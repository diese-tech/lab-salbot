import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("@salbot/db", () => ({
  getPlayerByDiscordId: vi.fn(),
  getPlayerScouterProfile: vi.fn(),
}));

import { getPlayerByDiscordId, getPlayerScouterProfile } from "@salbot/db";
import { execute, handleSeasonSelect } from "./profile";

const player = {
  id: "player-1",
  discord_id: "target-discord",
  discord_username: "target",
  ign: "TargetIGN",
  display_alias: "Target",
};

const profile = {
  selectedSeason: {
    id: "preseason2",
    name: "Preseason 2",
    status: "pre-season",
    startDate: "2026-07-01",
  },
  availableSeasons: [
    {
      id: "preseason2",
      name: "Preseason 2",
      status: "pre-season",
      startDate: "2026-07-01",
    },
    {
      id: "season1",
      name: "Season 1",
      status: "complete",
      startDate: "2026-04-01",
    },
  ],
  summary: {
    gamesPlayed: 2,
    wins: 1,
    losses: 1,
    averageKda: 5.5,
    averageDamage: 20000,
  },
};

describe("/profile", () => {
  it("shows an ephemeral scouter summary, selector, and site deep link", async () => {
    vi.mocked(getPlayerByDiscordId).mockResolvedValue(player as never);
    vi.mocked(getPlayerScouterProfile).mockResolvedValue(profile);
    const reply = vi.fn();

    await execute(
      {
        user: { id: "owner-discord" },
        options: { getUser: () => ({ id: "target-discord" }) },
        reply,
      } as never,
      { siteUrl: "https://sal.example" },
    );

    const payload = reply.mock.calls[0][0];
    expect(payload.ephemeral).toBe(true);
    const fields = Object.fromEntries(
      payload.embeds[0]
        .toJSON()
        .fields.map((field: { name: string; value: string }) => [
          field.name,
          field.value,
        ]),
    );
    expect(fields.Record).toBe("1-1");
    expect(fields["Avg KDA"]).toBe("5.50");
    const components = payload.components.map(
      (row: { toJSON: () => unknown }) => row.toJSON(),
    );
    expect(JSON.stringify(components)).toContain(
      "https://sal.example/players/player-1?season=preseason2",
    );
    expect(JSON.stringify(components)).toContain(
      "profile_season:owner-discord:target-discord",
    );
  });

  it("updates the same ephemeral response for a selected season", async () => {
    vi.mocked(getPlayerByDiscordId).mockResolvedValue(player as never);
    vi.mocked(getPlayerScouterProfile).mockResolvedValue({
      ...profile,
      selectedSeason: profile.availableSeasons[1],
    });
    const update = vi.fn();

    await handleSeasonSelect(
      {
        customId: "profile_season:owner-discord:target-discord",
        user: { id: "owner-discord" },
        values: ["season1"],
        update,
      } as never,
      { siteUrl: "https://sal.example" },
    );

    expect(getPlayerScouterProfile).toHaveBeenLastCalledWith(
      {},
      "player-1",
      "season1",
    );
    expect(update).toHaveBeenCalledOnce();
  });
});
