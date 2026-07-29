import { describe, expect, it } from "vitest";
import { parseDatabaseJsonObject } from "./json";

describe("parseDatabaseJsonObject", () => {
  it("accepts JSON objects and rejects arrays and primitives", () => {
    expect(parseDatabaseJsonObject({ kills: 5 }, "stats_json")).toEqual({
      kills: 5,
    });
    expect(() => parseDatabaseJsonObject([], "stats_json")).toThrow(
      "stats_json must be a JSON object",
    );
    expect(() => parseDatabaseJsonObject("bad", "payload_json")).toThrow(
      "payload_json must be a JSON object",
    );
  });
});
