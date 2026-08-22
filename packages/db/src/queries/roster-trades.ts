import type { SupabaseClient } from '../client';

// This module is the temporary consumer binding for the unreleased roster-trade
// contract. Keep every ungenerated table/RPC access here so the cast disappears
// when the next immutable sal-database types are pinned.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContractClient = any;

export type RosterTradePlayer = {
  id: string;
  name: string;
  discordId: string | null;
};

export type RosterTradeOrganization = {
  id: string;
  name: string;
  tag: string;
  organizationRoleId: string | null;
  captainDiscordIds: string[];
  players: RosterTradePlayer[];
};

export type RosterTradeSetup = {
  seasonId: string;
  divisionId: string;
  tradesOpen: boolean;
  captainRoleId: string | null;
  organizations: RosterTradeOrganization[];
};

export type RosterTradeMovement = RosterTradePlayer & {
  fromOrgId: string;
  toOrgId: string;
};

export type RosterTrade = {
  id: string;
  source: string;
  seasonId: string;
  divisionId: string;
  status: string;
  currentRevision: number;
  proposerOrgId: string;
  receiverOrgId: string;
  pendingActionId: string;
  proposalChannelId: string | null;
  proposalMessageId: string | null;
  proposer: { id: string; name: string; tag: string };
  receiver: { id: string; name: string; tag: string };
  movements: RosterTradeMovement[];
};

export type RosterTradeMutationResult = {
  code: string;
  transactionId: string;
  revision: number;
  status: string;
  pendingActionId?: string;
  outboxIds?: string[];
};

function contract(db: SupabaseClient): ContractClient {
  return db as ContractClient;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid result.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Roster trade contract returned an invalid ${key}.`);
  }
  return value;
}

function mutationResult(value: unknown): RosterTradeMutationResult {
  const row = record(value, 'Roster trade RPC');
  const revision = Number(row.revision);
  return {
    code: stringValue(row, 'code'),
    transactionId: stringValue(row, 'transactionId'),
    revision: Number.isInteger(revision) ? revision : 0,
    status: stringValue(row, 'status'),
    ...(typeof row.pendingActionId === 'string' ? { pendingActionId: row.pendingActionId } : {}),
    ...(Array.isArray(row.outboxIds)
      ? { outboxIds: row.outboxIds.filter((item): item is string => typeof item === 'string') }
      : {}),
  };
}

export async function getRosterTradeSetup(
  db: SupabaseClient,
  divisionId: string,
): Promise<RosterTradeSetup | null> {
  const client = contract(db);
  const { data: season, error: seasonError } = await client
    .from('seasons')
    .select('id')
    .eq('is_current', true)
    .eq('status', 'active')
    .single();
  if (seasonError || !season) return null;

  const [{ data: settings, error: settingsError }, { data: captainMapping, error: captainError },
    { data: seasonOrgs, error: orgError }, { data: rosters, error: rosterError },
    { data: organizationRoles, error: organizationRolesError }] = await Promise.all([
    client.from('season_transaction_settings').select('trades_open')
      .eq('season_id', season.id).eq('division_id', divisionId).maybeSingle(),
    client.from('captain_role_mappings').select('discord_role_id')
      .eq('division_id', divisionId).maybeSingle(),
    client.from('season_orgs')
      .select('org_id, org:orgs!inner(id,name,tag)')
      .eq('season_id', season.id).eq('division_id', divisionId).eq('status', 'active'),
    client.from('season_rosters')
      .select('player_id,org_id,is_captain,player:players!inner(discord_id,ign,display_alias)')
      .eq('season_id', season.id).eq('division_id', divisionId).eq('roster_status', 'active'),
    client.from('organization_role_mappings').select('org_id,discord_role_id'),
  ]);
  if (settingsError || captainError || orgError || rosterError || organizationRolesError) {
    throw settingsError ?? captainError ?? orgError ?? rosterError ?? organizationRolesError;
  }

  const rosterRows = (rosters ?? []) as Array<Record<string, unknown>>;
  const roleByOrganization = new Map(
    ((organizationRoles ?? []) as Array<Record<string, unknown>>)
      .filter((row) => typeof row.org_id === 'string' && typeof row.discord_role_id === 'string')
      .map((row) => [String(row.org_id), String(row.discord_role_id)]),
  );
  const organizations = ((seasonOrgs ?? []) as Array<Record<string, unknown>>).map((row) => {
    const org = record(row.org, 'season organization');
    const orgId = stringValue(org, 'id');
    const members = rosterRows.filter((roster) => roster.org_id === orgId);
    return {
      id: orgId,
      name: stringValue(org, 'name'),
      tag: stringValue(org, 'tag'),
      organizationRoleId: roleByOrganization.get(orgId) ?? null,
      captainDiscordIds: members.flatMap((roster) => {
        if (!roster.is_captain) return [];
        const player = record(roster.player, 'captain player');
        return typeof player.discord_id === 'string' ? [player.discord_id] : [];
      }),
      players: members.map((roster) => {
        const player = record(roster.player, 'roster player');
        return {
          id: String(roster.player_id),
          name: typeof player.display_alias === 'string' && player.display_alias.length > 0
            ? player.display_alias : stringValue(player, 'ign'),
          discordId: typeof player.discord_id === 'string' ? player.discord_id : null,
        };
      }),
    };
  });

  return {
    seasonId: String(season.id),
    divisionId,
    tradesOpen: settings?.trades_open === true,
    captainRoleId: typeof captainMapping?.discord_role_id === 'string'
      ? captainMapping.discord_role_id : null,
    organizations,
  };
}

export async function createRosterTrade(
  db: SupabaseClient,
  params: {
    actorDiscordId: string;
    seasonId: string;
    divisionId: string;
    proposerOrgId: string;
    receiverOrgId: string;
    offeredPlayerIds: string[];
    requestedPlayerIds: string[];
    proposalChannelId: string;
    source?: string;
  },
): Promise<RosterTradeMutationResult> {
  const { data, error } = await contract(db).rpc('create_roster_trade', {
    p_actor_discord_id: params.actorDiscordId,
    p_season_id: params.seasonId,
    p_division_id: params.divisionId,
    p_proposer_org_id: params.proposerOrgId,
    p_receiver_org_id: params.receiverOrgId,
    p_offered_player_ids: params.offeredPlayerIds,
    p_requested_player_ids: params.requestedPlayerIds,
    p_proposal_channel_id: params.proposalChannelId,
    p_source: params.source ?? 'discord_workflow',
  });
  if (error) throw error;
  return mutationResult(data);
}

export async function counterRosterTrade(
  db: SupabaseClient,
  params: { transactionId: string; expectedRevision: number; actorDiscordId: string;
    offeredPlayerIds: string[]; requestedPlayerIds: string[] },
): Promise<RosterTradeMutationResult> {
  const { data, error } = await contract(db).rpc('counter_roster_trade', {
    p_transaction_id: params.transactionId,
    p_expected_revision: params.expectedRevision,
    p_actor_discord_id: params.actorDiscordId,
    p_offered_player_ids: params.offeredPlayerIds,
    p_requested_player_ids: params.requestedPlayerIds,
  });
  if (error) throw error;
  return mutationResult(data);
}

export async function acceptRosterTrade(
  db: SupabaseClient,
  params: { transactionId: string; expectedRevision: number; actorDiscordId: string },
): Promise<RosterTradeMutationResult> {
  const { data, error } = await contract(db).rpc('accept_roster_trade', {
    p_transaction_id: params.transactionId,
    p_expected_revision: params.expectedRevision,
    p_actor_discord_id: params.actorDiscordId,
  });
  if (error) throw error;
  return mutationResult(data);
}

export async function declineRosterTrade(
  db: SupabaseClient,
  params: { transactionId: string; expectedRevision: number; actorDiscordId: string },
): Promise<RosterTradeMutationResult> {
  const { data, error } = await contract(db).rpc('decline_roster_trade', {
    p_transaction_id: params.transactionId,
    p_expected_revision: params.expectedRevision,
    p_actor_discord_id: params.actorDiscordId,
  });
  if (error) throw error;
  return mutationResult(data);
}

export async function cancelRosterTrade(
  db: SupabaseClient,
  params: { transactionId: string; expectedRevision: number; actorDiscordId: string;
    mode: 'withdraw' | 'revoke' },
): Promise<RosterTradeMutationResult> {
  const { data, error } = await contract(db).rpc('cancel_roster_trade', {
    p_transaction_id: params.transactionId,
    p_expected_revision: params.expectedRevision,
    p_actor_discord_id: params.actorDiscordId,
    p_mode: params.mode,
  });
  if (error) throw error;
  return mutationResult(data);
}

export async function getRosterTrade(db: SupabaseClient, transactionId: string): Promise<RosterTrade | null> {
  const client = contract(db);
  const { data: trade, error } = await client.from('roster_transactions').select('*')
    .eq('id', transactionId).maybeSingle();
  if (error) throw error;
  if (!trade) return null;
  const [{ data: orgs, error: orgError }, { data: movements, error: movementError }] = await Promise.all([
    client.from('orgs').select('id,name,tag').in('id', [trade.proposer_org_id, trade.receiver_org_id]),
    client.from('roster_transaction_movements')
      .select('player_id,from_org_id,to_org_id,player:players!inner(ign,display_alias,discord_id)')
      .eq('transaction_id', transactionId).eq('revision', trade.current_revision),
  ]);
  if (orgError || movementError) throw orgError ?? movementError;
  const orgRows = (orgs ?? []) as Array<Record<string, unknown>>;
  const proposer = orgRows.find((row) => row.id === trade.proposer_org_id);
  const receiver = orgRows.find((row) => row.id === trade.receiver_org_id);
  if (!proposer || !receiver) throw new Error(`Roster trade ${transactionId} has missing organizations.`);
  const toOrg = (row: Record<string, unknown>) => ({
    id: stringValue(row, 'id'), name: stringValue(row, 'name'), tag: stringValue(row, 'tag'),
  });
  return {
    id: String(trade.id), source: String(trade.source), seasonId: String(trade.season_id),
    divisionId: String(trade.division_id), status: String(trade.status),
    currentRevision: Number(trade.current_revision), proposerOrgId: String(trade.proposer_org_id),
    receiverOrgId: String(trade.receiver_org_id), pendingActionId: String(trade.pending_action_id),
    proposalChannelId: typeof trade.proposal_channel_id === 'string' ? trade.proposal_channel_id : null,
    proposalMessageId: typeof trade.proposal_message_id === 'string' ? trade.proposal_message_id : null,
    proposer: toOrg(proposer), receiver: toOrg(receiver),
    movements: ((movements ?? []) as Array<Record<string, unknown>>).map((movement) => {
      const player = record(movement.player, 'trade movement player');
      return {
        id: String(movement.player_id),
        name: typeof player.display_alias === 'string' && player.display_alias.length > 0
          ? player.display_alias : stringValue(player, 'ign'),
        discordId: typeof player.discord_id === 'string' ? player.discord_id : null,
        fromOrgId: String(movement.from_org_id), toOrgId: String(movement.to_org_id),
      };
    }),
  };
}

export async function updateRosterTradeProposalMessage(
  db: SupabaseClient, transactionId: string, messageId: string,
): Promise<void> {
  const { error } = await contract(db).from('roster_transactions')
    .update({ proposal_message_id: messageId, updated_at: new Date().toISOString() })
    .eq('id', transactionId);
  if (error) throw error;
}

export async function updateRosterTradeAdminReviewMessage(
  db: SupabaseClient, pendingActionId: string, messageId: string,
): Promise<void> {
  const { error } = await contract(db).from('pending_actions')
    .update({ admin_review_message_id: messageId, updated_at: new Date().toISOString() })
    .eq('id', pendingActionId);
  if (error) throw error;
}

export type CanonicalOrganizationRoleState = {
  playerId: string;
  discordId: string | null;
  playerName: string;
  desiredOrganizationRoleId: string | null;
  knownOrganizationRoleIds: string[];
  orgId: string | null;
};

export async function getCanonicalOrganizationRoleStates(
  db: SupabaseClient, seasonId: string, playerIds: string[],
): Promise<CanonicalOrganizationRoleState[]> {
  const client = contract(db);
  const [{ data: mappings, error: mappingError }, { data: rosters, error: rosterError }] = await Promise.all([
    client.from('organization_role_mappings').select('org_id,discord_role_id'),
    client.from('season_rosters')
      .select('player_id,org_id,roster_status,player:players!inner(discord_id,ign,display_alias)')
      .eq('season_id', seasonId).in('player_id', playerIds),
  ]);
  if (mappingError || rosterError) throw mappingError ?? rosterError;
  const mappingRows = (mappings ?? []) as Array<Record<string, unknown>>;
  const roleByOrg = new Map(mappingRows.map((row) => [String(row.org_id), String(row.discord_role_id)]));
  const knownOrganizationRoleIds = [...roleByOrg.values()];
  return ((rosters ?? []) as Array<Record<string, unknown>>).map((roster) => {
    const player = record(roster.player, 'canonical roster player');
    const orgId = roster.roster_status === 'active' && typeof roster.org_id === 'string' ? roster.org_id : null;
    return {
      playerId: String(roster.player_id),
      discordId: typeof player.discord_id === 'string' ? player.discord_id : null,
      playerName: typeof player.display_alias === 'string' && player.display_alias.length > 0
        ? player.display_alias : stringValue(player, 'ign'),
      desiredOrganizationRoleId: orgId ? roleByOrg.get(orgId) ?? null : null,
      knownOrganizationRoleIds,
      orgId,
    };
  });
}
