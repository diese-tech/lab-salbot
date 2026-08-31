import { describe, expect, it } from "vitest";
import { completeMatch, getEligibleMatchesForCaptain, getEligibleMatchesForOperator, rescheduleMatch, setProofThread } from "./matches";

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

describe("getEligibleMatchesForOperator", () => {
  it("returns scheduled, non-archived matches from the current season without an org identity filter", async () => {
    const calls: string[] = [];
    const seasonBuilder = {
      select: () => seasonBuilder,
      eq: () => seasonBuilder,
      single: () => Promise.resolve({ data: { id: "season-current" }, error: null }),
    };
    const matchBuilder = {
      select: () => matchBuilder,
      eq: (column: string, value: unknown) => (calls.push(`eq:${column}:${value}`), matchBuilder),
      is: (column: string, value: unknown) => (calls.push(`is:${column}:${value}`), matchBuilder),
      gte: () => matchBuilder,
      order: () => matchBuilder,
      limit: () => Promise.resolve({ data: [{ id: "m-operator" }], error: null }),
    };
    const db = {
      from: (table: string) => table === "seasons" ? seasonBuilder : matchBuilder,
    } as never;

    const eligible = await getEligibleMatchesForOperator(db);

    expect(eligible).toEqual([{ id: "m-operator" }]);
    expect(calls).toContain("eq:season_id:season-current");
    expect(calls).toContain("eq:status:scheduled");
    expect(calls).toContain("is:archived_at:null");
    expect(calls.some((call) => call.startsWith("or:"))).toBe(false);
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

// AGENTS.md "No Silent Mutations" requires every `matches` write to record an
// `audit_logs` entry with the actor and old/new values. setProofThread used to
// update the row bare, on both first attachment and crash recovery.
describe("setProofThread audit trail", () => {
  function makeProofThreadDb(existing: Record<string, unknown>) {
    const audits: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      from(table: string) {
        if (table === "audit_logs") {
          return {
            insert(payload: Record<string, unknown>) {
              audits.push(payload);
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table !== "matches") throw new Error(`unexpected table ${table}`);
        const builder = {
          select() {
            return builder;
          },
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return builder;
          },
          eq() {
            return builder;
          },
          single() {
            return Promise.resolve({ data: existing, error: null });
          },
          then(resolve: (value: { error: null }) => unknown) {
            return Promise.resolve(resolve({ error: null }));
          },
        };
        return builder;
      },
    };
    return { db, audits, updates };
  }

  it("records the actor and the previous thread pointer on first attachment", async () => {
    const { db, audits, updates } = makeProofThreadDb({
      proof_thread_id: null,
      proof_thread_url: null,
      screenshot_expected: null,
    });

    await setProofThread(db as never, "m-5", "thread-1", "https://d/1", 3, "1234567890");

    expect(updates[0]).toEqual({
      proof_thread_id: "thread-1",
      proof_thread_url: "https://d/1",
      screenshot_expected: 3,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action_type: "proof_thread_recorded",
      entity_type: "match",
      entity_id: "m-5",
      actor_discord_id: "1234567890",
    });
    expect(audits[0].old_value_json).toMatchObject({ proof_thread_id: null });
    expect(audits[0].new_value_json).toMatchObject({ proof_thread_id: "thread-1" });
  });

  it("captures the replaced pointer when crash recovery re-attaches a thread", async () => {
    const { db, audits } = makeProofThreadDb({
      proof_thread_id: "stale-thread",
      proof_thread_url: "https://d/stale",
      screenshot_expected: 2,
    });

    await setProofThread(db as never, "m-6", "thread-2", "https://d/2", 3, "9876543210");

    expect(audits[0].old_value_json).toMatchObject({
      proof_thread_id: "stale-thread",
      screenshot_expected: 2,
    });
    expect(audits[0].new_value_json).toMatchObject({
      proof_thread_id: "thread-2",
      screenshot_expected: 3,
    });
  });
});
