import { describe, expect, it, vi } from "vitest";
import {
  cancelScouterDraft,
  confirmScouterDraft,
  extractScouterDraft,
  getScouterDraft,
  reviseScouterDraft,
  type ScouterDraft,
  type ScouterExtractInput,
  type ScouterSiteDependencies,
  ScouterIngestError,
} from "./scouter-ingest";

const input: ScouterExtractInput = {
  scoreboardImagePath: "scouters/session-1/game-1/scoreboard.png",
  detailsImagePath: "scouters/session-1/game-1/details.png",
  gameOrdinal: 1,
  hostedByDiscordId: "discord-host",
  seasonId: "preseason2",
};

const game = {
  smiteMatchId: "smite-1",
  gameMode: "Conquest",
  winningSide: "order" as const,
  matchLengthSeconds: 1_234,
  participants: Array.from({ length: 10 }, (_, index) => ({
    side: index < 5 ? ("order" as const) : ("chaos" as const),
    rawIgn: `Player${index + 1}`,
    kills: index,
    deaths: 1,
    assists: 2,
  })),
};

const diagnostics = {
  participantCount: 10,
  duplicateIgns: [],
  unlinkedIgns: [],
  ambiguousIgns: [],
  participants: game.participants.map((participant, index) => ({
    index,
    side: participant.side,
    rawIgn: participant.rawIgn,
    playerId: `player-${index + 1}`,
    identityStatus: "linked" as const,
  })),
};

const draftResponse = {
  draft_id: "draft-1",
  revision: 1,
  status: "pending",
  season_id: "preseason2",
  scouter_match_id: null,
  game_ordinal: 1,
  scoreboard_image_path: input.scoreboardImagePath,
  details_image_path: input.detailsImagePath,
  game,
  diagnostics,
};

const dependencies = (fetchImpl: ReturnType<typeof vi.fn>) => ({
  siteUrl: "https://sal.example",
  token: "internal-token",
  fetchImpl: fetchImpl as ScouterSiteDependencies["fetchImpl"],
});

describe("scouter draft transport", () => {
  it("extracts into a private draft with the internal bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(draftResponse));

    await expect(
      extractScouterDraft(input, dependencies(fetchImpl)),
    ).resolves.toMatchObject({
      draftId: "draft-1",
      revision: 1,
      status: "pending",
      seasonId: "preseason2",
      game,
    } satisfies Partial<ScouterDraft>);

    const [url, request] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://sal.example/api/scouters/extract");
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer internal-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(request.body))).toEqual({
      scoreboard_image_path: input.scoreboardImagePath,
      details_image_path: input.detailsImagePath,
      game_ordinal: 1,
      hosted_by_discord_id: "discord-host",
      season_id: "preseason2",
    });
  });

  it("gets, revises, and cancels the host-owned draft through scoped endpoints", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok(draftResponse))
      .mockResolvedValueOnce(ok({ ...draftResponse, revision: 2 }))
      .mockResolvedValueOnce(
        ok({ code: "cancelled", applied: true, status: "cancelled" }),
      );
    const deps = dependencies(fetchImpl);

    await getScouterDraft("draft/unsafe", "host+one", deps);
    await reviseScouterDraft(
      {
        draftId: "draft-1",
        hostedByDiscordId: "discord-host",
        expectedRevision: 1,
        game,
      },
      deps,
    );
    await expect(
      cancelScouterDraft("draft-1", "discord-host", deps),
    ).resolves.toEqual({
      code: "cancelled",
      applied: true,
    });

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://sal.example/api/scouters/drafts/draft%2Funsafe?hosted_by_discord_id=host%2Bone",
    );
    expect(fetchImpl.mock.calls[0][1].method).toBe("GET");
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty(
      "Content-Type",
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1].body))).toEqual({
      hosted_by_discord_id: "discord-host",
      expected_revision: 1,
      game,
    });
    expect(String(fetchImpl.mock.calls[2][0])).toBe(
      "https://sal.example/api/scouters/drafts/draft-1/cancel",
    );
  });

  it("confirms with optimistic revision and the optional audited override reason", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        code: "inserted",
        applied: true,
        draft_id: "draft-1",
        revision: 2,
        status: "confirmed",
        scouter_match_id: "match-1",
        scouter_game_id: "game-1",
        receipt_url: "https://sal.example/scouters/match-1?game=game-1",
        identity_override_applied: true,
        participants_summary: [],
      }),
    );

    await expect(
      confirmScouterDraft(
        {
          draftId: "draft-1",
          hostedByDiscordId: "discord-host",
          expectedRevision: 2,
          identityOverrideReason: "Verified against the roster sheet.",
        },
        dependencies(fetchImpl),
      ),
    ).resolves.toMatchObject({
      code: "inserted",
      applied: true,
      scouterMatchId: "match-1",
      scouterGameId: "game-1",
      identityOverrideApplied: true,
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({
      hosted_by_discord_id: "discord-host",
      expected_revision: 2,
      identity_override_reason: "Verified against the roster sheet.",
    });
  });

  it("surfaces OCR failures without treating them as a successful draft", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: "OCR response was not valid scouter data.",
        raw_response: "{bad output}",
      }),
    });

    await expect(
      extractScouterDraft(input, dependencies(fetchImpl)),
    ).rejects.toMatchObject({
      message: "OCR response was not valid scouter data.",
      status: 422,
      rawResponse: "{bad output}",
    } satisfies Partial<ScouterIngestError>);
  });

  it("rejects malformed draft and confirmation responses", async () => {
    const badDraft = vi.fn().mockResolvedValue(ok({ draft_id: "draft-1" }));
    await expect(
      extractScouterDraft(input, dependencies(badDraft)),
    ).rejects.toMatchObject({
      status: 502,
    });

    const badConfirm = vi.fn().mockResolvedValue(ok({ code: "inserted" }));
    await expect(
      confirmScouterDraft(
        {
          draftId: "draft-1",
          hostedByDiscordId: "discord-host",
          expectedRevision: 1,
        },
        dependencies(badConfirm),
      ),
    ).rejects.toMatchObject({ status: 502 });
  });
});

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
