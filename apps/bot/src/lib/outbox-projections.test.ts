import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbedBuilder } from 'discord.js';

vi.mock('./proof-thread', () => ({ removeActiveProofThread: vi.fn() }));

import { createOutboxProjector, projectionMarker } from './outbox-projections';

const originalAdminChannel = process.env.CHANNEL_ADMIN_REVIEW;

afterEach(() => {
  if (originalAdminChannel === undefined) delete process.env.CHANNEL_ADMIN_REVIEW;
  else process.env.CHANNEL_ADMIN_REVIEW = originalAdminChannel;
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

  it('uses a stable marker for create-once projections', () => {
    expect(projectionMarker('abc')).toBe('sal-outbox:abc');
  });
});
