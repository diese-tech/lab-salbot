import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Collection, EmbedBuilder } from "discord.js";

vi.mock("./proof-thread", () => ({ removeActiveProofThread: vi.fn() }));
vi.mock("@salbot/db", () => ({
  getRosterTrade: vi.fn(),
  getRosterDrop: vi.fn(),
  getCanonicalTeamRoleStates: vi.fn(),
  updateRosterTradeProposalMessage: vi.fn(),
  updateRosterTradeAdminReviewMessage: vi.fn(),
  getPendingAction: vi.fn(),
  getMatchById: vi.fn(),
}));

import {
  getCanonicalTeamRoleStates,
  getPendingAction,
  getRosterDrop,
  getRosterTrade,
  updateRosterTradeAdminReviewMessage,
  updateRosterTradeProposalMessage,
} from "@salbot/db";
import { createOutboxProjector } from "./outbox-projections";

const originalTransactions = process.env.CHANNEL_TRANSACTIONS;
const originalAdmin = process.env.CHANNEL_ADMIN_REVIEW;
const originalGuild = process.env.DISCORD_GUILD_ID;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CHANNEL_TRANSACTIONS = "transactions";
  process.env.CHANNEL_ADMIN_REVIEW = "admin";
  process.env.DISCORD_GUILD_ID = "guild";
  vi.mocked(getRosterTrade).mockResolvedValue(completedTrade());
});

afterEach(() => {
  restore("CHANNEL_TRANSACTIONS", originalTransactions);
  restore("CHANNEL_ADMIN_REVIEW", originalAdmin);
  restore("DISCORD_GUILD_ID", originalGuild);
});

describe("roster trade outbox projections", () => {
  it("reconciles the durable proposal marker after restart and persists the discovered message ID", async () => {
    vi.mocked(getRosterTrade).mockResolvedValue({
      ...completedTrade(),
      status: "awaiting_acceptance",
      proposalMessageId: null,
    });
    const edit = vi.fn().mockResolvedValue(undefined);
    const existing = {
      id: "proposal-existing",
      content: "",
      edit,
      embeds: [
        new EmbedBuilder().setFooter({ text: "sal-trade:trade-1" }).toJSON(),
      ],
    };
    const send = vi.fn();
    const client = {
      channels: {
        fetch: vi
          .fn()
          .mockResolvedValue(
            textChannel(
              new Collection([["proposal-existing", existing]]),
              send,
            ),
          ),
      },
    };

    await expect(
      createOutboxProjector(
        client as never,
        {} as never,
      )(outbox("discord_trade_proposal_projection")),
    ).resolves.toBe("proposal-existing");
    expect(edit).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(updateRosterTradeProposalMessage).toHaveBeenCalledWith(
      {},
      "trade-1",
      "proposal-existing",
    );
  });

  it("projects accepted trades through the shared admin-review controls", async () => {
    vi.mocked(getRosterTrade).mockResolvedValue({
      ...completedTrade(),
      status: "awaiting_admin",
    });
    vi.mocked(getPendingAction).mockResolvedValue({
      id: "action-1",
      type: "roster_trade",
      status: "pending",
      requested_by_discord_id: "captain-1",
      match_id: null,
      division_id: "solar",
      payload_json: {
        transactionId: "trade-1",
        revision: 1,
        source: "discord_workflow",
      },
      admin_note: null,
      admin_review_message_id: null,
      public_receipt_message_id: null,
      approved_by_discord_id: null,
      approved_at: null,
    } as never);
    const send = vi.fn().mockResolvedValue({ id: "admin-review-1" });
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue(textChannel(new Collection(), send)),
      },
    };

    await expect(
      createOutboxProjector(
        client as never,
        {} as never,
      )(outbox("discord_trade_admin_review")),
    ).resolves.toBe("admin-review-1");
    expect(send.mock.calls[0][0].components[0].components).toHaveLength(3);
    expect(updateRosterTradeAdminReviewMessage).toHaveBeenCalledWith(
      {},
      "action-1",
      "admin-review-1",
    );
  });

  it("publishes a completed uneven trade only to CHANNEL_TRANSACTIONS", async () => {
    const send = vi.fn().mockResolvedValue({ id: "bulletin-1" });
    const channel = textChannel(new Collection(), send);
    const client = { channels: { fetch: vi.fn().mockResolvedValue(channel) } };

    await expect(
      createOutboxProjector(
        client as never,
        {} as never,
      )(outbox("discord_transaction_bulletin")),
    ).resolves.toBe("bulletin-1");

    expect(client.channels.fetch).toHaveBeenCalledWith("transactions");
    const embed = send.mock.calls[0][0].embeds[0].toJSON();
    expect(embed.description).toBe(
      "[SOLAR] FF traded Crow + Kestrel to TC for The_Expert133",
    );
    expect(embed.footer?.text).toBe("sal-operation:trade-1");
  });

  it("publishes completed drops without exposing private eligibility details", async () => {
    vi.mocked(getRosterTrade).mockResolvedValue(null);
    vi.mocked(getRosterDrop).mockResolvedValue(completedDrop());
    const send = vi.fn().mockResolvedValue({ id: "drop-bulletin-1" });
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue(textChannel(new Collection(), send)),
      },
    };

    await expect(
      createOutboxProjector(
        client as never,
        {} as never,
      )(outbox("discord_transaction_bulletin")),
    ).resolves.toBe("drop-bulletin-1");
    const embed = send.mock.calls[0][0].embeds[0].toJSON();
    expect(embed.description).toBe("[SOLAR] FF dropped Crow");
    expect(JSON.stringify(embed)).not.toContain("ineligible");
  });

  it("reuses a bulletin discovered by its stable marker instead of reposting", async () => {
    const existing = {
      id: "existing-bulletin",
      content: "",
      embeds: [
        new EmbedBuilder()
          .setFooter({ text: "sal-operation:trade-1" })
          .toJSON(),
      ],
    };
    const send = vi.fn();
    const client = {
      channels: {
        fetch: vi
          .fn()
          .mockResolvedValue(
            textChannel(
              new Collection([["existing-bulletin", existing]]),
              send,
            ),
          ),
      },
    };

    await expect(
      createOutboxProjector(
        client as never,
        {} as never,
      )(outbox("discord_transaction_bulletin")),
    ).resolves.toBe("existing-bulletin");
    expect(send).not.toHaveBeenCalled();
  });

  it("pauses an ambiguous bulletin send and creates a stable private reconciliation alert", async () => {
    const transactionChannel = textChannel(
      new Collection(),
      vi.fn().mockRejectedValue(new Error("request timed out")),
    );
    const alertSend = vi.fn().mockResolvedValue({ id: "delivery-alert-1" });
    const adminChannel = textChannel(new Collection(), alertSend);
    const client = {
      channels: {
        fetch: vi
          .fn()
          .mockImplementation((id: string) =>
            Promise.resolve(
              id === "transactions" ? transactionChannel : adminChannel,
            ),
          ),
      },
    };

    await expect(
      createOutboxProjector(
        client as never,
        {} as never,
      )(outbox("discord_transaction_bulletin")),
    ).rejects.toMatchObject({ needsReconciliation: true });
    const alert = alertSend.mock.calls[0][0].embeds[0].toJSON();
    expect(alert.description).toContain("paused for durable reconciliation");
    expect(alert.footer?.text).toBe("sal-delivery-alert:outbox-1");
  });

  it("reconciles only configured organization roles from canonical roster state", async () => {
    vi.mocked(getCanonicalTeamRoleStates).mockResolvedValue([
      {
        playerId: "p1",
        discordId: "member-1",
        playerName: "Crow",
        orgId: "tc",
        desiredTeamRoleId: "role-tc",
        knownDivisionTeamRoleIds: ["role-ff", "role-tc"],
      },
    ]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const member = {
      roles: {
        cache: new Collection([
          ["role-ff", {}],
          ["unrelated-role", {}],
        ]),
        remove,
        add,
      },
    };
    const guild = { members: { fetch: vi.fn().mockResolvedValue(member) } };
    const client = {
      guilds: { fetch: vi.fn().mockResolvedValue(guild) },
      channels: { fetch: vi.fn() },
    };

    await createOutboxProjector(
      client as never,
      {} as never,
    )(outbox("discord_organization_role_reconciliation"));

    expect(remove).toHaveBeenCalledWith(["role-ff"], expect.any(String));
    expect(add).toHaveBeenCalledWith("role-tc", expect.any(String));
    expect(remove.mock.calls.flat().join(" ")).not.toContain("unrelated-role");
  });

  it("alerts admins and leaves role work retryable when Discord role sync fails", async () => {
    vi.mocked(getCanonicalTeamRoleStates).mockResolvedValue([
      {
        playerId: "p1",
        discordId: null,
        playerName: "Crow",
        orgId: "tc",
        desiredTeamRoleId: "role-tc",
        knownDivisionTeamRoleIds: ["role-ff", "role-tc"],
      },
    ]);
    const alertSend = vi.fn().mockResolvedValue({ id: "alert-1" });
    const adminChannel = textChannel(new Collection(), alertSend);
    const client = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({ members: { fetch: vi.fn() } }),
      },
      channels: { fetch: vi.fn().mockResolvedValue(adminChannel) },
    };

    await expect(
      createOutboxProjector(
        client as never,
        {} as never,
      )(outbox("discord_organization_role_reconciliation")),
    ).rejects.toThrow("reconciliation incomplete");
    const description =
      alertSend.mock.calls[0][0].embeds[0].toJSON().description;
    expect(description).toContain("Transaction: trade-1");
    expect(description).toContain("Retry status: automatic retry pending");
  });

  it("removes the affected division team role after a completed drop without adding a role", async () => {
    vi.mocked(getCanonicalTeamRoleStates).mockResolvedValue([
      {
        playerId: "p1",
        discordId: "member-1",
        playerName: "Crow",
        orgId: null,
        desiredTeamRoleId: null,
        knownDivisionTeamRoleIds: ["role-ff", "role-tc"],
      },
    ]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const member = {
      roles: { cache: new Collection([["role-ff", {}]]), remove, add },
    };
    const client = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({
          members: { fetch: vi.fn().mockResolvedValue(member) },
        }),
      },
      channels: { fetch: vi.fn() },
    };

    await createOutboxProjector(
      client as never,
      {} as never,
    )(outbox("discord_organization_role_reconciliation"));
    expect(getCanonicalTeamRoleStates).toHaveBeenCalledWith(
      expect.anything(),
      "season-1",
      "solar",
      ["p1"],
    );
    expect(remove).toHaveBeenCalledWith(["role-ff"], expect.any(String));
    expect(add).not.toHaveBeenCalled();
  });
});

function completedTrade() {
  return {
    id: "trade-1",
    source: "discord_workflow",
    seasonId: "season-1",
    divisionId: "solar",
    status: "completed",
    currentRevision: 1,
    proposerOrgId: "ff",
    receiverOrgId: "tc",
    pendingActionId: "action-1",
    proposalChannelId: "trade-channel",
    proposalMessageId: "proposal-1",
    proposer: { id: "ff", name: "Food Fighters", tag: "FF" },
    receiver: { id: "tc", name: "The Crew", tag: "TC" },
    movements: [
      {
        id: "p1",
        name: "Crow",
        discordId: "d1",
        fromOrgId: "ff",
        toOrgId: "tc",
      },
      {
        id: "p2",
        name: "Kestrel",
        discordId: "d2",
        fromOrgId: "ff",
        toOrgId: "tc",
      },
      {
        id: "p3",
        name: "The_Expert133",
        discordId: "d3",
        fromOrgId: "tc",
        toOrgId: "ff",
      },
    ],
  };
}

function completedDrop() {
  return {
    id: "trade-1",
    source: "discord_workflow",
    seasonId: "season-1",
    divisionId: "solar",
    status: "completed",
    currentRevision: 1,
    pendingActionId: "action-drop",
    organization: { id: "ff", name: "Food Fighters", tag: "FF" },
    player: { id: "p1", name: "Crow", discordId: "d1" },
    eligibilityStatus: "ineligible_for_season",
    suspendedUntil: null,
  };
}

function outbox(topic: string) {
  return {
    id: "outbox-1",
    topic,
    aggregate_type: "roster_transaction",
    aggregate_id: "trade-1",
    event_type: "roster_trade_completed",
    deduplication_key: `trade-1:${topic}`,
    payload:
      topic === "discord_organization_role_reconciliation"
        ? { seasonId: "season-1", divisionId: "solar", playerIds: ["p1"] }
        : topic === "discord_trade_proposal_projection"
          ? {
              transactionId: "trade-1",
              revision: 1,
              channelId: "trade-channel",
            }
          : { operationId: "trade-1" },
    state: "processing",
    attempts: 1,
    available_at: "2026-08-22T00:00:00Z",
    lease_owner: "worker",
    lease_expires_at: "2026-08-22T00:01:00Z",
    last_error: null,
    external_id: null,
    completed_at: null,
    created_at: "2026-08-22T00:00:00Z",
    updated_at: "2026-08-22T00:00:00Z",
  };
}

function textChannel(
  messages: Collection<string, unknown>,
  send: ReturnType<typeof vi.fn>,
) {
  return {
    isTextBased: () => true,
    messages: { fetch: vi.fn().mockResolvedValue(messages) },
    send,
  };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
