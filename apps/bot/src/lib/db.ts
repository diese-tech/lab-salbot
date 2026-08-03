import { createClient } from '@salbot/db';
import type { SupabaseClient } from '@salbot/db';

// Lazy by design: importing this module (which every command file does, even
// ones that only need to expose their static `data` schema — see
// scripts/deploy-commands.ts) must not itself require Supabase credentials
// or open a connection. The client is only constructed on first real use.
let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    client = createClient(url, key);
  }
  return client;
}

export const db: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
