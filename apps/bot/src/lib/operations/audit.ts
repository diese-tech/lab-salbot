import { writeAuditLog, type SupabaseClient } from '@salbot/db';
import type { AuditActionType } from '@salbot/shared';

export async function writeOperationAudit(
  db: SupabaseClient,
  params: {
    actionType: AuditActionType;
    entityType: string;
    entityId: string;
    actorDiscordId: string;
    oldValueJson?: Record<string, unknown>;
    newValueJson?: Record<string, unknown>;
    note?: string;
  }
) {
  await writeAuditLog(db, params);
}
