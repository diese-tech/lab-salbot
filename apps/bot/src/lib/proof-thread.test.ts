import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));
vi.mock('@salbot/db', () => ({
  setProofThread: vi.fn(),
  incrementScreenshotCount: vi.fn(),
}));

import { setProofThread } from '@salbot/db';
import { activeProofThreads, createProofThread } from './proof-thread';

describe('match-result proof thread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeProofThreads.clear();
  });

  it('directs the verified host to the upload-once web flow', async () => {
    const trackingSend = vi.fn().mockResolvedValue({ id: 'tracking-1' });
    const thread = {
      id: 'thread-1',
      url: 'https://discord.example/thread-1',
      send: trackingSend,
    };
    const receiptMessage = {
      startThread: vi.fn().mockResolvedValue(thread),
    };

    await createProofThread(
      {} as never,
      receiptMessage as never,
      'match-1',
      'home-vs-away',
      2,
      3,
    );

    const instruction = String(trackingSend.mock.calls[0][0]);
    expect(instruction).toContain('Enter stats');
    expect(instruction).toContain('durable storage');
    expect(instruction).toContain('mirrored here');
    expect(instruction).not.toContain('Upload your scoreboard screenshots here');
    expect(instruction).not.toMatch(/0\s*\/\s*3/);
    expect(setProofThread).toHaveBeenCalledWith(
      {},
      'match-1',
      'thread-1',
      'https://discord.example/thread-1',
      3,
    );
  });
});
