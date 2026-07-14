import { describe, expect, it } from "vitest";
import { claimPendingActionForApproval, denyPendingAction, needsInfoPendingAction } from "./pending-actions";

// Regression test for a bug where these functions checked `count` from
// Supabase without requesting it (`{ count: 'exact' }`), so `count` was
// always null and every claim/deny/needs-info call reported "already
// processed by another admin" — even on the very first click — while the
// underlying UPDATE succeeded anyway, silently skipping the real approval
// side effects (audit log, embed update, captain notification).

type Row = { id: string; status: string; [key: string]: unknown };

function makeDb(rows: Map<string, Row>) {
  return {
    from: (table: string) => {
      if (table !== "pending_actions") throw new Error(`unexpected table ${table}`);
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

describe("pending action status guard (claim/deny/needs-info)", () => {
  it("claimPendingActionForApproval succeeds once on a pending row, then reports already processed", async () => {
    const rows = new Map([["pa-1", { id: "pa-1", status: "pending" }]]);
    const db = makeDb(rows) as never;

    expect(await claimPendingActionForApproval(db, "pa-1", "admin-1")).toBe(true);
    expect(rows.get("pa-1")?.status).toBe("approved");

    expect(await claimPendingActionForApproval(db, "pa-1", "admin-2")).toBe(false);
  });

  it("denyPendingAction succeeds once, and a later needs-info on the same row correctly fails", async () => {
    const rows = new Map([["pa-2", { id: "pa-2", status: "pending" }]]);
    const db = makeDb(rows) as never;

    expect(await denyPendingAction(db, "pa-2", "admin-1", "bad score")).toBe(true);
    expect(rows.get("pa-2")?.status).toBe("denied");

    expect(await needsInfoPendingAction(db, "pa-2", "admin-1", "need more info")).toBe(false);
  });

  it("needsInfoPendingAction succeeds on a fresh pending row", async () => {
    const rows = new Map([["pa-3", { id: "pa-3", status: "pending" }]]);
    const db = makeDb(rows) as never;

    expect(await needsInfoPendingAction(db, "pa-3", "admin-1", "need more info")).toBe(true);
    expect(rows.get("pa-3")?.status).toBe("pending_info");
  });
});
