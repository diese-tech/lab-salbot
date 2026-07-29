import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { STATUS_EMOJI } from '@salbot/shared';
import type { GodDraftRecapData } from '@salbot/db';

const COLOR = {
  pending: 0x5865f2,
  approved: 0x57f287,
  denied: 0xed4245,
  needs_info: 0xfee75c,
  cancelled: 0x747f8d,
} as const;

const DECISION_FIELD_NAMES = new Set([
  'Approved By',
  'Denied By',
  'Denial Reason',
  'Info Requested By',
  'Info Needed',
  'Cancelled By',
  'Cancellation Reason',
]);

function clearDecisionFields(embed: EmbedBuilder): EmbedBuilder {
  const fields = embed.toJSON().fields?.filter((field) => !DECISION_FIELD_NAMES.has(field.name)) ?? [];
  return embed.setFields(fields);
}

type OrgInfo = { name: string; tag: string };
type MatchInfo = {
  id: string;
  week: number;
  scheduled_date: string;
  scheduled_time: string;
  division: { name: string };
  home_org: OrgInfo;
  away_org: OrgInfo;
};

export function buildMatchResultReceiptEmbed(
  match: MatchInfo,
  winnerOrg: OrgInfo,
  score: string,
  captainDiscordId: string
) {
  return new EmbedBuilder()
    .setColor(COLOR.pending)
    .setTitle(`${STATUS_EMOJI.pending} Match Result — Under Review`)
    .addFields(
      { name: 'Match', value: `Week ${match.week} — ${match.home_org.tag} vs ${match.away_org.tag}`, inline: true },
      { name: 'Division', value: match.division.name, inline: true },
      { name: '​', value: '​', inline: true },
      { name: 'Reported Winner', value: winnerOrg.name, inline: true },
      { name: 'Score', value: score, inline: true },
      { name: 'Submitted By', value: `<@${captainDiscordId}>`, inline: true },
    )
    .setFooter({ text: 'Pending admin review' })
    .setTimestamp();
}

export function buildMatchResultAdminEmbed(
  match: MatchInfo,
  winnerOrg: OrgInfo,
  score: string,
  captainDiscordId: string,
  pendingActionId: string
) {
  return new EmbedBuilder()
    .setColor(COLOR.pending)
    .setTitle(`${STATUS_EMOJI.pending} Match Result Pending Review`)
    .addFields(
      { name: 'Match', value: `Week ${match.week} — ${match.home_org.tag} vs ${match.away_org.tag}`, inline: true },
      { name: 'Division', value: match.division.name, inline: true },
      { name: '​', value: '​', inline: true },
      { name: 'Reported Winner', value: winnerOrg.name, inline: true },
      { name: 'Score', value: score, inline: true },
      { name: 'Submitted By', value: `<@${captainDiscordId}>`, inline: true },
    )
    .setFooter({ text: `Action ID: ${pendingActionId}` })
    .setTimestamp();
}

export function buildRescheduleReceiptEmbed(
  match: MatchInfo,
  newDate: string,
  newTime: string,
  captainDiscordId: string
) {
  const currentTime = `${match.scheduled_date} ${match.scheduled_time}`;
  return new EmbedBuilder()
    .setColor(COLOR.pending)
    .setTitle(`${STATUS_EMOJI.pending} Reschedule Request — Under Review`)
    .addFields(
      { name: 'Match', value: `Week ${match.week} — ${match.home_org.tag} vs ${match.away_org.tag}`, inline: true },
      { name: 'Division', value: match.division.name, inline: true },
      { name: '​', value: '​', inline: true },
      { name: 'Current Time', value: currentTime, inline: true },
      { name: 'Requested Time', value: `${newDate} ${newTime}`, inline: true },
      { name: 'Requested By', value: `<@${captainDiscordId}>`, inline: true },
    )
    .setFooter({ text: 'Pending admin review' })
    .setTimestamp();
}

export function buildRescheduleAdminEmbed(
  match: MatchInfo,
  newDate: string,
  newTime: string,
  reason: string | undefined,
  captainDiscordId: string,
  pendingActionId: string
) {
  const currentTime = `${match.scheduled_date} ${match.scheduled_time}`;
  const embed = new EmbedBuilder()
    .setColor(COLOR.pending)
    .setTitle(`${STATUS_EMOJI.pending} Reschedule Request Pending Review`)
    .addFields(
      { name: 'Match', value: `Week ${match.week} — ${match.home_org.tag} vs ${match.away_org.tag}`, inline: true },
      { name: 'Division', value: match.division.name, inline: true },
      { name: '​', value: '​', inline: true },
      { name: 'Current Time', value: currentTime, inline: true },
      { name: 'Requested Time', value: `${newDate} ${newTime}`, inline: true },
      { name: 'Requested By', value: `<@${captainDiscordId}>`, inline: true },
    )
    .setFooter({ text: `Action ID: ${pendingActionId}` })
    .setTimestamp();

  if (reason) embed.addFields({ name: 'Reason', value: reason });
  return embed;
}

export function buildAdminReviewEmbed(
  issueType: string,
  description: string,
  captainDiscordId: string,
  pendingActionId: string
) {
  return new EmbedBuilder()
    .setColor(COLOR.pending)
    .setTitle(`${STATUS_EMOJI.pending} Admin Review Request`)
    .addFields(
      { name: 'Issue Type', value: issueType.replace(/_/g, ' '), inline: true },
      { name: 'Submitted By', value: `<@${captainDiscordId}>`, inline: true },
      { name: 'Description', value: description },
    )
    .setFooter({ text: `Action ID: ${pendingActionId}` })
    .setTimestamp();
}

export function buildApprovalButtons(pendingActionId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${pendingActionId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny:${pendingActionId}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`needs_info:${pendingActionId}`)
      .setLabel('⚠️ Needs Info')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function applyApprovedStatus(embed: EmbedBuilder, adminDiscordId: string) {
  return clearDecisionFields(embed)
    .setColor(COLOR.approved)
    .setTitle(`${STATUS_EMOJI.approved} Approved`)
    .addFields({ name: 'Approved By', value: `<@${adminDiscordId}>` })
    .setTimestamp();
}

export function applyDeniedStatus(embed: EmbedBuilder, adminDiscordId: string, reason: string) {
  return clearDecisionFields(embed)
    .setColor(COLOR.denied)
    .setTitle(`${STATUS_EMOJI.denied} Denied`)
    .addFields(
      { name: 'Denied By', value: `<@${adminDiscordId}>` },
      { name: 'Denial Reason', value: reason },
    )
    .setTimestamp();
}

export function applyNeedsInfoStatus(embed: EmbedBuilder, adminDiscordId: string, note: string) {
  return clearDecisionFields(embed)
    .setColor(COLOR.needs_info)
    .setTitle(`${STATUS_EMOJI.pending_info} Needs Info`)
    .addFields(
      { name: 'Info Requested By', value: `<@${adminDiscordId}>` },
      { name: 'Info Needed', value: note },
    )
    .setTimestamp();
}

export function applyCancelledStatus(embed: EmbedBuilder, adminDiscordId: string, reason: string) {
  return clearDecisionFields(embed)
    .setColor(COLOR.cancelled)
    .setTitle('Cancelled')
    .addFields(
      { name: 'Cancelled By', value: `<@${adminDiscordId}>` },
      { name: 'Cancellation Reason', value: reason },
    )
    .setTimestamp();
}

export function buildGodDraftRecapEmbed(recap: GodDraftRecapData) {
  const match = recap.session.matches;
  const home = match?.home_org;
  const away = match?.away_org;
  const homeLabel = home ? home.tag : 'Home';
  const awayLabel = away ? away.tag : 'Away';
  const homeOrgId = match?.home_org_id;
  const awayOrgId = match?.away_org_id;

  const homePicks = formatDraftRows(recap.picks.filter((pick) => pick.org_id === homeOrgId), true);
  const awayPicks = formatDraftRows(recap.picks.filter((pick) => pick.org_id === awayOrgId), true);
  const homeBans = formatDraftRows(recap.bans.filter((ban) => ban.org_id === homeOrgId), false);
  const awayBans = formatDraftRows(recap.bans.filter((ban) => ban.org_id === awayOrgId), false);

  const embed = new EmbedBuilder()
    .setColor(0x2dd4bf)
    .setTitle(`God Draft Complete - Game ${recap.session.game_number}`)
    .setDescription(match ? `Week ${match.week} - ${homeLabel} vs ${awayLabel}` : `Session ${recap.session.id}`)
    .addFields(
      { name: `${homeLabel} Picks`, value: homePicks, inline: true },
      { name: `${awayLabel} Picks`, value: awayPicks, inline: true },
      { name: `${homeLabel} Bans`, value: homeBans, inline: true },
      { name: `${awayLabel} Bans`, value: awayBans, inline: true },
    )
    .setFooter({ text: `Draft session ${recap.session.id}` })
    .setTimestamp();

  if (recap.seriesContinues) {
    embed.addFields({
      name: 'Vaulted Next Game',
      value: recap.vaultedGodNames.length ? recap.vaultedGodNames.join(', ') : 'No picked gods recorded.',
    });
  }

  return embed;
}

function formatDraftRows(rows: Array<{ god_name: string; player_ign?: string | null; slot: number }>, includePlayer: boolean) {
  if (!rows.length) return 'None recorded';
  return rows
    .sort((a, b) => a.slot - b.slot)
    .map((row, index) => {
      const player = includePlayer ? ` - ${row.player_ign ?? 'Unassigned'}` : '';
      return `${index + 1}. ${row.god_name}${player}`;
    })
    .join('\n');
}
