import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@salbot/db", () => ({
  createRosterDrop: vi.fn(),
  getRosterTradeSetup: vi.fn(),
}));
vi.mock("../lib/channels", () => ({
  getTradeDivisionForChannel: vi.fn(() => "solar"),
}));
vi.mock("../lib/outbox-runtime", () => ({
  requestImmediateOutboxDrain: vi.fn(),
}));

import { createRosterDrop, getRosterTradeSetup } from "@salbot/db";
import { execute, handleDropButton, handleDropSelect } from "./drop";

const OWNER_ROLE = "30000000000000001";
const CAPTAIN_ROLE = "20000000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SAL_OPERATOR_ROLE_IDS = "10000000000000001";
  process.env.SAL_ADMIN_ROLE_IDS = "10000000000000002";
  vi.mocked(getRosterTradeSetup).mockResolvedValue(setup());
  vi.mocked(createRosterDrop).mockResolvedValue({
    code: "created",
    transactionId: "drop-1",
    revision: 1,
    status: "awaiting_admin",
    pendingActionId: "action-1",
    outboxIds: ["outbox-1"],
  });
});

describe("/drop", () => {
  it("keeps closed divisions fail-closed", async () => {
    vi.mocked(getRosterTradeSetup).mockResolvedValue({
      ...setup(),
      dropsOpen: false,
    });
    const reply = vi.fn().mockResolvedValue(undefined);
    await execute(commandInteraction(reply) as never);
    expect(reply).toHaveBeenCalledWith({
      content: "Drops are not currently open for this division.",
      ephemeral: true,
    });
  });

  it("lets an organization owner use guided selection and creates no roster mutation directly", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await execute(commandInteraction(reply) as never);
    const playerCustomId = reply.mock.calls[0][0].components[0].components[0]
      .data.custom_id as string;

    const updateReview = vi.fn().mockResolvedValue(undefined);
    await handleDropSelect({
      customId: playerCustomId,
      values: ["player-1"],
      user: { id: "owner-1" },
      channelId: "trade-channel",
      update: updateReview,
    } as never);
    const submitCustomId = updateReview.mock.calls[0][0].components[0]
      .components[0].data.custom_id as string;

    const deferUpdate = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    await handleDropButton({
      customId: submitCustomId,
      user: { id: "owner-1" },
      channelId: "trade-channel",
      member: { roles: [OWNER_ROLE] },
      deferUpdate,
      editReply,
    } as never);

    expect(createRosterDrop).toHaveBeenCalledWith(expect.anything(), {
      actorDiscordId: "owner-1",
      seasonId: "s2",
      divisionId: "solar",
      orgId: "org-a",
      playerId: "player-1",
    });
    expect(editReply.mock.calls[0][0].content).toContain(
      "No roster change has occurred",
    );
  });
});

function setup() {
  return {
    seasonId: "s2",
    divisionId: "solar",
    tradesOpen: true,
    dropsOpen: true,
    captainRoleId: CAPTAIN_ROLE,
    organizations: [
      {
        id: "org-a",
        name: "Alpha Organization",
        tag: "ALP",
        organizationRoleId: OWNER_ROLE,
        captainDiscordIds: [],
        players: [
          { id: "player-1", name: "Player One", discordId: "discord-player-1" },
        ],
      },
    ],
  };
}

function commandInteraction(reply: ReturnType<typeof vi.fn>) {
  return {
    channelId: "trade-channel",
    guildId: "guild",
    user: { id: "owner-1" },
    member: { roles: [OWNER_ROLE] },
    reply,
  };
}
