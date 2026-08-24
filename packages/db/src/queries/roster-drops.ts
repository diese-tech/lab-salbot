import type { SupabaseClient } from "../client";

export type RosterDrop = {
  id: string;
  source: string;
  seasonId: string;
  divisionId: string;
  status: string;
  currentRevision: number;
  organization: { id: string; name: string; tag: string };
  player: { id: string; name: string; discordId: string | null };
  pendingActionId: string;
  eligibilityStatus: string | null;
  suspendedUntil: string | null;
};

export type RosterDropMutationResult = {
  code: string;
  transactionId: string;
  revision: number;
  status: string;
  pendingActionId: string;
  outboxIds: string[];
};

export async function createRosterDrop(
  db: SupabaseClient,
  params: {
    actorDiscordId: string;
    seasonId: string;
    divisionId: string;
    orgId: string;
    playerId: string;
    source?: string;
  },
): Promise<RosterDropMutationResult> {
  const { data, error } = await db.rpc("create_roster_drop", {
    p_actor_discord_id: params.actorDiscordId,
    p_season_id: params.seasonId,
    p_division_id: params.divisionId,
    p_org_id: params.orgId,
    p_player_id: params.playerId,
    p_source: params.source ?? "discord_workflow",
  });
  if (error) throw error;
  const row = record(data, "create_roster_drop");
  const revision = Number(row.revision);
  return {
    code: stringValue(row, "code"),
    transactionId: stringValue(row, "transactionId"),
    revision: Number.isInteger(revision) ? revision : 0,
    status: stringValue(row, "status"),
    pendingActionId: stringValue(row, "pendingActionId"),
    outboxIds: Array.isArray(row.outboxIds)
      ? row.outboxIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}

export async function getRosterDrop(
  db: SupabaseClient,
  transactionId: string,
): Promise<RosterDrop | null> {
  const { data: transaction, error } = await db
    .from("roster_transactions")
    .select("*")
    .eq("id", transactionId)
    .maybeSingle();
  if (error) throw error;
  if (
    !transaction ||
    transaction.transaction_type !== "drop" ||
    transaction.receiver_org_id !== null
  )
    return null;
  const [
    { data: org, error: orgError },
    { data: movement, error: movementError },
  ] = await Promise.all([
    db
      .from("orgs")
      .select("id,name,tag")
      .eq("id", transaction.proposer_org_id)
      .single(),
    db
      .from("roster_transaction_movements")
      .select("player_id,player:players!inner(ign,display_alias,discord_id)")
      .eq("transaction_id", transactionId)
      .eq("revision", transaction.current_revision)
      .single(),
  ]);
  if (orgError || movementError || !org || !movement)
    throw (
      orgError ?? movementError ?? new Error("Drop projection is incomplete.")
    );
  const player = record(movement.player, "roster drop player");
  return {
    id: transaction.id,
    source: transaction.source,
    seasonId: transaction.season_id,
    divisionId: transaction.division_id,
    status: transaction.status,
    currentRevision: transaction.current_revision,
    organization: { id: org.id, name: org.name, tag: org.tag },
    player: {
      id: movement.player_id,
      name:
        typeof player.display_alias === "string" &&
        player.display_alias.length > 0
          ? player.display_alias
          : stringValue(player, "ign"),
      discordId:
        typeof player.discord_id === "string" ? player.discord_id : null,
    },
    pendingActionId: transaction.pending_action_id,
    eligibilityStatus: transaction.drop_eligibility_status,
    suspendedUntil: transaction.drop_suspended_until,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid result.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Roster drop contract returned an invalid ${key}.`);
  }
  return value;
}
