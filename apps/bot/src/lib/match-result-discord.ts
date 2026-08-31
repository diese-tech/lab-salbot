import type { Client, Message, TextChannel, ThreadChannel } from 'discord.js';
import { setProofThread, updatePendingActionMessages } from '@salbot/db';
import type { MatchResultPayload } from '@salbot/shared';
import { getAdminReviewChannelId, getResultsChannelId } from './channels';
import { db } from './db';
import {
  buildEnterStatsButton,
  buildMatchResultAdminEmbed,
  buildMatchResultReceiptEmbed,
  buildMatchResultWaitingButtons,
} from './embeds';
import { createProofThread } from './proof-thread';

export type MatchResultArtifactAction = {
  id: string;
  requestedByDiscordId: string;
  payloadJson: MatchResultPayload;
  adminReviewMessageId: string | null;
  publicReceiptMessageId: string | null;
};

type MatchResultArtifactMatch = {
  id: string;
  week: number;
  scheduled_date: string;
  scheduled_time: string;
  divisionId: string;
  division: { id: string; name: string };
  home_org: { id: string; name: string; tag: string };
  away_org: { id: string; name: string; tag: string };
  proofThreadId: string | null;
};

export async function ensureMatchResultDiscordArtifacts(params: {
  client: Client;
  action: MatchResultArtifactAction;
  reportId: string;
  match: MatchResultArtifactMatch;
  winnerOrg: { id: string; name: string; tag: string };
}): Promise<ThreadChannel> {
  const { client, action, reportId, match, winnerOrg } = params;
  const actionMarker = `Action ID: ${action.id}`;
  const resultsChannel = await client.channels.fetch(
    getResultsChannelId(match.divisionId),
  ) as TextChannel;
  let receiptMessage = await findChannelMessage(
    resultsChannel,
    action.publicReceiptMessageId,
    actionMarker,
  );
  if (!receiptMessage) {
    receiptMessage = await resultsChannel.send({
      embeds: [buildMatchResultReceiptEmbed(
        match,
        winnerOrg,
        action.payloadJson.score,
        action.requestedByDiscordId,
        action.id,
      )],
    });
  }

  let proofThread = await findProofThread(client, match.proofThreadId);
  let createdProofThread = false;
  if (!proofThread && receiptMessage.thread?.isThread()) {
    proofThread = receiptMessage.thread;
    await setProofThread(
      db,
      match.id,
      proofThread.id,
      proofThread.url,
      action.payloadJson.parsed.gamesPlayed,
      action.requestedByDiscordId,
    );
  }
  if (!proofThread) {
    const matchLabel = `${match.home_org.tag.toLowerCase()}-vs-${match.away_org.tag.toLowerCase()}`;
    proofThread = await createProofThread(
      resultsChannel,
      receiptMessage,
      match.id,
      matchLabel,
      match.week,
      action.payloadJson.parsed.gamesPlayed,
      action.requestedByDiscordId,
    );
    createdProofThread = true;
  }
  if (proofThread.archived) await proofThread.setArchived(false);
  if (createdProofThread || !(await threadHasEnterStatsButton(proofThread, reportId))) {
    await proofThread.send({
      content: 'Use **Enter stats** to upload screenshots and correct the OCR results on the review page.',
      components: [buildEnterStatsButton(reportId)],
    });
  }

  const adminChannel = await client.channels.fetch(getAdminReviewChannelId()) as TextChannel;
  let adminMessage = await findChannelMessage(
    adminChannel,
    action.adminReviewMessageId,
    actionMarker,
  );
  if (!adminMessage) {
    adminMessage = await adminChannel.send({
      embeds: [buildMatchResultAdminEmbed(
        match,
        winnerOrg,
        action.payloadJson.score,
        action.requestedByDiscordId,
        action.id,
      )],
      components: [buildMatchResultWaitingButtons(action.id)],
    });
  }

  await updatePendingActionMessages(db, action.id, {
    adminReviewMessageId: adminMessage.id,
    publicReceiptMessageId: receiptMessage.id,
  });
  return proofThread;
}

async function findChannelMessage(
  channel: TextChannel,
  storedMessageId: string | null,
  marker: string,
): Promise<Message | null> {
  if (storedMessageId) {
    try {
      const stored = await channel.messages.fetch(storedMessageId);
      if (stored) return stored;
    } catch {
      // Fall through to the stable marker scan before creating a replacement.
    }
  }
  const recent = await channel.messages.fetch({ limit: 100 });
  return recent.find((message) =>
    message.embeds.some((embed) => embed.footer?.text?.includes(marker))) ?? null;
}

async function findProofThread(
  client: Client,
  proofThreadId: string | null,
): Promise<ThreadChannel | null> {
  if (!proofThreadId) return null;
  try {
    const channel = await client.channels.fetch(proofThreadId);
    return channel?.isThread() ? channel : null;
  } catch {
    return null;
  }
}

async function threadHasEnterStatsButton(
  thread: ThreadChannel,
  reportId: string,
): Promise<boolean> {
  const recent = await thread.messages.fetch({ limit: 100 });
  const customId = `mr_stats:${reportId}`;
  return recent.some((message) => message.components.some((row) =>
    'components' in row && row.components.some((component) =>
      'customId' in component && component.customId === customId)));
}
