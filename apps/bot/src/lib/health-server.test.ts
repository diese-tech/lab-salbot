import { describe, expect, it, vi } from 'vitest';
import { startHealthServer } from './health-server';

describe('/healthz', () => {
  it('returns 503 JSON until dependencies are ready', async () => {
    const monitor = {
      check: vi.fn().mockResolvedValue({
        ready: false,
        status: 'not_ready',
        checks: { discord: false, database: true, outbox: false, draining: false },
        outbox: { deadLetterCount: 0, oldestPendingAgeSeconds: null },
      }),
    };
    const server = await startHealthServer(monitor, { host: '127.0.0.1', port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ status: 'not_ready' });
    } finally {
      await server.close();
    }
  });

  it('returns 200 only for a ready snapshot and 404 elsewhere', async () => {
    const monitor = {
      check: vi.fn().mockResolvedValue({
        ready: true,
        status: 'ready',
        checks: { discord: true, database: true, outbox: true, draining: false },
        outbox: { deadLetterCount: 0, oldestPendingAgeSeconds: null },
      }),
    };
    const server = await startHealthServer(monitor, { host: '127.0.0.1', port: 0 });

    try {
      expect((await fetch(`http://127.0.0.1:${server.port}/healthz`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${server.port}/other`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
