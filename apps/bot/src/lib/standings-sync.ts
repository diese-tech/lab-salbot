// sal-site owns the canonical standings calculation. Durable outbox delivery
// uses the throwing request function so a transient failure is retried. The
// legacy best-effort wrapper remains for callers that cannot retry.
const REQUEST_TIMEOUT_MS = 5000;

export async function requestStandingsRecalculation(idempotencyKey?: string): Promise<void> {
  const siteUrl = process.env.SAL_SITE_URL;
  const token = process.env.SAL_SITE_INTERNAL_TOKEN;

  if (!siteUrl || !token) {
    throw new Error('SAL_SITE_URL / SAL_SITE_INTERNAL_TOKEN are not configured');
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const response = await fetch(new URL('/api/admin/recalculate-standings', siteUrl), {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Standings recalculation failed: ${response.status} ${response.statusText}`);
  }
}

export async function triggerStandingsRecalculation(): Promise<void> {
  if (!process.env.SAL_SITE_URL || !process.env.SAL_SITE_INTERNAL_TOKEN) {
    console.warn(
      '[standings-sync] SAL_SITE_URL / SAL_SITE_INTERNAL_TOKEN not configured - ' +
        'skipping standings recalculation. An admin must press "Recalculate standings" on the site.',
    );
    return;
  }

  try {
    await requestStandingsRecalculation();
  } catch (error) {
    console.error(
      '[standings-sync] Could not recalculate standings:',
      error,
      '- Standings may be stale until an admin recalculates manually.',
    );
  }
}
