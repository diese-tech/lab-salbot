import { describe, expect, it } from "vitest";
import { getPlayerScouterProfile } from "./scouters";

const rows = [
  {
    id: "participant-2",
    side: "chaos",
    kills: 2,
    deaths: 4,
    assists: 6,
    player_damage: 12000,
    game: {
      winning_side: "order",
      match: {
        season_id: "preseason2",
        season: {
          id: "preseason2",
          name: "Preseason 2",
          status: "pre-season",
          start_date: "2026-07-01",
        },
      },
    },
  },
  {
    id: "participant-1",
    side: "order",
    kills: 8,
    deaths: 2,
    assists: 10,
    player_damage: 28000,
    game: {
      winning_side: "order",
      match: {
        season_id: "preseason2",
        season: {
          id: "preseason2",
          name: "Preseason 2",
          status: "pre-season",
          start_date: "2026-07-01",
        },
      },
    },
  },
  {
    id: "participant-old",
    side: "chaos",
    kills: 4,
    deaths: 2,
    assists: 4,
    player_damage: 18000,
    game: {
      winning_side: "chaos",
      match: {
        season_id: "season1",
        season: {
          id: "season1",
          name: "Season 1",
          status: "complete",
          start_date: "2026-04-01",
        },
      },
    },
  },
];

function fakeDb() {
  const filters: Array<[string, unknown]> = [];
  const seasonBuilder = {
    select: () => seasonBuilder,
    eq: (column: string, value: unknown) => (
      filters.push([column, value]),
      seasonBuilder
    ),
    in: (column: string, values: string[]) => (
      filters.push([column, values]),
      seasonBuilder
    ),
    order: (column: string, options: unknown) => (
      filters.push([column, options]),
      seasonBuilder
    ),
    limit: (value: number) => (filters.push(["limit", value]), seasonBuilder),
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
  const participantBuilder = {
    select: () => participantBuilder,
    eq: (column: string, value: unknown) => (
      filters.push([column, value]),
      participantBuilder
    ),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return {
    filters,
    db: {
      from: (table: string) =>
        table === "seasons" ? seasonBuilder : participantBuilder,
    } as never,
  };
}

describe("getPlayerScouterProfile", () => {
  it("defaults to the canonical current scouter season and aggregates games", async () => {
    const { db, filters } = fakeDb();

    const profile = await getPlayerScouterProfile(db, "player-1");

    expect(filters).toEqual(
      expect.arrayContaining([
        ["status", ["active", "pre-season"]],
        ["is_current", true],
        ["player_id", "player-1"],
      ]),
    );
    expect(profile.selectedSeason?.id).toBe("preseason2");
    expect(profile.availableSeasons.map((season) => season.id)).toEqual([
      "preseason2",
      "season1",
    ]);
    expect(profile.summary).toEqual({
      gamesPlayed: 2,
      wins: 1,
      losses: 1,
      averageKda: 5.5,
      averageDamage: 20000,
    });
  });

  it("uses a requested season only when the player has scouter games in it", async () => {
    const { db } = fakeDb();

    const historical = await getPlayerScouterProfile(db, "player-1", "season1");
    const invalid = await getPlayerScouterProfile(db, "player-1", "unknown");

    expect(historical.selectedSeason?.id).toBe("season1");
    expect(historical.summary).toMatchObject({ gamesPlayed: 1, wins: 1 });
    expect(invalid.selectedSeason?.id).toBe("preseason2");
  });
});
