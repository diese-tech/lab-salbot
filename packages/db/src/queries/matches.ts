import type { SupabaseClient } from '../client';

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

export async function setProofThread(
  db: SupabaseClient,
  matchId: string,
  threadId: string,
  threadUrl: string,
  screenshotExpected: number
) {
  const { error } = await db
    .from('matches')
    .update({
      proof_thread_id: threadId,
      proof_thread_url: threadUrl,
      screenshot_expected: screenshotExpected,
    })
    .eq('id', matchId);

  if (error) throw error;
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
