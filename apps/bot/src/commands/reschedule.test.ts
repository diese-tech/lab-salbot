import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@salbot/db", () => ({
  getCaptainByDiscordId: vi.fn(),
  getEligibleMatchesForCaptain: vi.fn(),
  getEligibleMatchesForOperator: vi.fn(),
  createPendingAction: vi.fn(),
  updatePendingActionMessages: vi.fn(),
}));

import {
  getCaptainByDiscordId,
  getEligibleMatchesForCaptain,
  getEligibleMatchesForOperator,
} from "@salbot/db";
import { execute } from "./reschedule";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SAL_OPERATOR_ROLE_IDS = "10000000000000001";
  process.env.SAL_ADMIN_ROLE_IDS = "10000000000000002";
});

describe("/reschedule authorization", () => {
  it("lets an admin select from all eligible matches without captain identity", async () => {
    vi.mocked(getEligibleMatchesForOperator).mockResolvedValue([
      {
        id: "match-1",
        week: 3,
        scheduled_date: "2026-09-01",
        home_org: { tag: "BK" },
        away_org: { tag: "BNO" },
      },
    ] as never);
    const reply = vi.fn().mockResolvedValue(undefined);

    await execute({
      user: { id: "admin-1" },
      member: { roles: ["10000000000000002"] },
      reply,
    } as never);

    expect(getCaptainByDiscordId).not.toHaveBeenCalled();
    expect(getEligibleMatchesForCaptain).not.toHaveBeenCalled();
    expect(getEligibleMatchesForOperator).toHaveBeenCalledOnce();
    expect(
      reply.mock.calls[0][0].components[0].components[0].toJSON().options[0],
    ).toMatchObject({
      label: "Week 3 — BK vs BNO (2026-09-01)",
      value: "match-1",
    });
  });
});
