import type { SupabaseClient } from '../client';
import {
  parsePendingActionPayload,
  type PendingActionPayload,
  type PendingActionType,
} from '@salbot/shared';
import { toDatabaseJson } from '../json';

export async function createPendingAction(
  db: SupabaseClient,
  params: {
    type: PendingActionType;
    requestedByDiscordId: string;
    matchId?: string;
    divisionId?: string;
    payloadJson: Record<string, unknown>;
  }
) {
  const { data, error } = await db
    .from('pending_actions')
    .insert({
      type: params.type,
      requested_by_discord_id: params.requestedByDiscordId,
      match_id: params.matchId ?? null,
      division_id: params.divisionId ?? null,
      payload_json: toDatabaseJson(
        parsePendingActionPayload(params.type, params.payloadJson),
      ),
    })
    .select()
    .single();

  if (error) throw error;
  return data as { id: string; type: string; status: string; [key: string]: unknown };
}

export async function updatePendingActionMessages(
  db: SupabaseClient,
  id: string,
  params: {
    adminReviewMessageId: string;
    publicReceiptMessageId?: string;
  }
) {
  const { error } = await db
    .from('pending_actions')
    .update({
      admin_review_message_id: params.adminReviewMessageId,
      public_receipt_message_id: params.publicReceiptMessageId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

export async function getPendingAction(db: SupabaseClient, id: string) {
  const { data, error } = await db
    .from('pending_actions')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  if (!isPendingActionType(data.type)) {
    throw new Error(`Pending action ${id} has an invalid type.`);
  }
  const payloadJson = parsePendingActionPayload(data.type, data.payload_json);
  return {
    ...data,
    type: data.type,
    payload_json: payloadJson,
  } as {
    id: string;
    type: PendingActionType;
    status: string;
    requested_by_discord_id: string;
    match_id: string | null;
    division_id: string | null;
    payload_json: PendingActionPayload;
    admin_note: string | null;
    admin_review_message_id: string | null;
    public_receipt_message_id: string | null;
    approved_by_discord_id: string | null;
    approved_at: string | null;
  };
}

function isPendingActionType(value: string): value is PendingActionType {
  return ['match_result', 'reschedule', 'admin_review', 'alias_change'].includes(value);
}

// Atomic claim — only succeeds if status is still 'pending'. Returns false if already processed.
export async function claimPendingActionForApproval(
  db: SupabaseClient,
  id: string,
  adminDiscordId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('pending_actions')
    .update({
      status: 'approved',
      approved_by_discord_id: adminDiscordId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function denyPendingAction(
  db: SupabaseClient,
  id: string,
  adminDiscordId: string,
  note: string
): Promise<boolean> {
  const { data, error } = await db
    .from('pending_actions')
    .update({
      status: 'denied',
      approved_by_discord_id: adminDiscordId,
      approved_at: new Date().toISOString(),
      admin_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function needsInfoPendingAction(
  db: SupabaseClient,
  id: string,
  adminDiscordId: string,
  note: string
): Promise<boolean> {
  const { data, error } = await db
    .from('pending_actions')
    .update({
      status: 'pending_info',
      admin_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
