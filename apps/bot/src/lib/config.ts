import { CHANNEL_ENV_VARS } from './channels';
import { validateCommandAccessEnv } from './command-access';

const REQUIRED_ENV = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SAL_OPERATOR_ROLE_IDS',
  'SAL_ADMIN_ROLE_IDS',
] as const;

export function validateRequiredEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  validateCommandAccessEnv();
}

export function requiredEnvNames() {
  return [...REQUIRED_ENV];
}

// Channel env vars are checked lazily at first use (see lib/channels.ts),
// so a partially configured bot can still serve the divisions that ARE
// configured. This just surfaces the misconfiguration at boot — as a warning,
// not a crash — instead of leaving it to be discovered mid-workflow.
export function warnOnMissingChannelEnv() {
  const missing = CHANNEL_ENV_VARS.filter(({ envVar }) => !process.env[envVar]);
  for (const { envVar, description } of missing) {
    console.warn(`[bot] WARNING: ${envVar} is not set — ${description} will fail until configured.`);
  }
  return missing.map((m) => m.envVar);
}
