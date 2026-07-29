import { describe, expect, it, vi } from "vitest";
import {
  claimOperationOutbox,
  completeOperationOutbox,
  failOperationOutbox,
  getOperationOutboxHealth,
  resolvePendingAction,
  resolvePendingStatRecord,
} from "./operation-outbox";

function rpcDb(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as never;
}

describe("transactional decision RPCs", () => {
  it("resolves pending actions through the service RPC", async () => {
    const db = rpcDb({
      code: "applied",
      actionId: "action-1",
      actionType: "match_result",
      finalStatus: "approved",
      applied: true,
      matchId: "match-1",
      note: null,
      outboxIds: ["outbox-1"],
    });

    await expect(resolvePendingAction(db, {
      actionId: "action-1",
      actorDiscordId: "admin-1",
      decision: "approve",
    })).resolves.toMatchObject({ code: "applied", finalStatus: "approved" });
    expect(db.rpc).toHaveBeenCalledWith("resolve_pending_action", {
      p_action_id: "action-1",
      p_actor_discord_id: "admin-1",
      p_decision: "approve",
      p_note: undefined,
    });
  });

  it("resolves pending stat records through the service RPC", async () => {
    const db = rpcDb({
      code: "applied",
      recordId: "stat-1",
      finalStatus: "rejected",
      applied: false,
      matchId: "match-1",
      playerId: "player-1",
      note: "bad OCR",
      outboxIds: ["outbox-1"],
    });

    await expect(resolvePendingStatRecord(db, {
      recordId: "stat-1",
      actorDiscordId: "admin-1",
      decision: "deny",
      note: "bad OCR",
    })).resolves.toMatchObject({ finalStatus: "rejected" });
  });

  it("rejects malformed decision results", async () => {
    const db = rpcDb({ code: "applied", finalStatus: 123 });

    await expect(resolvePendingAction(db, {
      actionId: "action-1",
      actorDiscordId: "admin-1",
      decision: "approve",
    })).rejects.toThrow("invalid result");
  });
});

describe("operation outbox RPCs", () => {
  it("claims and validates leased rows", async () => {
    const db = rpcDb([{
      id: "outbox-1",
      topic: "standings_recalculation",
      aggregate_type: "match",
      aggregate_id: "match-1",
      event_type: "match_result_recorded",
      deduplication_key: "match-1:standings",
      payload: { matchId: "match-1" },
      state: "processing",
      attempts: 1,
      available_at: "2026-07-29T00:00:00.000Z",
      lease_owner: "worker-1",
      lease_expires_at: "2026-07-29T00:01:00.000Z",
      last_error: null,
      external_id: null,
      completed_at: null,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
    }]);

    await expect(claimOperationOutbox(db, "worker-1", 10)).resolves.toHaveLength(1);
    expect(db.rpc).toHaveBeenCalledWith("claim_operation_outbox", {
      p_worker_id: "worker-1",
      p_limit: 10,
    });
  });

  it("acknowledges and fails rows through lease-owner RPCs", async () => {
    const db = rpcDb({ code: "completed", state: "completed" });

    await completeOperationOutbox(db, "outbox-1", "worker-1", "message-1");
    expect(db.rpc).toHaveBeenLastCalledWith("complete_operation_outbox", {
      p_outbox_id: "outbox-1",
      p_worker_id: "worker-1",
      p_external_id: "message-1",
    });

    await failOperationOutbox(db, "outbox-1", "worker-1", "network down", 20);
    expect(db.rpc).toHaveBeenLastCalledWith("fail_operation_outbox", {
      p_outbox_id: "outbox-1",
      p_worker_id: "worker-1",
      p_error: "network down",
      p_retry_after_seconds: 20,
    });
  });

  it("reports dead letters and the oldest active event", async () => {
    const deadLetters = {
      select: () => deadLetters,
      eq: () => Promise.resolve({ count: 2, error: null }),
    };
    const oldest = {
      select: () => oldest,
      in: () => oldest,
      order: () => oldest,
      limit: () => oldest,
      maybeSingle: () => Promise.resolve({
        data: { created_at: "2026-07-29T00:00:00.000Z" },
        error: null,
      }),
    };
    const db = {
      from: vi.fn()
        .mockReturnValueOnce(deadLetters)
        .mockReturnValueOnce(oldest),
    } as never;

    await expect(getOperationOutboxHealth(db)).resolves.toEqual({
      deadLetterCount: 2,
      oldestPendingAt: "2026-07-29T00:00:00.000Z",
    });
  });
});
