import { describe, expect, it, vi } from "vitest";
import { uploadScouterImage } from "./scouter-storage";

describe("uploadScouterImage", () => {
  it("copies an image attachment into the public audit bucket under a match-scoped path", async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({ data: { path: "ok" }, error: null });
    const getPublicUrl = vi.fn((path: string) => ({
      data: { publicUrl: `https://storage.example/${path}` },
    }));
    const from = vi.fn(() => ({ upload, getPublicUrl }));
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const result = await uploadScouterImage(
      { storage: { from } } as never,
      {
        id: "attachment-123",
        url: "https://cdn.discordapp.com/score.png",
        name: "score.png",
        contentType: "image/png",
        size: 3,
      },
      {
        matchScopeId: "session-1",
        gameOrdinal: 2,
        kind: "scoreboard",
        fetchImpl,
      },
    );

    expect(from).toHaveBeenCalledWith("match-screenshots");
    expect(upload).toHaveBeenCalledWith(
      "scouters/session-1/game-2/scoreboard-attachment-123.png",
      expect.any(ArrayBuffer),
      { contentType: "image/png", upsert: false },
    );
    expect(result).toEqual({
      path: "scouters/session-1/game-2/scoreboard-attachment-123.png",
      publicUrl:
        "https://storage.example/scouters/session-1/game-2/scoreboard-attachment-123.png",
      fileName: "game-2-scoreboard.png",
    });
  });

  it("rejects non-image attachments before downloading or uploading", async () => {
    const fetchImpl = vi.fn();
    const from = vi.fn();

    await expect(
      uploadScouterImage(
        { storage: { from } } as never,
        {
          id: "attachment-456",
          url: "https://cdn.discordapp.com/not-an-image.txt",
          name: "not-an-image.txt",
          contentType: "text/plain",
          size: 3,
        },
        {
          matchScopeId: "session-1",
          gameOrdinal: 1,
          kind: "details",
          fetchImpl,
        },
      ),
    ).rejects.toThrow("must be an image");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
