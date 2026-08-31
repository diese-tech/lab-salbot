import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAdminReviewChannelId,
  getResultsChannelId,
  getReschedulesChannelId,
  getTradeBlockChannelId,
  getTradeDivisionForChannel,
  getTransactionsChannelId,
} from "./channels";
import { UserFacingError } from "./errors";

// F-08: minimal coverage for the division -> env-var mapping in channels.ts.
// This mapping shipped without tests; a typo here silently sends receipts to
// the wrong channel (or throws for a division that should be configured).

const ENV_VARS = [
  "CHANNEL_ADMIN_REVIEW",
  "CHANNEL_RESULTS_SOLAR",
  "CHANNEL_RESULTS_LUNAR",
  "CHANNEL_RESULTS_TERRA",
  "CHANNEL_RESCHEDULES_SOLAR",
  "CHANNEL_RESCHEDULES_LUNAR",
  "CHANNEL_RESCHEDULES_TERRA",
  "CHANNEL_TRADE_BLOCK_SOLAR",
  "CHANNEL_TRADE_BLOCK_LUNAR",
  "CHANNEL_TRADE_BLOCK_TERRA",
  "CHANNEL_TRANSACTIONS",
] as const;

describe("channels division -> env-var mapping", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_VARS) original[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("maps each division to its results channel env var", () => {
    process.env.CHANNEL_RESULTS_SOLAR = "results-solar-id";
    process.env.CHANNEL_RESULTS_LUNAR = "results-lunar-id";
    process.env.CHANNEL_RESULTS_TERRA = "results-terra-id";

    expect(getResultsChannelId("solar")).toBe("results-solar-id");
    expect(getResultsChannelId("lunar")).toBe("results-lunar-id");
    expect(getResultsChannelId("terra")).toBe("results-terra-id");
  });

  it("maps each division to its reschedules channel env var", () => {
    process.env.CHANNEL_RESCHEDULES_SOLAR = "reschedules-solar-id";
    process.env.CHANNEL_RESCHEDULES_LUNAR = "reschedules-lunar-id";
    process.env.CHANNEL_RESCHEDULES_TERRA = "reschedules-terra-id";

    expect(getReschedulesChannelId("solar")).toBe("reschedules-solar-id");
    expect(getReschedulesChannelId("lunar")).toBe("reschedules-lunar-id");
    expect(getReschedulesChannelId("terra")).toBe("reschedules-terra-id");
  });

  it("maps trade-block channels in both directions and exposes the consolidated channel", () => {
    process.env.CHANNEL_TRADE_BLOCK_SOLAR = "trade-solar-id";
    process.env.CHANNEL_TRADE_BLOCK_LUNAR = "trade-lunar-id";
    process.env.CHANNEL_TRADE_BLOCK_TERRA = "trade-terra-id";
    process.env.CHANNEL_TRANSACTIONS = "transactions-id";

    expect(getTradeBlockChannelId("solar")).toBe("trade-solar-id");
    expect(getTradeDivisionForChannel("trade-lunar-id")).toBe("lunar");
    expect(getTradeDivisionForChannel("general")).toBeNull();
    expect(getTransactionsChannelId()).toBe("transactions-id");
  });

  it("is case-insensitive on the division id", () => {
    process.env.CHANNEL_RESULTS_SOLAR = "results-solar-id";
    expect(getResultsChannelId("SOLAR")).toBe("results-solar-id");
  });

  it("getAdminReviewChannelId throws UserFacingError when unset", () => {
    delete process.env.CHANNEL_ADMIN_REVIEW;
    expect(() => getAdminReviewChannelId()).toThrow(UserFacingError);
  });

  it("getResultsChannelId throws UserFacingError when the division's env var is unset", () => {
    delete process.env.CHANNEL_RESULTS_SOLAR;
    expect(() => getResultsChannelId("solar")).toThrow(UserFacingError);
  });

  it("getReschedulesChannelId throws UserFacingError when the division's env var is unset", () => {
    delete process.env.CHANNEL_RESCHEDULES_LUNAR;
    expect(() => getReschedulesChannelId("lunar")).toThrow(UserFacingError);
  });
});
