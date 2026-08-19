import type { SupabaseClient } from '../client';
import { parseMatchResultPayload, type MatchResultPayload } from '@salbot/shared';
import { toDatabaseJson } from '../json';

export type CreatedMatchResultAction = {
  code: 'created' | 'existing';
  created: boolean;
  actionId: string;
  pendingActionId: string;
  reportId: string;
  matchId: string;
  hostDiscordId: string;
  status: string;
  revision: number;
};

export async function createMatchResultActionWithReport(
  db: SupabaseClient,
  matchId: string,
  hostDiscordId: string,
  payload: MatchResultPayload,
): Promise<CreatedMatchResultAction> {
  const canonicalPayload = parseMatchResultPayload(payload);
  // Keep the compatibility cast isolated until the protected sal-database
  // release is pinned and generated types are refreshed in this consumer.
  const rpc = db.rpc as unknown as (
    name: 'create_match_result_action_with_report',
    args: { p_match_id: string; p_host_discord_id: string; p_payload: unknown },
  ) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc('create_match_result_action_with_report', {
    p_match_id: matchId,
    p_host_discord_id: hostDiscordId,
    p_payload: toDatabaseJson(canonicalPayload),
  });

  if (error) throw error;
  if (!isCreatedMatchResultAction(data) || data.matchId !== matchId) {
    throw new Error('Database returned an invalid atomic match-result action.');
  }
  return data;
}

export type EnsuredMatchReport = {
  code: string;
  created: boolean;
  reportId: string;
  pendingActionId: string;
  matchId: string;
  hostDiscordId: string;
  status: string;
  revision: number;
};

export async function ensureMatchReportForPendingAction(
  db: SupabaseClient,
  pendingActionId: string,
  hostDiscordId: string,
): Promise<EnsuredMatchReport> {
  // Keep the compatibility cast isolated until the coordinated sal-database
  // release is pinned and generated types are refreshed in this consumer.
  const rpc = db.rpc as unknown as (
    name: 'ensure_match_report_for_pending_action',
    args: { p_pending_action_id: string; p_host_discord_id: string },
  ) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc('ensure_match_report_for_pending_action', {
    p_pending_action_id: pendingActionId,
    p_host_discord_id: hostDiscordId,
  });

  if (error) throw error;
  if (!isEnsuredMatchReport(data)) {
    throw new Error('Database returned an invalid match report result.');
  }
  return data;
}

function isEnsuredMatchReport(value: unknown): value is EnsuredMatchReport {
  return isRecord(value)
    && nonEmptyString(value.code)
    && typeof value.created === 'boolean'
    && nonEmptyString(value.reportId)
    && nonEmptyString(value.pendingActionId)
    && nonEmptyString(value.matchId)
    && nonEmptyString(value.hostDiscordId)
    && nonEmptyString(value.status)
    && Number.isInteger(value.revision)
    && Number(value.revision) >= 0;
}

function isCreatedMatchResultAction(value: unknown): value is CreatedMatchResultAction {
  return isRecord(value)
    && (value.code === 'created' || value.code === 'existing')
    && typeof value.created === 'boolean'
    && value.created === (value.code === 'created')
    && nonEmptyString(value.actionId)
    && value.pendingActionId === value.actionId
    && nonEmptyString(value.reportId)
    && nonEmptyString(value.matchId)
    && nonEmptyString(value.hostDiscordId)
    && nonEmptyString(value.status)
    && Number.isInteger(value.revision)
    && Number(value.revision) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
