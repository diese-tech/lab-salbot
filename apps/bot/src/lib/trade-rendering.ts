import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { RosterTrade } from '@salbot/db';

export function tradeOperationMarker(operationId: string): string {
  return `sal-operation:${operationId}`;
}

export function tradeProposalMarker(transactionId: string): string {
  return `sal-trade:${transactionId}`;
}

export function buildTradeProposalEmbed(trade: RosterTrade): EmbedBuilder {
  const offered = trade.movements.filter((move) => move.fromOrgId === trade.proposerOrgId);
  const requested = trade.movements.filter((move) => move.fromOrgId === trade.receiverOrgId);
  return new EmbedBuilder()
    .setColor(trade.status === 'completed' ? 0x57f287 : trade.status === 'awaiting_admin' ? 0xfee75c : 0x5865f2)
    .setTitle(`Trade Proposal — ${trade.proposer.tag} ↔ ${trade.receiver.tag}`)
    .setDescription(`Revision ${trade.currentRevision} • ${proposalStatusLabel(trade.status)}`)
    .addFields(
      { name: `${trade.proposer.tag} sends`, value: playerList(offered.map((move) => move.name)), inline: true },
      { name: `${trade.receiver.tag} sends`, value: playerList(requested.map((move) => move.name)), inline: true },
    )
    .setFooter({ text: tradeProposalMarker(trade.id) })
    .setTimestamp();
}

export function buildTradeProposalButtons(trade: RosterTrade) {
  const id = (action: string) => `trade:${action}:${trade.id}:${trade.currentRevision}`;
  if (trade.status === 'awaiting_acceptance') {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(id('accept')).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(id('counter')).setLabel('Counter').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(id('decline')).setLabel('Decline').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(id('withdraw')).setLabel('Withdraw').setStyle(ButtonStyle.Secondary),
    )];
  }
  if (trade.status === 'awaiting_admin' || trade.status === 'blocked') {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(id('revoke')).setLabel('Revoke Consent').setStyle(ButtonStyle.Danger),
    )];
  }
  return [];
}

export function buildTradeAdminEmbed(trade: RosterTrade): EmbedBuilder {
  const offered = trade.movements.filter((move) => move.fromOrgId === trade.proposerOrgId);
  const requested = trade.movements.filter((move) => move.fromOrgId === trade.receiverOrgId);
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('Roster Trade — Admin Review')
    .setDescription(`Transaction ${trade.id} • Revision ${trade.currentRevision}`)
    .addFields(
      { name: `${trade.proposer.tag} sends`, value: playerList(offered.map((move) => move.name)), inline: true },
      { name: `${trade.receiver.tag} sends`, value: playerList(requested.map((move) => move.name)), inline: true },
      { name: 'Safety', value: 'Captain consent is recorded. Approval revalidates roster ownership, eligibility, capacity, revision, and concurrency in the database.' },
    )
    .setFooter({ text: `sal-trade-review:${trade.pendingActionId}` })
    .setTimestamp();
}

export function buildCompletedTradeLine(input: {
  divisionId: string;
  proposerOrgId: string;
  receiverOrgId: string;
  proposerTag: string;
  receiverTag: string;
  movements: Array<{ playerName: string; fromOrgId: string; toOrgId: string }>;
}): string {
  const offered = input.movements.filter((move) => move.fromOrgId === input.proposerOrgId)
    .map((move) => move.playerName);
  const requested = input.movements.filter((move) => move.fromOrgId === input.receiverOrgId)
    .map((move) => move.playerName);
  return `[${input.divisionId.toUpperCase()}] ${input.proposerTag} traded ${playerList(offered)} to ${input.receiverTag} for ${playerList(requested)}`;
}

function playerList(names: string[]): string {
  return names.length > 0 ? names.join(' + ') : 'no players';
}

function proposalStatusLabel(status: string): string {
  if (status === 'awaiting_acceptance') return 'Awaiting counterpart response';
  if (status === 'awaiting_admin') return 'Accepted — awaiting admin review';
  if (status === 'blocked') return 'Execution blocked — admin action required';
  if (status === 'completed') return 'Completed';
  if (status === 'withdrawn') return 'Withdrawn / consent revoked';
  if (status === 'denied') return 'Declined / denied';
  return status.replaceAll('_', ' ');
}
