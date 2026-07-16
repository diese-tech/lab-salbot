import { describe, expect, it, vi } from 'vitest';
import { buildGodDraftRecapEmbed } from './embeds';
import { handleGodDraftSessionComplete } from './god-draft-recap';
import type { GodDraftRecapData, SupabaseClient } from '@salbot/db';

const recap: GodDraftRecapData = {
  session: {
    id: 'draft-1',
    match_id: 'match-1',
    game_number: 1,
    status: 'complete',
    matches: {
      id: 'match-1',
      week: 4,
      division_id: 'solar',
      home_org_id: 'org-a',
      away_org_id: 'org-b',
      home_org: { id: 'org-a', name: 'Alpha', tag: 'ALP' },
      away_org: { id: 'org-b', name: 'Beta', tag: 'BET' },
    },
  },
  picks: [
    { session_id: 'draft-1', match_id: 'match-1', game_number: 1, org_id: 'org-a', god_id: 'athena', god_name: 'Athena', slot: 0 },
    { session_id: 'draft-1', match_id: 'match-1', game_number: 1, org_id: 'org-b', god_id: 'ymir', god_name: 'Ymir', slot: 1 },
  ],
  bans: [
    { session_id: 'draft-1', match_id: 'match-1', game_number: 1, org_id: 'org-a', god_id: 'loki', god_name: 'Loki', slot: 0 },
    { session_id: 'draft-1', match_id: 'match-1', game_number: 1, org_id: 'org-b', god_id: 'ra', god_name: 'Ra', slot: 1 },
  ],
  vaultedGodNames: ['Athena', 'Ymir'],
  seriesContinues: true,
};

vi.mock('@salbot/db', async () => {
  const actual = await vi.importActual<typeof import('@salbot/db')>('@salbot/db');
  return {
    ...actual,
    getGodDraftRecapData: vi.fn(async () => recap),
  };
});

describe('god draft recap embeds', () => {
  it('contains match, picks, bans by team, and vault summary', () => {
    const json = buildGodDraftRecapEmbed(recap).toJSON();
    expect(json.title).toContain('Game 1');
    expect(json.description).toContain('ALP vs BET');
    expect(json.fields?.find((field) => field.name === 'ALP Picks')?.value).toContain('Athena');
    expect(json.fields?.find((field) => field.name === 'ALP Picks')?.value).toContain('Unassigned');
    expect(json.fields?.find((field) => field.name === 'BET Bans')?.value).toContain('Ra');
    expect(json.fields?.find((field) => field.name === 'Vaulted Next Game')?.value).toContain('Ymir');
  });

  it('omits vault summary when the series is over', () => {
    const json = buildGodDraftRecapEmbed({ ...recap, seriesContinues: false }).toJSON();
    expect(json.fields?.some((field) => field.name === 'Vaulted Next Game')).toBe(false);
  });
});

describe('god draft realtime handler', () => {
  it('does nothing for non-complete transitions', async () => {
    const send = vi.fn();
    const client = { channels: { fetch: vi.fn(async () => ({ send })) } };
    const handled = await handleGodDraftSessionComplete(client as never, {} as SupabaseClient, { new: { id: 'draft-1', status: 'picking' } });
    expect(handled).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('posts one recap embed on complete', async () => {
    process.env.CHANNEL_RESULTS_SOLAR = 'results-solar';
    const send = vi.fn();
    const client = { channels: { fetch: vi.fn(async () => ({ send })) } };
    const handled = await handleGodDraftSessionComplete(client as never, {} as SupabaseClient, { new: { id: 'draft-2', status: 'complete' }, old: { status: 'picking' } });
    expect(handled).toBe(true);
    expect(client.channels.fetch).toHaveBeenCalledWith('results-solar');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].embeds[0].toJSON().title).toContain('God Draft Complete');
  });

  it('does not repost when an already-complete session is updated again', async () => {
    process.env.CHANNEL_RESULTS_SOLAR = 'results-solar';
    const send = vi.fn();
    const client = { channels: { fetch: vi.fn(async () => ({ send })) } };
    const handled = await handleGodDraftSessionComplete(client as never, {} as SupabaseClient, { new: { id: 'draft-3', status: 'complete' }, old: { status: 'complete' } });
    expect(handled).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('dedupes complete payloads when old row status is unavailable', async () => {
    process.env.CHANNEL_RESULTS_SOLAR = 'results-solar';
    const send = vi.fn();
    const client = { channels: { fetch: vi.fn(async () => ({ send })) } };
    const payload = { new: { id: 'draft-4', status: 'complete' } };
    expect(await handleGodDraftSessionComplete(client as never, {} as SupabaseClient, payload)).toBe(true);
    expect(await handleGodDraftSessionComplete(client as never, {} as SupabaseClient, payload)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
