import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({ db: {} }));
vi.mock('../lib/outbox-runtime', () => ({ requestImmediateOutboxDrain: vi.fn() }));
vi.mock('@salbot/db', () => ({
  getRosterTradeSetup: vi.fn(),
  createRosterTrade: vi.fn(),
  counterRosterTrade: vi.fn(),
  acceptRosterTrade: vi.fn(),
  declineRosterTrade: vi.fn(),
  cancelRosterTrade: vi.fn(),
  getRosterTrade: vi.fn(),
}));

import { acceptRosterTrade, createRosterTrade, getRosterTrade, getRosterTradeSetup } from '@salbot/db';
import { execute, handleTradeActionButton, handleTradeSelect, handleTradeWizardButton } from './trade';

describe('/trade entry authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHANNEL_TRADE_BLOCK_SOLAR = 'channel-solar';
  });

  it('starts an ephemeral wizard for a current division captain in the configured channel', async () => {
    vi.mocked(getRosterTradeSetup).mockResolvedValue({
      seasonId: 'season-1',
      divisionId: 'solar',
      tradesOpen: true,
      captainRoleId: 'captain-role',
      organizations: [
        {
          id: 'org-a', name: 'Alpha', tag: 'ALP', organizationRoleId: 'org-role-a',
          captainDiscordIds: ['captain-1'], players: [{ id: 'a1', name: 'Alpha One', discordId: 'a1-discord' }],
        },
        {
          id: 'org-b', name: 'Beta', tag: 'BET', organizationRoleId: 'org-role-b',
          captainDiscordIds: ['captain-2'], players: [{ id: 'b1', name: 'Beta One', discordId: 'b1-discord' }],
        },
      ],
    });
    const reply = vi.fn();
    const interaction = {
      channelId: 'channel-solar',
      guildId: 'guild-1',
      user: { id: 'captain-1' },
      member: { roles: ['captain-role', 'org-role-a'] },
      reply,
    };

    await execute(interaction as never);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(reply.mock.calls[0][0].content).toContain('Step 1 of 5');
    expect(reply.mock.calls[0][0].components).toHaveLength(1);
  });

  it('rejects the command privately in the wrong channel before querying canonical state', async () => {
    const reply = vi.fn();
    await execute({
      channelId: 'general', guildId: 'guild-1', user: { id: 'captain-1' }, member: { roles: [] }, reply,
    } as never);

    expect(getRosterTradeSetup).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });

  it('rejects a user missing the canonical captain and organization role combination', async () => {
    vi.mocked(getRosterTradeSetup).mockResolvedValue({
      seasonId: 'season-1', divisionId: 'solar', tradesOpen: true, captainRoleId: 'captain-role',
      organizations: [{
        id: 'org-a', name: 'Alpha', tag: 'ALP', organizationRoleId: 'org-role-a',
        captainDiscordIds: ['captain-1'], players: [{ id: 'a1', name: 'Alpha One', discordId: null }],
      }],
    });
    const reply = vi.fn();
    await execute({
      channelId: 'channel-solar', guildId: 'guild-1', user: { id: 'captain-1' },
      member: { roles: ['captain-role'] }, reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not the current authorized captain'), ephemeral: true,
    }));
  });

  it('keeps selections private until Post Proposal and supports an uneven exchange', async () => {
    vi.mocked(getRosterTradeSetup).mockResolvedValue({
      seasonId: 'season-1', divisionId: 'solar', tradesOpen: true, captainRoleId: 'captain-role',
      organizations: [
        {
          id: 'org-a', name: 'Alpha', tag: 'ALP', organizationRoleId: 'org-role-a',
          captainDiscordIds: ['captain-1'],
          players: [
            { id: 'a1', name: 'Alpha One', discordId: null },
            { id: 'a2', name: 'Alpha Two', discordId: null },
          ],
        },
        {
          id: 'org-b', name: 'Beta', tag: 'BET', organizationRoleId: 'org-role-b',
          captainDiscordIds: ['captain-2'], players: [{ id: 'b1', name: 'Beta One', discordId: null }],
        },
      ],
    });
    vi.mocked(createRosterTrade).mockResolvedValue({
      code: 'created', transactionId: 'trade-1', revision: 1,
      status: 'awaiting_acceptance', pendingActionId: 'action-1', outboxIds: ['outbox-1'],
    });
    const reply = vi.fn();
    await execute({
      channelId: 'channel-solar', guildId: 'guild-1', user: { id: 'captain-1' },
      member: { roles: ['captain-role', 'org-role-a'] }, reply,
    } as never);
    let customId = componentCustomId(reply.mock.calls[0][0]);

    const offerStep = await select(customId, ['org-a']);
    customId = componentCustomId(offerStep);
    const receiverStep = await select(customId, ['a1', 'a2']);
    customId = componentCustomId(receiverStep);
    const requestStep = await select(customId, ['org-b']);
    customId = componentCustomId(requestStep);
    const reviewStep = await select(customId, ['b1']);

    expect(createRosterTrade).not.toHaveBeenCalled();
    expect(reviewStep.content).toContain('Nothing becomes public until you explicitly post.');
    const postCustomId = componentCustomId(reviewStep);
    const editReply = vi.fn();
    await handleTradeWizardButton({
      customId: postCustomId, channelId: 'channel-solar', user: { id: 'captain-1' },
      member: { roles: ['captain-role', 'org-role-a'] },
      deferUpdate: vi.fn(), editReply,
    } as never);

    expect(createRosterTrade).toHaveBeenCalledWith({}, expect.objectContaining({
      offeredPlayerIds: ['a1', 'a2'], requestedPlayerIds: ['b1'], proposalChannelId: 'channel-solar',
    }));
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
  });

  it('re-reads durable state and rejects an unauthorized public-card interaction', async () => {
    vi.mocked(getRosterTrade).mockResolvedValue(tradeFixture());
    vi.mocked(getRosterTradeSetup).mockResolvedValue(setupFixture());

    await expect(handleTradeActionButton({
      customId: 'trade:accept:trade-1:1', channelId: 'channel-solar',
      user: { id: 'spectator' }, member: { roles: [] }, deferReply: vi.fn(), editReply: vi.fn(),
    } as never)).rejects.toThrow('Only the receiving organization');

    expect(acceptRosterTrade).not.toHaveBeenCalled();
  });

  it('binds receiving-captain acceptance to the card revision and leaves execution to admin review', async () => {
    vi.mocked(getRosterTrade).mockResolvedValue(tradeFixture());
    vi.mocked(getRosterTradeSetup).mockResolvedValue(setupFixture());
    vi.mocked(acceptRosterTrade).mockResolvedValue({
      code: 'accepted', transactionId: 'trade-1', revision: 1, status: 'awaiting_admin',
      pendingActionId: 'action-1',
    });
    const editReply = vi.fn();
    await handleTradeActionButton({
      customId: 'trade:accept:trade-1:1', channelId: 'channel-solar',
      user: { id: 'captain-2' }, member: { roles: ['captain-role', 'org-role-b'] },
      deferReply: vi.fn(), editReply,
    } as never);

    expect(acceptRosterTrade).toHaveBeenCalledWith({}, {
      transactionId: 'trade-1', expectedRevision: 1, actorDiscordId: 'captain-2',
    });
    expect(editReply).toHaveBeenCalledWith(expect.stringContaining('no roster changed yet'));
  });

  it('rejects stale card controls before calling a mutation RPC', async () => {
    vi.mocked(getRosterTrade).mockResolvedValue({ ...tradeFixture(), currentRevision: 2 });
    await expect(handleTradeActionButton({
      customId: 'trade:accept:trade-1:1', channelId: 'channel-solar',
      user: { id: 'captain-2' }, member: { roles: ['captain-role', 'org-role-b'] },
    } as never)).rejects.toThrow('card is stale');
    expect(acceptRosterTrade).not.toHaveBeenCalled();
  });
});

function componentCustomId(payload: { components: Array<{ toJSON(): unknown }> }): string {
  const row = payload.components[0].toJSON() as { components: Array<{ custom_id: string }> };
  return row.components[0].custom_id;
}

async function select(customId: string, values: string[]) {
  const update = vi.fn();
  await handleTradeSelect({
    customId, values, channelId: 'channel-solar', user: { id: 'captain-1' }, update,
  } as never);
  return update.mock.calls[0][0] as {
    content: string;
    components: Array<{ toJSON(): unknown }>;
  };
}

function setupFixture() {
  return {
    seasonId: 'season-1', divisionId: 'solar', tradesOpen: true, captainRoleId: 'captain-role',
    organizations: [
      { id: 'org-a', name: 'Alpha', tag: 'ALP', organizationRoleId: 'org-role-a',
        captainDiscordIds: ['captain-1'], players: [{ id: 'a1', name: 'Alpha One', discordId: null }] },
      { id: 'org-b', name: 'Beta', tag: 'BET', organizationRoleId: 'org-role-b',
        captainDiscordIds: ['captain-2'], players: [{ id: 'b1', name: 'Beta One', discordId: null }] },
    ],
  };
}

function tradeFixture() {
  return {
    id: 'trade-1', source: 'discord_workflow', seasonId: 'season-1', divisionId: 'solar',
    status: 'awaiting_acceptance', currentRevision: 1, proposerOrgId: 'org-a', receiverOrgId: 'org-b',
    pendingActionId: 'action-1', proposalChannelId: 'channel-solar', proposalMessageId: 'message-1',
    proposer: { id: 'org-a', name: 'Alpha', tag: 'ALP' },
    receiver: { id: 'org-b', name: 'Beta', tag: 'BET' },
    movements: [
      { id: 'a1', name: 'Alpha One', discordId: null, fromOrgId: 'org-a', toOrgId: 'org-b' },
      { id: 'b1', name: 'Beta One', discordId: null, fromOrgId: 'org-b', toOrgId: 'org-a' },
    ],
  };
}
