import type { APIInteractionGuildMember, GuildMember } from "discord.js";
import type { RosterTradeOrganization } from "@salbot/db";
import { hasAdminCommandAccess } from "./command-access";

export function authorizedForRosterOrganization(
  member: APIInteractionGuildMember | GuildMember | null,
  actorDiscordId: string,
  captainRoleId: string,
  org: Pick<
    RosterTradeOrganization,
    "captainDiscordIds" | "organizationRoleId"
  >,
): boolean {
  if (hasAdminCommandAccess(member)) return true;
  const isCanonicalCaptain =
    org.captainDiscordIds.includes(actorDiscordId) &&
    memberHasRole(member, captainRoleId);
  const isOwnerOrAdvisor =
    !!org.organizationRoleId && memberHasRole(member, org.organizationRoleId);
  return isCanonicalCaptain || isOwnerOrAdvisor;
}

function memberHasRole(
  member: APIInteractionGuildMember | GuildMember | null,
  roleId: string,
): boolean {
  if (!member) return false;
  if (Array.isArray(member.roles)) return member.roles.includes(roleId);
  return member.roles.cache.has(roleId);
}
