import { describe, expect, it } from "vitest";
import { getCurrentScouterSeason, getScouterMatchReceipt } from "./scouters";

describe("scouter queries", () => {
  it("selects the most recent active or pre-season season", async () => {
    const calls: Array<[string, unknown]> = [];
    const builder = {
      select: () => builder,
      in: (column: string, values: string[]) => (
        calls.push([column, values]),
        builder
      ),
      order: (column: string, options: unknown) => (
        calls.push([column, options]),
        builder
      ),
      limit: (value: number) => (calls.push(["limit", value]), builder),
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: "preseason2",
            name: "Preseason 2",
            status: "pre-season",
            start_date: "2026-07-01",
          },
          error: null,
        }),
    };
    const db = {
      from: (table: string) => {
        expect(table).toBe("seasons");
        return builder;
      },
    } as never;

    await expect(getCurrentScouterSeason(db)).resolves.toMatchObject({
      id: "preseason2",
    });
    expect(calls).toContainEqual(["status", ["active", "pre-season"]]);
    expect(calls).toContainEqual(["start_date", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 1]);
  });

  it("loads games and participants from Supabase for a public receipt", async () => {
    const filters: Array<[string, unknown]> = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (
        filters.push([column, value]),
        builder
      ),
      single: () =>
        Promise.resolve({
          data: {
            id: "match-1",
            season_id: "preseason2",
            hosted_at: "2026-07-29T12:00:00Z",
            games: [
              {
                id: "game-1",
                game_ordinal: 1,
                smite_match_id: "smite-1",
                winning_side: "order",
                scoreboard_image_path: "score.png",
                details_image_path: "details.png",
                participants: [{ raw_ign: "Known", player_id: "player-1" }],
              },
            ],
          },
          error: null,
        }),
    };
    const db = {
      from: (table: string) => {
        expect(table).toBe("scouter_matches");
        return builder;
      },
    } as never;

    const result = await getScouterMatchReceipt(db, "match-1");

    expect(filters).toEqual([["id", "match-1"]]);
    expect(result.games[0]).toMatchObject({
      gameOrdinal: 1,
      participants: [{ rawIgn: "Known", playerId: "player-1" }],
    });
  });
});
