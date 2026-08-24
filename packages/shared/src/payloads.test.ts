import { describe, expect, it } from "vitest";
import {
  parseMatchResultPayload,
  parsePendingActionPayload,
  parseReschedulePayload,
} from "./payloads";

describe("pending action payload validation", () => {
  it("normalizes a valid match result and recomputes parsed score data", () => {
    expect(
      parseMatchResultPayload({
        winnerOrgId: "org-1",
        score: "2-1",
        parsed: {
          winnerGames: 99,
          loserGames: 99,
          gamesPlayed: 99,
          expectedScreenshots: 99,
        },
      }),
    ).toEqual({
      winnerOrgId: "org-1",
      score: "2-1",
      parsed: {
        winnerGames: 2,
        loserGames: 1,
        gamesPlayed: 3,
        expectedScreenshots: 6,
      },
    });
  });

  it("rejects malformed JSON instead of trusting a compile-time cast", () => {
    expect(() => parseMatchResultPayload({ score: "2-1" })).toThrow(
      "winnerOrgId",
    );
    expect(() =>
      parseReschedulePayload({
        newDate: "tomorrow",
        newTime: "later",
      }),
    ).toThrow("newDate");
    expect(() =>
      parsePendingActionPayload("admin_review", {
        issueType: "arbitrary",
        description: "help",
      }),
    ).toThrow("issueType");
  });

  it("binds roster-trade pending actions to an exact canonical revision", () => {
    expect(
      parsePendingActionPayload("roster_trade", {
        transactionId: "3bd50934-a0db-4c95-a343-124034b71801",
        revision: 2,
        source: "discord_workflow",
      }),
    ).toEqual({
      transactionId: "3bd50934-a0db-4c95-a343-124034b71801",
      revision: 2,
      source: "discord_workflow",
    });
    expect(() =>
      parsePendingActionPayload("roster_trade", {
        transactionId: "3bd50934-a0db-4c95-a343-124034b71801",
        revision: 0,
        source: "discord_workflow",
      }),
    ).toThrow("positive integer");
  });

  it("binds roster-drop pending actions to the exact organization and player", () => {
    expect(
      parsePendingActionPayload("roster_drop", {
        transactionId: "3bd50934-a0db-4c95-a343-124034b71801",
        revision: 1,
        source: "discord_workflow",
        orgId: "org-a",
        playerId: "player-a",
      }),
    ).toEqual({
      transactionId: "3bd50934-a0db-4c95-a343-124034b71801",
      revision: 1,
      source: "discord_workflow",
      orgId: "org-a",
      playerId: "player-a",
    });
  });
});
