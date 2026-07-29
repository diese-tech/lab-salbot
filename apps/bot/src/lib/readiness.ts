import type { OutboxWorkerStatus } from './outbox-worker';

type DatabaseHealth = {
  deadLetterCount: number;
  oldestPendingAt: string | null;
};

type ReadinessDependencies = {
  isDiscordReady: () => boolean;
  getOutboxStatus: () => OutboxWorkerStatus;
  checkDatabase: () => Promise<DatabaseHealth>;
};

export type ReadinessSnapshot = {
  ready: boolean;
  status: 'ready' | 'not_ready';
  checks: {
    discord: boolean;
    database: boolean;
    outbox: boolean;
    draining: boolean;
  };
  outbox: {
    deadLetterCount: number | null;
    oldestPendingAgeSeconds: number | null;
  };
};

export class ReadinessMonitor {
  private draining = false;

  constructor(private readonly dependencies: ReadinessDependencies) {}

  beginDrain(): void {
    this.draining = true;
  }

  isDraining(): boolean {
    return this.draining;
  }

  async check(): Promise<ReadinessSnapshot> {
    const discord = this.dependencies.isDiscordReady();
    const outboxStatus = this.dependencies.getOutboxStatus();
    const outbox = outboxStatus.initialized
      && outboxStatus.running
      && outboxStatus.lastError === null;

    let database = false;
    let databaseHealth: DatabaseHealth | null = null;
    try {
      databaseHealth = await this.dependencies.checkDatabase();
      database = true;
    } catch {
      // The public endpoint reports only dependency state. Raw database errors
      // stay in internal logs and never enter the health response.
    }

    const ready = discord && database && outbox && !this.draining;
    return {
      ready,
      status: ready ? 'ready' : 'not_ready',
      checks: {
        discord,
        database,
        outbox,
        draining: this.draining,
      },
      outbox: {
        deadLetterCount: databaseHealth?.deadLetterCount ?? null,
        oldestPendingAgeSeconds: oldestPendingAgeSeconds(databaseHealth?.oldestPendingAt ?? null),
      },
    };
  }
}

function oldestPendingAgeSeconds(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}
