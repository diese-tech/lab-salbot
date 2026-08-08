import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({ db: {} }));
vi.mock('../lib/operations', () => ({
  requireAdmin: vi.fn(),
  listConfiguredDivisionRoles: vi.fn(),
  setDivisionRoleMapping: vi.fn(),
  getRequiredDivisionRole: vi.fn(),
  linkDiscordIdIfEmpty: vi.fn(),
  normalizeDivisionId: vi.fn(),
  resolvePlayerIdentity: vi.fn(),
  syncDivisionRole: vi.fn(),
  writeOperationAudit: vi.fn(),
}));

import { requireAdmin } from '../lib/operations';
import { execute as executeDivisionRoleConfig } from './division-role-config';
import { execute as executeDivisionSync } from './division-sync';

describe('admin-only command runtime authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      status: 'error',
      reason: 'Only admins can use this command.',
    });
  });

  it.each([
    ['division-role-config', executeDivisionRoleConfig],
    ['division-sync', executeDivisionSync],
  ])('rejects a non-admin before executing /%s', async (_name, execute) => {
    const deferReply = vi.fn();
    const editReply = vi.fn();
    const getSubcommand = vi.fn();

    await execute({
      user: { id: 'non-admin' },
      guild: {},
      options: { getSubcommand },
      deferReply,
      editReply,
    } as never);

    expect(requireAdmin).toHaveBeenCalledWith({}, 'non-admin');
    expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(editReply).toHaveBeenCalledWith('Only admins can use this command.');
    expect(getSubcommand).not.toHaveBeenCalled();
  });
});
