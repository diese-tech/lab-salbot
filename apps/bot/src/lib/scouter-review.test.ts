import { describe, expect, it } from "vitest";
import type { ScouterDraft } from "./scouter-ingest";
import {
  applyScouterParticipantCorrection,
  applyScouterGameCorrection,
  buildScouterReviewComponents,
  buildScouterReviewEmbed,
  parseScouterReviewState,
  requireScouterConfirmationReady,
  SCOUTER_REVIEW_IDS,
  serializeScouterReviewState,
  type ScouterReviewState,
} from "./scouter-review";

const state: ScouterReviewState = {
  draftId: "123e4567-e89b-12d3-a456-426614174000",
  totalGames: 3,
  ownerDiscordId: "123456789012345678",
};

const participants = Array.from({ length: 10 }, (_, index) => ({
  side: index < 5 ? ("order" as const) : ("chaos" as const),
  rawIgn: `Player${index + 1}`,
  godName: `God ${index + 1}`,
  role: (["solo", "jungle", "mid", "support", "carry"] as const)[index % 5],
  playerLevel: 20,
  kills: index,
  deaths: 1,
  assists: 2,
  gpm: 500,
  playerDamage: 12_000,
  minionDamage: 8_000,
  jungleDamage: 1_000,
  structureDamage: 2_000,
  damageTaken: 10_000,
  damageMitigated: 4_000,
  selfHealing: 500,
  allyHealing: 250,
  wardsPlaced: 7,
}));

function draft(
  overrides: Partial<ScouterDraft["diagnostics"]> = {},
): ScouterDraft {
  return {
    draftId: state.draftId,
    revision: 1,
    status: "pending",
    gameOrdinal: 1,
    game: {
      smiteMatchId: "smite-1",
      gameMode: "Conquest",
      winningSide: "order",
      matchLengthSeconds: 1_205,
      participants,
    },
    diagnostics: {
      participantCount: 10,
      duplicateIgns: [],
      unlinkedIgns: [],
      ambiguousIgns: [],
      participants: participants.map((participant, index) => ({
        index,
        side: participant.side,
        rawIgn: participant.rawIgn,
        playerId: `player-${index + 1}`,
        identityStatus: "linked" as const,
      })),
      ...overrides,
    },
  };
}

describe("scouter review UI", () => {
  it("round-trips the compact durable review state within Discord's limit", () => {
    const customId = serializeScouterReviewState(
      SCOUTER_REVIEW_IDS.editModal,
      state,
      9,
    );

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(
      parseScouterReviewState(customId, SCOUTER_REVIEW_IDS.editModal),
    ).toEqual({
      state,
      participantIndex: 9,
    });
  });

  it("shows every persisted stat and blocks confirmation for duplicate IGNs", () => {
    const duplicateDraft = draft({ duplicateIgns: ["Player1"] });
    const embed = buildScouterReviewEmbed(
      duplicateDraft,
      1,
      state.ownerDiscordId,
    ).toJSON();
    const text = JSON.stringify(embed);
    const rows = buildScouterReviewComponents(duplicateDraft, state).map(
      (row) => row.toJSON(),
    );
    const confirm = rows[1].components[1];

    expect(text).toContain("Player1");
    expect(text).toContain("PDMG 12,000");
    expect(text).toContain("Min/Jng/Str 8,000/1,000/2,000");
    expect(text).toContain("Taken/Mit 10,000/4,000");
    expect(text).toContain("Heal 500/250");
    expect(text).toContain("Wards 7");
    expect(embed.fields?.every((field) => field.value.length <= 1_024)).toBe(
      true,
    );
    expect(confirm).toMatchObject({ label: "Confirm Game", disabled: true });
    expect(() =>
      requireScouterConfirmationReady(duplicateDraft, "checked"),
    ).toThrow("Correct duplicate IGN");
  });

  it("warns about unlinked identities while allowing an audited override", () => {
    const unlinkedDraft = draft({
      unlinkedIgns: ["Player10"],
      participants: draft().diagnostics.participants.map((item, index) =>
        index === 9
          ? { ...item, playerId: null, identityStatus: "unlinked" as const }
          : item,
      ),
    });
    const embed = buildScouterReviewEmbed(
      unlinkedDraft,
      1,
      state.ownerDiscordId,
    ).toJSON();
    const rows = buildScouterReviewComponents(unlinkedDraft, state).map((row) =>
      row.toJSON(),
    );

    expect(JSON.stringify(embed)).toContain("Unlinked IGNs");
    expect(JSON.stringify(embed)).toContain("audited override reason");
    expect(rows[1].components[1]).toMatchObject({
      label: "Confirm / Override",
      disabled: false,
    });
    expect(() => requireScouterConfirmationReady(unlinkedDraft, "")).toThrow(
      "override reason is required",
    );
    expect(
      requireScouterConfirmationReady(unlinkedDraft, "  Checked roster  "),
    ).toBe("Checked roster");
  });

  it("edits exactly one participant across the complete persisted stat set", () => {
    const values: Record<string, string> = {
      ign: "Corrected IGN",
      identity: "Athena | support | 19",
      kda: "1 | 2 | 17",
      economy: "450 | 9,001 | 7,002 | 3,003 | 1,004",
      combat: "11,005 | 6,006 | 507 | 8,008 | 12",
    };
    const revised = applyScouterParticipantCorrection(draft().game, 4, {
      getTextInputValue: (customId: string) => values[customId],
    });

    expect(revised.participants[4]).toMatchObject({
      rawIgn: "Corrected IGN",
      godName: "Athena",
      role: "support",
      playerLevel: 19,
      kills: 1,
      deaths: 2,
      assists: 17,
      gpm: 450,
      playerDamage: 9_001,
      minionDamage: 7_002,
      jungleDamage: 3_003,
      structureDamage: 1_004,
      damageTaken: 11_005,
      damageMitigated: 6_006,
      selfHealing: 507,
      allyHealing: 8_008,
      wardsPlaced: 12,
    });
    expect(revised.participants[3]).toEqual(participants[3]);
    expect(revised.participants[5]).toEqual(participants[5]);
  });

  it("edits the persisted game metadata and parses a reviewed duration", () => {
    const values: Record<string, string> = {
      smite_match_id: "corrected-match-id",
      game_mode: "Ranked Conquest",
      winning_side: "Chaos",
      match_length: "32:07",
    };
    const revised = applyScouterGameCorrection(draft().game, {
      getTextInputValue: (customId: string) => values[customId],
    });

    expect(revised).toMatchObject({
      smiteMatchId: "corrected-match-id",
      gameMode: "Ranked Conquest",
      winningSide: "chaos",
      matchLengthSeconds: 1_927,
    });
    expect(revised.participants).toEqual(participants);
  });

  it("rejects invalid roles, negative counters, and malformed state", () => {
    const base = {
      ign: "Player1",
      identity: "Athena | wizard | 20",
      kda: "1 | 2 | 3",
      economy: "1 | 2 | 3 | 4 | 5",
      combat: "1 | 2 | 3 | 4 | 5",
    };
    expect(() =>
      applyScouterParticipantCorrection(draft().game, 0, {
        getTextInputValue: (customId: string) =>
          base[customId as keyof typeof base],
      }),
    ).toThrow("Role must be");

    const negative = {
      ...base,
      identity: "Athena | support | 20",
      kda: "-1 | 2 | 3",
    };
    expect(() =>
      applyScouterParticipantCorrection(draft().game, 0, {
        getTextInputValue: (customId: string) =>
          negative[customId as keyof typeof negative],
      }),
    ).toThrow("nonnegative whole numbers");

    expect(() =>
      parseScouterReviewState(
        "sc_em:bad:6:host:10",
        SCOUTER_REVIEW_IDS.editModal,
      ),
    ).toThrow("Invalid or expired");

    expect(() =>
      applyScouterGameCorrection(draft().game, {
        getTextInputValue: (customId: string) =>
          customId === "winning_side" ? "middle" : "",
      }),
    ).toThrow("Winning side must be");

    expect(() =>
      applyScouterGameCorrection(draft().game, {
        getTextInputValue: (customId: string) => {
          if (customId === "winning_side") return "order";
          return customId === "match_length" ? "12:99" : "";
        },
      }),
    ).toThrow("Match length must use MM:SS");
  });
});
