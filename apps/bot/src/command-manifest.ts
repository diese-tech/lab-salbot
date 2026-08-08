/**
 * The guild manifest is deliberately explicit. Accepted ADR commands stay out
 * until both their database contracts and runtime handlers exist.
 */
export async function loadCommandManifest() {
  const commands = await Promise.all([
    import('./commands/report-result'),
    import('./commands/reschedule'),
    import('./commands/request-admin-review'),
    import('./commands/update-ign'),
    import('./commands/division-role-config'),
    import('./commands/division-sync'),
    import('./commands/log-scouter'),
    import('./commands/profile'),
    import('./commands/help'),
  ]);

  return commands.map((command) => command.data);
}
