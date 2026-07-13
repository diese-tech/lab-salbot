// Channel IDs come from env vars — explicit IDs are more reliable than name-based lookup.
// Set these per deployment in Railway / your hosting platform.

const RESULT_ENV: Record<string, string> = {
  solar: 'CHANNEL_RESULTS_SOLAR',
  lunar: 'CHANNEL_RESULTS_LUNAR',
  terra: 'CHANNEL_RESULTS_TERRA',
};

const RESCHEDULE_ENV: Record<string, string> = {
  solar: 'CHANNEL_RESCHEDULES_SOLAR',
  lunar: 'CHANNEL_RESCHEDULES_LUNAR',
  terra: 'CHANNEL_RESCHEDULES_TERRA',
};

export function getAdminReviewChannelId(): string {
  const id = process.env.CHANNEL_ADMIN_REVIEW;
  if (!id) throw new Error('CHANNEL_ADMIN_REVIEW env var is not set');
  return id;
}

export function getResultsChannelId(divisionId: string): string {
  const envName = RESULT_ENV[divisionId.toLowerCase()];
  const id = envName ? process.env[envName] : undefined;
  if (!id) throw new Error(`CHANNEL_RESULTS_${divisionId.toUpperCase()} env var is not set`);
  return id;
}

export function getReschedulesChannelId(divisionId: string): string {
  const envName = RESCHEDULE_ENV[divisionId.toLowerCase()];
  const id = envName ? process.env[envName] : undefined;
  if (!id) throw new Error(`CHANNEL_RESCHEDULES_${divisionId.toUpperCase()} env var is not set`);
  return id;
}
