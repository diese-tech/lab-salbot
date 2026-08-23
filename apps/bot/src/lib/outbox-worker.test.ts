import { describe, expect, it, vi } from 'vitest';
import { OperationOutboxWorker, getRetryDelaySeconds } from './outbox-worker';

const row = {
  id: 'outbox-1',
  topic: 'standings_recalculation',
  aggregate_type: 'match',
  aggregate_id: 'match-1',
  event_type: 'match_result_recorded',
  deduplication_key: 'match-1:standings',
  payload: { matchId: 'match-1' },
  state: 'processing',
  attempts: 3,
  available_at: '2026-07-29T00:00:00.000Z',
  lease_owner: 'worker-1',
  lease_expires_at: '2026-07-29T00:01:00.000Z',
  last_error: null,
  external_id: null,
  completed_at: null,
  created_at: '2026-07-29T00:00:00.000Z',
  updated_at: '2026-07-29T00:00:00.000Z',
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    claim: vi.fn().mockResolvedValue([row]),
    project: vi.fn().mockResolvedValue('discord-message-1'),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue({ state: 'pending' }),
    reconcileAmbiguity: vi.fn().mockResolvedValue({ state: 'needs_reconciliation' }),
    log: vi.fn(),
    ...overrides,
  };
}

describe('OperationOutboxWorker', () => {
  it('projects and acknowledges each claimed row', async () => {
    const deps = dependencies();
    const worker = new OperationOutboxWorker(deps, {
      workerId: 'worker-1',
      random: () => 0.5,
    });

    await worker.drainNow();

    expect(deps.claim).toHaveBeenCalledWith('worker-1', 25);
    expect(deps.project).toHaveBeenCalledWith(row);
    expect(deps.complete).toHaveBeenCalledWith(
      'outbox-1',
      'worker-1',
      'discord-message-1',
    );
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it('schedules a jittered retry when projection fails', async () => {
    const deps = dependencies({
      project: vi.fn().mockRejectedValue(new Error('Discord unavailable')),
    });
    const worker = new OperationOutboxWorker(deps, {
      workerId: 'worker-1',
      random: () => 0.5,
    });

    await worker.drainNow();

    expect(deps.fail).toHaveBeenCalledWith(
      'outbox-1',
      'worker-1',
      'Discord unavailable',
      20,
    );
  });

  it('pauses ambiguous Discord delivery for reconciliation instead of blindly retrying', async () => {
    const error = Object.assign(new Error('Discord timed out after send'), { needsReconciliation: true });
    const deps = dependencies({ project: vi.fn().mockRejectedValue(error) });
    const worker = new OperationOutboxWorker(deps, { workerId: 'worker-1' });

    await worker.drainNow();

    expect(deps.reconcileAmbiguity).toHaveBeenCalledWith(
      'outbox-1', 'worker-1', 'Discord timed out after send',
    );
    expect(deps.fail).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('coalesces concurrent drain requests', async () => {
    let releaseClaim!: (rows: typeof row[]) => void;
    const claim = vi.fn().mockImplementation(() => new Promise((resolve) => {
      releaseClaim = resolve;
    }));
    const deps = dependencies({ claim });
    const worker = new OperationOutboxWorker(deps, { workerId: 'worker-1' });

    const first = worker.drainNow();
    const second = worker.drainNow();
    releaseClaim([]);
    await Promise.all([first, second]);

    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('drains immediately on startup and stops accepting new claims', async () => {
    const deps = dependencies({ claim: vi.fn().mockResolvedValue([]) });
    const worker = new OperationOutboxWorker(deps, {
      workerId: 'worker-1',
      intervalMs: 5_000,
    });

    await worker.start();
    await worker.stop();
    await worker.drainNow();

    expect(deps.claim).toHaveBeenCalledTimes(1);
  });

  it('releases an active lease when shutdown cannot finish in time', async () => {
    let releaseProjection!: () => void;
    const project = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      releaseProjection = resolve;
    }));
    const deps = dependencies({ project });
    const worker = new OperationOutboxWorker(deps, { workerId: 'worker-1' });

    const drain = worker.drainNow();
    await vi.waitFor(() => expect(project).toHaveBeenCalled());
    await worker.stop(1);
    releaseProjection();
    await drain;

    expect(deps.fail).toHaveBeenCalledWith(
      'outbox-1',
      'worker-1',
      'Worker shutdown released the active lease.',
      0,
    );
    expect(deps.complete).not.toHaveBeenCalled();
  });
});

describe('getRetryDelaySeconds', () => {
  it('uses exponential backoff with jitter and a fifteen-minute cap', () => {
    expect(getRetryDelaySeconds(3, () => 0.5)).toBe(20);
    expect(getRetryDelaySeconds(10, () => 1)).toBe(900);
  });
});
