// Inspired by lab-godforge's pattern of catching discord.Forbidden/NotFound
// specifically at every Discord API call site and turning it into a
// distinct, actionable message instead of a generic "something went wrong."
//
// UserFacingError: throw this when the message is already safe to show the
// user verbatim (validation failures, "not configured yet", etc.).
// toUserMessage: turns any caught error into a safe reply string. Always log
// the raw error separately for diagnosis — this only controls what the user sees.

import { DiscordAPIError } from 'discord.js';

export class UserFacingError extends Error {}

// Discord REST JSON error codes worth explaining specifically. Numeric
// rather than the RESTJSONErrorCodes enum to avoid an extra import — see
// https://discord.com/developers/docs/topics/opcodes-and-status-codes#json-error-codes
const DISCORD_ERROR_MESSAGES: Record<number, string> = {
  10003: "A configured channel no longer exists. Ask an admin to check the channel ID in the bot's environment variables.",
  50001: "I don't have access to a channel this command needs. Ask an admin to check my permissions on that channel.",
  50007: "I couldn't DM that user — they likely have server DMs disabled.",
  50013: "I'm missing a Discord permission this command needs (e.g. Manage Roles, Send Messages). Ask an admin to check my role and channel permissions.",
};

// PostgREST/Postgres unique_violation error code. Supabase's PostgrestError
// (and the raw pg error it wraps) surface this as a `code` string field.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const POSTGRES_UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

export function toUserMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;

  if (err instanceof DiscordAPIError) {
    const known = DISCORD_ERROR_MESSAGES[Number(err.code)];
    if (known) return known;
  }

  return 'An unexpected error occurred. Please try again or contact an admin.';
}
