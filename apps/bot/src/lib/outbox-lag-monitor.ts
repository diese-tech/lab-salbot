type LogLevel = 'info' | 'warn' | 'error';

export type OutboxHealth = {
  deadLetterCount: number;
  oldestPendingAt: string | null;
};

export type OutboxLagMonitorDependencies = {
  checkHealth: () => Promise<OutboxHealth>;
  log: (level: LogLevel, event: string, details?: Record<string, unknown>) => void;
  now?: () => Date;
};

export type OutboxLagMonitorOptions = {
  intervalMs?: number;
  /** Age of the oldest pending/processing row, in seconds, that logs a warning. */
  warnLagSeconds?: number;
  /** Age of the oldest pending/processing row, in seconds, that logs an alert. */
  alertLagSeconds?: number;
};

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_WARN_LAG_SECONDS = 5 * 60;
const DEFAULT_ALERT_LAG_SECONDS = 15 * 60;

/**
 * Periodically samples the operation outbox's backlog depth and logs it, so
 * a stuck or slow-draining outbox shows up in logs/metrics before it becomes
 * a user-visible incident instead of only being visible to whoever happens
 * to poll /healthz.
 */
export class OutboxLagMonitor {
  private readonly intervalMs: number;
  private readonly warnLagSeconds: number;
  private readonly alertLagSeconds: number;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly dependencies: OutboxLagMonitorDependencies,
    options: OutboxLagMonitorOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.warnLagSeconds = options.warnLagSeconds ?? DEFAULT_WARN_LAG_SECONDS;
    this.alertLagSeconds = options.alertLagSeconds ?? DEFAULT_ALERT_LAG_SECONDS;
    this.now = dependencies.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    void this.checkOnce();
    this.timer = setInterval(() => void this.checkOnce(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async checkOnce(): Promise<void> {
    let health: OutboxHealth;
    try {
      health = await this.dependencies.checkHealth();
    } catch (error) {
      this.dependencies.log('error', 'outbox_lag_check_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const lagSeconds = ageSeconds(health.oldestPendingAt, this.now());
    const details = {
      lagSeconds,
      deadLetterCount: health.deadLetterCount,
      oldestPendingAt: health.oldestPendingAt,
    };

    if (lagSeconds !== null && lagSeconds >= this.alertLagSeconds) {
      this.dependencies.log('error', 'outbox_lag_alert', details);
    } else if (lagSeconds !== null && lagSeconds >= this.warnLagSeconds) {
      this.dependencies.log('warn', 'outbox_lag_warning', details);
    } else {
      this.dependencies.log('info', 'outbox_lag_ok', details);
    }

    if (health.deadLetterCount > 0) {
      this.dependencies.log('error', 'outbox_dead_letters_present', {
        deadLetterCount: health.deadLetterCount,
      });
    }
  }
}

function ageSeconds(createdAt: string | null, now: Date): number | null {
  if (!createdAt) return null;
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 1000));
}
