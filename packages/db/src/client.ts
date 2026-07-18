import { createClient as supabaseCreateClient, type SupabaseClient as BaseSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types/database.types';

export type SupabaseClient = BaseSupabaseClient<Database>;

export function createClient(url: string, key: string): SupabaseClient {
  return supabaseCreateClient<Database>(url, key);
}
