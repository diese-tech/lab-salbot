import { createServer, type Server } from 'node:http';
import type { ReadinessSnapshot } from './readiness';

type ReadinessCheck = {
  check: () => Promise<ReadinessSnapshot>;
};

type HealthServerOptions = {
  host?: string;
  port: number;
};

export type RunningHealthServer = {
  port: number;
  close: () => Promise<void>;
};

export async function startHealthServer(
  readiness: ReadinessCheck,
  options: HealthServerOptions,
): Promise<RunningHealthServer> {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/healthz') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'not_found' }));
      return;
    }

    try {
      const snapshot = await readiness.check();
      response.writeHead(snapshot.ready ? 200 : 503, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      });
      response.end(JSON.stringify(snapshot));
    } catch {
      response.writeHead(503, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      });
      response.end(JSON.stringify({ status: 'not_ready' }));
    }
  });

  await listen(server, options.port, options.host ?? '0.0.0.0');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Health server did not bind a TCP port');
  }

  return {
    port: address.port,
    close: () => close(server),
  };
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
}
