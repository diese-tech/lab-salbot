import { describe, expect, it } from "vitest";
import { completeMatch, getEligibleMatchesForCaptain, rescheduleMatch } from "./matches";

// Regression test for F-02b: completeMatch/rescheduleMatch used to update the
// `matches` row unconditionally, with no `status = 'scheduled'` precondition.
// A second approval of a duplicate submission, or an approval landing after
// an admin corrected the score on the site, would silently overwrite the
// official result. Both functions now require `status = 'scheduled'` and
// report back (via a boolean, not a throw) whether the row was actually
// updated — mirroring the atomic-claim pattern in pending-actions.ts.

type Row = { id: string; status: string; [key: string]: unknown };

function makeDb(rows: Map<string, Row>) {
  return {
    from: (table: string) => {
      if (table !== "matches") throw new Error(`unexpected table ${table}`);
      let updatePayload: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const builder = {
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        select() {
          const matched = [...rows.values()].filter((row) =>
            filters.every(([col, val]) => row[col] === val)
          );
          for (const row of matched) Object.assign(row, updatePayload);
          return Promise.resolve({ data: matched.map((row) => ({ id: row.id })), error: null });
        },
      };
      return builder;
    },
  };
}

describe("completeMatch status precondition", () => {
  it("returns true and updates the row when the match is still scheduled", async () => {
    const rows = new Map([["m-1", { id: "m-1", status: "scheduled" }]]);
    const db = makeDb(rows) as never;

    const result = await completeMatch(db, "m-1", {
      winnerOrgId: "org-1",
      homeScore: 2,
      awayScore: 0,
      score: "2-0",
    });

    expect(result).toBe(true);
    expect(rows.get("m-1")?.status).toBe("completed");
    expect(rows.get("m-1")?.winner_org_id).toBe("org-1");
  });

  it("returns false without throwing when the match is no longer scheduled", async () => {
    const rows = new Map([["m-2", { id: "m-2", status: "completed" }]]);
    const db = makeDb(rows) as never;

    const result = await completeMatch(db, "m-2", {
      winnerOrgId: "org-1",
      homeScore: 2,
      awayScore: 0,
      score: "2-0",
    });

    expect(result).toBe(false);
    // Row is untouched — no overwrite of an already-completed/corrected result.
    expect(rows.get("m-2")?.status).toBe("completed");
    expect(rows.get("m-2")?.winner_org_id).toBeUndefined();
  });
});

describe("getEligibleMatchesForCaptain archived filter", () => {
  it("excludes archived and other-season matches even when still scheduled", async () => {
    const rows: Row[] = [
      { id: "m-5", season_id: "season-current", status: "scheduled", home_org_id: "org-1", scheduled_date: "2099-01-01", archived_at: null },
      { id: "m-6", season_id: "season-current", status: "scheduled", home_org_id: "org-1", scheduled_date: "2099-01-01", archived_at: "2026-07-01T00:00:00Z" },
      { id: "m-7", season_id: "season-old", status: "scheduled", home_org_id: "org-1", scheduled_date: "2099-01-01", archived_at: null },
    ];
    const filters: Array<(row: Row) => boolean> = [];
    const builder = {
      select: () => builder,
      or: () => builder,
      eq: (col: string, val: unknown) => (filters.push((row) => row[col] === val), builder),
      is: (col: string, val: unknown) => (filters.push((row) => row[col] === val), builder),
      gte: (col: string, val: string) => (filters.push((row) => String(row[col]) >= val), builder),
      order: () => builder,
      then: (resolve: (res: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows.filter((row) => filters.every((f) => f(row))), error: null }),
    };
    const db = { from: () => builder } as never;

    const eligible = await getEligibleMatchesForCaptain(db, "org-1", "season-current");

    expect(eligible.map((row: Row) => row.id)).toEqual(["m-5"]);
  });
});

describe("rescheduleMatch status precondition", () => {
  it("returns true and updates the row when the match is still scheduled", async () => {
    const rows = new Map([["m-3", { id: "m-3", status: "scheduled" }]]);
    const db = makeDb(rows) as never;

    const result = await rescheduleMatch(db, "m-3", { newDate: "2026-08-01", newTime: "19:00" });

    expect(result).toBe(true);
    expect(rows.get("m-3")?.scheduled_date).toBe("2026-08-01");
    expect(rows.get("m-3")?.scheduled_time).toBe("19:00");
  });

  it("returns false without throwing when the match is no longer scheduled", async () => {
    const rows = new Map([["m-4", { id: "m-4", status: "completed" }]]);
    const db = makeDb(rows) as never;

    const result = await rescheduleMatch(db, "m-4", { newDate: "2026-08-01", newTime: "19:00" });

    expect(result).toBe(false);
    expect(rows.get("m-4")?.scheduled_date).toBeUndefined();
  });
});
