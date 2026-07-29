import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("@salbot/db", () => ({
  getCaptainByDiscordId: vi.fn(),
  getCurrentScouterSeason: vi.fn(),
  getScouterMatchReceipt: vi.fn(),
  isAdminUser: vi.fn(),
}));
import {
  getCaptainByDiscordId,
  getCurrentScouterSeason,
  isAdminUser,
} from "@salbot/db";
import {
  buildScouterReceiptEmbed,
  buildUploadButton,
  execute,
  parseUploadState,
  type ScouterReceipt,
} from "./log-scouter";

const receipt: ScouterReceipt = {
  id: "match-1",
  seasonId: "preseason2",
  hostedAt: "2026-07-29T12:00:00.000Z",
  games: [
    {
      id: "game-1",
      gameOrdinal: 1,
      smiteMatchId: "smite-1",
      winningSide: "order",
      scoreboardImagePath: "scouters/session/game-1/scoreboard.png",
      detailsImagePath: "scouters/session/game-1/details.png",
      participants: [
        { rawIgn: "Known1", playerId: "player-1" },
        { rawIgn: "Known2", playerId: "player-2" },
      ],
    },
    {
      id: "game-2",
      gameOrdinal: 2,
      smiteMatchId: "smite-2",
      winningSide: "chaos",
      scoreboardImagePath: "scouters/match-1/game-2/scoreboard.jpg",
      detailsImagePath: "scouters/match-1/game-2/details.jpg",
      participants: [
        { rawIgn: "Known1", playerId: "player-1" },
        { rawIgn: "UnrecognizedIGN", playerId: null },
      ],
    },
  ],
};

describe("/log-scouter state and receipt", () => {
  it("posts the upload workflow publicly in the invoking channel", async () => {
    vi.mocked(getCaptainByDiscordId).mockResolvedValue({
      id: "captain",
    } as never);
    vi.mocked(isAdminUser).mockResolvedValue(false);
    vi.mocked(getCurrentScouterSeason).mockResolvedValue({
      id: "preseason2",
      name: "Preseason 2",
      status: "pre-season",
      startDate: "2026-07-01",
    });
    const reply = vi.fn();

    await execute({
      user: { id: "123456789012345678" },
      options: { getInteger: () => 2 },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
    expect(reply.mock.calls[0][0]).not.toHaveProperty("ephemeral");
  });

  it("round-trips the durable identifiers needed for a two-game happy path", () => {
    const state = {
      matchScopeId: "123e4567-e89b-12d3-a456-426614174000",
      gameOrdinal: 2,
      totalGames: 2,
      seasonId: "987fcdeb-51a2-43d7-8abc-1234567890ab",
      ownerDiscordId: "123456789012345678",
    };
    const button = buildUploadButton(state);
    const customId = (button.toJSON() as { custom_id: string }).custom_id;

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseUploadState(customId)).toEqual(state);
  });

  it("summarizes both games and calls out unrecognized IGNs without failing the receipt", () => {
    const json = buildScouterReceiptEmbed(
      receipt,
      "discord-host",
      "https://sal.example/scouters/match-1",
    ).toJSON();
    const fields = Object.fromEntries(
      (json.fields ?? []).map((field) => [field.name, field.value]),
    );

    expect(fields.Games).toBe("2");
    expect(fields.Results).toContain("Game 1: Order");
    expect(fields.Results).toContain("Game 2: Chaos");
    expect(fields.Participants).toContain("4 extracted");
    expect(fields.Participants).toContain("3 linked");
    expect(fields["Unlinked IGNs"]).toBe("UnrecognizedIGN");
  });
});
