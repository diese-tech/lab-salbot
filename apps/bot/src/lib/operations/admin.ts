import type { SupabaseClient } from '@salbot/db';
import { isAdminUser } from '@salbot/db';
import { errorResult, success, type OperationResult } from './types';

export async function requireAdmin(
  db: SupabaseClient,
  discordId: string
): Promise<OperationResult<{ discordId: string }>> {
  const isAdmin = await isAdminUser(db, discordId);
  if (!isAdmin) return errorResult('Only admins can use this command.');
  return success({ discordId });
}
