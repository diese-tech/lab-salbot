// Audit F-01: sal-site recalculates standings on every admin-side match save
// (saveMatch -> recalculateAndPersistStandings), but completeMatch() here
// writes directly to Supabase and never triggers that. Rather than duplicate
// the standings algorithm in this repo (the exact "two divergent pipelines"
// problem the audit calls out separately as F-07 for stats), call back into
// sal-site's existing endpoint so standings stay single-sourced there.
//
// Best-effort: a failure here must not fail the match approval itself — the
// match result is already committed. Log clearly so it isn't silently stale;
// an admin can still press the manual "Recalculate standings" button.
export async function triggerStandingsRecalculation(): Promise<void> {
  const siteUrl = process.env.SAL_SITE_URL;
  const token = process.env.SAL_SITE_INTERNAL_TOKEN;

  if (!siteUrl || !token) {
    console.warn(
      '[standings-sync] SAL_SITE_URL / SAL_SITE_INTERNAL_TOKEN not configured — ' +
        'skipping standings recalculation. An admin must press "Recalculate standings" on the site.'
    );
    return;
  }

  try {
    const res = await fetch(new URL('/api/admin/recalculate-standings', siteUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(
        `[standings-sync] Recalculation request failed: ${res.status} ${res.statusText}. ` +
          'Standings may be stale until an admin recalculates manually.'
      );
    }
  } catch (err) {
    console.error(
      '[standings-sync] Could not reach the site to recalculate standings:',
      err,
      '- Standings may be stale until an admin recalculates manually.'
    );
  }
}
