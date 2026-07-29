import { describe, expect, it, vi } from "vitest";
import {
  ScouterIngestError,
  submitScouterGame,
  type ScouterIngestInput,
} from "./scouter-ingest";

const input: ScouterIngestInput = {
  scoreboardImagePath: "scouters/session-1/game-1/scoreboard.png",
  detailsImagePath: "scouters/session-1/game-1/details.png",
  gameOrdinal: 1,
  hostedByDiscordId: "discord-host",
  seasonId: "preseason2",
};

describe("submitScouterGame", () => {
  it("sends the internal bearer token and returns a successful extraction", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        scouter_match_id: "match-1",
        scouter_game_id: "game-1",
        receipt_url: "https://sal.example/scouters/match-1?game=game-1",
        participants_summary: [
          {
            id: "participant-1",
            side: "order",
            rawIgn: "Known",
            playerId: "player-1",
          },
          {
            id: "participant-2",
            side: "chaos",
            rawIgn: "Unknown",
            playerId: null,
          },
        ],
      }),
    });

    const result = await submitScouterGame(input, {
      siteUrl: "https://sal.example",
      token: "internal-token",
      fetchImpl,
    });

    expect(result).toMatchObject({
      code: "inserted",
      scouterMatchId: "match-1",
      scouterGameId: "game-1",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://sal.example/api/scouters/ingest");
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

  it("surfaces an OCR failure and raw response without treating it as a write", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: "OCR response was not valid scouter data.",
        raw_response: "{bad output}",
      }),
    });

    await expect(
      submitScouterGame(input, {
        siteUrl: "https://sal.example",
        token: "internal-token",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      message: "OCR response was not valid scouter data.",
      status: 422,
      rawResponse: "{bad output}",
    } satisfies Partial<ScouterIngestError>);
  });

  it("returns an idempotent existing result for a repeated SMITE match", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        existing_scouter_game_id: "game-existing",
        receipt_url:
          "https://sal.example/scouters/match-existing?game=game-existing",
      }),
    });

    await expect(
      submitScouterGame(input, {
        siteUrl: "https://sal.example",
        token: "internal-token",
        fetchImpl,
      }),
    ).resolves.toEqual({
      code: "existing",
      existingScouterGameId: "game-existing",
      receiptUrl:
        "https://sal.example/scouters/match-existing?game=game-existing",
    });
  });
});
