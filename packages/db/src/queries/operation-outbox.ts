import type { SupabaseClient } from "../client";
import { parseDatabaseJsonObject } from "../json";
import type { Database } from "../types/database.types";

type RawOutboxRow = Database["public"]["Tables"]["operation_outbox"]["Row"];

export type OperationOutboxRow = Omit<RawOutboxRow, "payload"> & {
  payload: Record<string, unknown>;
};

export type PendingActionDecision = "approve" | "deny" | "needs_info";
export type PendingStatDecision = "approve" | "deny";

export type PendingActionDecisionResult = {
  code: string;
  actionId: string;
  actionType: string;
  finalStatus: string;
  applied: boolean;
  matchId: string | null;
  note: string | null;
  outboxIds: string[];
};

export type PendingStatDecisionResult = {
  code: string;
  recordId: string;
  finalStatus: string;
  applied: boolean;
  matchId: string;
  playerId: string | null;
  note: string | null;
  outboxIds: string[];
};

function objectResult(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid result.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} returned an invalid result.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requiredString(value, label);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} returned an invalid result.`);
  }
  return value;
}

function parsePendingActionDecision(value: unknown): PendingActionDecisionResult {
  const label = "resolve_pending_action";
  const row = objectResult(value, label);
  if (typeof row.applied !== "boolean") throw new Error(`${label} returned an invalid result.`);
  return {
    code: requiredString(row.code, label),
    actionId: requiredString(row.actionId, label),
    actionType: requiredString(row.actionType, label),
    finalStatus: requiredString(row.finalStatus, label),
    applied: row.applied,
    matchId: nullableString(row.matchId, label),
    note: nullableString(row.note, label),
    outboxIds: stringArray(row.outboxIds, label),
  };
}

function parsePendingStatDecision(value: unknown): PendingStatDecisionResult {
  const label = "resolve_pending_stat_record";
  const row = objectResult(value, label);
  if (typeof row.applied !== "boolean") throw new Error(`${label} returned an invalid result.`);
  return {
    code: requiredString(row.code, label),
    recordId: requiredString(row.recordId, label),
    finalStatus: requiredString(row.finalStatus, label),
    applied: row.applied,
    matchId: requiredString(row.matchId, label),
    playerId: nullableString(row.playerId, label),
    note: nullableString(row.note, label),
    outboxIds: stringArray(row.outboxIds, label),
  };
}

export async function resolvePendingAction(
  db: SupabaseClient,
  params: {
    actionId: string;
    actorDiscordId: string;
    decision: PendingActionDecision;
    note?: string;
  },
): Promise<PendingActionDecisionResult> {
  const { data, error } = await db.rpc("resolve_pending_action", {
    p_action_id: params.actionId,
    p_actor_discord_id: params.actorDiscordId,
    p_decision: params.decision,
    p_note: params.note,
  });
  if (error) throw error;
  return parsePendingActionDecision(data);
}

export async function resolvePendingStatRecord(
  db: SupabaseClient,
  params: {
    recordId: string;
    actorDiscordId: string;
    decision: PendingStatDecision;
    note?: string;
  },
): Promise<PendingStatDecisionResult> {
  const { data, error } = await db.rpc("resolve_pending_stat_record", {
    p_record_id: params.recordId,
    p_actor_discord_id: params.actorDiscordId,
    p_decision: params.decision,
    p_note: params.note,
  });
  if (error) throw error;
  return parsePendingStatDecision(data);
}

function parseOutboxRow(value: RawOutboxRow): OperationOutboxRow {
  if (!value.id || !value.topic || value.state !== "processing" || value.attempts < 1) {
    throw new Error("claim_operation_outbox returned an invalid result.");
  }
  return {
    ...value,
    payload: parseDatabaseJsonObject(value.payload, "operation_outbox.payload"),
  };
}

export async function claimOperationOutbox(
  db: SupabaseClient,
  workerId: string,
  limit = 25,
): Promise<OperationOutboxRow[]> {
  const { data, error } = await db.rpc("claim_operation_outbox", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []).map(parseOutboxRow);
}

export async function completeOperationOutbox(
  db: SupabaseClient,
  outboxId: string,
  workerId: string,
  externalId?: string,
): Promise<void> {
  const { error } = await db.rpc("complete_operation_outbox", {
    p_outbox_id: outboxId,
    p_worker_id: workerId,
    p_external_id: externalId,
  });
  if (error) throw error;
}

export async function failOperationOutbox(
  db: SupabaseClient,
  outboxId: string,
  workerId: string,
  errorMessage: string,
  retryAfterSeconds: number,
): Promise<{ state: string }> {
  const { data, error } = await db.rpc("fail_operation_outbox", {
    p_outbox_id: outboxId,
    p_worker_id: workerId,
    p_error: errorMessage,
    p_retry_after_seconds: retryAfterSeconds,
  });
  if (error) throw error;
  const result = objectResult(data, "fail_operation_outbox");
  return { state: requiredString(result.state, "fail_operation_outbox") };
}
