// Channel IDs come from env vars — explicit IDs are more reliable than name-based lookup.
// Set these per deployment in Railway / your hosting platform.

import { UserFacingError } from './errors';

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

// Flat list of every channel env var, for startup validation (see lib/config.ts).
// Built from the maps above so the var names never drift out of sync.
export const CHANNEL_ENV_VARS: { envVar: string; description: string }[] = [
  { envVar: 'CHANNEL_ADMIN_REVIEW', description: 'admin review notifications' },
  ...Object.entries(RESULT_ENV).map(([division, envVar]) => ({
    envVar,
    description: `the ${division} results channel`,
  })),
  ...Object.entries(RESCHEDULE_ENV).map(([division, envVar]) => ({
    envVar,
    description: `the ${division} reschedules channel`,
  })),
];

export function getAdminReviewChannelId(): string {
  const id = process.env.CHANNEL_ADMIN_REVIEW;
  if (!id) throw new UserFacingError('The admin review channel is not configured (CHANNEL_ADMIN_REVIEW). Ask an admin to check the bot deployment.');
  return id;
}

export function getResultsChannelId(divisionId: string): string {
  const envName = RESULT_ENV[divisionId.toLowerCase()];
  const id = envName ? process.env[envName] : undefined;
  if (!id) throw new UserFacingError(`The results channel for "${divisionId}" is not configured (CHANNEL_RESULTS_${divisionId.toUpperCase()}). Ask an admin to check the bot deployment.`);
  return id;
}

export function getReschedulesChannelId(divisionId: string): string {
  const envName = RESCHEDULE_ENV[divisionId.toLowerCase()];
  const id = envName ? process.env[envName] : undefined;
  if (!id) throw new UserFacingError(`The reschedules channel for "${divisionId}" is not configured (CHANNEL_RESCHEDULES_${divisionId.toUpperCase()}). Ask an admin to check the bot deployment.`);
  return id;
}
