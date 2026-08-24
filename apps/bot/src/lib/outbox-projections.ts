import { EmbedBuilder, type Client, type Message } from "discord.js";
import {
  getMatchById,
  getCanonicalTeamRoleStates,
  getPendingAction,
  getRosterDrop,
  getRosterTrade,
  updateRosterTradeAdminReviewMessage,
  updateRosterTradeProposalMessage,
  type OperationOutboxRow,
  type SupabaseClient,
} from "@salbot/db";
import {
  getAdminReviewChannelId,
  getResultsChannelId,
  getReschedulesChannelId,
  getTransactionsChannelId,
} from "./channels";
import {
  applyApprovedStatus,
  applyCancelledStatus,
  applyDeniedStatus,
  applyNeedsInfoStatus,
} from "./embeds";
import { removeActiveProofThread } from "./proof-thread";
import { requestStandingsRecalculation } from "./standings-sync";
import { buildApprovalButtons } from "./embeds";
import {
  buildCompletedTradeLine,
  buildTradeAdminEmbed,
  buildTradeProposalButtons,
  buildTradeProposalEmbed,
  tradeOperationMarker,
  tradeProposalMarker,
} from "./trade-rendering";
import {
  buildCompletedDropLine,
  buildDropAdminEmbed,
  buildDropApprovalButtons,
} from "./drop-rendering";

type DecisionStatus = "approved" | "denied" | "pending_info" | "cancelled";

export function projectionMarker(outboxId: string): string {
  return `sal-outbox:${outboxId}`;
}

function messageHasProjection(message: Message, outboxId: string): boolean {
  const marker = projectionMarker(outboxId);
  return (
    message.content.includes(marker) ||
    message.embeds.some((embed) => embed.footer?.text?.includes(marker))
  );
}

export function createOutboxProjector(client: Client, db: SupabaseClient) {
  return async (row: OperationOutboxRow): Promise<string | undefined> => {
    switch (row.topic) {
      case "discord_review_projection":
        return projectReview(client, db, row);
      case "discord_receipt_projection":
        return projectReceipt(client, db, row);
      case "discord_captain_notification":
      case "discord_requester_notification":
        return projectDirectMessage(client, row);
      case "proof_thread_closure":
        return projectProofThreadClosure(client, row);
      case "standings_recalculation":
        await requestStandingsRecalculation(
          optionalString(row.payload.outboxIdempotencyKey) ?? undefined,
        );
        return row.aggregate_id;
      case "discord_trade_proposal_projection":
        return projectTradeProposal(client, db, row);
      case "discord_trade_admin_review":
        return projectTradeAdminReview(client, db, row);
      case "discord_roster_drop_admin_review":
        return projectDropAdminReview(client, db, row);
      case "discord_transaction_bulletin":
        return projectTransactionBulletin(client, db, row);
      case "discord_organization_role_reconciliation":
        return projectOrganizationRoleReconciliation(client, db, row);
      default:
        throw new Error(`Unsupported operation outbox topic: ${row.topic}`);
    }
  };
}

async function projectDropAdminReview(
  client: Client,
  db: SupabaseClient,
  row: OperationOutboxRow,
): Promise<string> {
  const drop = await getRosterDrop(db, row.aggregate_id);
  if (!drop) throw new Error(`Roster drop ${row.aggregate_id} not found`);
  const action = await getPendingAction(db, drop.pendingActionId);
  if (!action)
    throw new Error(`Pending action ${drop.pendingActionId} not found`);
  const channel = await client.channels.fetch(getAdminReviewChannelId());
  if (
    !channel?.isTextBased() ||
    !("messages" in channel) ||
    !("send" in channel)
  ) {
    throw new Error("Admin review channel is not text based");
  }
  let message = action.admin_review_message_id
    ? await channel.messages
        .fetch(action.admin_review_message_id)
        .catch(() => undefined)
    : undefined;
  const marker = `sal-drop-review:${drop.pendingActionId}`;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 100 });
    message = recent.find((candidate) => messageHasMarker(candidate, marker));
  }
  const payload = {
    embeds: [buildDropAdminEmbed(drop)],
    components: [buildDropApprovalButtons(drop.pendingActionId)],
  };
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  if (!message)
    throw new Error(
      `Drop review ${drop.pendingActionId} did not produce a Discord message`,
    );
  if (action.admin_review_message_id !== message.id) {
    await updateRosterTradeAdminReviewMessage(
      db,
      drop.pendingActionId,
      message.id,
    );
  }
  return message.id;
}

async function projectTradeProposal(
  client: Client,
  db: SupabaseClient,
  row: OperationOutboxRow,
): Promise<string> {
  const trade = await getRosterTrade(db, row.aggregate_id);
  if (!trade) throw new Error(`Roster trade ${row.aggregate_id} not found`);
  const channelId = requiredString(row.payload.channelId, "channelId");
  const channel = await client.channels.fetch(channelId);
  if (
    !channel?.isTextBased() ||
    !("messages" in channel) ||
    !("send" in channel)
  ) {
    throw new Error(`Trade proposal channel ${channelId} is not text based`);
  }
  let message = trade.proposalMessageId
    ? await channel.messages
        .fetch(trade.proposalMessageId)
        .catch(() => undefined)
    : undefined;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 100 });
    message = recent.find((candidate) =>
      messageHasMarker(candidate, tradeProposalMarker(trade.id)),
    );
  }
  const payload = {
    embeds: [buildTradeProposalEmbed(trade)],
    components: buildTradeProposalButtons(trade),
  };
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  if (!message)
    throw new Error(
      `Trade proposal ${trade.id} did not produce a Discord message`,
    );
  if (trade.proposalMessageId !== message.id) {
    await updateRosterTradeProposalMessage(db, trade.id, message.id);
  }
  return message.id;
}

async function projectTradeAdminReview(
  client: Client,
  db: SupabaseClient,
  row: OperationOutboxRow,
): Promise<string> {
  const trade = await getRosterTrade(db, row.aggregate_id);
  if (!trade) throw new Error(`Roster trade ${row.aggregate_id} not found`);
  const action = await getPendingAction(db, trade.pendingActionId);
  if (!action)
    throw new Error(`Pending action ${trade.pendingActionId} not found`);
  const channel = await client.channels.fetch(getAdminReviewChannelId());
  if (
    !channel?.isTextBased() ||
    !("messages" in channel) ||
    !("send" in channel)
  ) {
    throw new Error("Admin review channel is not text based");
  }
  let message = action.admin_review_message_id
    ? await channel.messages
        .fetch(action.admin_review_message_id)
        .catch(() => undefined)
    : undefined;
  const marker = `sal-trade-review:${trade.pendingActionId}`;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 100 });
    message = recent.find((candidate) => messageHasMarker(candidate, marker));
  }
  const payload = {
    embeds: [buildTradeAdminEmbed(trade)],
    components: [buildApprovalButtons(trade.pendingActionId)],
  };
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  if (!message)
    throw new Error(
      `Trade review ${trade.pendingActionId} did not produce a Discord message`,
    );
  if (action.admin_review_message_id !== message.id) {
    await updateRosterTradeAdminReviewMessage(
      db,
      trade.pendingActionId,
      message.id,
    );
  }
  return message.id;
}

async function projectTransactionBulletin(
  client: Client,
  db: SupabaseClient,
  row: OperationOutboxRow,
): Promise<string> {
  const trade = await getRosterTrade(db, row.aggregate_id);
  const drop = trade ? null : await getRosterDrop(db, row.aggregate_id);
  if (
    (!trade || trade.status !== "completed") &&
    (!drop || drop.status !== "completed")
  ) {
    throw new Error(
      `Completed roster transaction ${row.aggregate_id} not found`,
    );
  }
  const channel = await client.channels.fetch(getTransactionsChannelId());
  if (
    !channel?.isTextBased() ||
    !("messages" in channel) ||
    !("send" in channel)
  ) {
    throw new Error("Transactions channel is not text based");
  }
  const transactionId = trade?.id ?? drop!.id;
  const marker = tradeOperationMarker(transactionId);
  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = recent.find((candidate) =>
    messageHasMarker(candidate, marker),
  );
  if (existing) return existing.id;
  const line = trade
    ? buildCompletedTradeLine({
        divisionId: trade.divisionId,
        proposerOrgId: trade.proposerOrgId,
        receiverOrgId: trade.receiverOrgId,
        proposerTag: trade.proposer.tag,
        receiverTag: trade.receiver.tag,
        movements: trade.movements.map((movement) => ({
          playerName: movement.name,
          fromOrgId: movement.fromOrgId,
          toOrgId: movement.toOrgId,
        })),
      })
    : buildCompletedDropLine(drop!);
  try {
    const message = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setDescription(line)
          .setFooter({ text: marker })
          .setTimestamp(),
      ],
    });
    return message.id;
  } catch (error) {
    let alertFailure = "";
    try {
      await postPrivateAlert(client, {
        marker: `sal-delivery-alert:${row.id}`,
        title: "Transaction bulletin delivery needs reconciliation",
        description: `Transaction: ${transactionId}\nTarget: CHANNEL_TRANSACTIONS\nStable marker: ${marker}\nLatest error: ${errorText(error)}\nRetry status: paused for durable reconciliation`,
      });
    } catch (alertError) {
      // The uncertain public send must still leave the automatic retry loop
      // even when the secondary admin alert cannot be delivered.
      alertFailure = ` Admin alert also failed: ${errorText(alertError)}`;
    }
    throw new AmbiguousDiscordDeliveryError(
      `Ambiguous transaction bulletin delivery for ${transactionId}: ${errorText(error)}.${alertFailure}`,
    );
  }
}

async function projectOrganizationRoleReconciliation(
  client: Client,
  db: SupabaseClient,
  row: OperationOutboxRow,
): Promise<string> {
  const seasonId = requiredString(row.payload.seasonId, "seasonId");
  const divisionId = requiredString(row.payload.divisionId, "divisionId");
  const playerIds = requiredStringArray(row.payload.playerIds, "playerIds");
  const guildId = requiredEnvironment("DISCORD_GUILD_ID");
  const guild = await client.guilds.fetch(guildId);
  const states = await getCanonicalTeamRoleStates(
    db,
    seasonId,
    divisionId,
    playerIds,
  );
  const failures: string[] = [];
  for (const state of states) {
    try {
      if (!state.discordId)
        throw new Error("Player has no linked Discord member ID.");
      const member = await guild.members.fetch(state.discordId);
      if (state.orgId && !state.desiredTeamRoleId) {
        throw new Error("Canonical season-team role mapping is missing.");
      }
      const removals = state.knownDivisionTeamRoleIds.filter(
        (roleId) =>
          roleId !== state.desiredTeamRoleId && member.roles.cache.has(roleId),
      );
      if (removals.length > 0) {
        await member.roles.remove(
          removals,
          `Canonical roster reconciliation for ${row.aggregate_id}`,
        );
      }
      if (
        state.desiredTeamRoleId &&
        !member.roles.cache.has(state.desiredTeamRoleId)
      ) {
        await member.roles.add(
          state.desiredTeamRoleId,
          `Canonical roster reconciliation for ${row.aggregate_id}`,
        );
      }
    } catch (error) {
      const failedOperation = errorText(error);
      failures.push(`${state.playerId}: ${failedOperation}`);
      await postPrivateAlert(client, {
        marker: `sal-role-alert:${row.id}:${state.playerId}`,
        title: "Organization role reconciliation failed",
        description: [
          `Transaction: ${row.aggregate_id}`,
          `Player/member: ${state.playerName} / ${state.discordId ?? "unlinked"}`,
          `Intended season team/role: ${seasonId}/${divisionId}/${state.orgId ?? "none"} / ${state.desiredTeamRoleId ?? "none"}`,
          `Failed operation: canonical role reconciliation`,
          `Latest error: ${failedOperation}`,
          `Retry status: ${row.attempts >= 10 ? "manual intervention required (retry limit reached)" : "automatic retry pending"}`,
        ].join("\n"),
      });
    }
  }
  if (states.length !== playerIds.length)
    failures.push("One or more canonical roster rows were missing.");
  if (failures.length > 0)
    throw new Error(
      `Organization role reconciliation incomplete: ${failures.join("; ")}`,
    );
  return row.aggregate_id;
}

async function postPrivateAlert(
  client: Client,
  input: { marker: string; title: string; description: string },
): Promise<string> {
  const channel = await client.channels.fetch(getAdminReviewChannelId());
  if (
    !channel?.isTextBased() ||
    !("messages" in channel) ||
    !("send" in channel)
  )
    throw new Error("Admin review channel is not text based");
  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = recent.find((message) =>
    messageHasMarker(message, input.marker),
  );
  const payload = {
    embeds: [
      new EmbedBuilder()
        .setTitle(input.title)
        .setDescription(input.description)
        .setFooter({ text: input.marker })
        .setTimestamp(),
    ],
  };
  if (existing) {
    await existing.edit(payload);
    return existing.id;
  }
  return (await channel.send(payload)).id;
}

function messageHasMarker(message: Message, marker: string): boolean {
  return (
    message.content.includes(marker) ||
    message.embeds.some((embed) => embed.footer?.text?.includes(marker))
  );
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error(`Outbox payload ${label} must be a non-empty string array`);
  }
  return value as string[];
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AmbiguousDiscordDeliveryError extends Error {
  readonly needsReconciliation = true;
}

async function projectReview(
  client: Client,
  db: SupabaseClient,
  row: OperationOutboxRow,
): Promise<string> {
  if (row.aggregate_type === "pending_stat_record") {
    // Legacy stat review records have no Discord message reference. The
    // decision RPC is still authoritative; there is no safe projection target
    // to edit until a future schema stores one.
    return `pending-stat-record:${row.aggregate_id}:no-message-target`;
  }
  if (row.aggregate_type !== "pending_action") {
    throw new Error(`Unsupported review aggregate: ${row.aggregate_type}`);
  }

  const action = await getPendingAction(db, row.aggregate_id);
  if (!action) throw new Error(`Pending action ${row.aggregate_id} not found`);
  if (!action.admin_review_message_id) {
    throw new Error(
      `Pending action ${row.aggregate_id} has no admin review message`,
    );
  }

  const status = decisionStatus(action.status);
  const actorDiscordId = await getDecisionActor(
    db,
    action.id,
    action.approved_by_discord_id,
  );
  const channel = await client.channels.fetch(getAdminReviewChannelId());
  if (!channel?.isTextBased() || !("messages" in channel)) {
    throw new Error("Admin review channel is not text based");
  }
  const message = await channel.messages.fetch(action.admin_review_message_id);
  const embed = existingEmbed(message);
  applyDecisionStatus(embed, status, actorDiscordId, action.admin_note);
  await message.edit({
    embeds: [embed],
    ...(status === "pending_info" ? {} : { components: [] }),
  });
  return message.id;
}

async function projectReceipt(
  client: Client,
  db: SupabaseClient,
  row: OperationOutboxRow,
): Promise<string> {
  const action = await getPendingAction(db, row.aggregate_id);
  if (!action) throw new Error(`Pending action ${row.aggregate_id} not found`);
  if (!action.public_receipt_message_id || !action.match_id) {
    throw new Error(
      `Pending action ${row.aggregate_id} has no public receipt target`,
    );
  }
  const match = await getMatchById(db, action.match_id);
  if (!match?.division_id)
    throw new Error(`Match ${action.match_id} has no division`);

  const status = decisionStatus(action.status);
  const actorDiscordId = await getDecisionActor(
    db,
    action.id,
    action.approved_by_discord_id,
  );
  const channelId =
    action.type === "reschedule"
      ? getReschedulesChannelId(match.division_id)
      : getResultsChannelId(match.division_id);
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("messages" in channel)) {
    throw new Error(`Receipt channel ${channelId} is not text based`);
  }
  const message = await channel.messages.fetch(
    action.public_receipt_message_id,
  );
  const embed = existingEmbed(message);
  applyDecisionStatus(embed, status, actorDiscordId, action.admin_note);
  await message.edit({ embeds: [embed] });
  return message.id;
}

async function projectDirectMessage(
  client: Client,
  row: OperationOutboxRow,
): Promise<string> {
  const recipientDiscordId = requiredString(
    row.payload.recipientDiscordId,
    "recipientDiscordId",
  );
  const status = decisionStatus(
    requiredString(row.payload.finalStatus, "finalStatus"),
  );
  const note = optionalString(row.payload.note);
  const user = await client.users.fetch(recipientDiscordId);
  const channel = await user.createDM();
  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = recent.find((message) =>
    messageHasProjection(message, row.id),
  );
  if (existing) return existing.id;

  const embed = new EmbedBuilder()
    .setTitle(notificationTitle(status))
    .setDescription(notificationDescription(status, note))
    .setFooter({ text: projectionMarker(row.id) })
    .setTimestamp();
  const sent = await channel.send({ embeds: [embed] });
  return sent.id;
}

async function projectProofThreadClosure(
  client: Client,
  row: OperationOutboxRow,
): Promise<string> {
  const threadId = requiredString(row.payload.proofThreadId, "proofThreadId");
  const status = decisionStatus(
    requiredString(row.payload.finalStatus, "finalStatus"),
  );
  const channel = await client.channels.fetch(threadId);
  if (!channel?.isThread())
    throw new Error(`Proof thread ${threadId} not found`);

  const recent = await channel.messages.fetch({ limit: 100 });
  let message = recent.find((candidate) =>
    messageHasProjection(candidate, row.id),
  );
  if (!message) {
    if (channel.archived) await channel.setArchived(false);
    message = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(notificationTitle(status))
          .setDescription("This proof thread is now closed.")
          .setFooter({ text: projectionMarker(row.id) })
          .setTimestamp(),
      ],
    });
  }
  if (!channel.archived) await channel.setArchived(true);
  removeActiveProofThread(threadId);
  return message.id;
}

async function getDecisionActor(
  db: SupabaseClient,
  actionId: string,
  storedActor: string | null,
): Promise<string> {
  if (storedActor) return storedActor;
  const { data, error } = await db
    .from("audit_logs")
    .select("actor_discord_id")
    .eq("pending_action_id", actionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.actor_discord_id)
    throw new Error(`Decision actor for ${actionId} not found`);
  return data.actor_discord_id;
}

function existingEmbed(message: Message): EmbedBuilder {
  const embed = message.embeds[0];
  if (!embed) throw new Error(`Discord message ${message.id} has no embed`);
  return EmbedBuilder.from(embed);
}

function applyDecisionStatus(
  embed: EmbedBuilder,
  status: DecisionStatus,
  actorDiscordId: string,
  note: string | null,
): void {
  if (status === "approved") applyApprovedStatus(embed, actorDiscordId);
  else if (status === "denied")
    applyDeniedStatus(embed, actorDiscordId, note ?? "No reason provided.");
  else if (status === "pending_info")
    applyNeedsInfoStatus(
      embed,
      actorDiscordId,
      note ?? "More information is required.",
    );
  else
    applyCancelledStatus(
      embed,
      actorDiscordId,
      note ?? "The underlying record changed.",
    );
}

function decisionStatus(value: string): DecisionStatus {
  if (
    value === "approved" ||
    value === "denied" ||
    value === "pending_info" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error(`Unsupported decision status: ${value}`);
}

function notificationTitle(status: DecisionStatus): string {
  if (status === "approved") return "Action approved";
  if (status === "denied") return "Action denied";
  if (status === "pending_info") return "More information needed";
  return "Action cancelled";
}

function notificationDescription(
  status: DecisionStatus,
  note: string | null,
): string {
  if (status === "approved") return "Your pending action was approved.";
  if (status === "denied")
    return `Your pending action was denied.\n\nReason: ${note ?? "No reason provided."}`;
  if (status === "pending_info")
    return `An admin needs more information.\n\nInfo needed: ${note ?? "Please contact an admin."}`;
  return `Your pending action was cancelled without applying changes.\n\n${note ?? ""}`.trim();
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Outbox payload ${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
