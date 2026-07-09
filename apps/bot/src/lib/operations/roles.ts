import type { GuildMember } from 'discord.js';
import {
  getDivisionById,
  getDivisionRoleMapping,
  listDivisionRoleMappings,
  type SupabaseClient,
  upsertDivisionRoleMapping,
  type DivisionRoleMapping,
} from '@salbot/db';
import { writeOperationAudit } from './audit';
import { conflict, skipped, success, type OperationResult } from './types';

export async function setDivisionRoleMapping(
  db: SupabaseClient,
  params: {
    divisionId: string;
    discordRoleId: string;
    actorDiscordId: string;
  }
): Promise<OperationResult<{ divisionId: string; discordRoleId: string }>> {
  const divisionId = normalizeDivisionId(params.divisionId);
  const division = await getDivisionById(db, divisionId);
  if (!division) return conflict('Unknown division.', { divisionId });

  const previous = await getDivisionRoleMapping(db, divisionId);

  await upsertDivisionRoleMapping(db, {
    divisionId,
    discordRoleId: params.discordRoleId,
    updatedByDiscordId: params.actorDiscordId,
  });

  await writeOperationAudit(db, {
    actionType: 'division_role_mapping_updated',
    entityType: 'division_role_mapping',
    entityId: divisionId,
    actorDiscordId: params.actorDiscordId,
    oldValueJson: previous
      ? { discordRoleId: previous.discord_role_id }
      : undefined,
    newValueJson: { discordRoleId: params.discordRoleId },
    note: `Division role mapping updated for ${divisionId}.`,
  });

  return success({ divisionId, discordRoleId: params.discordRoleId });
}

export async function listConfiguredDivisionRoles(db: SupabaseClient) {
  return listDivisionRoleMappings(db);
}

export async function getRequiredDivisionRole(
  db: SupabaseClient,
  divisionId: string
): Promise<OperationResult<DivisionRoleMapping>> {
  const normalized = normalizeDivisionId(divisionId);
  const division = await getDivisionById(db, normalized);
  if (!division) return conflict('Unknown division.', { divisionId: normalized });

  const mapping = await getDivisionRoleMapping(db, normalized);
  if (!mapping) return conflict('Division has no configured Discord role.', { divisionId: normalized });

  return success(mapping);
}

export async function syncDivisionRole(
  db: SupabaseClient,
  params: {
    member: GuildMember;
    divisionId: string;
    actorDiscordId: string;
  }
): Promise<OperationResult<{ addedRoleId: string; removedRoleIds: string[] }>> {
  const mappingResult = await getRequiredDivisionRole(db, params.divisionId);
  if (mappingResult.status !== 'success') return mappingResult;

  const allMappings = await listDivisionRoleMappings(db);
  const knownRoleIds = new Set(allMappings.map((mapping) => mapping.discord_role_id));
  const requiredRoleId = mappingResult.data.discord_role_id;
  const oldDivisionRoleIds = [...knownRoleIds].filter(
    (roleId) => roleId !== requiredRoleId && params.member.roles.cache.has(roleId)
  );
  const alreadyHasRequiredRole = params.member.roles.cache.has(requiredRoleId);

  if (oldDivisionRoleIds.length === 0 && alreadyHasRequiredRole) {
    return skipped('Member already has the correct division role state.', {
      discordId: params.member.user.id,
      divisionId: params.divisionId,
    });
  }

  if (oldDivisionRoleIds.length > 0) {
    await params.member.roles.remove(oldDivisionRoleIds, 'SAL division role synchronization');
  }

  if (!alreadyHasRequiredRole) {
    await params.member.roles.add(requiredRoleId, 'SAL division role synchronization');
  }

  await writeOperationAudit(db, {
    actionType: 'division_role_synced',
    entityType: 'discord_member',
    entityId: params.member.user.id,
    actorDiscordId: params.actorDiscordId,
    oldValueJson: { removedRoleIds: oldDivisionRoleIds },
    newValueJson: { addedRoleId: requiredRoleId, divisionId: params.divisionId },
    note: `Division role synchronized for ${params.member.user.username}.`,
  });

  return success({ addedRoleId: requiredRoleId, removedRoleIds: oldDivisionRoleIds });
}

export function normalizeDivisionId(value: string) {
  return value.trim().toLowerCase();
}
