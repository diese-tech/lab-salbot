import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({ db: {} }));
vi.mock('@salbot/db', () => ({
  getEligibleMatchesForOperator: vi.fn(),
}));
vi.mock('../lib/command-access', () => ({
  hasCommandAccess: vi.fn(),
}));

import { getEligibleMatchesForOperator } from '@salbot/db';
import { hasCommandAccess } from '../lib/command-access';
import { execute } from './report-result';

describe('/report-result role authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses Discord roles and does not require a linked captain identity', async () => {
    vi.mocked(hasCommandAccess).mockReturnValue(true);
    vi.mocked(getEligibleMatchesForOperator).mockResolvedValue([]);
    const reply = vi.fn();
    const member = { roles: ['111111111111111111'] };

    await execute({ user: { id: 'unlinked-user' }, member, reply } as never);

    expect(hasCommandAccess).toHaveBeenCalledWith(member, 'report-result');
    expect(getEligibleMatchesForOperator).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith({
      content: 'There are no scheduled current-season matches available to report.',
      ephemeral: true,
    });
  });

  it('rejects users without an authorized Discord role before querying matches', async () => {
    vi.mocked(hasCommandAccess).mockReturnValue(false);
    const reply = vi.fn();

    await execute({ user: { id: 'linked-captain' }, member: { roles: [] }, reply } as never);

    expect(getEligibleMatchesForOperator).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith({
      content: 'You need an authorized SAL operator or admin Discord role to report results.',
      ephemeral: true,
    });
  });
});
