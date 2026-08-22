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

const OPERATOR_ROLE_ID = '11111111111111111';
const ADMIN_ROLE_ID = '22222222222222222';
const CAPTAIN_ROLE_ID = '33333333333333333';
const ORG_A_ROLE_ID = '44444444444444444';
const ORG_B_ROLE_ID = '55555555555555555';

describe('/trade entry authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHANNEL_TRADE_BLOCK_SOLAR = 'channel-solar';
    process.env.SAL_OPERATOR_ROLE_IDS = OPERATOR_ROLE_ID;
    process.env.SAL_ADMIN_ROLE_IDS = ADMIN_ROLE_ID;
  });

  it('starts an ephemeral wizard for a role-authorized temporary captain without player linkage', async () => {
    vi.mocked(getRosterTradeSetup).mockResolvedValue({
      seasonId: 'season-1',
      divisionId: 'solar',
      tradesOpen: true,
      captainRoleId: CAPTAIN_ROLE_ID,
      organizations: [
        {
          id: 'org-a', name: 'Alpha', tag: 'ALP', organizationRoleId: ORG_A_ROLE_ID,
          captainDiscordIds: [], players: [{ id: 'a1', name: 'Alpha One', discordId: null }],
        },
        {
          id: 'org-b', name: 'Beta', tag: 'BET', organizationRoleId: ORG_B_ROLE_ID,
          captainDiscordIds: ['captain-2'], players: [{ id: 'b1', name: 'Beta One', discordId: 'b1-discord' }],
        },
      ],
    });
    const reply = vi.fn();
    const interaction = {
      channelId: 'channel-solar',
      guildId: 'guild-1',
      user: { id: 'temporary-captain' },
      member: { roles: [OPERATOR_ROLE_ID, CAPTAIN_ROLE_ID, ORG_A_ROLE_ID] },
      reply,
    };

    await execute(interaction as never);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(reply.mock.calls[0][0].content).toContain('Step 1 of 5');
    expect(reply.mock.calls[0][0].components).toHaveLength(1);
  });

  it('lets an authorized administrator select any active organization for remediation', async () => {
    vi.mocked(getRosterTradeSetup).mockResolvedValue(setupFixture());
    const reply = vi.fn();

    await execute({
      channelId: 'channel-solar', guildId: 'guild-1', user: { id: 'admin-1' },
      member: { roles: [ADMIN_ROLE_ID] }, reply,
    } as never);

    expect(reply.mock.calls[0][0].content).toContain('Step 1 of 5');
    const row = reply.mock.calls[0][0].components[0].toJSON() as {
      components: Array<{ options: unknown[] }>;
    };
    expect(row.components[0].options).toHaveLength(2);
  });

  it('rejects the command privately in the wrong channel before querying canonical state', async () => {
    const reply = vi.fn();
    await execute({
      channelId: 'general', guildId: 'guild-1', user: { id: 'captain-1' }, member: { roles: [] }, reply,
    } as never);

    expect(getRosterTradeSetup).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });

  it('rejects a role-authorized captain missing the canonical organization role', async () => {
    vi.mocked(getRosterTradeSetup).mockResolvedValue({
      seasonId: 'season-1', divisionId: 'solar', tradesOpen: true, captainRoleId: CAPTAIN_ROLE_ID,
      organizations: [{
        id: 'org-a', name: 'Alpha', tag: 'ALP', organizationRoleId: ORG_A_ROLE_ID,
        captainDiscordIds: [], players: [{ id: 'a1', name: 'Alpha One', discordId: null }],
      }],
    });
    const reply = vi.fn();
    await execute({
      channelId: 'channel-solar', guildId: 'guild-1', user: { id: 'captain-1' },
      member: { roles: [OPERATOR_ROLE_ID, CAPTAIN_ROLE_ID] }, reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not the current authorized captain'), ephemeral: true,
    }));
  });

  it('keeps selections private until Post Proposal and supports an uneven exchange', async () => {
    vi.mocked(getRosterTradeSetup).mockResolvedValue({
      seasonId: 'season-1', divisionId: 'solar', tradesOpen: true, captainRoleId: CAPTAIN_ROLE_ID,
      organizations: [
        {
          id: 'org-a', name: 'Alpha', tag: 'ALP', organizationRoleId: ORG_A_ROLE_ID,
          captainDiscordIds: ['captain-1'],
          players: [
            { id: 'a1', name: 'Alpha One', discordId: null },
            { id: 'a2', name: 'Alpha Two', discordId: null },
          ],
        },
        {
          id: 'org-b', name: 'Beta', tag: 'BET', organizationRoleId: ORG_B_ROLE_ID,
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
      member: { roles: [OPERATOR_ROLE_ID, CAPTAIN_ROLE_ID, ORG_A_ROLE_ID] }, reply,
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
      member: { roles: [OPERATOR_ROLE_ID, CAPTAIN_ROLE_ID, ORG_A_ROLE_ID] },
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
      user: { id: 'temporary-captain-2' },
      member: { roles: [OPERATOR_ROLE_ID, CAPTAIN_ROLE_ID, ORG_B_ROLE_ID] },
      deferReply: vi.fn(), editReply,
    } as never);

    expect(acceptRosterTrade).toHaveBeenCalledWith({}, {
      transactionId: 'trade-1', expectedRevision: 1, actorDiscordId: 'temporary-captain-2',
    });
    expect(editReply).toHaveBeenCalledWith(expect.stringContaining('no roster changed yet'));
  });

  it('rejects stale card controls before calling a mutation RPC', async () => {
    vi.mocked(getRosterTrade).mockResolvedValue({ ...tradeFixture(), currentRevision: 2 });
    await expect(handleTradeActionButton({
      customId: 'trade:accept:trade-1:1', channelId: 'channel-solar',
      user: { id: 'captain-2' },
      member: { roles: [OPERATOR_ROLE_ID, CAPTAIN_ROLE_ID, ORG_B_ROLE_ID] },
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
    seasonId: 'season-1', divisionId: 'solar', tradesOpen: true, captainRoleId: CAPTAIN_ROLE_ID,
    organizations: [
      { id: 'org-a', name: 'Alpha', tag: 'ALP', organizationRoleId: ORG_A_ROLE_ID,
        captainDiscordIds: [], players: [{ id: 'a1', name: 'Alpha One', discordId: null }] },
      { id: 'org-b', name: 'Beta', tag: 'BET', organizationRoleId: ORG_B_ROLE_ID,
        captainDiscordIds: [], players: [{ id: 'b1', name: 'Beta One', discordId: null }] },
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
