import { describe, expect, it } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import {
  applyApprovedStatus,
  applyCancelledStatus,
  applyNeedsInfoStatus,
} from './embeds';

describe('decision status embeds', () => {
  it('is idempotent when the same projection is replayed', () => {
    const embed = new EmbedBuilder().setTitle('Pending');

    applyApprovedStatus(embed, 'admin-1');
    applyApprovedStatus(embed, 'admin-1');

    expect(embed.toJSON().fields?.filter((field) => field.name === 'Approved By')).toHaveLength(1);
  });

  it('replaces Needs Info fields when a later decision is projected', () => {
    const embed = new EmbedBuilder().setTitle('Pending');

    applyNeedsInfoStatus(embed, 'admin-1', 'Upload details.');
    applyApprovedStatus(embed, 'admin-2');

    expect(embed.toJSON().fields?.map((field) => field.name)).toEqual(['Approved By']);
  });

  it('renders stale decisions as cancelled instead of approved', () => {
    const embed = new EmbedBuilder().setTitle('Pending');

    applyCancelledStatus(embed, 'admin-1', 'Match is no longer scheduled.');

    expect(embed.toJSON()).toMatchObject({
      title: expect.stringContaining('Cancelled'),
      fields: expect.arrayContaining([
        expect.objectContaining({ name: 'Cancellation Reason' }),
      ]),
    });
  });
});
