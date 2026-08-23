import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warnOnMissingChannelEnv } from './config';

const CHANNEL_VARS = [
  'CHANNEL_ADMIN_REVIEW',
  'CHANNEL_RESULTS_SOLAR',
  'CHANNEL_RESULTS_LUNAR',
  'CHANNEL_RESULTS_TERRA',
  'CHANNEL_RESCHEDULES_SOLAR',
  'CHANNEL_RESCHEDULES_LUNAR',
  'CHANNEL_RESCHEDULES_TERRA',
  'CHANNEL_TRADE_BLOCK_SOLAR',
  'CHANNEL_TRADE_BLOCK_LUNAR',
  'CHANNEL_TRADE_BLOCK_TERRA',
  'CHANNEL_TRANSACTIONS',
] as const;

describe('warnOnMissingChannelEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const name of CHANNEL_VARS) delete process.env[name];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('warns once per missing channel env var and does not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => warnOnMissingChannelEnv()).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(CHANNEL_VARS.length);
    for (const name of CHANNEL_VARS) {
      expect(warnSpy.mock.calls.some(([msg]) => typeof msg === 'string' && msg.includes(name))).toBe(true);
    }
  });

  it('only warns for vars that are actually missing', () => {
    process.env.CHANNEL_ADMIN_REVIEW = 'some-channel-id';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const missing = warnOnMissingChannelEnv();

    expect(missing).not.toContain('CHANNEL_ADMIN_REVIEW');
    expect(warnSpy).toHaveBeenCalledTimes(CHANNEL_VARS.length - 1);
  });

  it('does not warn when all channel env vars are set', () => {
    for (const name of CHANNEL_VARS) process.env[name] = 'some-channel-id';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const missing = warnOnMissingChannelEnv();

    expect(missing).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
