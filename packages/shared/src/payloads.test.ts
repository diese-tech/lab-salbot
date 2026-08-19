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
        expectedScreenshots: 3,
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
});
