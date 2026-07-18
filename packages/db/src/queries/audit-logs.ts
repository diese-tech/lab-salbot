import type { SupabaseClient } from '../client';
import type { AuditActionType } from '@salbot/shared';
import { toDatabaseJson } from '../json';

export async function writeAuditLog(
  db: SupabaseClient,
  params: {
    actionType: AuditActionType;
    entityType: string;
    entityId: string;
    actorDiscordId: string;
    pendingActionId?: string;
    oldValueJson?: Record<string, unknown>;
    newValueJson?: Record<string, unknown>;
    note?: string;
  }
) {
  const { error } = await db.from('audit_logs').insert({
    action_type: params.actionType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    actor_discord_id: params.actorDiscordId,
    pending_action_id: params.pendingActionId ?? null,
    old_value_json: params.oldValueJson ? toDatabaseJson(params.oldValueJson) : null,
    new_value_json: params.newValueJson ? toDatabaseJson(params.newValueJson) : null,
    note: params.note ?? null,
  });

  if (error) throw error;
}
