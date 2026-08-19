import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, EmbedBuilder } from 'discord.js';

vi.mock('../lib/db', () => ({ db: { from: vi.fn() } }));
vi.mock('@salbot/db', () => ({
  createPendingAction: vi.fn(),
  createMatchResultActionWithReport: vi.fn(),
  ensureMatchReportForPendingAction: vi.fn(),
  getActiveMatchResultPendingAction: vi.fn(),
  getEligibleMatchesForOperator: vi.fn(),
  setProofThread: vi.fn(),
  updatePendingActionMessages: vi.fn(),
}));
vi.mock('../lib/channels', () => ({
  getAdminReviewChannelId: () => 'admin-channel',
  getResultsChannelId: () => 'results-channel',
}));
vi.mock('../lib/proof-thread', () => ({ createProofThread: vi.fn() }));
vi.mock('../lib/command-access', () => ({ hasCommandAccess: vi.fn() }));
vi.mock('../lib/match-report-site', () => ({
  issueMatchReportHostReviewLink: vi.fn(),
}));

import {
  createPendingAction,
  createMatchResultActionWithReport,
  ensureMatchReportForPendingAction,
  getActiveMatchResultPendingAction,
  updatePendingActionMessages,
} from '@salbot/db';
import { db } from '../lib/db';
import { createProofThread } from '../lib/proof-thread';
import { hasCommandAccess } from '../lib/command-access';
import { issueMatchReportHostReviewLink } from '../lib/match-report-site';
import { handleEnterStatsButton, handleScoreModal } from './report-result';

const match = {
  id: 'match-1',
  week: 2,
  scheduled_date: '2026-08-20',
  scheduled_time: '20:00',
  division_id: 'division-1',
  home_org_id: 'org-home',
  away_org_id: 'org-away',
  home_org: { id: 'org-home', name: 'Home Org', tag: 'HOME' },
  away_org: { id: 'org-away', name: 'Away Org', tag: 'AWAY' },
  division: { id: 'division-1', name: 'Solar' },
  proof_thread_id: null as string | null,
  proof_thread_url: null,
};
let currentMatch = { ...match };

describe('/report-result match stats entry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentMatch = { ...match };
    vi.mocked(db.from).mockReturnValue({
      select: () => ({
        eq: () => ({ single: vi.fn(async () => ({ data: currentMatch, error: null })) }),
      }),
    } as never);
  });

  it('links one canonical match report and posts a durable Enter stats button', async () => {
    vi.mocked(createMatchResultActionWithReport).mockResolvedValue({
      code: 'created',
      created: true,
      actionId: 'action-1',
      reportId: 'report-1',
      pendingActionId: 'action-1',
      matchId: 'match-1',
      hostDiscordId: 'host-1',
      status: 'pending',
      revision: 0,
    });
    vi.mocked(getActiveMatchResultPendingAction).mockResolvedValue({
      id: 'action-1',
      matchId: 'match-1',
      requestedByDiscordId: 'host-1',
      status: 'pending',
      payloadJson: { winnerOrgId: 'org-home', score: '2-1', parsed: { winnerGames: 2, loserGames: 1, gamesPlayed: 3, expectedScreenshots: 3 } },
      adminReviewMessageId: null,
      publicReceiptMessageId: null,
    });
    const receiptSend = vi.fn().mockResolvedValue({ id: 'receipt-1' });
    const adminSend = vi.fn().mockResolvedValue({ id: 'review-1' });
    const proofSend = vi.fn().mockResolvedValue({ id: 'stats-entry-1' });
    vi.mocked(createProofThread).mockResolvedValue({
      id: 'thread-1',
      url: 'https://discord.example/thread-1',
      send: proofSend,
    } as never);
    const interaction = scoreInteraction(receiptSend, adminSend);

    await handleScoreModal(interaction as never);

    expect(createMatchResultActionWithReport).toHaveBeenCalledWith(
      db,
      'match-1',
      'host-1',
      { winnerOrgId: 'org-home', score: '2-1', parsed: { winnerGames: 2, loserGames: 1, gamesPlayed: 3, expectedScreenshots: 3 } },
    );
    expect(createPendingAction).not.toHaveBeenCalled();
    expect(ensureMatchReportForPendingAction).not.toHaveBeenCalled();
    expect(createProofThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'match-1',
      'home-vs-away',
      2,
      3,
    );
    const entryMessage = proofSend.mock.calls[0][0];
    expect(entryMessage.content).toContain('Enter stats');
    expect(entryMessage.components[0].toJSON().components[0]).toMatchObject({
      custom_id: 'mr_stats:report-1',
      label: 'Enter stats',
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Enter stats'),
    );
    const adminCard = adminSend.mock.calls[0][0];
    expect(adminCard.embeds[0].toJSON().title).toContain('Waiting for Host Stats');
    expect(adminCard.components[0].toJSON().components).toEqual([
      expect.objectContaining({ custom_id: 'deny:action-1', label: 'Deny' }),
      expect.objectContaining({ custom_id: 'needs_info:action-1', label: '⚠️ Needs Info' }),
    ]);
  });

  it('repairs a retried submission without reposting the receipt or admin review', async () => {
    vi.mocked(createMatchResultActionWithReport).mockResolvedValue({
      code: 'existing', created: false, actionId: 'action-1', pendingActionId: 'action-1',
      reportId: 'report-1', matchId: 'match-1', hostDiscordId: 'host-1', status: 'pending', revision: 0,
    });
    vi.mocked(getActiveMatchResultPendingAction).mockResolvedValue({
      id: 'action-1',
      matchId: 'match-1',
      requestedByDiscordId: 'host-1',
      status: 'pending',
      payloadJson: { winnerOrgId: 'org-home', score: '2-1', parsed: { winnerGames: 2, loserGames: 1, gamesPlayed: 3, expectedScreenshots: 3 } },
      adminReviewMessageId: 'review-1',
      publicReceiptMessageId: 'receipt-1',
    });
    const receiptSend = vi.fn();
    const adminSend = vi.fn();
    const proofSend = vi.fn();
    const receiptMessage = { id: 'receipt-1', embeds: [], thread: null };
    const adminMessage = { id: 'review-1', embeds: [] };
    const proofMessages = new Collection<string, never>();
    proofMessages.set('stats-entry-1', {
      components: [{ components: [{ customId: 'mr_stats:report-1' }] }],
    } as never);
    const proofThread = {
      id: 'thread-1',
      url: 'https://discord.example/thread-1',
      isThread: () => true,
      archived: false,
      messages: { fetch: vi.fn().mockResolvedValue(proofMessages) },
      send: proofSend,
    };
    receiptMessage.thread = proofThread as never;
    currentMatch = { ...match, proof_thread_id: 'thread-1' };
    vi.mocked(db.from).mockReturnValue({
      select: () => ({
        eq: () => ({ single: vi.fn().mockResolvedValue({ data: currentMatch, error: null }) }),
      }),
    } as never);
    const interaction = scoreInteraction(receiptSend, adminSend, {
      receiptMessage,
      adminMessage,
      proofThread,
    });

    await handleScoreModal(interaction as never);

    expect(getActiveMatchResultPendingAction).toHaveBeenCalledWith(db, 'match-1');
    expect(createPendingAction).not.toHaveBeenCalled();
    expect(ensureMatchReportForPendingAction).not.toHaveBeenCalled();
    expect(receiptSend).not.toHaveBeenCalled();
    expect(adminSend).not.toHaveBeenCalled();
    expect(createProofThread).not.toHaveBeenCalled();
    expect(proofSend).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('already awaiting review'),
    }));
  });

  it('recreates missing Discord artifacts after a crash and persists their IDs', async () => {
    vi.mocked(createMatchResultActionWithReport).mockResolvedValue({
      code: 'existing', created: false, actionId: 'action-1', pendingActionId: 'action-1',
      reportId: 'report-1', matchId: 'match-1', hostDiscordId: 'host-1', status: 'pending', revision: 0,
    });
    vi.mocked(getActiveMatchResultPendingAction).mockResolvedValue({
      id: 'action-1',
      matchId: 'match-1',
      requestedByDiscordId: 'host-1',
      status: 'pending',
      payloadJson: { winnerOrgId: 'org-home', score: '2-1', parsed: { winnerGames: 2, loserGames: 1, gamesPlayed: 3, expectedScreenshots: 3 } },
      adminReviewMessageId: null,
      publicReceiptMessageId: null,
    });
    const receiptSend = vi.fn().mockResolvedValue({ id: 'receipt-recovered' });
    const adminSend = vi.fn().mockResolvedValue({ id: 'review-recovered' });
    const proofSend = vi.fn().mockResolvedValue({ id: 'stats-entry-recovered' });
    vi.mocked(createProofThread).mockResolvedValue({
      id: 'thread-recovered',
      url: 'https://discord.example/thread-recovered',
      messages: { fetch: vi.fn().mockResolvedValue(new Collection()) },
      send: proofSend,
    } as never);
    const interaction = scoreInteraction(receiptSend, adminSend);

    await handleScoreModal(interaction as never);

    expect(receiptSend).toHaveBeenCalledTimes(1);
    expect(createProofThread).toHaveBeenCalledTimes(1);
    expect(proofSend).toHaveBeenCalledWith(expect.objectContaining({
      components: expect.any(Array),
    }));
    expect(adminSend).toHaveBeenCalledTimes(1);
    expect(updatePendingActionMessages).toHaveBeenCalledWith(db, 'action-1', {
      adminReviewMessageId: 'review-recovered',
      publicReceiptMessageId: 'receipt-recovered',
    });
  });

  it('recovers orphaned receipt and admin messages by their stable action marker', async () => {
    vi.mocked(createMatchResultActionWithReport).mockResolvedValue({
      code: 'existing', created: false, actionId: 'action-1', pendingActionId: 'action-1',
      reportId: 'report-1', matchId: 'match-1', hostDiscordId: 'host-1', status: 'pending', revision: 0,
    });
    vi.mocked(getActiveMatchResultPendingAction).mockResolvedValue({
      id: 'action-1',
      matchId: 'match-1',
      requestedByDiscordId: 'host-1',
      status: 'pending',
      payloadJson: { winnerOrgId: 'org-home', score: '2-1', parsed: { winnerGames: 2, loserGames: 1, gamesPlayed: 3, expectedScreenshots: 3 } },
      adminReviewMessageId: null,
      publicReceiptMessageId: null,
    });
    const receiptSend = vi.fn();
    const adminSend = vi.fn();
    const proofSend = vi.fn();
    const proofMessages = new Collection<string, never>();
    proofMessages.set('stats-entry-1', {
      components: [{ components: [{ customId: 'mr_stats:report-1' }] }],
    } as never);
    const proofThread = {
      id: 'thread-1',
      url: 'https://discord.example/thread-1',
      isThread: () => true,
      archived: false,
      messages: { fetch: vi.fn().mockResolvedValue(proofMessages) },
      send: proofSend,
    };
    const receiptMessage = {
      id: 'receipt-orphan',
      embeds: [new EmbedBuilder().setFooter({ text: 'Pending admin review • Action ID: action-1' }).toJSON()],
      thread: proofThread,
    };
    const adminMessage = {
      id: 'review-orphan',
      embeds: [new EmbedBuilder().setFooter({ text: 'Action ID: action-1' }).toJSON()],
    };
    const receiptRecent = new Collection<string, never>();
    receiptRecent.set(receiptMessage.id, receiptMessage as never);
    const adminRecent = new Collection<string, never>();
    adminRecent.set(adminMessage.id, adminMessage as never);
    const interaction = scoreInteraction(receiptSend, adminSend, {
      receiptRecent,
      adminRecent,
    });

    await handleScoreModal(interaction as never);

    expect(receiptSend).not.toHaveBeenCalled();
    expect(adminSend).not.toHaveBeenCalled();
    expect(createProofThread).not.toHaveBeenCalled();
    expect(proofSend).not.toHaveBeenCalled();
    expect(updatePendingActionMessages).toHaveBeenCalledWith(db, 'action-1', {
      adminReviewMessageId: 'review-orphan',
      publicReceiptMessageId: 'receipt-orphan',
    });
  });

  it('does not expose Enter stats to an operator when the existing action belongs to another host', async () => {
    vi.mocked(createMatchResultActionWithReport).mockResolvedValue({
      code: 'existing', created: false, actionId: 'action-1', pendingActionId: 'action-1',
      reportId: 'report-1', matchId: 'match-1', hostDiscordId: 'original-host', status: 'pending', revision: 0,
    });
    vi.mocked(getActiveMatchResultPendingAction).mockResolvedValue({
      id: 'action-1',
      matchId: 'match-1',
      requestedByDiscordId: 'original-host',
      status: 'pending',
      payloadJson: { winnerOrgId: 'org-home', score: '2-1', parsed: { winnerGames: 2, loserGames: 1, gamesPlayed: 3, expectedScreenshots: 3 } },
      adminReviewMessageId: null,
      publicReceiptMessageId: null,
    });
    const receiptSend = vi.fn().mockResolvedValue({ id: 'receipt-recovered' });
    const adminSend = vi.fn().mockResolvedValue({ id: 'review-recovered' });
    vi.mocked(createProofThread).mockResolvedValue({
      id: 'thread-recovered',
      url: 'https://discord.example/thread-recovered',
      send: vi.fn().mockResolvedValue({ id: 'stats-entry-recovered' }),
    } as never);
    const interaction = scoreInteraction(receiptSend, adminSend);

    await handleScoreModal(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.not.stringContaining('Use **Enter stats** below'),
    );
  });

  it('rechecks the match-stats capability before issuing an ephemeral host link', async () => {
    vi.mocked(hasCommandAccess).mockReturnValue(true);
    vi.mocked(issueMatchReportHostReviewLink).mockResolvedValue({
      reviewUrl: 'https://sal.example/match-reports/report-1/review#token=secret',
      expiresAt: '2026-08-19T01:02:03.000Z',
    });
    const editReply = vi.fn();
    const interaction = {
      customId: 'mr_stats:report-1',
      member: { roles: ['role-1'] },
      user: { id: 'host-1' },
      deferReply: vi.fn(),
      editReply,
    };

    await handleEnterStatsButton(interaction as never);

    expect(hasCommandAccess).toHaveBeenCalledWith(
      interaction.member,
      'enter-match-stats',
    );
    expect(issueMatchReportHostReviewLink).toHaveBeenCalledWith(
      'report-1',
      'host-1',
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(editReply.mock.calls[0][0].components[0].toJSON().components[0]).toMatchObject({
      label: 'Open stats review',
      url: 'https://sal.example/match-reports/report-1/review#token=secret',
    });
  });

  it('does not call sal-site when the member lost the required capability', async () => {
    vi.mocked(hasCommandAccess).mockReturnValue(false);
    const reply = vi.fn();

    await handleEnterStatsButton({
      customId: 'mr_stats:report-1',
      member: { roles: [] },
      user: { id: 'host-1' },
      reply,
    } as never);

    expect(issueMatchReportHostReviewLink).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith({
      content: 'You no longer have permission to enter match stats.',
      ephemeral: true,
    });
  });
});

function scoreInteraction(
  receiptSend: ReturnType<typeof vi.fn>,
  adminSend: ReturnType<typeof vi.fn>,
  existing: {
    receiptMessage?: unknown;
    adminMessage?: unknown;
    proofThread?: unknown;
    receiptRecent?: Collection<string, never>;
    adminRecent?: Collection<string, never>;
  } = {},
) {
  const messages = (
    storedId: string,
    storedMessage: unknown,
    recent: Collection<string, never> = new Collection(),
  ) => ({
    fetch: vi.fn(async (value: unknown) => {
      if (typeof value === 'string') {
        if (value === storedId && storedMessage) return storedMessage;
        throw new Error('Unknown Message');
      }
      return recent;
    }),
  });
  return {
    customId: 'rr_score:match-1:org-home',
    fields: { getTextInputValue: () => '2-1' },
    user: { id: 'host-1' },
    deferReply: vi.fn(),
    editReply: vi.fn(),
    client: {
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === 'proof-thread-1') return existing.proofThread;
          return id === 'results-channel'
            ? { send: receiptSend, messages: messages('receipt-1', existing.receiptMessage, existing.receiptRecent) }
            : { send: adminSend, messages: messages('review-1', existing.adminMessage, existing.adminRecent) };
        }),
      },
    },
  };
}
