import type { SupabaseClient } from '../client';
import { parseDatabaseJsonObject } from '../json';

function extractNumber(
  json: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  if (!json) return null;
  const v = json[key];
  return typeof v === 'number' ? v : null;
}

function extractString(
  json: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!json) return null;
  const v = json[key];
  return typeof v === 'string' ? v : null;
}

export async function getPendingStatRecord(db: SupabaseClient, id: string) {
  const { data, error } = await db
    .from('pending_stat_records')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  const row = data as unknown as {
    id: string;
    match_id: string;
    player_id: string | null;
    screenshot_url: string;
    extracted_json: unknown;
    stats_json: unknown;
    confidence: number;
    source: string;
    status: string;
    reviewed_by_discord_id: string | null;
    reviewed_at: string | null;
    correction_note: string | null;
    created_at: string;
    updated_at: string;
  };
  return {
    ...row,
    extracted_json: parseDatabaseJsonObject(row.extracted_json, 'extracted_json'),
    stats_json: row.stats_json === null
      ? null
      : parseDatabaseJsonObject(row.stats_json, 'stats_json'),
  };
}

/**
 * Approve a pending stat record:
 * - Resolves game_number, won, and damage_mitigated from stats_json / extracted_json.
 * - Upserts into player_stats on (match_id, player_id, game_number) — idempotent.
 * - Marks pending_stat_records row as approved.
 * - Resyncs players.stats JSONB aggregate.
 *
 * won is derived from match.winner_org_id vs the player's org at match time.
 * stats_json.org_id takes precedence over players.org_id to handle transfers correctly.
 */
export async function approvePendingStatRecord(
  db: SupabaseClient,
  pendingStatRecordId: string,
  adminDiscordId: string
): Promise<void> {
  const { data: raw, error: recordErr } = await db
    .from('pending_stat_records')
    .select('id, match_id, player_id, stats_json, extracted_json, status')
    .eq('id', pendingStatRecordId)
    .single();

  if (recordErr || !raw) throw new Error(`Pending stat record ${pendingStatRecordId} not found`);

  const recordRow = raw as unknown as {
    id: string;
    match_id: string;
    player_id: string;
    stats_json: unknown;
    extracted_json: unknown;
    status: string;
  };
  const record = {
    ...recordRow,
    stats_json: recordRow.stats_json === null
      ? null
      : parseDatabaseJsonObject(recordRow.stats_json, 'stats_json'),
    extracted_json: parseDatabaseJsonObject(
      recordRow.extracted_json,
      'extracted_json',
    ),
  };

  if (record.status !== 'pending') {
    throw new Error(`Stat record ${pendingStatRecordId} is already ${record.status}`);
  }

  const stats = record.stats_json ?? record.extracted_json;

  // game_number is required — ForgeLens or the admin must supply it in stats_json.
  const gameNumber =
    extractNumber(record.stats_json, 'game_number') ??
    extractNumber(record.extracted_json, 'game_number');
  if (!gameNumber) {
    throw new Error(`game_number missing from stats for record ${pendingStatRecordId}`);
  }

  const { data: matchRaw, error: matchErr } = await db
    .from('matches')
    .select('winner_org_id')
    .eq('id', record.match_id)
    .single();

  if (matchErr || !matchRaw) throw new Error(`Match ${record.match_id} not found`);
  const winnerOrgId = (matchRaw as { winner_org_id: string | null }).winner_org_id;

  // Prefer stats_json.org_id (captured by ForgeLens at screenshot time) so transfers
  // don't retroactively flip the won flag.
  const statsOrgId = extractString(record.stats_json, 'org_id');
  let playerOrgId: string | null = statsOrgId;

  if (!playerOrgId) {
    const { data: playerRaw } = await db
      .from('players')
      .select('org_id')
      .eq('id', record.player_id)
      .single();
    playerOrgId = playerRaw ? (playerRaw as { org_id: string | null }).org_id : null;
  }

  const won = winnerOrgId != null && playerOrgId != null && playerOrgId === winnerOrgId;

  const { error: upsertErr } = await db
    .from('player_stats')
    .upsert(
      {
        match_id: record.match_id,
        player_id: record.player_id,
        pending_stat_record_id: record.id,
        game_number: gameNumber,
        won,
        kills: extractNumber(stats, 'kills'),
        deaths: extractNumber(stats, 'deaths'),
        assists: extractNumber(stats, 'assists'),
        damage_dealt: extractNumber(stats, 'damage_dealt'),
        damage_mitigated: extractNumber(stats, 'damage_mitigated'),
        healing_done: extractNumber(stats, 'healing_done'),
        god_played: extractString(stats, 'god_played') ?? extractString(stats, 'godPlayed'),
        role: extractString(stats, 'role'),
      },
      { onConflict: 'match_id,player_id,game_number' }
    );

  if (upsertErr) throw upsertErr;

  const { error: approveErr } = await db
    .from('pending_stat_records')
    .update({
      status: 'approved',
      reviewed_by_discord_id: adminDiscordId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingStatRecordId);

  if (approveErr) throw approveErr;

  await syncPlayerStatsJson(db, record.player_id);
}

export async function rejectPendingStatRecord(
  db: SupabaseClient,
  pendingStatRecordId: string,
  adminDiscordId: string,
  note: string
): Promise<void> {
  const { error } = await db
    .from('pending_stat_records')
    .update({
      status: 'rejected',
      reviewed_by_discord_id: adminDiscordId,
      reviewed_at: new Date().toISOString(),
      correction_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingStatRecordId)
    .eq('status', 'pending');

  if (error) throw error;
}

/**
 * Recompute players.stats JSONB from the full player_stats history for a player.
 * Called after every stat approval to keep the player card aggregate current.
 */
export async function syncPlayerStatsJson(db: SupabaseClient, playerId: string): Promise<void> {
  const { data, error } = await db
    .from('player_stats')
    .select('kills, deaths, assists, won')
    .eq('player_id', playerId);

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    won: boolean | null;
  }>;

  const stats = {
    kills: rows.reduce((s, r) => s + (r.kills ?? 0), 0),
    deaths: rows.reduce((s, r) => s + (r.deaths ?? 0), 0),
    assists: rows.reduce((s, r) => s + (r.assists ?? 0), 0),
    gamesPlayed: rows.length,
    wins: rows.filter((r) => r.won === true).length,
  };

  const { error: updateErr } = await db
    .from('players')
    .update({ stats })
    .eq('id', playerId);

  if (updateErr) throw updateErr;
}
