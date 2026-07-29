let drainTrigger: (() => Promise<void>) | undefined;

export function registerOutboxDrain(trigger: () => Promise<void>): void {
  drainTrigger = trigger;
}

export function requestImmediateOutboxDrain(): void {
  if (!drainTrigger) {
    console.warn('[outbox] Immediate drain requested before worker initialization.');
    return;
  }
  void drainTrigger();
}
