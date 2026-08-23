import type { SupabaseClient } from '../client';

// Removed when the roster-role tables ship in the next generated DB contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContractClient = any;
const client = (db: SupabaseClient): ContractClient => db as ContractClient;

export type CaptainRoleMapping = {
  division_id: string;
  discord_role_id: string;
  updated_by_discord_id: string;
};

export type OrganizationRoleMapping = {
  org_id: string;
  discord_role_id: string;
  updated_by_discord_id: string;
  org?: { id: string; name: string; tag: string };
};

export async function getCaptainRoleMapping(db: SupabaseClient, divisionId: string) {
  const { data, error } = await client(db).from('captain_role_mappings').select('*')
    .eq('division_id', divisionId).maybeSingle();
  if (error) throw error;
  return data as CaptainRoleMapping | null;
}

export async function listCaptainRoleMappings(db: SupabaseClient) {
  const { data, error } = await client(db).from('captain_role_mappings').select('*')
    .order('division_id', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CaptainRoleMapping[];
}

export async function upsertCaptainRoleMapping(
  db: SupabaseClient,
  params: { divisionId: string; discordRoleId: string; updatedByDiscordId: string },
) {
  const { error } = await client(db).from('captain_role_mappings').upsert({
    division_id: params.divisionId,
    discord_role_id: params.discordRoleId,
    updated_by_discord_id: params.updatedByDiscordId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'division_id' });
  if (error) throw error;
}

export async function getOrganizationRoleMapping(db: SupabaseClient, orgId: string) {
  const { data, error } = await client(db).from('organization_role_mappings').select('*')
    .eq('org_id', orgId).maybeSingle();
  if (error) throw error;
  return data as OrganizationRoleMapping | null;
}

export async function listOrganizationRoleMappings(db: SupabaseClient) {
  const { data, error } = await client(db).from('organization_role_mappings')
    .select('org_id,discord_role_id,updated_by_discord_id,org:orgs!inner(id,name,tag)')
    .order('org_id', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrganizationRoleMapping[];
}

export async function upsertOrganizationRoleMapping(
  db: SupabaseClient,
  params: { orgId: string; discordRoleId: string; updatedByDiscordId: string },
) {
  const { error } = await client(db).from('organization_role_mappings').upsert({
    org_id: params.orgId,
    discord_role_id: params.discordRoleId,
    updated_by_discord_id: params.updatedByDiscordId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function getOrganizationIdentity(db: SupabaseClient, orgId: string) {
  const { data, error } = await db.from('orgs').select('id,name,tag').eq('id', orgId).maybeSingle();
  if (error) throw error;
  return data;
}
