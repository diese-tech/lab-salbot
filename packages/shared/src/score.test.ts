import { describe, expect, it } from "vitest";
import { parseScore } from "./score";

describe("parseScore", () => {
  it("parses a 2-1 match", () => {
    expect(parseScore("2-1")).toEqual({
      winnerGames: 2,
      loserGames: 1,
      gamesPlayed: 3,
      expectedScreenshots: 3,
    });
  });

  it("parses a 2-0 match", () => {
    expect(parseScore("2-0")).toEqual({
      winnerGames: 2,
      loserGames: 0,
      gamesPlayed: 2,
      expectedScreenshots: 2,
    });
  });

  it("rejects scores where the loser has more games", () => {
    expect(parseScore("1-2")).toBeNull();
  });

  it("rejects non-score input", () => {
    expect(parseScore("abc")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(parseScore("")).toBeNull();
  });
});
