import { afterEach, describe, expect, it, vi } from 'vitest';
import { Collection, EmbedBuilder } from 'discord.js';

vi.mock('./proof-thread', () => ({ removeActiveProofThread: vi.fn() }));

import { createOutboxProjector, projectionMarker } from './outbox-projections';

const originalAdminChannel = process.env.CHANNEL_ADMIN_REVIEW;
const originalSiteUrl = process.env.SAL_SITE_URL;
const originalTerraResults = process.env.CHANNEL_RESULTS_TERRA;

afterEach(() => {
  if (originalAdminChannel === undefined) delete process.env.CHANNEL_ADMIN_REVIEW;
  else process.env.CHANNEL_ADMIN_REVIEW = originalAdminChannel;
  if (originalSiteUrl === undefined) delete process.env.SAL_SITE_URL;
  else process.env.SAL_SITE_URL = originalSiteUrl;
  if (originalTerraResults === undefined) delete process.env.CHANNEL_RESULTS_TERRA;
  else process.env.CHANNEL_RESULTS_TERRA = originalTerraResults;
});

function outboxRow() {
  return {
    id: 'outbox-1',
    topic: 'discord_review_projection',
    aggregate_type: 'pending_action',
    aggregate_id: 'action-1',
    event_type: 'pending_action_pending_info',
    deduplication_key: 'action-1:pending_info:admin_review',
    payload: { actionId: 'action-1', finalStatus: 'pending_info' },
    state: 'processing',
    attempts: 1,
    available_at: '2026-07-29T00:00:00.000Z',
    lease_owner: 'worker-1',
    lease_expires_at: '2026-07-29T00:01:00.000Z',
    last_error: null,
    external_id: null,
    completed_at: null,
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
  };
}

function action(status: string) {
  return {
    id: 'action-1',
    type: 'admin_review',
    status,
    requested_by_discord_id: 'captain-1',
    match_id: null,
    division_id: null,
    payload_json: { issueType: 'other', description: 'Review this.' },
    admin_note: status === 'pending_info' ? 'Upload proof.' : null,
    admin_review_message_id: 'message-1',
    public_receipt_message_id: null,
    approved_by_discord_id: 'admin-1',
    approved_at: null,
  };
}

function harness(status: string) {
  const edit = vi.fn().mockResolvedValue(undefined);
  const message = {
    id: 'message-1',
    content: '',
    embeds: [new EmbedBuilder().setTitle('Pending').toJSON()],
    edit,
  };
  const channel = {
    isTextBased: () => true,
    messages: { fetch: vi.fn().mockResolvedValue(message) },
  };
  const client = {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  };
  const builder = {
    select: () => builder,
    eq: () => builder,
    single: () => Promise.resolve({ data: action(status), error: null }),
  };
  const db = { from: vi.fn().mockReturnValue(builder) };
  return { client, db, edit };
}

describe('outbox Discord projections', () => {
  it('preserves admin controls when projecting Needs Info', async () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'admin-channel';
    const { client, db, edit } = harness('pending_info');
    const project = createOutboxProjector(client as never, db as never);

    await expect(project(outboxRow())).resolves.toBe('message-1');

    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0]).not.toHaveProperty('components');
  });

  it('removes admin controls after a terminal decision', async () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'admin-channel';
    const { client, db, edit } = harness('approved');
    const project = createOutboxProjector(client as never, db as never);

    await project(outboxRow());

    expect(edit.mock.calls[0][0]).toMatchObject({ components: [] });
  });

  it('projects the authoritative reviewed winner and score onto the admin card', async () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'admin-channel';
    const edit = vi.fn().mockResolvedValue(undefined);
    const message = {
      id: 'message-1',
      content: '',
      embeds: [new EmbedBuilder()
        .setTitle('Waiting for Host Stats')
        .addFields(
          { name: 'Reported Winner', value: 'Preliminary Home' },
          { name: 'Score', value: '2-1' },
        )
        .toJSON()],
      edit,
    };
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          messages: { fetch: vi.fn().mockResolvedValue(message) },
        }),
      },
    };
    const pendingAction = {
      ...action('approved'),
      type: 'match_result',
      match_id: 'match-1',
      payload_json: { winnerOrgId: 'away-org', score: '2-0' },
    };
    const reviewedMatch = {
      id: 'match-1',
      division_id: 'terra',
      home_org: { id: 'home-org', name: 'Home Org', tag: 'HOME' },
      away_org: { id: 'away-org', name: 'Away Org', tag: 'AWAY' },
    };
    const db = {
      from: vi.fn((table: string) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () => Promise.resolve({
            data: table === 'pending_actions' ? pendingAction : reviewedMatch,
            error: null,
          }),
        };
        return builder;
      }),
    };
    const project = createOutboxProjector(client as never, db as never);

    await project({
      ...outboxRow(),
      event_type: 'pending_action_approved',
      payload: { actionId: 'action-1', finalStatus: 'approved' },
    });

    const fields = edit.mock.calls[0][0].embeds[0].toJSON().fields;
    expect(fields).toContainEqual(expect.objectContaining({
      name: 'Reported Winner',
      value: 'Away Org',
    }));
    expect(fields).toContainEqual(expect.objectContaining({
      name: 'Score',
      value: '2-0',
    }));
  });

  it('projects the authoritative reviewed winner and score onto the public receipt', async () => {
    process.env.CHANNEL_RESULTS_TERRA = 'results-channel';
    const edit = vi.fn().mockResolvedValue(undefined);
    const message = {
      id: 'receipt-1',
      content: '',
      embeds: [new EmbedBuilder()
        .setTitle('Match Result — Under Review')
        .addFields(
          { name: 'Reported Winner', value: 'Preliminary Home' },
          { name: 'Score', value: '2-1' },
        )
        .toJSON()],
      edit,
    };
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          messages: { fetch: vi.fn().mockResolvedValue(message) },
        }),
      },
    };
    const pendingAction = {
      ...action('approved'),
      type: 'match_result',
      match_id: 'match-1',
      public_receipt_message_id: 'receipt-1',
      payload_json: { winnerOrgId: 'away-org', score: '2-0' },
    };
    const reviewedMatch = {
      id: 'match-1',
      division_id: 'terra',
      home_org: { id: 'home-org', name: 'Home Org', tag: 'HOME' },
      away_org: { id: 'away-org', name: 'Away Org', tag: 'AWAY' },
    };
    const db = {
      from: vi.fn((table: string) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () => Promise.resolve({
            data: table === 'pending_actions' ? pendingAction : reviewedMatch,
            error: null,
          }),
        };
        return builder;
      }),
    };
    const project = createOutboxProjector(client as never, db as never);

    await project({
      ...outboxRow(),
      topic: 'discord_receipt_projection',
      event_type: 'pending_action_approved',
      payload: { actionId: 'action-1', finalStatus: 'approved' },
    });

    const fields = edit.mock.calls[0][0].embeds[0].toJSON().fields;
    expect(fields).toContainEqual(expect.objectContaining({
      name: 'Reported Winner',
      value: 'Away Org',
    }));
    expect(fields).toContainEqual(expect.objectContaining({
      name: 'Score',
      value: '2-0',
    }));
  });

  it('uses a stable marker for create-once projections', () => {
    expect(projectionMarker('abc')).toBe('sal-outbox:abc');
  });

  it('mirrors durable host screenshots and posts the admin stats review card', async () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'admin-channel';
    process.env.SAL_SITE_URL = 'https://sal.example';
    const proofSend = vi.fn()
      .mockResolvedValueOnce({ id: 'proof-image-1' })
      .mockResolvedValueOnce({ id: 'proof-image-2' });
    const adminSend = vi.fn().mockResolvedValue({ id: 'stats-review-1' });
    const emptyMessages = { fetch: vi.fn().mockResolvedValue(new Collection()) };
    const setArchived = vi.fn().mockResolvedValue(undefined);
    const proofThread = {
      isThread: () => true,
      archived: true,
      setArchived,
      messages: emptyMessages,
      send: proofSend,
    };
    const adminChannel = {
      isTextBased: () => true,
      messages: emptyMessages,
      send: adminSend,
    };
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) =>
          id === 'proof-thread-1' ? proofThread : adminChannel),
      },
    };
    const project = createOutboxProjector(client as never, {} as never);
    const row = {
      ...outboxRow(),
      aggregate_type: 'match_report',
      aggregate_id: 'report-1',
      event_type: 'match_report_host_submitted',
      payload: {
        reportId: 'report-1',
        pendingActionId: 'action-1',
        matchId: 'match-1',
        hostDiscordId: 'host-1',
        screenshotUrls: [
          'https://storage.example/game-1-scoreboard.png',
          'https://storage.example/game-1-details.png',
        ],
        proofThreadId: 'proof-thread-1',
      },
    };

    await expect(project(row)).resolves.toContain('stats-review-1');

    expect(proofSend).toHaveBeenCalledTimes(2);
    expect(setArchived.mock.calls).toEqual([[false], [true]]);
    expect(proofSend.mock.calls[0][0]).toMatchObject({
      files: [{
        attachment: 'https://storage.example/game-1-scoreboard.png',
      }],
    });
    expect(adminSend).toHaveBeenCalledTimes(1);
    const reviewCard = adminSend.mock.calls[0][0];
    expect(reviewCard.embeds[0].toJSON()).toMatchObject({
      title: 'Match stats ready for admin review',
    });
    expect(reviewCard.components[0].toJSON().components[0]).toMatchObject({
      label: 'Review match stats',
      url: 'https://sal.example/admin/tickets?ticket=match_report%3Areport-1',
    });
  });

  it('projects a manual-entry submission with no screenshots', async () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'admin-channel';
    process.env.SAL_SITE_URL = 'https://sal.example';
    const proofSend = vi.fn();
    const adminSend = vi.fn().mockResolvedValue({ id: 'stats-review-1' });
    const emptyMessages = { fetch: vi.fn().mockResolvedValue(new Collection()) };
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) => id === 'proof-thread-1'
          ? { isThread: () => true, archived: false, messages: emptyMessages, send: proofSend }
          : { isTextBased: () => true, messages: emptyMessages, send: adminSend }),
      },
    };
    const project = createOutboxProjector(client as never, {} as never);

    await expect(project({
      ...outboxRow(),
      aggregate_type: 'match_report',
      aggregate_id: 'report-1',
      event_type: 'match_report_host_submitted',
      payload: {
        reportId: 'report-1',
        pendingActionId: 'action-1',
        matchId: 'match-1',
        hostDiscordId: 'host-1',
        screenshotUrls: [],
        proofThreadId: 'proof-thread-1',
      },
    })).resolves.toContain('stats-review-1');

    expect(proofSend).not.toHaveBeenCalled();
    expect(adminSend.mock.calls[0][0].embeds[0].toJSON().fields).toContainEqual({
      name: 'Screenshots',
      value: '0',
      inline: true,
    });
  });

  it('still notifies admins when a crash prevented proof-thread creation', async () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'admin-channel';
    process.env.SAL_SITE_URL = 'https://sal.example';
    const adminSend = vi.fn().mockResolvedValue({ id: 'stats-review-1' });
    const emptyMessages = { fetch: vi.fn().mockResolvedValue(new Collection()) };
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          messages: emptyMessages,
          send: adminSend,
        }),
      },
    };
    const project = createOutboxProjector(client as never, {} as never);

    await expect(project({
      ...outboxRow(),
      aggregate_type: 'match_report',
      aggregate_id: 'report-1',
      event_type: 'match_report_host_submitted',
      payload: {
        reportId: 'report-1',
        pendingActionId: 'action-1',
        matchId: 'match-1',
        hostDiscordId: 'host-1',
        screenshotUrls: ['https://storage.example/game-1-scoreboard.png'],
      },
    })).resolves.toContain('stats-review-1');

    expect(client.channels.fetch).toHaveBeenCalledTimes(1);
    expect(client.channels.fetch).toHaveBeenCalledWith('admin-channel');
    expect(adminSend.mock.calls[0][0].embeds[0].toJSON().fields).toContainEqual({
      name: 'Proof thread',
      value: 'Unavailable — screenshots remain in durable storage.',
    });
  });

  it('still notifies admins when the persisted proof thread was deleted', async () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'admin-channel';
    process.env.SAL_SITE_URL = 'https://sal.example';
    const adminSend = vi.fn().mockResolvedValue({ id: 'stats-review-1' });
    const emptyMessages = { fetch: vi.fn().mockResolvedValue(new Collection()) };
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === 'proof-thread-1') throw new Error('Unknown Channel');
          return {
            isTextBased: () => true,
            messages: emptyMessages,
            send: adminSend,
          };
        }),
      },
    };
    const project = createOutboxProjector(client as never, {} as never);

    await expect(project({
      ...outboxRow(),
      aggregate_type: 'match_report',
      aggregate_id: 'report-1',
      event_type: 'match_report_host_submitted',
      payload: {
        reportId: 'report-1',
        pendingActionId: 'action-1',
        matchId: 'match-1',
        hostDiscordId: 'host-1',
        screenshotUrls: ['https://storage.example/game-1-scoreboard.png'],
        proofThreadId: 'proof-thread-1',
      },
    })).resolves.toContain('stats-review-1');

    expect(adminSend.mock.calls[0][0].embeds[0].toJSON().fields).toContainEqual({
      name: 'Proof thread',
      value: 'Unavailable — screenshots remain in durable storage.',
    });
  });

  it('skips mirroring when the persisted proof channel is not a thread', async () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'admin-channel';
    process.env.SAL_SITE_URL = 'https://sal.example';
    const proofSend = vi.fn();
    const adminSend = vi.fn().mockResolvedValue({ id: 'stats-review-1' });
    const emptyMessages = { fetch: vi.fn().mockResolvedValue(new Collection()) };
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) => id === 'proof-thread-1'
          ? { isThread: () => false, send: proofSend }
          : { isTextBased: () => true, messages: emptyMessages, send: adminSend }),
      },
    };
    const project = createOutboxProjector(client as never, {} as never);

    await expect(project({
      ...outboxRow(),
      aggregate_type: 'match_report',
      aggregate_id: 'report-1',
      event_type: 'match_report_host_submitted',
      payload: {
        reportId: 'report-1',
        pendingActionId: 'action-1',
        matchId: 'match-1',
        hostDiscordId: 'host-1',
        screenshotUrls: ['https://storage.example/game-1-scoreboard.png'],
        proofThreadId: 'proof-thread-1',
      },
    })).resolves.toContain('stats-review-1');

    expect(proofSend).not.toHaveBeenCalled();
    expect(adminSend.mock.calls[0][0].embeds[0].toJSON().fields).toContainEqual({
      name: 'Proof thread',
      value: 'Unavailable — screenshots remain in durable storage.',
    });
  });

  it('does not duplicate already projected screenshots or review cards on retry', async () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'admin-channel';
    const proofSend = vi.fn();
    const adminSend = vi.fn();
    const proofMessages = new Collection<string, never>();
    proofMessages.set('proof-image-1', {
      content: '',
      embeds: [new EmbedBuilder()
        .setFooter({ text: 'sal-outbox:outbox-1:screenshot:0' })
        .toJSON()],
    } as never);
    const adminMessages = new Collection<string, never>();
    adminMessages.set('stats-review-1', {
      content: '',
      embeds: [new EmbedBuilder()
        .setFooter({ text: 'sal-outbox:outbox-1:admin-review' })
        .toJSON()],
    } as never);
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) => id === 'proof-thread-1'
          ? {
            isThread: () => true,
            messages: { fetch: vi.fn().mockResolvedValue(proofMessages) },
            send: proofSend,
          }
          : {
            isTextBased: () => true,
            messages: { fetch: vi.fn().mockResolvedValue(adminMessages) },
            send: adminSend,
          }),
      },
    };
    const project = createOutboxProjector(client as never, {} as never);

    await project({
      ...outboxRow(),
      aggregate_type: 'match_report',
      aggregate_id: 'report-1',
      event_type: 'match_report_host_submitted',
      payload: {
        reportId: 'report-1',
        pendingActionId: 'action-1',
        matchId: 'match-1',
        hostDiscordId: 'host-1',
        screenshotUrls: ['https://storage.example/game-1-scoreboard.png'],
        proofThreadId: 'proof-thread-1',
      },
    });

    expect(proofSend).not.toHaveBeenCalled();
    expect(adminSend).not.toHaveBeenCalled();
  });
});
