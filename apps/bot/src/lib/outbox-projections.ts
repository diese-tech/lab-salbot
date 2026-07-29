import { EmbedBuilder, type Client, type Message } from 'discord.js';
import {
  getMatchById,
  getPendingAction,
  type OperationOutboxRow,
  type SupabaseClient,
} from '@salbot/db';
import { getAdminReviewChannelId, getResultsChannelId, getReschedulesChannelId } from './channels';
import {
  applyApprovedStatus,
  applyCancelledStatus,
  applyDeniedStatus,
  applyNeedsInfoStatus,
} from './embeds';
import { removeActiveProofThread } from './proof-thread';
import { requestStandingsRecalculation } from './standings-sync';

type DecisionStatus = 'approved' | 'denied' | 'pending_info' | 'cancelled';

export function projectionMarker(outboxId: string): string {
  return `sal-outbox:${outboxId}`;
}

function messageHasProjection(message: Message, outboxId: string): boolean {
  const marker = projectionMarker(outboxId);
  return message.content.includes(marker)
    || message.embeds.some((embed) => embed.footer?.text?.includes(marker));
}

export function createOutboxProjector(client: Client, db: SupabaseClient) {
  return async (row: OperationOutboxRow): Promise<string | undefined> => {
    switch (row.topic) {
      case 'discord_review_projection':
        return projectReview(client, db, row);
      case 'discord_receipt_projection':
        return projectReceipt(client, db, row);
      case 'discord_captain_notification':
      case 'discord_requester_notification':
        return projectDirectMessage(client, row);
      case 'proof_thread_closure':
        return projectProofThreadClosure(client, row);
      case 'standings_recalculation':
        await requestStandingsRecalculation(
          optionalString(row.payload.outboxIdempotencyKey) ?? undefined,
        );
        return row.aggregate_id;
      default:
        throw new Error(`Unsupported operation outbox topic: ${row.topic}`);
    }
  };
}

async function projectReview(
  client: Client,
  db: SupabaseClient,
  row: OperationOutboxRow,
): Promise<string> {
  if (row.aggregate_type === 'pending_stat_record') {
    // Legacy stat review records have no Discord message reference. The
    // decision RPC is still authoritative; there is no safe projection target
    // to edit until a future schema stores one.
    return `pending-stat-record:${row.aggregate_id}:no-message-target`;
  }
  if (row.aggregate_type !== 'pending_action') {
    throw new Error(`Unsupported review aggregate: ${row.aggregate_type}`);
  }

  const action = await getPendingAction(db, row.aggregate_id);
  if (!action) throw new Error(`Pending action ${row.aggregate_id} not found`);
  if (!action.admin_review_message_id) {
    throw new Error(`Pending action ${row.aggregate_id} has no admin review message`);
  }

  const status = decisionStatus(action.status);
  const actorDiscordId = await getDecisionActor(db, action.id, action.approved_by_discord_id);
  const channel = await client.channels.fetch(getAdminReviewChannelId());
  if (!channel?.isTextBased() || !('messages' in channel)) {
    throw new Error('Admin review channel is not text based');
  }
  const message = await channel.messages.fetch(action.admin_review_message_id);
  const embed = existingEmbed(message);
  applyDecisionStatus(embed, status, actorDiscordId, action.admin_note);
  await message.edit({
    embeds: [embed],
    ...(status === 'pending_info' ? {} : { components: [] }),
  });
  return message.id;
}

async function projectReceipt(
  client: Client,
  db: SupabaseClient,
  row: OperationOutboxRow,
): Promise<string> {
  const action = await getPendingAction(db, row.aggregate_id);
  if (!action) throw new Error(`Pending action ${row.aggregate_id} not found`);
  if (!action.public_receipt_message_id || !action.match_id) {
    throw new Error(`Pending action ${row.aggregate_id} has no public receipt target`);
  }
  const match = await getMatchById(db, action.match_id);
  if (!match?.division_id) throw new Error(`Match ${action.match_id} has no division`);

  const status = decisionStatus(action.status);
  const actorDiscordId = await getDecisionActor(db, action.id, action.approved_by_discord_id);
  const channelId = action.type === 'reschedule'
    ? getReschedulesChannelId(match.division_id)
    : getResultsChannelId(match.division_id);
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !('messages' in channel)) {
    throw new Error(`Receipt channel ${channelId} is not text based`);
  }
  const message = await channel.messages.fetch(action.public_receipt_message_id);
  const embed = existingEmbed(message);
  applyDecisionStatus(embed, status, actorDiscordId, action.admin_note);
  await message.edit({ embeds: [embed] });
  return message.id;
}

async function projectDirectMessage(client: Client, row: OperationOutboxRow): Promise<string> {
  const recipientDiscordId = requiredString(row.payload.recipientDiscordId, 'recipientDiscordId');
  const status = decisionStatus(requiredString(row.payload.finalStatus, 'finalStatus'));
  const note = optionalString(row.payload.note);
  const user = await client.users.fetch(recipientDiscordId);
  const channel = await user.createDM();
  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = recent.find((message) => messageHasProjection(message, row.id));
  if (existing) return existing.id;

  const embed = new EmbedBuilder()
    .setTitle(notificationTitle(status))
    .setDescription(notificationDescription(status, note))
    .setFooter({ text: projectionMarker(row.id) })
    .setTimestamp();
  const sent = await channel.send({ embeds: [embed] });
  return sent.id;
}

async function projectProofThreadClosure(client: Client, row: OperationOutboxRow): Promise<string> {
  const threadId = requiredString(row.payload.proofThreadId, 'proofThreadId');
  const status = decisionStatus(requiredString(row.payload.finalStatus, 'finalStatus'));
  const channel = await client.channels.fetch(threadId);
  if (!channel?.isThread()) throw new Error(`Proof thread ${threadId} not found`);

  const recent = await channel.messages.fetch({ limit: 100 });
  let message = recent.find((candidate) => messageHasProjection(candidate, row.id));
  if (!message) {
    if (channel.archived) await channel.setArchived(false);
    message = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(notificationTitle(status))
          .setDescription('This proof thread is now closed.')
          .setFooter({ text: projectionMarker(row.id) })
          .setTimestamp(),
      ],
    });
  }
  if (!channel.archived) await channel.setArchived(true);
  removeActiveProofThread(threadId);
  return message.id;
}

async function getDecisionActor(
  db: SupabaseClient,
  actionId: string,
  storedActor: string | null,
): Promise<string> {
  if (storedActor) return storedActor;
  const { data, error } = await db
    .from('audit_logs')
    .select('actor_discord_id')
    .eq('pending_action_id', actionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.actor_discord_id) throw new Error(`Decision actor for ${actionId} not found`);
  return data.actor_discord_id;
}

function existingEmbed(message: Message): EmbedBuilder {
  const embed = message.embeds[0];
  if (!embed) throw new Error(`Discord message ${message.id} has no embed`);
  return EmbedBuilder.from(embed);
}

function applyDecisionStatus(
  embed: EmbedBuilder,
  status: DecisionStatus,
  actorDiscordId: string,
  note: string | null,
): void {
  if (status === 'approved') applyApprovedStatus(embed, actorDiscordId);
  else if (status === 'denied') applyDeniedStatus(embed, actorDiscordId, note ?? 'No reason provided.');
  else if (status === 'pending_info') applyNeedsInfoStatus(embed, actorDiscordId, note ?? 'More information is required.');
  else applyCancelledStatus(embed, actorDiscordId, note ?? 'The underlying record changed.');
}

function decisionStatus(value: string): DecisionStatus {
  if (value === 'approved' || value === 'denied' || value === 'pending_info' || value === 'cancelled') {
    return value;
  }
  throw new Error(`Unsupported decision status: ${value}`);
}

function notificationTitle(status: DecisionStatus): string {
  if (status === 'approved') return 'Action approved';
  if (status === 'denied') return 'Action denied';
  if (status === 'pending_info') return 'More information needed';
  return 'Action cancelled';
}

function notificationDescription(status: DecisionStatus, note: string | null): string {
  if (status === 'approved') return 'Your pending action was approved.';
  if (status === 'denied') return `Your pending action was denied.\n\nReason: ${note ?? 'No reason provided.'}`;
  if (status === 'pending_info') return `An admin needs more information.\n\nInfo needed: ${note ?? 'Please contact an admin.'}`;
  return `Your pending action was cancelled without applying changes.\n\n${note ?? ''}`.trim();
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Outbox payload ${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
