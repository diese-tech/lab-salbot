import { afterEach, describe, expect, it } from 'vitest';
import { hasCommandAccess, validateCommandAccessEnv } from './command-access';

const OPERATOR_ROLES = [
  '111111111111111111',
  '222222222222222222',
  '333333333333333333',
  '444444444444444444',
];
const ADMIN_ROLE = '555555555555555555';

function member(...roleIds: string[]) {
  return { roles: roleIds };
}

describe('Discord role-backed operational command access', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each(OPERATOR_ROLES)('authorizes configured operator role %s for both initial capabilities', (roleId) => {
    process.env.SAL_OPERATOR_ROLE_IDS = OPERATOR_ROLES.join(',');
    process.env.SAL_ADMIN_ROLE_IDS = ADMIN_ROLE;

    expect(hasCommandAccess(member(roleId), 'report-result')).toBe(true);
    expect(hasCommandAccess(member(roleId), 'log-scouter')).toBe(true);
  });

  it('authorizes the configured admin role as an override', () => {
    process.env.SAL_OPERATOR_ROLE_IDS = OPERATOR_ROLES.join(',');
    process.env.SAL_ADMIN_ROLE_IDS = ADMIN_ROLE;

    expect(hasCommandAccess(member(ADMIN_ROLE), 'report-result')).toBe(true);
    expect(hasCommandAccess(member(ADMIN_ROLE), 'log-scouter')).toBe(true);
  });

  it('supports cached GuildMember roles from normal gateway interactions', () => {
    process.env.SAL_OPERATOR_ROLE_IDS = OPERATOR_ROLES.join(',');
    process.env.SAL_ADMIN_ROLE_IDS = ADMIN_ROLE;
    const guildMember = { roles: { cache: new Map([[OPERATOR_ROLES[0], {}]]) } };

    expect(hasCommandAccess(guildMember as never, 'report-result')).toBe(true);
  });

  it('rejects an unauthorized member regardless of application captain linkage', () => {
    process.env.SAL_OPERATOR_ROLE_IDS = OPERATOR_ROLES.join(',');
    process.env.SAL_ADMIN_ROLE_IDS = ADMIN_ROLE;
    const applicationIdentity = { playerId: 'player-1', isCaptain: true };

    expect(applicationIdentity.isCaptain).toBe(true);
    expect(hasCommandAccess(member('999999999999999999'), 'report-result')).toBe(false);
  });

  it('fails closed when role configuration is missing or malformed', () => {
    delete process.env.SAL_OPERATOR_ROLE_IDS;
    process.env.SAL_ADMIN_ROLE_IDS = ADMIN_ROLE;
    expect(hasCommandAccess(member(ADMIN_ROLE), 'log-scouter')).toBe(false);

    process.env.SAL_OPERATOR_ROLE_IDS = 'not-a-role';
    expect(hasCommandAccess(member(ADMIN_ROLE), 'log-scouter')).toBe(false);
    expect(() => validateCommandAccessEnv()).toThrow(/SAL_OPERATOR_ROLE_IDS/);
  });
});
