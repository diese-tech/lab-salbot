import type { Guild, GuildMember } from 'discord.js';
import {
  getPlayerByDiscordUsername,
  type SupabaseClient,
  updatePlayerDiscordId,
} from '@salbot/db';
import { conflict, skipped, success, type OperationResult } from './types';

export type ResolvedIdentity = {
  discordUsername: string;
  member: GuildMember;
  player: {
    id: string;
    discord_username: string;
    discord_id: string | null;
    ign: string;
    display_alias: string | null;
    division_id: string | null;
  };
};

export async function resolveMemberByUsername(
  guild: Guild,
  discordUsername: string
): Promise<OperationResult<GuildMember>> {
  const normalized = normalizeDiscordUsername(discordUsername);
  if (!normalized) return conflict('Discord username is required.');

  const fetched = await guild.members.fetch({ query: normalized, limit: 10 });
  const exactMatches = [...fetched.values()].filter(
    (member) => normalizeDiscordUsername(member.user.username) === normalized
  );

  if (exactMatches.length === 0) {
    return conflict('Discord user was not found in this server.', { discordUsername });
  }

  if (exactMatches.length > 1) {
    return conflict('Discord username resolved to multiple server members.', { discordUsername });
  }

  return success(exactMatches[0]);
}

export async function resolvePlayerIdentity(
  db: SupabaseClient,
  guild: Guild,
  discordUsername: string
): Promise<OperationResult<ResolvedIdentity>> {
  const memberResult = await resolveMemberByUsername(guild, discordUsername);
  if (memberResult.status !== 'success') return memberResult;

  const player = await getPlayerByDiscordUsername(db, discordUsername);
  if (!player) {
    return conflict('Supabase player was not found by players.discord_username.', {
      discordUsername,
      discordId: memberResult.data.user.id,
    });
  }

  const playerDiscordId = player.discord_id as string | null;
  const resolvedDiscordId = memberResult.data.user.id;

  if (playerDiscordId && playerDiscordId !== resolvedDiscordId) {
    return conflict('Supabase player already has a different discord_id.', {
      playerId: player.id,
      discordUsername,
      existingDiscordId: playerDiscordId,
      resolvedDiscordId,
    });
  }

  return success({
    discordUsername,
    member: memberResult.data,
    player: player as ResolvedIdentity['player'],
  });
}

export async function linkDiscordIdIfEmpty(
  db: SupabaseClient,
  identity: ResolvedIdentity
): Promise<OperationResult<{ playerId: string; discordId: string }>> {
  const discordId = identity.member.user.id;

  if (identity.player.discord_id === discordId) {
    return skipped('Player already has the resolved discord_id.', {
      playerId: identity.player.id,
      discordId,
    });
  }

  if (identity.player.discord_id && identity.player.discord_id !== discordId) {
    return conflict('Supabase player already has a different discord_id.', {
      playerId: identity.player.id,
      existingDiscordId: identity.player.discord_id,
      resolvedDiscordId: discordId,
    });
  }

  const wasLinked = await updatePlayerDiscordId(db, identity.player.id, discordId);
  if (!wasLinked) {
    return conflict('Supabase player discord_id changed before apply. Run preview again.', {
      playerId: identity.player.id,
      resolvedDiscordId: discordId,
    });
  }

  return success({ playerId: identity.player.id, discordId });
}

function normalizeDiscordUsername(value: string) {
  return value.trim().toLowerCase();
}
