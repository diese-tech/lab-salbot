type ShutdownDependencies = {
  beginDrain: () => void;
  stopOutbox: () => Promise<void>;
  destroyDiscord: () => Promise<void> | void;
  closeHealthServer: () => Promise<void>;
  exit: (code: number) => void;
  log: (message: string, error?: unknown) => void;
};

export function createShutdownHandler(dependencies: ShutdownDependencies): () => Promise<void> {
  let activeShutdown: Promise<void> | undefined;

  return () => {
    if (activeShutdown) return activeShutdown;
    dependencies.beginDrain();
    activeShutdown = runShutdown(dependencies);
    return activeShutdown;
  };
}

async function runShutdown(dependencies: ShutdownDependencies): Promise<void> {
  await attempt('outbox worker', dependencies.stopOutbox, dependencies.log);
  await attempt('Discord client', dependencies.destroyDiscord, dependencies.log);
  await attempt('health server', dependencies.closeHealthServer, dependencies.log);
  dependencies.exit(0);
}

async function attempt(
  label: string,
  action: () => Promise<void> | void,
  log: (message: string, error?: unknown) => void,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    log(`[shutdown] Could not stop ${label} cleanly.`, error);
  }
}
