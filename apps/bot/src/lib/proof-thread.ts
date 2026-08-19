import type { Client, TextChannel, Message, ThreadChannel } from 'discord.js';
import { db } from './db';
import { setProofThread, incrementScreenshotCount } from '@salbot/db';

// In-memory set of active proof thread IDs.
// NOTE: cleared on bot restart. Full persistence is Phase 4.
export const activeProofThreads = new Map<string, { matchId: string; trackingMessageId: string; expected: number }>();

export async function createProofThread(
  channel: TextChannel,
  receiptMessage: Message,
  matchId: string,
  matchLabel: string,
  week: number,
  expectedScreenshots: number
): Promise<ThreadChannel> {
  const thread = await receiptMessage.startThread({
    name: `proof-week-${week}-${matchLabel}`,
    autoArchiveDuration: 10080, // 7 days
  });

  const trackingMsg = await thread.send(
    `📊 **Match stats review thread** — Week ${week} ${matchLabel}\n\n` +
    `The verified host should use **Enter stats** below and upload each game screenshot once on the SAL review page.\n` +
    `Screenshots are kept in durable storage and mirrored here after host submission.\n\n` +
    `_Do not upload duplicate screenshots directly to Discord. This thread closes after the final admin decision._`
  );

  await setProofThread(db, matchId, thread.id, thread.url, expectedScreenshots);

  activeProofThreads.set(thread.id, {
    matchId,
    trackingMessageId: trackingMsg.id,
    expected: expectedScreenshots,
  });

  return thread;
}

export async function handleProofUpload(client: Client, channelId: string, attachmentCount: number) {
  const entry = activeProofThreads.get(channelId);
  if (!entry) return;

  for (let i = 0; i < attachmentCount; i++) {
    await incrementScreenshotCount(db, entry.matchId);
  }

  // Fetch updated count and edit tracking message
  try {
    const thread = await client.channels.fetch(channelId) as ThreadChannel;
    const { data: match } = await db
      .from('matches')
      .select('screenshot_count, screenshot_expected')
      .eq('id', entry.matchId)
      .single();

    if (!match) return;
    const current = match.screenshot_count ?? 0;
    const expected = match.screenshot_expected ?? entry.expected;
    const done = current >= expected;

    const trackingMsg = await thread.messages.fetch(entry.trackingMessageId);
    const label = done ? `✅ ${current} / ${expected}` : `**${current} / ${expected}**`;
    await trackingMsg.edit(
      trackingMsg.content.replace(/Progress:.+screenshots/, `Progress: ${label} screenshots`)
    );
  } catch (err) {
    // Non-critical — counter update failed but upload still counted
    console.warn(`[proof-thread] Could not update tracking message for match ${entry.matchId}:`, err);
  }
}

export function removeActiveProofThread(threadId: string) {
  activeProofThreads.delete(threadId);
}
