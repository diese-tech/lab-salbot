import type { SupabaseClient } from '../client';
import { writeAuditLog } from './audit-logs';

const MATCH_FIELDS = `
  id, week, scheduled_date, scheduled_time, status,
  home_org_id, away_org_id, home_score, away_score,
  winner_org_id, score, proof_thread_id, proof_thread_url,
  screenshot_count, screenshot_expected, division_id,
  home_org:orgs!home_org_id(id, name, tag),
  away_org:orgs!away_org_id(id, name, tag),
  division:divisions(id, name)
`;

export async function getEligibleMatchesForCaptain(
  db: SupabaseClient,
  orgId: string,
  seasonId: string
) {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await db
    .from('matches')
    .select(MATCH_FIELDS)
    .or(`home_org_id.eq.${orgId},away_org_id.eq.${orgId}`)
    .eq('season_id', seasonId)
    .eq('status', 'scheduled')
    .is('archived_at', null)
    .gte('scheduled_date', today)
    .order('scheduled_date')
    .order('scheduled_time');

  if (error) return [];
  return data ?? [];
}

export async function getEligibleMatchesForOperator(db: SupabaseClient) {
  const { data: season, error: seasonError } = await db
    .from('seasons')
    .select('id')
    .eq('is_current', true)
    .single();
  if (seasonError || !season) return [];

  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await db
    .from('matches')
    .select(MATCH_FIELDS)
    .eq('season_id', season.id)
    .eq('status', 'scheduled')
    .is('archived_at', null)
    .gte('scheduled_date', today)
    .order('scheduled_date')
    .order('scheduled_time')
    .limit(25);

  if (error) return [];
  return data ?? [];
}

export async function getMatchById(db: SupabaseClient, matchId: string) {
  const { data, error } = await db
    .from('matches')
    .select(MATCH_FIELDS)
    .eq('id', matchId)
    .single();

  if (error) return null;
  return data;
}

// Atomic status guard — only succeeds if the match is still 'scheduled'. Returns
// false (does not throw) if a second approval of a duplicate submission, or an
// approval landing after an admin corrected the score on the site, would
// otherwise silently overwrite the official result.
export async function completeMatch(
  db: SupabaseClient,
  matchId: string,
  params: {
    winnerOrgId: string;
    homeScore: number;
    awayScore: number;
    score: string;
  }
): Promise<boolean> {
  const { data, error } = await db
    .from('matches')
    .update({
      status: 'completed',
      winner_org_id: params.winnerOrgId,
      home_score: params.homeScore,
      away_score: params.awayScore,
      score: params.score,
    })
    .eq('id', matchId)
    .eq('status', 'scheduled')
    .select('id');

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// Atomic status guard — only succeeds if the match is still 'scheduled'. See
// completeMatch above for why this precondition matters.
export async function rescheduleMatch(
  db: SupabaseClient,
  matchId: string,
  params: { newDate: string; newTime: string }
): Promise<boolean> {
  const { data, error } = await db
    .from('matches')
    .update({
      scheduled_date: params.newDate,
      scheduled_time: params.newTime,
    })
    .eq('id', matchId)
    .eq('status', 'scheduled')
    .select('id');

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Attach a proof thread to a match.
 *
 * This writes to `matches`, so per AGENTS.md "No Silent Mutations" it records
 * an `audit_logs` entry with the actor and the old/new values. Both the first
 * attachment and the crash-recovery re-attachment run through here, so the
 * history reads the same either way.
 *
 * `actorDiscordId` is the operator whose `/report-result` submission caused the
 * thread to exist — a real Discord identity, never a synthetic one.
 */
export async function setProofThread(
  db: SupabaseClient,
  matchId: string,
  threadId: string,
  threadUrl: string,
  screenshotExpected: number,
  actorDiscordId: string
) {
  const { data: previous, error: readError } = await db
    .from('matches')
    .select('proof_thread_id, proof_thread_url, screenshot_expected')
    .eq('id', matchId)
    .single();

  if (readError) throw readError;

  const nextValue = {
    proof_thread_id: threadId,
    proof_thread_url: threadUrl,
    screenshot_expected: screenshotExpected,
  };

  const { error } = await db
    .from('matches')
    .update(nextValue)
    .eq('id', matchId);

  if (error) throw error;

  const previousRow = previous as unknown as {
    proof_thread_id: string | null;
    proof_thread_url: string | null;
    screenshot_expected: number | null;
  };

  await writeAuditLog(db, {
    actionType: 'proof_thread_recorded',
    entityType: 'match',
    entityId: matchId,
    actorDiscordId,
    oldValueJson: {
      proof_thread_id: previousRow.proof_thread_id,
      proof_thread_url: previousRow.proof_thread_url,
      screenshot_expected: previousRow.screenshot_expected,
    },
    newValueJson: nextValue,
  });
}

export async function incrementScreenshotCount(db: SupabaseClient, matchId: string) {
  // This RPC predates the shared database baseline. Keep the compatibility call
  // isolated until the atomic approval migration replaces this legacy helper.
  const legacyRpc = db.rpc as unknown as (
    fn: string,
    args: { match_id: string }
  ) => Promise<{ error: unknown }>;
  const { error } = await legacyRpc('increment_screenshot_count', { match_id: matchId });
  if (error) {
    // Fallback: manual increment if RPC not available
    const { data: match } = await db
      .from('matches')
      .select('screenshot_count')
      .eq('id', matchId)
      .single();
    if (match) {
      await db
        .from('matches')
        .update({ screenshot_count: (match.screenshot_count ?? 0) + 1 })
        .eq('id', matchId);
    }
  }
}
