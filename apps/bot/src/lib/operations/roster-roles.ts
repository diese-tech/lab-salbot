import {
  getCaptainRoleMapping,
  getDivisionById,
  getOrganizationIdentity,
  getOrganizationRoleMapping,
  listCaptainRoleMappings,
  listOrganizationRoleMappings,
  type SupabaseClient,
  upsertCaptainRoleMapping,
  upsertOrganizationRoleMapping,
} from '@salbot/db';
import { writeOperationAudit } from './audit';
import { conflict, success } from './types';
import { normalizeDivisionId } from './roles';

export async function setCaptainRoleMapping(
  db: SupabaseClient,
  params: { divisionId: string; discordRoleId: string; actorDiscordId: string },
) {
  const divisionId = normalizeDivisionId(params.divisionId);
  if (!await getDivisionById(db, divisionId)) return conflict('Unknown division.', { divisionId });
  const previous = await getCaptainRoleMapping(db, divisionId);
  await upsertCaptainRoleMapping(db, {
    divisionId, discordRoleId: params.discordRoleId, updatedByDiscordId: params.actorDiscordId,
  });
  await writeOperationAudit(db, {
    actionType: 'captain_role_mapping_updated', entityType: 'captain_role_mapping', entityId: divisionId,
    actorDiscordId: params.actorDiscordId,
    oldValueJson: previous ? { discordRoleId: previous.discord_role_id } : undefined,
    newValueJson: { discordRoleId: params.discordRoleId },
    note: `Captain role mapping updated for ${divisionId}.`,
  });
  return success({ divisionId, discordRoleId: params.discordRoleId });
}

export async function setOrganizationRoleMapping(
  db: SupabaseClient,
  params: { orgId: string; discordRoleId: string; actorDiscordId: string },
) {
  const org = await getOrganizationIdentity(db, params.orgId);
  if (!org) return conflict('Unknown organization.', { orgId: params.orgId });
  const previous = await getOrganizationRoleMapping(db, params.orgId);
  await upsertOrganizationRoleMapping(db, {
    orgId: params.orgId, discordRoleId: params.discordRoleId, updatedByDiscordId: params.actorDiscordId,
  });
  await writeOperationAudit(db, {
    actionType: 'organization_role_mapping_updated', entityType: 'organization_role_mapping', entityId: params.orgId,
    actorDiscordId: params.actorDiscordId,
    oldValueJson: previous ? { discordRoleId: previous.discord_role_id } : undefined,
    newValueJson: { discordRoleId: params.discordRoleId, tag: org.tag },
    note: `Organization role mapping updated for ${org.name}.`,
  });
  return success({ orgId: params.orgId, orgName: org.name, orgTag: org.tag, discordRoleId: params.discordRoleId });
}

export { listCaptainRoleMappings, listOrganizationRoleMappings };
