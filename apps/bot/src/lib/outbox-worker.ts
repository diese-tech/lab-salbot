import type { OperationOutboxRow } from '@salbot/db';

type LogLevel = 'info' | 'warn' | 'error';

export type OutboxWorkerDependencies = {
  claim: (workerId: string, limit: number) => Promise<OperationOutboxRow[]>;
  project: (row: OperationOutboxRow) => Promise<string | undefined>;
  complete: (outboxId: string, workerId: string, externalId?: string) => Promise<void>;
  fail: (
    outboxId: string,
    workerId: string,
    error: string,
    retryAfterSeconds: number,
  ) => Promise<{ state: string }>;
  log: (level: LogLevel, event: string, details?: Record<string, unknown>) => void;
};

type OutboxWorkerOptions = {
  workerId: string;
  intervalMs?: number;
  batchSize?: number;
  random?: () => number;
  now?: () => Date;
};

export type OutboxWorkerStatus = {
  initialized: boolean;
  running: boolean;
  draining: boolean;
  lastSuccessfulDrainAt: string | null;
  lastError: string | null;
  observedDeadLetters: number;
};

export function getRetryDelaySeconds(attempt: number, random = Math.random): number {
  const exponential = 5 * (2 ** Math.max(0, attempt - 1));
  const jitter = 0.75 + (random() * 0.5);
  return Math.min(900, Math.max(1, Math.round(exponential * jitter)));
}

export class OperationOutboxWorker {
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly random: () => number;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeDrain: Promise<void> | undefined;
  private stopped = false;
  private started = false;
  private initialized = false;
  private lastSuccessfulDrainAt: string | null = null;
  private lastError: string | null = null;
  private observedDeadLetters = 0;

  constructor(
    private readonly dependencies: OutboxWorkerDependencies,
    private readonly options: OutboxWorkerOptions,
  ) {
    this.intervalMs = options.intervalMs ?? 5_000;
    this.batchSize = options.batchSize ?? 25;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.drainNow();
    this.scheduleNextDrain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.activeDrain;
  }

  drainNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.activeDrain) return this.activeDrain;

    this.activeDrain = this.drain().finally(() => {
      this.activeDrain = undefined;
    });
    return this.activeDrain;
  }

  getStatus(): OutboxWorkerStatus {
    return {
      initialized: this.initialized,
      running: this.started && !this.stopped,
      draining: this.activeDrain !== undefined,
      lastSuccessfulDrainAt: this.lastSuccessfulDrainAt,
      lastError: this.lastError,
      observedDeadLetters: this.observedDeadLetters,
    };
  }

  private scheduleNextDrain(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.drainNow().finally(() => this.scheduleNextDrain());
    }, this.intervalMs);
  }

  private async drain(): Promise<void> {
    let claimedCount: number;
    do {
      let rows: OperationOutboxRow[];
      try {
        rows = await this.dependencies.claim(this.options.workerId, this.batchSize);
        this.initialized = true;
        this.lastSuccessfulDrainAt = this.now().toISOString();
        this.lastError = null;
      } catch (error) {
        this.lastError = errorMessage(error);
        this.dependencies.log('error', 'outbox_claim_failed', { error: this.lastError });
        return;
      }

      claimedCount = rows.length;
      await Promise.all(rows.map((row) => this.processRow(row)));
    } while (!this.stopped && claimedCount === this.batchSize);
  }

  private async processRow(row: OperationOutboxRow): Promise<void> {
    const ageMs = Math.max(0, this.now().getTime() - Date.parse(row.created_at));
    this.dependencies.log('info', 'outbox_claimed', {
      outboxId: row.id,
      topic: row.topic,
      attempts: row.attempts,
      ageMs,
    });

    try {
      const externalId = await this.dependencies.project(row);
      await this.dependencies.complete(row.id, this.options.workerId, externalId);
      this.dependencies.log('info', 'outbox_completed', {
        outboxId: row.id,
        topic: row.topic,
        attempts: row.attempts,
        ageMs,
        externalId: externalId ?? null,
      });
    } catch (error) {
      const message = errorMessage(error);
      const retryAfterSeconds = getRetryDelaySeconds(row.attempts, this.random);
      try {
        const result = await this.dependencies.fail(
          row.id,
          this.options.workerId,
          message,
          retryAfterSeconds,
        );
        if (result.state === 'dead_letter') this.observedDeadLetters += 1;
        this.dependencies.log(result.state === 'dead_letter' ? 'error' : 'warn', 'outbox_failed', {
          outboxId: row.id,
          topic: row.topic,
          attempts: row.attempts,
          ageMs,
          state: result.state,
          retryAfterSeconds,
          error: message,
        });
      } catch (leaseError) {
        this.dependencies.log('error', 'outbox_failure_record_failed', {
          outboxId: row.id,
          topic: row.topic,
          error: errorMessage(leaseError),
          projectionError: message,
        });
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
