// Admin decisions are committed by service-role RPCs. Each RPC applies the
// domain mutation, audit records, and durable projection events atomically.

import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { resolvePendingAction, resolvePendingStatRecord } from '@salbot/db';
import { db } from '../lib/db';
import { toUserMessage } from '../lib/errors';
import { requestImmediateOutboxDrain } from '../lib/outbox-runtime';

export async function handleApproveButton(interaction: ButtonInteraction, pendingActionId: string) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await resolvePendingAction(db, {
      actionId: pendingActionId,
      actorDiscordId: interaction.user.id,
      decision: 'approve',
    });
    requestImmediateOutboxDrain();

    if (result.code === 'already_processed') {
      await interaction.editReply(`This action is already ${result.finalStatus}.`);
    } else if (result.code === 'stale_cancelled') {
      await interaction.editReply(`Action cancelled without changes: ${result.note}`);
    } else if (result.code === 'blocked') {
      await interaction.editReply(`Execution blocked without roster changes: ${result.note ?? 'Revalidation failed.'}`);
    } else {
      await interaction.editReply('Approved. Discord receipts are updating.');
    }
  } catch (error) {
    console.error('[approval] approve error:', error);
    await interaction.editReply(toUserMessage(error));
  }
}

export async function handleDenyButton(interaction: ButtonInteraction, pendingActionId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_deny:${pendingActionId}`)
    .setTitle('Deny - Reason Required')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for denial')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleDenyModal(interaction: ModalSubmitInteraction, pendingActionId: string) {
  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue('reason');
  try {
    const result = await resolvePendingAction(db, {
      actionId: pendingActionId,
      actorDiscordId: interaction.user.id,
      decision: 'deny',
      note: reason,
    });
    requestImmediateOutboxDrain();
    await interaction.editReply(
      result.code === 'already_processed'
        ? `This action is already ${result.finalStatus}.`
        : 'Denied. Discord receipts and notifications are updating.',
    );
  } catch (error) {
    console.error('[approval] deny error:', error);
    await interaction.editReply(toUserMessage(error));
  }
}

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
          .setMaxLength(500),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleNeedsInfoModal(
  interaction: ModalSubmitInteraction,
  pendingActionId: string,
) {
  await interaction.deferReply({ ephemeral: true });
  const note = interaction.fields.getTextInputValue('note');
  try {
    const result = await resolvePendingAction(db, {
      actionId: pendingActionId,
      actorDiscordId: interaction.user.id,
      decision: 'needs_info',
      note,
    });
    requestImmediateOutboxDrain();
    await interaction.editReply(
      result.code === 'already_processed'
        ? `This action is already ${result.finalStatus}.`
        : 'Marked as Needs Info. Controls remain available for the final decision.',
    );
  } catch (error) {
    console.error('[approval] needs info error:', error);
    await interaction.editReply(toUserMessage(error));
  }
}

export async function handleApproveStatButton(interaction: ButtonInteraction, statRecordId: string) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await resolvePendingStatRecord(db, {
      recordId: statRecordId,
      actorDiscordId: interaction.user.id,
      decision: 'approve',
    });
    requestImmediateOutboxDrain();
    await interaction.editReply(
      result.code === 'already_processed'
        ? `This stat record is already ${result.finalStatus}.`
        : 'Stat record approved and written to player stats.',
    );
  } catch (error) {
    console.error('[approval] approve stat error:', error);
    await interaction.editReply(toUserMessage(error));
  }
}

export async function handleRejectStatButton(interaction: ButtonInteraction, statRecordId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_reject_stat:${statRecordId}`)
    .setTitle('Reject Stat Record - Reason Required')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for rejection')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleRejectStatModal(
  interaction: ModalSubmitInteraction,
  statRecordId: string,
) {
  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue('reason');
  try {
    const result = await resolvePendingStatRecord(db, {
      recordId: statRecordId,
      actorDiscordId: interaction.user.id,
      decision: 'deny',
      note: reason,
    });
    requestImmediateOutboxDrain();
    await interaction.editReply(
      result.code === 'already_processed'
        ? `This stat record is already ${result.finalStatus}.`
        : 'Stat record rejected.',
    );
  } catch (error) {
    console.error('[approval] reject stat error:', error);
    await interaction.editReply(toUserMessage(error));
  }
}
