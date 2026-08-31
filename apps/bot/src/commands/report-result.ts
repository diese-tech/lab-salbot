import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  getEligibleMatchesForOperator,
  createMatchResultActionWithReport,
  getActiveMatchResultPendingAction,
} from '@salbot/db';
import { parseScore } from '@salbot/shared';
import type { MatchResultPayload } from '@salbot/shared';
import { db } from '../lib/db';
import { buildEnterStatsButton } from '../lib/embeds';
import { hasCommandAccess } from '../lib/command-access';
import { issueMatchReportHostReviewLink } from '../lib/match-report-site';
import {
  ensureMatchResultDiscordArtifacts,
  type MatchResultArtifactAction,
} from '../lib/match-result-discord';

export const data = {
  name: 'report-result',
  description: 'Report the result of a completed match.',
} as const;

// ── Step 1: Show match select ─────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!hasCommandAccess(interaction.member, 'report-result')) {
    await interaction.reply({
      content: 'You need an authorized SAL operator or admin Discord role to report results.',
      ephemeral: true,
    });
    return;
  }

  const matches = await getEligibleMatchesForOperator(db);
  if (!matches.length) {
    await interaction.reply({
      content: 'There are no scheduled current-season matches available to report.',
      ephemeral: true,
    });
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
      proof_thread_id, proof_thread_url,
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

  const matchReport = await createMatchResultActionWithReport(
    db,
    matchId,
    interaction.user.id,
    payload,
  );
  const activeAction = await getActiveMatchResultPendingAction(db, matchId);
  if (!activeAction
    || activeAction.id !== matchReport.actionId
    || activeAction.requestedByDiscordId !== matchReport.hostDiscordId) {
    throw new Error('Atomic match-result creation returned inconsistent recovery state.');
  }
  const pendingAction: MatchResultArtifactAction = activeAction;
  const recovered = !matchReport.created;
  const winnerOrg = pendingAction.payloadJson.winnerOrgId === homeOrg.id ? homeOrg : awayOrg;
  const proofThread = await ensureMatchResultDiscordArtifacts({
    client: interaction.client,
    action: pendingAction,
    reportId: matchReport.reportId,
    match: {
      ...matchInfo,
      divisionId: match.division_id as string,
      proofThreadId: match.proof_thread_id as string | null,
    },
    winnerOrg,
  });

  if (recovered) {
    const content = 'A result for this match is already awaiting review — its receipt, proof thread, and admin card were recovered.';
    if (pendingAction.requestedByDiscordId === interaction.user.id) {
      await interaction.editReply({
        content: `${content} Use **Enter stats** below to continue.`,
        components: [buildEnterStatsButton(matchReport.reportId)],
      });
    } else {
      await interaction.editReply(content);
    }
  } else {
    await interaction.editReply(
      `✅ Result submitted and waiting for host stats.\n📊 Use **Enter stats** in the proof thread to upload screenshots and review the extraction: ${proofThread.url}`,
    );
  }
}

export async function handleEnterStatsButton(interaction: ButtonInteraction) {
  if (!hasCommandAccess(interaction.member, 'enter-match-stats')) {
    await interaction.reply({
      content: 'You no longer have permission to enter match stats.',
      ephemeral: true,
    });
    return;
  }

  const [, reportId] = interaction.customId.split(':');
  await interaction.deferReply({ ephemeral: true });
  const link = await issueMatchReportHostReviewLink(reportId, interaction.user.id);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Open stats review')
      .setStyle(ButtonStyle.Link)
      .setURL(link.reviewUrl),
  );
  await interaction.editReply({
    content: 'This private link is bound to your Discord account and expires after use.',
    components: [row],
  });
}
