import { describe, expect, it, vi } from "vitest";
import {
  claimPendingActionForApproval,
  denyPendingAction,
  getActiveMatchResultPendingAction,
  needsInfoPendingAction,
} from "./pending-actions";

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

describe('active match-result recovery', () => {
  it('loads the existing actionable submission and its original host', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'action-1',
        match_id: 'match-1',
        requested_by_discord_id: 'original-host',
        status: 'pending_info',
        payload_json: { winnerOrgId: 'org-home', score: '2-1' },
        admin_review_message_id: 'review-1',
        public_receipt_message_id: 'receipt-1',
      },
      error: null,
    });
    const inFilter = vi.fn(() => ({ maybeSingle }));
    const eqType = vi.fn(() => ({ in: inFilter }));
    const eqMatch = vi.fn(() => ({ eq: eqType }));
    const select = vi.fn(() => ({ eq: eqMatch }));
    const from = vi.fn(() => ({ select }));

    await expect(
      getActiveMatchResultPendingAction({ from } as never, 'match-1'),
    ).resolves.toEqual({
      id: 'action-1',
      matchId: 'match-1',
      requestedByDiscordId: 'original-host',
      status: 'pending_info',
      payloadJson: {
        winnerOrgId: 'org-home',
        score: '2-1',
        parsed: {
          winnerGames: 2,
          loserGames: 1,
          gamesPlayed: 3,
          expectedScreenshots: 3,
        },
      },
      adminReviewMessageId: 'review-1',
      publicReceiptMessageId: 'receipt-1',
    });

    expect(from).toHaveBeenCalledWith('pending_actions');
    expect(eqMatch).toHaveBeenCalledWith('match_id', 'match-1');
    expect(eqType).toHaveBeenCalledWith('type', 'match_result');
    expect(inFilter).toHaveBeenCalledWith('status', ['pending', 'pending_info']);
  });
});
