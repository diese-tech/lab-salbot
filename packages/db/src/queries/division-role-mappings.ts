import type { SupabaseClient } from '@supabase/supabase-js';

export type DivisionRoleMapping = {
  division_id: string;
  discord_role_id: string;
  updated_by_discord_id: string;
  created_at?: string;
  updated_at?: string;
};

const FIELDS = 'division_id, discord_role_id, updated_by_discord_id, created_at, updated_at';

export async function getDivisionRoleMapping(db: SupabaseClient, divisionId: string) {
  const { data, error } = await db
    .from('division_role_mappings')
    .select(FIELDS)
    .eq('division_id', divisionId)
    .single();

  if (error) return null;
  return data as DivisionRoleMapping;
}

export async function listDivisionRoleMappings(db: SupabaseClient) {
  const { data, error } = await db
    .from('division_role_mappings')
    .select(FIELDS)
    .order('division_id', { ascending: true });

  if (error) throw error;
  return (data ?? []) as DivisionRoleMapping[];
}

export async function upsertDivisionRoleMapping(
  db: SupabaseClient,
  params: {
    divisionId: string;
    discordRoleId: string;
    updatedByDiscordId: string;
  }
) {
  const { error } = await db
    .from('division_role_mappings')
    .upsert(
      {
        division_id: params.divisionId,
        discord_role_id: params.discordRoleId,
        updated_by_discord_id: params.updatedByDiscordId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'division_id' }
    );

  if (error) throw error;
}
