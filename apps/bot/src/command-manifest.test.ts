import { describe, expect, it } from 'vitest';
import { loadCommandManifest } from './command-manifest';

describe('Discord guild command manifest', () => {
  it('contains only implemented or explicitly labeled stub commands', async () => {
    const names = (await loadCommandManifest()).map((command) => command.name);

    expect(names).toEqual([
      'report-result',
      'reschedule',
      'request-admin-review',
      'update-ign',
      'division-role-config',
      'division-sync',
      'log-scouter',
      'profile',
      'help',
    ]);
    expect(names).not.toContain('rules');
    expect(names).not.toContain('trade');
    expect(names).not.toContain('claim');
    expect(names).not.toContain('drop');
  });
});
