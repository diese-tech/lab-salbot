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
  private readonly activeRows = new Map<string, OperationOutboxRow>();
  private readonly releasedRows = new Set<string>();

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

  async stop(timeoutMs?: number): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.activeDrain) return;
    if (timeoutMs === undefined) {
      await this.activeDrain;
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      this.activeDrain.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!completed) await this.releaseActiveRows();
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
    this.activeRows.set(row.id, row);
    const ageMs = Math.max(0, this.now().getTime() - Date.parse(row.created_at));
    this.dependencies.log('info', 'outbox_claimed', {
      outboxId: row.id,
      topic: row.topic,
      attempts: row.attempts,
      ageMs,
    });

    try {
      const externalId = await this.dependencies.project(row);
      if (this.releasedRows.has(row.id)) return;
      await this.dependencies.complete(row.id, this.options.workerId, externalId);
      this.dependencies.log('info', 'outbox_completed', {
        outboxId: row.id,
        topic: row.topic,
        attempts: row.attempts,
        ageMs,
        externalId: externalId ?? null,
      });
    } catch (error) {
      if (this.releasedRows.has(row.id)) return;
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
    } finally {
      this.activeRows.delete(row.id);
      this.releasedRows.delete(row.id);
    }
  }

  private async releaseActiveRows(): Promise<void> {
    await Promise.all([...this.activeRows.values()].map(async (row) => {
      this.releasedRows.add(row.id);
      try {
        await withTimeout(
          this.dependencies.fail(
            row.id,
            this.options.workerId,
            'Worker shutdown released the active lease.',
            0,
          ),
          2_000,
          'Timed out releasing the outbox lease during shutdown.',
        );
        this.dependencies.log('warn', 'outbox_lease_released', {
          outboxId: row.id,
          topic: row.topic,
          attempts: row.attempts,
        });
      } catch (error) {
        this.dependencies.log('error', 'outbox_lease_release_failed', {
          outboxId: row.id,
          topic: row.topic,
          error: errorMessage(error),
        });
      }
    }));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
