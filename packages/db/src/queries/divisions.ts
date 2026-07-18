import type { SupabaseClient } from '../client';

export async function getDivisionById(db: SupabaseClient, divisionId: string) {
  const { data, error } = await db
    .from('divisions')
    .select('id, name')
    .eq('id', divisionId)
    .single();

  if (error) return null;
  return data;
}

export async function listDivisions(db: SupabaseClient) {
  const { data, error } = await db
    .from('divisions')
    .select('id, name')
    .order('id', { ascending: true });

  if (error) throw error;
  return data ?? [];
}
