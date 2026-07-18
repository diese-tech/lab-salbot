import type { SupabaseClient } from '../client';

const PLAYER_FIELDS = 'id, discord_username, discord_id, ign, display_alias, org_id, is_captain, division_id';
const CURRENT_CAPTAIN_FIELDS = `
  season_id, org_id, division_id, is_captain,
  player:players!inner(id, discord_username, discord_id, ign, display_alias),
  season:seasons!inner(id, is_current)
`;

export async function getCaptainByDiscordId(db: SupabaseClient, discordId: string) {
  const { data, error } = await db
    .from('season_rosters')
    .select(CURRENT_CAPTAIN_FIELDS)
    .eq('is_captain', true)
    .eq('roster_status', 'active')
    .eq('season.is_current', true)
    .eq('player.discord_id', discordId)
    .single();

  if (error) return null;
  const row = data as unknown as {
    season_id: string;
    org_id: string;
    division_id: string;
    is_captain: boolean;
    player: {
      id: string;
      discord_username: string;
      discord_id: string;
      ign: string;
      display_alias: string | null;
    };
  };
  return {
    ...row.player,
    season_id: row.season_id,
    org_id: row.org_id,
    division_id: row.division_id,
    is_captain: row.is_captain,
  };
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
