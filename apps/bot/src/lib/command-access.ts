import type { APIInteractionGuildMember, GuildMember } from 'discord.js';

export type OperationalCapability = 'report-result' | 'log-scouter' | 'trade';
export type CommandAccessMember =
  | Pick<APIInteractionGuildMember, 'roles'>
  | Pick<GuildMember, 'roles'>
  | null;

const ROLE_ENV_NAMES = ['SAL_OPERATOR_ROLE_IDS', 'SAL_ADMIN_ROLE_IDS'] as const;
const DISCORD_ROLE_ID = /^\d{17,20}$/;

function configuredRoleIds(
  name: (typeof ROLE_ENV_NAMES)[number],
  env: NodeJS.ProcessEnv,
): string[] {
  const roleIds = (env[name] ?? '')
    .split(',')
    .map((roleId) => roleId.trim())
    .filter(Boolean);
  if (roleIds.length === 0 || roleIds.some((roleId) => !DISCORD_ROLE_ID.test(roleId))) {
    throw new Error(`${name} must contain one or more comma-separated Discord role IDs.`);
  }
  return roleIds;
}

export function validateCommandAccessEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of ROLE_ENV_NAMES) configuredRoleIds(name, env);
}

export function hasCommandAccess(
  member: CommandAccessMember,
  _capability: OperationalCapability,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!member) return false;

  let authorizedRoleIds: string[];
  try {
    authorizedRoleIds = ROLE_ENV_NAMES.flatMap((name) => configuredRoleIds(name, env));
  } catch {
    return false;
  }

  const roles = member.roles;
  if (Array.isArray(roles)) {
    return authorizedRoleIds.some((roleId) => roles.includes(roleId));
  }
  return authorizedRoleIds.some((roleId) => roles.cache.has(roleId));
}

export function hasAdminCommandAccess(
  member: CommandAccessMember,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!member) return false;

  let adminRoleIds: string[];
  try {
    adminRoleIds = configuredRoleIds('SAL_ADMIN_ROLE_IDS', env);
  } catch {
    return false;
  }

  const roles = member.roles;
  if (Array.isArray(roles)) return adminRoleIds.some((roleId) => roles.includes(roleId));
  return adminRoleIds.some((roleId) => roles.cache.has(roleId));
}
