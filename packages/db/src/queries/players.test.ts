import { describe, expect, it } from "vitest";
import { getCaptainByDiscordId } from "./players";

describe("getCaptainByDiscordId current-season contract", () => {
  it("resolves captain, organization, and division through the current season roster", async () => {
    const filters: Array<[string, unknown]> = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push([column, value]), builder),
      single: () => Promise.resolve({
        data: {
          season_id: "season-current",
          org_id: "org-current",
          division_id: "terra",
          is_captain: true,
          player: {
            id: "player-1",
            discord_username: "captain",
            discord_id: "discord-1",
            ign: "Captain",
            display_alias: null,
          },
        },
        error: null,
      }),
    };
    const db = {
      from: (table: string) => {
        expect(table).toBe("season_rosters");
        return builder;
      },
    } as never;

    const captain = await getCaptainByDiscordId(db, "discord-1");

    expect(filters).toEqual(expect.arrayContaining([
      ["is_captain", true],
      ["roster_status", "active"],
      ["season.is_current", true],
      ["player.discord_id", "discord-1"],
    ]));
    expect(captain).toMatchObject({
      id: "player-1",
      season_id: "season-current",
      org_id: "org-current",
      division_id: "terra",
      is_captain: true,
    });
  });
});
