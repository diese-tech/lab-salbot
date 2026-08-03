import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const original = Object.fromEntries(ENV_VARS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_VARS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  vi.resetModules();
});

describe('db', () => {
  it('imports without throwing even when Supabase env vars are unset', async () => {
    for (const key of ENV_VARS) delete process.env[key];

    // scripts/deploy-commands.ts imports command modules (which import this
    // module) purely to read their static `.data` schema — that must not
    // require Supabase credentials or open a connection.
    await expect(import('./db')).resolves.toBeDefined();
  });

  it('throws only once something actually touches the client', async () => {
    for (const key of ENV_VARS) delete process.env[key];

    const { db } = await import('./db');

    expect(() => db.from('players')).toThrow('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  });

  it('constructs and forwards to a real client once env vars are present', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const { db } = await import('./db');

    expect(() => db.from('players')).not.toThrow();
  });
});
