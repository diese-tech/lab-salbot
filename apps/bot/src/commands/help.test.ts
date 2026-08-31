import { describe, expect, it, vi } from "vitest";
import { execute, handleHelpButton, helpEmbed } from "./help";

describe("/help", () => {
  it("opens a simple ephemeral Player tab with three discoverable tabs", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await execute({ reply } as never);
    const payload = reply.mock.calls[0][0];
    expect(payload.ephemeral).toBe(true);
    expect(payload.embeds[0].toJSON().title).toBe("Player Commands");
    expect(payload.components[0].components).toHaveLength(3);
  });

  it("switches to role-organized captain and admin guidance", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    await handleHelpButton({ customId: "help:captain", update } as never);
    expect(update.mock.calls[0][0].embeds[0].toJSON().title).toBe(
      "Captain & Organization Commands",
    );
    expect(
      helpEmbed("admin")
        .toJSON()
        .fields?.map((field) => field.name),
    ).toContain("/trade · /drop");
  });
});
