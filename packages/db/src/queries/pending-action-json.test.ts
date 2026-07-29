import { describe, expect, it, vi } from "vitest";
import { createPendingAction, getPendingAction } from "./pending-actions";

describe("pending action JSON boundaries", () => {
  it("rejects malformed payloads before inserting them", async () => {
    const insert = vi.fn();
    const db = {
      from: () => ({ insert }),
    } as never;

    await expect(
      createPendingAction(db, {
        type: "match_result",
        requestedByDiscordId: "captain-1",
        payloadJson: { score: "2-1" },
      }),
    ).rejects.toThrow("winnerOrgId");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON loaded from the database", async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      single: () =>
        Promise.resolve({
          data: {
            id: "pending-1",
            type: "reschedule",
            status: "pending",
            requested_by_discord_id: "captain-1",
            match_id: "match-1",
            division_id: "solar",
            payload_json: { newDate: "tomorrow", newTime: "later" },
            admin_note: null,
            admin_review_message_id: null,
            public_receipt_message_id: null,
            approved_by_discord_id: null,
            approved_at: null,
          },
          error: null,
        }),
    };
    const db = { from: () => builder } as never;

    await expect(getPendingAction(db, "pending-1")).rejects.toThrow("newDate");
  });
});
