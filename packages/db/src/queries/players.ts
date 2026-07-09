import type { SupabaseClient } from '@supabase/supabase-js';

const PLAYER_FIELDS = 'id, discord_username, discord_id, ign, display_alias, org_id, is_captain, division_id';

export async function getCaptainByDiscordId(db: SupabaseClient, discordId: string) {
  const { data, error } = await db
    .from('players')
    .select(PLAYER_FIELDS)
    .eq('discord_id', discordId)
    .eq('is_captain', true)
    .single();

  if (error) return null;
  return data;
}

export async function getPlayerByDiscordId(db: SupabaseClient, discordId: string) {
  const { data, error } = await db
    .from('players')
    .select(PLAYER_FIELDS)
    .eq('discord_id', discordId)
    .single();

  if (error) return null;
  return data;
}

export async function getPlayerByDiscordUsername(db: SupabaseClient, discordUsername: string) {
  const { data, error } = await db
    .from('players')
    .select(PLAYER_FIELDS)
    .ilike('discord_username', discordUsername)
    .limit(2);

  if (error || !data || data.length !== 1) return null;
  return data[0];
}

export async function updatePlayerDiscordId(
  db: SupabaseClient,
  playerId: string,
  discordId: string
) {
  const { data, error } = await db
    .from('players')
    .update({ discord_id: discordId })
    .eq('id', playerId)
    .is('discord_id', null)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export async function updatePlayerIgnAndAlias(
  db: SupabaseClient,
  playerId: string,
  newIgn: string
) {
  const { error } = await db
    .from('players')
    .update({ ign: newIgn, display_alias: newIgn })
    .eq('id', playerId);

  if (error) throw error;
}
