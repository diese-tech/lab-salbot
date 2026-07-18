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
import type { ReschedulePayload } from '@salbot/shared';
import { db } from '../lib/db';
import { getAdminReviewChannelId, getReschedulesChannelId } from '../lib/channels';
import {
  buildRescheduleReceiptEmbed,
  buildRescheduleAdminEmbed,
  buildApprovalButtons,
} from '../lib/embeds';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const data = {
  name: 'reschedule',
  description: 'Request to reschedule a match.',
} as const;

// ── Step 1: Show match select ─────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  const captain = await getCaptainByDiscordId(db, interaction.user.id);
  if (!captain) {
    await interaction.reply({ content: 'You are not registered as a captain.', ephemeral: true });
    return;
  }

  const matches = await getEligibleMatchesForCaptain(
    db,
    captain.org_id as string,
    captain.season_id as string
  );
  if (!matches.length) {
    await interaction.reply({ content: 'You have no upcoming scheduled matches.', ephemeral: true });
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
      .setCustomId('rs_match')
      .setPlaceholder('Select the match to reschedule')
      .addOptions(options)
  );

  await interaction.reply({
    content: '**Request Reschedule** — Step 1 of 2: Select the match.',
    components: [row],
    ephemeral: true,
  });
}

// ── Step 2: Match selected → show date/time modal ────────────────────────────

export async function handleMatchSelect(interaction: StringSelectMenuInteraction) {
  const matchId = interaction.values[0];

  const modal = new ModalBuilder()
    .setCustomId(`rs_modal:${matchId}`)
    .setTitle('Request Reschedule')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('new_date')
          .setLabel('New date (YYYY-MM-DD)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('2025-06-15')
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('new_time')
          .setLabel('New time (HH:MM in ET)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('20:00')
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(300)
      )
    );

  await interaction.showModal(modal);
}

// ── Step 3: Modal submitted → validate + create pending_action ────────────────

export async function handleRescheduleModal(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const [, matchId] = interaction.customId.split(':');
  const newDate = interaction.fields.getTextInputValue('new_date').trim();
  const newTime = interaction.fields.getTextInputValue('new_time').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim() || undefined;

  if (!DATE_RE.test(newDate)) {
    await interaction.editReply('Invalid date format. Use YYYY-MM-DD (e.g. 2025-06-15).');
    return;
  }
  if (!TIME_RE.test(newTime)) {
    await interaction.editReply('Invalid time format. Use HH:MM (e.g. 20:00).');
    return;
  }

  const { data: match } = await db
    .from('matches')
    .select(`
      id, week, scheduled_date, scheduled_time, division_id,
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
  const matchInfo = {
    id: match.id as string,
    week: match.week as number,
    scheduled_date: match.scheduled_date as string,
    scheduled_time: match.scheduled_time as string,
    division,
    home_org: homeOrg,
    away_org: awayOrg,
  };

  const payload: ReschedulePayload = { newDate, newTime, reason };

  const pendingAction = await createPendingAction(db, {
    type: 'reschedule',
    requestedByDiscordId: interaction.user.id,
    matchId,
    divisionId: match.division_id as string,
    payloadJson: payload as unknown as Record<string, unknown>,
  });

  // Public receipt in reschedules channel
  const rescChannel = await interaction.client.channels.fetch(
    getReschedulesChannelId(match.division_id as string)
  ) as TextChannel;
  const receiptEmbed = buildRescheduleReceiptEmbed(matchInfo, newDate, newTime, interaction.user.id);
  const receiptMsg = await rescChannel.send({ embeds: [receiptEmbed] });

  // Admin review card
  const adminChannel = await interaction.client.channels.fetch(getAdminReviewChannelId()) as TextChannel;
  const adminEmbed = buildRescheduleAdminEmbed(matchInfo, newDate, newTime, reason, interaction.user.id, pendingAction.id);
  const reviewMsg = await adminChannel.send({
    embeds: [adminEmbed],
    components: [buildApprovalButtons(pendingAction.id)],
  });

  await updatePendingActionMessages(db, pendingAction.id, {
    adminReviewMessageId: reviewMsg.id,
    publicReceiptMessageId: receiptMsg.id,
  });

  await interaction.editReply('✅ Reschedule request submitted for admin review.');
}
