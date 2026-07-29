import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from './shutdown';

describe('clean shutdown', () => {
  it('marks non-ready, stops the worker, disconnects Discord, closes HTTP, and exits', async () => {
    const calls: string[] = [];
    const shutdown = createShutdownHandler({
      beginDrain: () => calls.push('draining'),
      stopOutbox: vi.fn().mockImplementation(async () => { calls.push('outbox'); }),
      destroyDiscord: vi.fn().mockImplementation(async () => { calls.push('discord'); }),
      closeHealthServer: vi.fn().mockImplementation(async () => { calls.push('health'); }),
      exit: vi.fn().mockImplementation(() => { calls.push('exit'); }),
      log: vi.fn(),
    });

    await shutdown();

    expect(calls).toEqual(['draining', 'outbox', 'discord', 'health', 'exit']);
  });

  it('coalesces repeated shutdown signals', async () => {
    const stopOutbox = vi.fn().mockResolvedValue(undefined);
    const shutdown = createShutdownHandler({
      beginDrain: vi.fn(),
      stopOutbox,
      destroyDiscord: vi.fn().mockResolvedValue(undefined),
      closeHealthServer: vi.fn().mockResolvedValue(undefined),
      exit: vi.fn(),
      log: vi.fn(),
    });

    await Promise.all([shutdown(), shutdown()]);

    expect(stopOutbox).toHaveBeenCalledTimes(1);
  });
});
