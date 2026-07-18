import type { SupabaseClient } from '../client';

export async function isAdminUser(db: SupabaseClient, discordId: string): Promise<boolean> {
  const { data } = await db
    .from('admin_users')
    .select('discord_id')
    .eq('discord_id', discordId)
    .single();
  return data !== null;
}
