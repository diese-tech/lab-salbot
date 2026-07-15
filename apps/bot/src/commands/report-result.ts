import type { ChatInputCommandInteraction, StringSelectMenuInteraction, ModalSubmitInteraction, TextChannel } from 'discord.js';
import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  getCaptainByDiscordId,
  getEligibleMatchesForCaptain,
  createPendingAction,
  updatePendingActionMessages,
} from '@salbot/db';
import { parseScore } from '@salbot/shared';
import type { MatchResultPayload } from '@salbot/shared';
import { db } from '../lib/db';
import { getAdminReviewChannelId, getResultsChannelId } from '../lib/channels';
import {
  buildMatchResultReceiptEmbed,
  buildMatchResultAdminEmbed,
  buildApprovalButtons,
} from '../lib/embeds';
import { createProofThread } from '../lib/proof-thread';
import { isUniqueViolation } from '../lib/errors';

export const data = {
  name: 'report-result',
  description: 'Report the result of a completed match.',
} as const;

// ── Step 1: Show match select ─────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  const captain = await getCaptainByDiscordId(db, interaction.user.id);
  if (!captain) {
    await interaction.reply({ content: 'You are not registered as a captain.', ephemeral: true });
    return;
  }

  const matches = await getEligibleMatchesForCaptain(db, captain.org_id as string);
  if (!matches.length) {
    await interaction.reply({ content: 'You have no scheduled matches available to report.', ephemeral: true });
    return;
  }

  const options = matches.slice(0, 25).map((m) => {
    const home = m.home_org as unknown as { tag: string } | null;
    const away = m.away_org as unknown as { tag: string } | null;
    return {
      label: `Week ${m.week} — ${home?.tag ?? '?'} vs ${away?.tag ?? '?'} (${m.scheduled_date})`,
      value: m.id as string,
    };
  });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('rr_match')
      .setPlaceholder('Select the match to report')
      .addOptions(options)
  );

  await interaction.reply({
    content: '**Report Match Result** — Step 1 of 3: Select the match.',
    components: [row],
    ephemeral: true,
  });
}

// ── Step 2: Match selected → show winner select ───────────────────────────────

export async function handleMatchSelect(interaction: StringSelectMenuInteraction) {
  const matchId = interaction.values[0];
  const { data: match } = await db
    .from('matches')
    .select('id, week, home_org:orgs!home_org_id(id, name, tag), away_org:orgs!away_org_id(id, name, tag)')
    .eq('id', matchId)
    .single();

  if (!match) {
    await interaction.update({ content: 'Match not found. Please try again.', components: [] });
    return;
  }

  const home = match.home_org as unknown as { id: string; name: string; tag: string } | null;
  const away = match.away_org as unknown as { id: string; name: string; tag: string } | null;

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`rr_winner:${matchId}`)
      .setPlaceholder('Select the winning team')
      .addOptions([
        { label: `${home?.name ?? 'Home'} (Home)`, value: home?.id ?? '' },
        { label: `${away?.name ?? 'Away'} (Away)`, value: away?.id ?? '' },
      ])
  );

  await interaction.update({
    content: `**Week ${(match as { week: number }).week}** — ${home?.tag} vs ${away?.tag}\n\nStep 2 of 3: Select the winner.`,
    components: [row],
  });
}

// ── Step 3: Winner selected → show score modal ────────────────────────────────

export async function handleWinnerSelect(interaction: StringSelectMenuInteraction) {
  const [, matchId] = interaction.customId.split(':');
  const winnerOrgId = interaction.values[0];

  const modal = new ModalBuilder()
    .setCustomId(`rr_score:${matchId}:${winnerOrgId}`)
    .setTitle('Enter Match Score')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('score')
          .setLabel('Score (e.g. 2-1 or 2-0)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('2-1')
          .setRequired(true)
          .setMaxLength(5)
      )
    );

  await interaction.showModal(modal);
}

// ── Step 4: Score submitted → create pending_action + post embeds ─────────────

export async function handleScoreModal(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const parts = interaction.customId.split(':');
  const matchId = parts[1];
  const winnerOrgId = parts[2];
  const scoreRaw = interaction.fields.getTextInputValue('score').trim();
  const parsed = parseScore(scoreRaw);

  if (!parsed) {
    await interaction.editReply('Invalid score format. Use "2-1", "2-0", or "3-2".');
    return;
  }

  const { data: match } = await db
    .from('matches')
    .select(`
      id, week, scheduled_date, scheduled_time, division_id,
      home_org_id, away_org_id,
      home_org:orgs!home_org_id(id, name, tag),
      away_org:orgs!away_org_id(id, name, tag),
      division:divisions(id, name)
    `)
    .eq('id', matchId)
    .single();

  if (!match) {
    await interaction.editReply('Match not found.');
    return;
  }

  const homeOrg = match.home_org as unknown as { id: string; name: string; tag: string };
  const awayOrg = match.away_org as unknown as { id: string; name: string; tag: string };
  const division = match.division as unknown as { id: string; name: string };
  const winnerOrg = winnerOrgId === homeOrg.id ? homeOrg : awayOrg;
  const matchInfo = {
    id: match.id as string,
    week: match.week as number,
    scheduled_date: match.scheduled_date as string,
    scheduled_time: match.scheduled_time as string,
    division,
    home_org: homeOrg,
    away_org: awayOrg,
  };

  const payload: MatchResultPayload = { winnerOrgId, score: scoreRaw, parsed };

  let pendingAction;
  try {
    pendingAction = await createPendingAction(db, {
      type: 'match_result',
      requestedByDiscordId: interaction.user.id,
      matchId,
      divisionId: match.division_id as string,
      payloadJson: payload as unknown as Record<string, unknown>,
    });
  } catch (err) {
    // Postgres unique_violation (022_pending_result_uniqueness.sql on sal-site) —
    // a match_result pending_action already exists for this match in a
    // pending/pending_info state. Surface a friendly message instead of a raw error.
    if (isUniqueViolation(err)) {
      await interaction.editReply(
        'A result for this match is already awaiting review — an admin needs to process the existing submission first.'
      );
      return;
    }
    throw err;
  }

  // Public receipt
  const resultsChannelId = getResultsChannelId(match.division_id as string);
  const resultsChannel = await interaction.client.channels.fetch(resultsChannelId) as TextChannel;
  const receiptEmbed = buildMatchResultReceiptEmbed(matchInfo, winnerOrg, scoreRaw, interaction.user.id);
  const receiptMsg = await resultsChannel.send({ embeds: [receiptEmbed] });

  // Proof thread
  const matchLabel = `${homeOrg.tag.toLowerCase()}-vs-${awayOrg.tag.toLowerCase()}`;
  const proofThread = await createProofThread(
    resultsChannel,
    receiptMsg,
    matchId,
    matchLabel,
    match.week as number,
    parsed.expectedScreenshots
  );

  // Admin review card
  const adminChannel = await interaction.client.channels.fetch(getAdminReviewChannelId()) as TextChannel;
  const adminEmbed = buildMatchResultAdminEmbed(matchInfo, winnerOrg, scoreRaw, interaction.user.id, pendingAction.id);
  const reviewMsg = await adminChannel.send({
    embeds: [adminEmbed],
    components: [buildApprovalButtons(pendingAction.id)],
  });

  await updatePendingActionMessages(db, pendingAction.id, {
    adminReviewMessageId: reviewMsg.id,
    publicReceiptMessageId: receiptMsg.id,
  });

  await interaction.editReply(
    `✅ Result submitted for admin review.\n📸 Upload your proof screenshots here: ${proofThread.url}`
  );
}
