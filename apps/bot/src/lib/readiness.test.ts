import { describe, expect, it, vi } from 'vitest';
import { ReadinessMonitor } from './readiness';

function outboxStatus(overrides: Record<string, unknown> = {}) {
  return {
    initialized: true,
    running: true,
    draining: false,
    lastSuccessfulDrainAt: '2026-07-29T00:00:00.000Z',
    lastError: null,
    observedDeadLetters: 0,
    ...overrides,
  };
}

describe('ReadinessMonitor', () => {
  it('is non-ready during startup', async () => {
    const monitor = new ReadinessMonitor({
      isDiscordReady: () => false,
      getOutboxStatus: () => outboxStatus({ initialized: false, running: false }),
      checkDatabase: vi.fn().mockResolvedValue({ deadLetterCount: 0, oldestPendingAt: null }),
    });

    await expect(monitor.check()).resolves.toMatchObject({
      ready: false,
      checks: { discord: false, database: true, outbox: false, draining: false },
    });
  });

  it('is ready after Discord, database, and outbox initialization', async () => {
    const monitor = new ReadinessMonitor({
      isDiscordReady: () => true,
      getOutboxStatus: () => outboxStatus(),
      checkDatabase: vi.fn().mockResolvedValue({ deadLetterCount: 2, oldestPendingAt: null }),
    });

    await expect(monitor.check()).resolves.toMatchObject({
      ready: true,
      checks: { discord: true, database: true, outbox: true, draining: false },
      outbox: { deadLetterCount: 2 },
    });
  });

  it('becomes non-ready when database connectivity is lost without exposing the error', async () => {
    const monitor = new ReadinessMonitor({
      isDiscordReady: () => true,
      getOutboxStatus: () => outboxStatus(),
      checkDatabase: vi.fn().mockRejectedValue(new Error('postgres://secret@host raw failure')),
    });

    const result = await monitor.check();
    expect(result).toMatchObject({
      ready: false,
      checks: { database: false },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('raw failure');
  });

  it('becomes non-ready during drain', async () => {
    const monitor = new ReadinessMonitor({
      isDiscordReady: () => true,
      getOutboxStatus: () => outboxStatus(),
      checkDatabase: vi.fn().mockResolvedValue({ deadLetterCount: 0, oldestPendingAt: null }),
    });

    monitor.beginDrain();

    await expect(monitor.check()).resolves.toMatchObject({
      ready: false,
      checks: { draining: true },
    });
    expect(monitor.isDraining()).toBe(true);
  });
});
