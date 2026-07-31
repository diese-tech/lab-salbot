import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxLagMonitor } from './outbox-lag-monitor';

function dependencies(overrides: Partial<{
  checkHealth: () => Promise<{ deadLetterCount: number; oldestPendingAt: string | null }>;
  now: () => Date;
}> = {}) {
  return {
    checkHealth: vi.fn().mockResolvedValue({ deadLetterCount: 0, oldestPendingAt: null }),
    log: vi.fn(),
    now: () => new Date('2026-07-29T00:10:00.000Z'),
    ...overrides,
  };
}

describe('OutboxLagMonitor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs ok when there is no pending backlog', async () => {
    const deps = dependencies();
    const monitor = new OutboxLagMonitor(deps);

    await monitor.checkOnce();

    expect(deps.log).toHaveBeenCalledWith('info', 'outbox_lag_ok', {
      lagSeconds: null,
      deadLetterCount: 0,
      oldestPendingAt: null,
    });
  });

  it('logs ok when the oldest pending row is younger than the warning threshold', async () => {
    const deps = dependencies({
      checkHealth: vi.fn().mockResolvedValue({
        deadLetterCount: 0,
        oldestPendingAt: '2026-07-29T00:08:00.000Z', // 2 minutes old
      }),
    });
    const monitor = new OutboxLagMonitor(deps, { warnLagSeconds: 300, alertLagSeconds: 900 });

    await monitor.checkOnce();

    expect(deps.log).toHaveBeenCalledWith('info', 'outbox_lag_ok', expect.objectContaining({
      lagSeconds: 120,
    }));
  });

  it('logs a warning once the oldest pending row crosses the warn threshold', async () => {
    const deps = dependencies({
      checkHealth: vi.fn().mockResolvedValue({
        deadLetterCount: 0,
        oldestPendingAt: '2026-07-29T00:04:00.000Z', // 6 minutes old
      }),
    });
    const monitor = new OutboxLagMonitor(deps, { warnLagSeconds: 300, alertLagSeconds: 900 });

    await monitor.checkOnce();

    expect(deps.log).toHaveBeenCalledWith('warn', 'outbox_lag_warning', expect.objectContaining({
      lagSeconds: 360,
    }));
  });

  it('logs an alert once the oldest pending row crosses the alert threshold', async () => {
    const deps = dependencies({
      checkHealth: vi.fn().mockResolvedValue({
        deadLetterCount: 0,
        oldestPendingAt: '2026-07-28T23:50:00.000Z', // 20 minutes old
      }),
    });
    const monitor = new OutboxLagMonitor(deps, { warnLagSeconds: 300, alertLagSeconds: 900 });

    await monitor.checkOnce();

    expect(deps.log).toHaveBeenCalledWith('error', 'outbox_lag_alert', expect.objectContaining({
      lagSeconds: 1200,
    }));
  });

  it('separately alerts on any dead letters regardless of lag', async () => {
    const deps = dependencies({
      checkHealth: vi.fn().mockResolvedValue({
        deadLetterCount: 3,
        oldestPendingAt: null,
      }),
    });
    const monitor = new OutboxLagMonitor(deps);

    await monitor.checkOnce();

    expect(deps.log).toHaveBeenCalledWith('info', 'outbox_lag_ok', expect.objectContaining({
      deadLetterCount: 3,
    }));
    expect(deps.log).toHaveBeenCalledWith('error', 'outbox_dead_letters_present', {
      deadLetterCount: 3,
    });
  });

  it('logs an error and does not throw when the health check itself fails', async () => {
    const deps = dependencies({
      checkHealth: vi.fn().mockRejectedValue(new Error('connection reset')),
    });
    const monitor = new OutboxLagMonitor(deps);

    await expect(monitor.checkOnce()).resolves.toBeUndefined();

    expect(deps.log).toHaveBeenCalledWith('error', 'outbox_lag_check_failed', {
      error: 'connection reset',
    });
  });

  it('checks immediately on start and stops scheduling further checks on stop', async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    const monitor = new OutboxLagMonitor(deps, { intervalMs: 1_000 });

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.checkHealth).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.checkHealth).toHaveBeenCalledTimes(2);

    monitor.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.checkHealth).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
