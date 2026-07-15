// Approval pipeline: shared logic for Approve / Deny / Needs Info button flows.
// Each action is atomic — only the first admin to click wins.

import type { ButtonInteraction, ModalSubmitInteraction, Client, TextChannel } from 'discord.js';
import { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } from 'discord.js';
import {
  getPendingAction,
  claimPendingActionForApproval,
  denyPendingAction,
  needsInfoPendingAction,
  writeAuditLog,
  getMatchById,
  completeMatch,
  rescheduleMatch,
  approvePendingStatRecord,
  rejectPendingStatRecord,
} from '@salbot/db';
import { parseScore } from '@salbot/shared';
import type { MatchResultPayload, ReschedulePayload } from '@salbot/shared';
import { db } from '../lib/db';
import { getAdminReviewChannelId, getResultsChannelId, getReschedulesChannelId } from '../lib/channels';
import {
  applyApprovedStatus,
  applyDeniedStatus,
  applyNeedsInfoStatus,
} from '../lib/embeds';
import { removeActiveProofThread } from '../lib/proof-thread';
import { toUserMessage } from '../lib/errors';
import { triggerStandingsRecalculation } from '../lib/standings-sync';

// ── Approve button ────────────────────────────────────────────────────────────────────

export async function handleApproveButton(interaction: ButtonInteraction, pendingActionId: string) {
  await interaction.deferReply({ ephemeral: true });

  const claimed = await claimPendingActionForApproval(db, pendingActionId, interaction.user.id);
  if (!claimed) {
    await interaction.editReply('This action was already processed by another admin.');
    return;
  }

  const pendingAction = await getPendingAction(db, pendingActionId);
  if (!pendingAction) {
    await interaction.editReply('Pending action not found.');
    return;
  }

  try {
    // claimPendingActionForApproval above already flipped this row to
    // 'approved' -- that decision is final regardless of what happens next,
    // so every branch below must still write the pending_action_approved
    // audit log and update the embeds. A stale/already-finalized match (the
    // `applied: false` case) is a valid outcome, not an error: throwing here
    // would skip both, leaving the pending action stuck at 'approved' with
    // no audit trail and no way to deny/retry it (its precondition guards
    // only accept a 'pending' row).
    let applied = true;
    let note: string | undefined;
    if (pendingAction.type === 'match_result') {
      ({ applied, note } = await approveMatchResult(interaction, pendingAction));
    } else if (pendingAction.type === 'reschedule') {
      ({ applied, note } = await approveReschedule(interaction, pendingAction));
    } else if (pendingAction.type === 'admin_review') {
      await resolveAdminReview(interaction, pendingAction);
    }

    await writeAuditLog(db, {
      actionType: 'pending_action_approved',
      entityType: 'pending_action',
      entityId: pendingActionId,
      actorDiscordId: interaction.user.id,
      pendingActionId,
      newValueJson: { status: 'approved', applied },
    });

    await updateEmbeds(interaction.client, pendingAction, 'approved', interaction.user.id);
    await interaction.editReply(
      applied ? '✅ Approved.' : `✅ Approval recorded, but no changes were made: ${note}`
    );
  } catch (err) {
    console.error('[approval] approve error:', err);
    await interaction.editReply(toUserMessage(err));
  }
}

// ── Deny button → modal ──────────────────────────────────────────────────────

export async function handleDenyButton(interaction: ButtonInteraction, pendingActionId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_deny:${pendingActionId}`)
    .setTitle('Deny — Reason Required')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for denial')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
  await interaction.showModal(modal);
}

export async function handleDenyModal(interaction: ModalSubmitInteraction, pendingActionId: string) {
  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue('reason');

  const denied = await denyPendingAction(db, pendingActionId, interaction.user.id, reason);
  if (!denied) {
    await interaction.editReply('This action was already processed by another admin.');
    return;
  }

  const pendingAction = await getPendingAction(db, pendingActionId);
  if (!pendingAction) {
    await interaction.editReply('Pending action not found.');
    return;
  }

  await writeAuditLog(db, {
    actionType: 'pending_action_denied',
    entityType: 'pending_action',
    entityId: pendingActionId,
    actorDiscordId: interaction.user.id,
    pendingActionId,
    newValueJson: { status: 'denied', reason },
  });

  await updateEmbeds(interaction.client, pendingAction, 'denied', interaction.user.id, reason);
  await notifyCaptain(interaction.client, pendingAction.requested_by_discord_id, 'denied', reason);
  await interaction.editReply('❌ Denied.');
}

// ── Needs Info button → modal ───────────────────────────────────────────────────

export async function handleNeedsInfoButton(interaction: ButtonInteraction, pendingActionId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_needs_info:${pendingActionId}`)
    .setTitle('Needs Info')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('note')
          .setLabel('What info is needed from the captain?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
  await interaction.showModal(modal);
}

export async function handleNeedsInfoModal(interaction: ModalSubmitInteraction, pendingActionId: string) {
  await interaction.deferReply({ ephemeral: true });
  const note = interaction.fields.getTextInputValue('note');

  const marked = await needsInfoPendingAction(db, pendingActionId, interaction.user.id, note);
  if (!marked) {
    await interaction.editReply('This action was already processed by another admin.');
    return;
  }

  const pendingAction = await getPendingAction(db, pendingActionId);
  if (!pendingAction) {
    await interaction.editReply('Pending action not found.');
    return;
  }

  await writeAuditLog(db, {
    actionType: 'pending_action_needs_info',
    entityType: 'pending_action',
    entityId: pendingActionId,
    actorDiscordId: interaction.user.id,
    pendingActionId,
    newValueJson: { status: 'pending_info', note },
  });

  await updateEmbeds(interaction.client, pendingAction, 'needs_info', interaction.user.id, note);
  await notifyCaptain(interaction.client, pendingAction.requested_by_discord_id, 'needs_info', note);
  await interaction.editReply('⚠️ Marked as Needs Info.');
}

// ── Approve stat record button ──────────────────────────────────────────────────────

export async function handleApproveStatButton(interaction: ButtonInteraction, statRecordId: string) {
  await interaction.deferReply({ ephemeral: true });

  try {
    await approvePendingStatRecord(db, statRecordId, interaction.user.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already')) {
      await interaction.editReply('This stat record was already processed.');
      return;
    }
    if (msg.includes('game_number missing')) {
      await interaction.editReply('❌ Cannot approve: `game_number` is missing from the OCR output. Correct the stat record first.');
      return;
    }
    console.error('[approval] approve stat error:', err);
    await interaction.editReply(toUserMessage(err));
    return;
  }

  await writeAuditLog(db, {
    actionType: 'stat_approved',
    entityType: 'pending_stat_record',
    entityId: statRecordId,
    actorDiscordId: interaction.user.id,
    newValueJson: { status: 'approved' },
  });

  await interaction.editReply('✅ Stat record approved and written to player_stats.');
}

// ── Reject stat record button → modal ──────────────────────────────────────────────

export async function handleRejectStatButton(interaction: ButtonInteraction, statRecordId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_reject_stat:${statRecordId}`)
    .setTitle('Reject Stat Record — Reason Required')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for rejection')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
  await interaction.showModal(modal);
}

export async function handleRejectStatModal(interaction: ModalSubmitInteraction, statRecordId: string) {
  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue('reason');

  try {
    await rejectPendingStatRecord(db, statRecordId, interaction.user.id, reason);
  } catch (err) {
    console.error('[approval] reject stat error:', err);
    await interaction.editReply(toUserMessage(err));
    return;
  }

  await writeAuditLog(db, {
    actionType: 'stat_rejected',
    entityType: 'pending_stat_record',
    entityId: statRecordId,
    actorDiscordId: interaction.user.id,
    newValueJson: { status: 'rejected', reason },
  });

  await interaction.editReply('❌ Stat record rejected.');
}

// ── Type-specific approval logic ──────────────────────────────────────────────────

async function approveMatchResult(
  interaction: ButtonInteraction,
  pendingAction: NonNullable<Awaited<ReturnType<typeof getPendingAction>>>
): Promise<{ applied: boolean; note?: string }> {
  const payload = pendingAction.payload_json as unknown as MatchResultPayload;
  const match = await getMatchById(db, pendingAction.match_id!);
  if (!match) throw new Error(`Match ${pendingAction.match_id} not found`);

  const parsed = parseScore(payload.score);
  if (!parsed) throw new Error(`Invalid score in payload: ${payload.score}`);

  const isWinnerHome = payload.winnerOrgId === match.home_org_id;
  const completed = await completeMatch(db, match.id, {
    winnerOrgId: payload.winnerOrgId,
    homeScore: isWinnerHome ? parsed.winnerGames : parsed.loserGames,
    awayScore: isWinnerHome ? parsed.loserGames : parsed.winnerGames,
    score: payload.score,
  });
  if (!completed) {
    // The match is no longer 'scheduled' -- already completed or corrected
    // elsewhere. The pending action is still terminally approved (see
    // handleApproveButton); just don't apply a mutation that's no longer valid.
    return {
      applied: false,
      note: 'this match is no longer in a reportable state (already completed or corrected elsewhere).',
    };
  }

  await writeAuditLog(db, {
    actionType: 'match_result_recorded',
    entityType: 'match',
    entityId: match.id,
    actorDiscordId: interaction.user.id,
    pendingActionId: pendingAction.id,
    oldValueJson: { status: 'scheduled' },
    newValueJson: { status: 'completed', winner_org_id: payload.winnerOrgId, score: payload.score },
  });

  if (match.proof_thread_id) {
    removeActiveProofThread(match.proof_thread_id);
    try {
      const thread = await interaction.client.channels.fetch(match.proof_thread_id);
      if (thread && 'send' in thread) {
        await (thread as TextChannel).send('✅ Match result approved. Thread is now closed.');
        if ('setArchived' in thread) {
          await (thread as unknown as { setArchived: (v: boolean) => Promise<void> }).setArchived(true);
        }
      }
    } catch (err) {
      console.warn(`[approval] Could not close proof thread ${match.proof_thread_id}:`, err);
    }
  }

  // Best-effort and last: the match result, audit log, and receipt/thread
  // updates above are the parts that must never be left half-done. This call
  // has its own timeout (see standings-sync.ts) and never throws, but it's
  // still ordered last so a slow or hanging site can't hold up anything the
  // audit trail rule in AGENTS.md requires (audit F-01).
  await triggerStandingsRecalculation();
  return { applied: true };
}

async function approveReschedule(
  interaction: ButtonInteraction,
  pendingAction: NonNullable<Awaited<ReturnType<typeof getPendingAction>>>
): Promise<{ applied: boolean; note?: string }> {
  const payload = pendingAction.payload_json as unknown as ReschedulePayload;
  const match = await getMatchById(db, pendingAction.match_id!);
  if (!match) throw new Error(`Match ${pendingAction.match_id} not found`);

  const rescheduled = await rescheduleMatch(db, match.id, { newDate: payload.newDate, newTime: payload.newTime });
  if (!rescheduled) {
    // Same reasoning as approveMatchResult above: a stale match is a valid
    // outcome, not an error -- the approval itself still stands.
    return {
      applied: false,
      note: 'this match is no longer in a reportable state (already completed or corrected elsewhere).',
    };
  }

  await writeAuditLog(db, {
    actionType: 'match_rescheduled',
    entityType: 'match',
    entityId: match.id,
    actorDiscordId: interaction.user.id,
    pendingActionId: pendingAction.id,
    oldValueJson: { scheduled_date: match.scheduled_date, scheduled_time: match.scheduled_time },
    newValueJson: { scheduled_date: payload.newDate, scheduled_time: payload.newTime },
  });
  return { applied: true };
}

async function resolveAdminReview(
  _interaction: ButtonInteraction,
  _pendingAction: NonNullable<Awaited<ReturnType<typeof getPendingAction>>>
) {
  // admin_review type: no match mutation — just marking resolved. Audit log written by caller.
}

// ── Embed updates ─────────────────────────────────────────────────────────────────

async function updateEmbeds(
  client: Client,
  pendingAction: NonNullable<Awaited<ReturnType<typeof getPendingAction>>>,
  outcome: 'approved' | 'denied' | 'needs_info',
  adminDiscordId: string,
  note?: string
) {
  if (pendingAction.admin_review_message_id) {
    try {
      const adminChannel = await client.channels.fetch(getAdminReviewChannelId()) as TextChannel;
      const adminMsg = await adminChannel.messages.fetch(pendingAction.admin_review_message_id);
      const embed = EmbedBuilder.from(adminMsg.embeds[0]);

      if (outcome === 'approved') applyApprovedStatus(embed, adminDiscordId);
      else if (outcome === 'denied') applyDeniedStatus(embed, adminDiscordId, note!);
      else applyNeedsInfoStatus(embed, adminDiscordId, note!);

      await adminMsg.edit({ embeds: [embed], components: [] });
    } catch (err) {
      console.warn(`[approval] Could not update admin review card for pending_action ${pendingAction.id}:`, err);
    }
  }

  if (pendingAction.public_receipt_message_id && pendingAction.match_id) {
    try {
      const match = await getMatchById(db, pendingAction.match_id);
      if (!match || !match.division_id) return;

      const receiptChannelId = pendingAction.type === 'reschedule'
        ? getReschedulesChannelId(match.division_id)
        : getResultsChannelId(match.division_id);

      const receiptChannel = await client.channels.fetch(receiptChannelId) as TextChannel;
      const receiptMsg = await receiptChannel.messages.fetch(pendingAction.public_receipt_message_id);
      const embed = EmbedBuilder.from(receiptMsg.embeds[0]);

      if (outcome === 'approved') applyApprovedStatus(embed, adminDiscordId);
      else if (outcome === 'denied') applyDeniedStatus(embed, adminDiscordId, note!);
      else applyNeedsInfoStatus(embed, adminDiscordId, note!);

      await receiptMsg.edit({ embeds: [embed] });
    } catch (err) {
      console.warn(`[approval] Could not update public receipt for pending_action ${pendingAction.id}:`, err);
    }
  }
}

// ── Captain notification ────────────────────────────────────────────────────────

async function notifyCaptain(
  client: Client,
  captainDiscordId: string,
  outcome: 'denied' | 'needs_info',
  note: string
) {
  try {
    const user = await client.users.fetch(captainDiscordId);
    if (outcome === 'denied') {
      await user.send(`❌ Your pending action was denied.\n\n**Reason:** ${note}`);
    } else {
      await user.send(`⚠️ An admin needs more info on your pending action.\n\n**Info needed:** ${note}`);
    }
  } catch (err) {
    console.warn(`[approval] Could not DM captain ${captainDiscordId} (DMs may be disabled):`, err);
  }
}
