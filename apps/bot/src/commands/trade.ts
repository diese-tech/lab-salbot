import { randomUUID } from 'node:crypto';
import type {
  APIInteractionGuildMember,
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  StringSelectMenuInteraction,
} from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import {
  acceptRosterTrade,
  cancelRosterTrade,
  counterRosterTrade,
  createRosterTrade,
  declineRosterTrade,
  getRosterTrade,
  getRosterTradeSetup,
  type RosterTrade,
  type RosterTradeOrganization,
} from '@salbot/db';
import { db } from '../lib/db';
import { getTradeDivisionForChannel } from '../lib/channels';
import { UserFacingError } from '../lib/errors';
import { requestImmediateOutboxDrain } from '../lib/outbox-runtime';

export const data = {
  name: 'trade',
  description: 'Propose a player trade to another organization in your division.',
} as const;

type TradeWizard = {
  id: string;
  actorDiscordId: string;
  channelId: string;
  seasonId: string;
  divisionId: string;
  organizations: RosterTradeOrganization[];
  proposerOrgId?: string;
  offeredPlayerIds?: string[];
  receiverOrgId?: string;
  requestedPlayerIds?: string[];
  transactionId?: string;
  expectedRevision?: number;
  expiresAt: number;
};

// Draft selections are intentionally ephemeral. Canonical state begins only
// after Post Proposal and is stored by sal-database, so a restart can discard
// this map without losing a submitted transaction.
const tradeWizards = new Map<string, TradeWizard>();

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const divisionId = getTradeDivisionForChannel(interaction.channelId);
  if (!divisionId) {
    await interaction.reply({
      content: 'Use `/trade` in your division’s configured trade-block channel.',
      ephemeral: true,
    });
    return;
  }
  if (!interaction.guildId) {
    await interaction.reply({ content: '`/trade` is only available in the SAL server.', ephemeral: true });
    return;
  }

  const setup = await getRosterTradeSetup(db, divisionId);
  if (!setup || !setup.tradesOpen) {
    await interaction.reply({ content: 'Trades are not currently open for this division.', ephemeral: true });
    return;
  }
  if (!setup.captainRoleId) {
    await interaction.reply({ content: 'The Captain role is not configured for this division.', ephemeral: true });
    return;
  }

  const captainRoleId = setup.captainRoleId;
  const authorizedOrganizations = setup.organizations.filter((org) =>
    authorizedForOrganization(interaction.member, interaction.user.id, captainRoleId, org),
  );
  if (authorizedOrganizations.length === 0) {
    await interaction.reply({
      content: 'You are not the current authorized captain for an organization in this division.',
      ephemeral: true,
    });
    return;
  }

  const wizardId = randomUUID().slice(0, 12);
  tradeWizards.set(wizardId, {
    id: wizardId,
    actorDiscordId: interaction.user.id,
    channelId: interaction.channelId,
    seasonId: setup.seasonId,
    divisionId,
    organizations: setup.organizations,
    expiresAt: Date.now() + 15 * 60_000,
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(`tr_org:${wizardId}`)
    .setPlaceholder('Select the organization you represent')
    .addOptions(authorizedOrganizations.slice(0, 25).map((org) => ({
      label: `${org.name} (${org.tag})`, value: org.id,
    })));
  await interaction.reply({
    content: '**Trade Proposal — Step 1 of 5:** Select the organization you represent.',
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleTradeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [action, wizardId] = interaction.customId.split(':');
  const wizard = requireWizard(wizardId, interaction.user.id, interaction.channelId);
  if (action === 'tr_org') {
    const org = requireOrganization(wizard, interaction.values[0]);
    wizard.proposerOrgId = org.id;
    wizard.offeredPlayerIds = undefined;
    wizard.receiverOrgId = undefined;
    wizard.requestedPlayerIds = undefined;
    await interaction.update({
      content: '**Trade Proposal — Step 2 of 5:** Select one or more players you are offering.',
      components: [playerSelectRow(`tr_offer:${wizard.id}`, org.players)],
    });
    return;
  }
  if (action === 'tr_offer') {
    const proposer = requireOrganization(wizard, wizard.proposerOrgId);
    assertSelectedPlayers(proposer, interaction.values);
    wizard.offeredPlayerIds = [...interaction.values];
    const options = wizard.organizations.filter((org) => org.id !== proposer.id);
    if (options.length === 0) throw new UserFacingError('No other active organization is available in this division.');
    await interaction.update({
      content: '**Trade Proposal — Step 3 of 5:** Select the other organization.',
      components: [organizationSelectRow(`tr_recv:${wizard.id}`, options)],
    });
    return;
  }
  if (action === 'tr_recv') {
    const receiver = requireOrganization(wizard, interaction.values[0]);
    if (receiver.id === wizard.proposerOrgId) throw new UserFacingError('A trade requires two different organizations.');
    wizard.receiverOrgId = receiver.id;
    wizard.requestedPlayerIds = undefined;
    await interaction.update({
      content: '**Trade Proposal — Step 4 of 5:** Select one or more players you are requesting.',
      components: [playerSelectRow(`tr_request:${wizard.id}`, receiver.players)],
    });
    return;
  }
  if (action === 'tr_request') {
    const receiver = requireOrganization(wizard, wizard.receiverOrgId);
    assertSelectedPlayers(receiver, interaction.values);
    wizard.requestedPlayerIds = [...interaction.values];
    const proposer = requireOrganization(wizard, wizard.proposerOrgId);
    await interaction.update({
      content: tradeReviewText(wizard, proposer, receiver),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`tr_post:${wizard.id}`).setLabel(
          wizard.transactionId ? 'Post Counter' : 'Post Proposal',
        ).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tr_cancel:${wizard.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      )],
    });
  }
}

export async function handleTradeWizardButton(interaction: ButtonInteraction): Promise<void> {
  const [action, wizardId] = interaction.customId.split(':');
  const wizard = requireWizard(wizardId, interaction.user.id, interaction.channelId);
  if (action === 'tr_cancel') {
    tradeWizards.delete(wizard.id);
    await interaction.update({ content: 'Trade draft cancelled. Nothing was posted.', components: [] });
    return;
  }
  if (action !== 'tr_post') return;
  if (!wizard.offeredPlayerIds?.length || !wizard.requestedPlayerIds?.length) {
    throw new UserFacingError('This trade draft is incomplete. Start `/trade` again.');
  }
  const current = await requireCurrentWizardAuthorization(interaction, wizard);
  const proposer = current.proposer;
  const receiver = current.receiver;
  await interaction.deferUpdate();
  const result = wizard.transactionId && wizard.expectedRevision
    ? await counterRosterTrade(db, {
      transactionId: wizard.transactionId,
      expectedRevision: wizard.expectedRevision,
      actorDiscordId: interaction.user.id,
      offeredPlayerIds: wizard.offeredPlayerIds,
      requestedPlayerIds: wizard.requestedPlayerIds,
    })
    : await createRosterTrade(db, {
      actorDiscordId: interaction.user.id,
      seasonId: wizard.seasonId,
      divisionId: wizard.divisionId,
      proposerOrgId: proposer.id,
      receiverOrgId: receiver.id,
      offeredPlayerIds: wizard.offeredPlayerIds,
      requestedPlayerIds: wizard.requestedPlayerIds,
      proposalChannelId: wizard.channelId,
    });
  tradeWizards.delete(wizard.id);
  requestImmediateOutboxDrain();
  await interaction.editReply({
    content: result.code === 'countered'
      ? `Counter revision ${result.revision} posted durably.`
      : `Trade proposal revision ${result.revision} posted durably.`,
    components: [],
  });
}

async function requireCurrentWizardAuthorization(
  interaction: ButtonInteraction,
  wizard: TradeWizard,
): Promise<{ proposer: RosterTradeOrganization; receiver: RosterTradeOrganization }> {
  const setup = await getRosterTradeSetup(db, wizard.divisionId);
  if (!setup || setup.seasonId !== wizard.seasonId || !setup.tradesOpen || !setup.captainRoleId) {
    throw new UserFacingError('Trade availability or role configuration changed. Start `/trade` again.');
  }
  const proposer = setup.organizations.find((org) => org.id === wizard.proposerOrgId);
  const receiver = setup.organizations.find((org) => org.id === wizard.receiverOrgId);
  if (!proposer || !receiver
    || !authorizedForOrganization(interaction.member, interaction.user.id, setup.captainRoleId, proposer)) {
    throw new UserFacingError('Your current Captain or organization-role authorization no longer permits this proposal.');
  }
  assertSelectedPlayers(proposer, wizard.offeredPlayerIds ?? []);
  assertSelectedPlayers(receiver, wizard.requestedPlayerIds ?? []);
  if (wizard.transactionId) {
    const trade = await getRosterTrade(db, wizard.transactionId);
    if (!trade || trade.currentRevision !== wizard.expectedRevision
      || trade.receiverOrgId !== proposer.id || trade.proposerOrgId !== receiver.id) {
      throw new UserFacingError('This trade changed while you prepared the counteroffer. Use the current proposal.');
    }
  }
  return { proposer, receiver };
}

export async function handleTradeActionButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, transactionId, revisionRaw] = interaction.customId.split(':');
  const expectedRevision = Number(revisionRaw);
  if (!transactionId || !Number.isInteger(expectedRevision)) {
    throw new UserFacingError('This trade control is invalid.');
  }
  const trade = await getRosterTrade(db, transactionId);
  if (!trade) throw new UserFacingError('This trade no longer exists.');
  if (trade.currentRevision !== expectedRevision) {
    throw new UserFacingError('This trade card is stale. Use the current proposal revision.');
  }
  const setup = await getRosterTradeSetup(db, trade.divisionId);
  if (!setup || setup.seasonId !== trade.seasonId || !setup.captainRoleId) {
    throw new UserFacingError('Current trade authorization cannot be resolved. Ask an admin to review configuration.');
  }
  const captainRoleId = setup.captainRoleId;
  const actorOrgIds = setup.organizations
    .filter((org) => authorizedForOrganization(interaction.member, interaction.user.id, captainRoleId, org))
    .map((org) => org.id);

  if (action === 'counter') {
    requireActorOrganization(actorOrgIds, trade.receiverOrgId, 'Only the receiving organization’s captain can counter.');
    await startCounterWizard(interaction, trade, setup.organizations);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  if (action === 'accept') {
    requireActorOrganization(actorOrgIds, trade.receiverOrgId, 'Only the receiving organization’s captain can accept.');
    await acceptRosterTrade(db, { transactionId, expectedRevision, actorDiscordId: interaction.user.id });
    await interaction.editReply('Accepted. The trade is now waiting for administrator review; no roster changed yet.');
  } else if (action === 'decline') {
    requireActorOrganization(actorOrgIds, trade.receiverOrgId, 'Only the receiving organization’s captain can decline.');
    await declineRosterTrade(db, { transactionId, expectedRevision, actorDiscordId: interaction.user.id });
    await interaction.editReply('Trade declined.');
  } else if (action === 'withdraw') {
    requireActorOrganization(actorOrgIds, trade.proposerOrgId, 'Only the proposing organization’s captain can withdraw.');
    await cancelRosterTrade(db, { transactionId, expectedRevision, actorDiscordId: interaction.user.id, mode: 'withdraw' });
    await interaction.editReply('Trade withdrawn.');
  } else if (action === 'revoke') {
    if (!actorOrgIds.includes(trade.proposerOrgId) && !actorOrgIds.includes(trade.receiverOrgId)) {
      throw new UserFacingError('Only a participating organization’s captain can revoke consent.');
    }
    await cancelRosterTrade(db, { transactionId, expectedRevision, actorDiscordId: interaction.user.id, mode: 'revoke' });
    await interaction.editReply('Consent revoked before administrator execution.');
  } else {
    throw new UserFacingError('This trade control is not supported.');
  }
  requestImmediateOutboxDrain();
}

async function startCounterWizard(
  interaction: ButtonInteraction,
  trade: RosterTrade,
  organizations: RosterTradeOrganization[],
): Promise<void> {
  const proposer = organizations.find((org) => org.id === trade.receiverOrgId);
  const receiver = organizations.find((org) => org.id === trade.proposerOrgId);
  if (!proposer || !receiver) throw new UserFacingError('The current trade organizations are unavailable.');
  const wizardId = randomUUID().slice(0, 12);
  const offered = trade.movements.filter((move) => move.fromOrgId === proposer.id).map((move) => move.id);
  tradeWizards.set(wizardId, {
    id: wizardId, actorDiscordId: interaction.user.id, channelId: interaction.channelId,
    seasonId: trade.seasonId, divisionId: trade.divisionId, organizations,
    proposerOrgId: proposer.id, receiverOrgId: receiver.id,
    transactionId: trade.id, expectedRevision: trade.currentRevision,
    expiresAt: Date.now() + 15 * 60_000,
  });
  await interaction.reply({
    content: `**Counteroffer — Step 1 of 3:** Update players offered by ${proposer.tag}.`,
    components: [playerSelectRow(`tr_counter_offer:${wizardId}`, proposer.players, offered)],
    ephemeral: true,
  });
}

export async function handleTradeCounterSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [action, wizardId] = interaction.customId.split(':');
  const wizard = requireWizard(wizardId, interaction.user.id, interaction.channelId);
  if (action === 'tr_counter_offer') {
    const proposer = requireOrganization(wizard, wizard.proposerOrgId);
    assertSelectedPlayers(proposer, interaction.values);
    wizard.offeredPlayerIds = [...interaction.values];
    const receiver = requireOrganization(wizard, wizard.receiverOrgId);
    const requested = wizard.transactionId
      ? (await getRosterTrade(db, wizard.transactionId))?.movements
        .filter((move) => move.fromOrgId === receiver.id).map((move) => move.id) ?? []
      : [];
    await interaction.update({
      content: `**Counteroffer — Step 2 of 3:** Update players requested from ${receiver.tag}.`,
      components: [playerSelectRow(`tr_request:${wizard.id}`, receiver.players, requested)],
    });
  }
}

function requireWizard(id: string, actorDiscordId: string, channelId: string): TradeWizard {
  pruneWizards();
  const wizard = tradeWizards.get(id);
  if (!wizard || wizard.actorDiscordId !== actorDiscordId || wizard.channelId !== channelId) {
    throw new UserFacingError('This private trade wizard expired or belongs to another user. Start `/trade` again.');
  }
  return wizard;
}

function pruneWizards(): void {
  const now = Date.now();
  for (const [id, wizard] of tradeWizards) if (wizard.expiresAt <= now) tradeWizards.delete(id);
}

function requireOrganization(wizard: TradeWizard, orgId: string | undefined): RosterTradeOrganization {
  const org = orgId ? wizard.organizations.find((candidate) => candidate.id === orgId) : undefined;
  if (!org) throw new UserFacingError('The selected organization is no longer available.');
  return org;
}

function assertSelectedPlayers(org: RosterTradeOrganization, playerIds: string[]): void {
  if (playerIds.length === 0 || new Set(playerIds).size !== playerIds.length
    || playerIds.some((id) => !org.players.some((player) => player.id === id))) {
    throw new UserFacingError('One or more selected players are no longer on that roster.');
  }
}

function organizationSelectRow(customId: string, organizations: RosterTradeOrganization[]) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder('Select an organization')
      .addOptions(organizations.slice(0, 25).map((org) => ({ label: `${org.name} (${org.tag})`, value: org.id }))),
  );
}

function playerSelectRow(customId: string, players: RosterTradeOrganization['players'], defaults: string[] = []) {
  if (players.length === 0) throw new UserFacingError('That organization has no current rostered players.');
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder('Select one or more players')
      .setMinValues(1).setMaxValues(Math.min(25, players.length))
      .addOptions(players.slice(0, 25).map((player) => ({
        label: player.name, value: player.id, default: defaults.includes(player.id),
      }))),
  );
}

function tradeReviewText(
  wizard: TradeWizard,
  proposer: RosterTradeOrganization,
  receiver: RosterTradeOrganization,
): string {
  const names = (org: RosterTradeOrganization, ids: string[]) =>
    ids.map((id) => org.players.find((player) => player.id === id)?.name ?? id).join(', ');
  return [
    `**${wizard.transactionId ? 'Counteroffer' : 'Trade Proposal'} — Step 5 of 5: Private Review**`,
    `${proposer.tag} sends: ${names(proposer, wizard.offeredPlayerIds ?? [])}`,
    `${receiver.tag} sends: ${names(receiver, wizard.requestedPlayerIds ?? [])}`,
    '',
    'Nothing becomes public until you explicitly post.',
  ].join('\n');
}

function authorizedForOrganization(
  member: APIInteractionGuildMember | GuildMember | null,
  actorDiscordId: string,
  captainRoleId: string,
  org: RosterTradeOrganization,
): boolean {
  return org.captainDiscordIds.includes(actorDiscordId)
    && !!org.organizationRoleId
    && memberHasRole(member, captainRoleId)
    && memberHasRole(member, org.organizationRoleId);
}

function requireActorOrganization(actorOrgIds: string[], expectedOrgId: string, message: string): void {
  if (!actorOrgIds.includes(expectedOrgId)) throw new UserFacingError(message);
}

function memberHasRole(
  member: APIInteractionGuildMember | GuildMember | null,
  roleId: string,
): boolean {
  if (!member) return false;
  if (Array.isArray(member.roles)) return member.roles.includes(roleId);
  return member.roles.cache.has(roleId);
}
