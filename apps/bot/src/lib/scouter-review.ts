import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitFields,
} from "discord.js";
import type {
  ScouterDraft,
  ScouterGameDraft,
  ScouterParticipant,
} from "./scouter-ingest";

export const SCOUTER_REVIEW_IDS = {
  editGame: "sc_eg",
  editGameModal: "sc_gm",
  edit: "sc_ed",
  editModal: "sc_em",
  confirm: "sc_cf",
  confirmModal: "sc_cm",
  cancel: "sc_ca",
} as const;

export type ScouterReviewState = {
  draftId: string;
  totalGames: number;
  ownerDiscordId: string;
};

type ReviewPrefix =
  (typeof SCOUTER_REVIEW_IDS)[keyof typeof SCOUTER_REVIEW_IDS];

export function buildScouterReviewEmbed(
  draft: ScouterDraft,
  gameOrdinal: number,
  ownerDiscordId: string,
): EmbedBuilder {
  const hasDuplicates = draft.diagnostics.duplicateIgns.length > 0;
  const needsOverride =
    draft.diagnostics.unlinkedIgns.length > 0 ||
    draft.diagnostics.ambiguousIgns.length > 0;
  const linkedCount = draft.diagnostics.participants.filter(
    (participant) => participant.identityStatus === "linked",
  ).length;
  const embed = new EmbedBuilder()
    .setColor(hasDuplicates ? 0xed4245 : needsOverride ? 0xfee75c : 0x5865f2)
    .setTitle(`Review Scouter Game ${gameOrdinal}`)
    .setDescription(
      "Nothing below is canonical yet. Review every participant, correct OCR mistakes, then explicitly confirm the game.",
    )
    .addFields(
      {
        name: "Game",
        value: [
          `SMITE ID: ${draft.game.smiteMatchId ?? "—"}`,
          `Mode: ${draft.game.gameMode ?? "—"}`,
          `Winner: ${capitalize(draft.game.winningSide)}`,
          `Length: ${formatDuration(draft.game.matchLengthSeconds)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Identity Check",
        value: `${linkedCount}/${draft.diagnostics.participantCount} linked`,
        inline: true,
      },
      {
        name: "Order",
        value: participantLines(draft, "order"),
      },
      {
        name: "Chaos",
        value: participantLines(draft, "chaos"),
      },
    )
    .setFooter({
      text: `Draft ${draft.draftId} • Revision ${draft.revision} • Host ${ownerDiscordId}`,
    })
    .setTimestamp();

  if (hasDuplicates) {
    embed.addFields({
      name: "⛔ Duplicate IGNs — correction required",
      value: draft.diagnostics.duplicateIgns.join(", ").slice(0, 1024),
    });
  }
  if (draft.diagnostics.unlinkedIgns.length > 0) {
    embed.addFields({
      name: "⚠️ Unlinked IGNs",
      value:
        `${draft.diagnostics.unlinkedIgns.join(", ")}\nCorrect them or provide an audited override reason when confirming.`.slice(
          0,
          1024,
        ),
    });
  }
  if (draft.diagnostics.ambiguousIgns.length > 0) {
    embed.addFields({
      name: "⚠️ Ambiguous IGNs",
      value:
        `${draft.diagnostics.ambiguousIgns.join(", ")}\nCorrect them or provide an audited override reason when confirming.`.slice(
          0,
          1024,
        ),
    });
  }
  return embed;
}

export function buildScouterReviewComponents(
  draft: ScouterDraft,
  state: ScouterReviewState,
) {
  const options = draft.game.participants.map((participant, index) => ({
    label: `${index + 1}. ${participant.rawIgn}`.slice(0, 100),
    value: String(index),
    description:
      `${capitalize(participant.side)} • ${participant.godName ?? "Unknown god"} • ${participant.kills}/${participant.deaths}/${participant.assists}`.slice(
        0,
        100,
      ),
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(serializeScouterReviewState(SCOUTER_REVIEW_IDS.edit, state))
    .setPlaceholder("Edit a participant")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(draft.status !== "pending")
    .addOptions(options);
  const confirm = new ButtonBuilder()
    .setCustomId(serializeScouterReviewState(SCOUTER_REVIEW_IDS.confirm, state))
    .setLabel(
      draft.diagnostics.unlinkedIgns.length > 0 ||
        draft.diagnostics.ambiguousIgns.length > 0
        ? "Confirm / Override"
        : "Confirm Game",
    )
    .setStyle(ButtonStyle.Success)
    .setDisabled(
      draft.status !== "pending" || draft.diagnostics.duplicateIgns.length > 0,
    );
  const editGame = new ButtonBuilder()
    .setCustomId(
      serializeScouterReviewState(SCOUTER_REVIEW_IDS.editGame, state),
    )
    .setLabel("Edit Game")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(draft.status !== "pending");
  const cancel = new ButtonBuilder()
    .setCustomId(serializeScouterReviewState(SCOUTER_REVIEW_IDS.cancel, state))
    .setLabel("Cancel Draft")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(draft.status !== "pending");

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      editGame,
      confirm,
      cancel,
    ),
  ];
}

export function buildScouterGameEditModal(
  draft: ScouterDraft,
  state: ScouterReviewState,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(
      serializeScouterReviewState(SCOUTER_REVIEW_IDS.editGameModal, state),
    )
    .setTitle("Edit Scouter Game")
    .addComponents(
      gameTextRow(
        "smite_match_id",
        "SMITE match ID",
        draft.game.smiteMatchId ?? "",
        false,
      ),
      gameTextRow("game_mode", "Game mode", draft.game.gameMode ?? "", false),
      gameTextRow(
        "winning_side",
        "Winning side (order or chaos)",
        draft.game.winningSide,
        true,
      ),
      gameTextRow(
        "match_length",
        "Match length (MM:SS or seconds)",
        formatDurationInput(draft.game.matchLengthSeconds),
        false,
      ),
    );
}

export function buildScouterParticipantEditModal(
  draft: ScouterDraft,
  state: ScouterReviewState,
  participantIndex: number,
): ModalBuilder {
  const participant = draft.game.participants[participantIndex];
  if (!participant)
    throw new Error("Selected scouter participant is no longer available.");

  return new ModalBuilder()
    .setCustomId(
      serializeScouterReviewState(
        SCOUTER_REVIEW_IDS.editModal,
        state,
        participantIndex,
      ),
    )
    .setTitle(`Edit ${participant.rawIgn}`.slice(0, 45))
    .addComponents(
      textRow("ign", "IGN", participant.rawIgn, "Exact in-game name"),
      textRow(
        "identity",
        "God | role | level",
        [participant.godName, participant.role, participant.playerLevel]
          .map(formatInput)
          .join(" | "),
        "Use — for unreadable optional values",
      ),
      textRow(
        "kda",
        "Kills | deaths | assists",
        [participant.kills, participant.deaths, participant.assists].join(
          " | ",
        ),
      ),
      textRow(
        "economy",
        "GPM | player | minion | jungle | structure",
        [
          participant.gpm,
          participant.playerDamage,
          participant.minionDamage,
          participant.jungleDamage,
          participant.structureDamage,
        ]
          .map(formatInput)
          .join(" | "),
      ),
      textRow(
        "combat",
        "Taken | mitigated | self heal | ally heal | wards",
        [
          participant.damageTaken,
          participant.damageMitigated,
          participant.selfHealing,
          participant.allyHealing,
          participant.wardsPlaced,
        ]
          .map(formatInput)
          .join(" | "),
      ),
    );
}

export function buildScouterConfirmModal(
  state: ScouterReviewState,
): ModalBuilder {
  const overrideReason = new TextInputBuilder()
    .setCustomId("override_reason")
    .setLabel("Identity override reason (only if flagged)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500)
    .setPlaceholder(
      "Required for unlinked or ambiguous IGNs; leave blank when all identities are linked.",
    );
  return new ModalBuilder()
    .setCustomId(
      serializeScouterReviewState(SCOUTER_REVIEW_IDS.confirmModal, state),
    )
    .setTitle("Confirm Scouter Game")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(overrideReason),
    );
}

export function applyScouterParticipantCorrection(
  game: ScouterGameDraft,
  participantIndex: number,
  fields: Pick<ModalSubmitFields, "getTextInputValue">,
): ScouterGameDraft {
  const participant = game.participants[participantIndex];
  if (!participant)
    throw new Error("Selected scouter participant is no longer available.");

  const [godName, roleRaw, playerLevelRaw] = splitFields(
    fields.getTextInputValue("identity"),
    3,
    "God, role, and level",
  );
  const [kills, deaths, assists] = splitFields(
    fields.getTextInputValue("kda"),
    3,
    "K/D/A",
  ).map((value) => requiredCounter(value, "K/D/A"));
  const economy = splitFields(
    fields.getTextInputValue("economy"),
    5,
    "Economy/objective stats",
  ).map((value) => optionalCounter(value, "Economy/objective stats"));
  const combat = splitFields(
    fields.getTextInputValue("combat"),
    5,
    "Combat/utility stats",
  ).map((value) => optionalCounter(value, "Combat/utility stats"));
  const role = optionalText(roleRaw)?.toLowerCase() ?? null;
  if (
    role !== null &&
    !["solo", "jungle", "mid", "support", "carry"].includes(role)
  ) {
    throw new Error("Role must be solo, jungle, mid, support, carry, or —.");
  }
  const playerLevel = optionalCounter(playerLevelRaw, "Player level");
  if (playerLevel !== null && (playerLevel < 1 || playerLevel > 20)) {
    throw new Error("Player level must be between 1 and 20, or —.");
  }
  const rawIgn = fields.getTextInputValue("ign").trim();
  if (!rawIgn) throw new Error("IGN is required.");

  const revised: ScouterParticipant = {
    ...participant,
    rawIgn,
    godName: optionalText(godName),
    role: role as ScouterParticipant["role"],
    playerLevel,
    kills,
    deaths,
    assists,
    gpm: economy[0],
    playerDamage: economy[1],
    minionDamage: economy[2],
    jungleDamage: economy[3],
    structureDamage: economy[4],
    damageTaken: combat[0],
    damageMitigated: combat[1],
    selfHealing: combat[2],
    allyHealing: combat[3],
    wardsPlaced: combat[4],
  };
  return {
    ...game,
    participants: game.participants.map((current, index) =>
      index === participantIndex ? revised : current,
    ),
  };
}

export function applyScouterGameCorrection(
  game: ScouterGameDraft,
  fields: Pick<ModalSubmitFields, "getTextInputValue">,
): ScouterGameDraft {
  const winningSide = fields
    .getTextInputValue("winning_side")
    .trim()
    .toLowerCase();
  if (winningSide !== "order" && winningSide !== "chaos") {
    throw new Error("Winning side must be order or chaos.");
  }
  return {
    ...game,
    smiteMatchId: optionalText(fields.getTextInputValue("smite_match_id")),
    gameMode: optionalText(fields.getTextInputValue("game_mode")),
    winningSide,
    matchLengthSeconds: parseDuration(fields.getTextInputValue("match_length")),
  };
}

export function requireScouterConfirmationReady(
  draft: ScouterDraft,
  identityOverrideReason: string,
): string | undefined {
  if (draft.diagnostics.duplicateIgns.length > 0) {
    throw new Error(
      `Correct duplicate IGN${draft.diagnostics.duplicateIgns.length === 1 ? "" : "s"} before confirming: ${draft.diagnostics.duplicateIgns.join(", ")}.`,
    );
  }
  const hasIdentityExceptions =
    draft.diagnostics.unlinkedIgns.length > 0 ||
    draft.diagnostics.ambiguousIgns.length > 0;
  const reason = identityOverrideReason.trim();
  if (hasIdentityExceptions && !reason) {
    throw new Error(
      "An identity override reason is required for unlinked or ambiguous IGNs.",
    );
  }
  return reason || undefined;
}

export function serializeScouterReviewState(
  prefix: ReviewPrefix,
  state: ScouterReviewState,
  participantIndex?: number,
) {
  const customId = [
    prefix,
    encodeIdentifier(state.draftId),
    state.totalGames,
    encodeURIComponent(state.ownerDiscordId),
    ...(participantIndex === undefined ? [] : [participantIndex]),
  ].join(":");
  if (customId.length > 100)
    throw new Error("Scouter review state exceeds Discord limits.");
  return customId;
}

export function parseScouterReviewState(
  customId: string,
  expectedPrefix: ReviewPrefix,
) {
  const [prefix, draftId, totalRaw, ownerDiscordId, participantRaw, ...extra] =
    customId.split(":");
  const totalGames = Number(totalRaw);
  const participantIndex =
    participantRaw === undefined ? undefined : Number(participantRaw);
  if (
    prefix !== expectedPrefix ||
    extra.length > 0 ||
    !draftId ||
    !ownerDiscordId ||
    !Number.isInteger(totalGames) ||
    totalGames < 1 ||
    totalGames > 5 ||
    (participantIndex !== undefined &&
      (!Number.isInteger(participantIndex) ||
        participantIndex < 0 ||
        participantIndex > 9))
  ) {
    throw new Error(
      "Invalid or expired scouter review state. Run /log-scouter again.",
    );
  }
  return {
    state: {
      draftId: decodeIdentifier(draftId),
      totalGames,
      ownerDiscordId: decodeURIComponent(ownerDiscordId),
    },
    participantIndex,
  };
}

function participantLines(draft: ScouterDraft, side: "order" | "chaos") {
  return draft.game.participants
    .map((participant, index) => ({ participant, index }))
    .filter(({ participant }) => participant.side === side)
    .map(({ participant, index }) => {
      const diagnostic = draft.diagnostics.participants.find(
        (item) => item.index === index,
      );
      const identity =
        diagnostic?.identityStatus === "linked"
          ? "✅"
          : diagnostic?.identityStatus === "duplicate"
            ? "⛔"
            : "⚠️";
      return [
        `**${index + 1}. ${participant.rawIgn}** ${identity} — ${participant.godName ?? "—"} / ${participant.role ?? "—"} / Lv ${formatValue(participant.playerLevel)}`,
        `${participant.kills}/${participant.deaths}/${participant.assists} • GPM ${formatValue(participant.gpm)} • PDMG ${formatValue(participant.playerDamage)} • Min/Jng/Str ${formatValue(participant.minionDamage)}/${formatValue(participant.jungleDamage)}/${formatValue(participant.structureDamage)} • Taken/Mit ${formatValue(participant.damageTaken)}/${formatValue(participant.damageMitigated)} • Heal ${formatValue(participant.selfHealing)}/${formatValue(participant.allyHealing)} • Wards ${formatValue(participant.wardsPlaced)}`,
      ].join("\n");
    })
    .join("\n");
}

function textRow(
  customId: string,
  label: string,
  value: string,
  placeholder?: string,
) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(300)
    .setValue(value.slice(0, 300));
  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function gameTextRow(
  customId: string,
  label: string,
  value: string,
  required: boolean,
) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(100);
  if (value) input.setValue(value.slice(0, 100));
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function splitFields(value: string, count: number, label: string) {
  const values = value.split("|").map((item) => item.trim());
  if (values.length !== count)
    throw new Error(`${label} must contain ${count} pipe-separated values.`);
  return values;
}

function requiredCounter(value: string, label: string) {
  const parsed = Number(value.replaceAll(",", ""));
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`${label} must use nonnegative whole numbers.`);
  return parsed;
}

function optionalCounter(value: string, label: string) {
  if (!optionalText(value)) return null;
  return requiredCounter(value, label);
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return !trimmed || trimmed === "—" || trimmed.toLowerCase() === "null"
    ? null
    : trimmed;
}

function formatInput(value: string | number | null | undefined) {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function formatValue(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString("en-US");
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDurationInput(seconds: number | null) {
  return seconds === null
    ? ""
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function parseDuration(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (seconds <= 0 || seconds > 86_400) {
      throw new Error("Match length must be between 1 second and 24 hours.");
    }
    return seconds;
  }
  const match = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (!match || Number(match[2]) > 59) {
    throw new Error("Match length must use MM:SS, whole seconds, or be blank.");
  }
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  if (seconds <= 0 || seconds > 86_400) {
    throw new Error("Match length must be between 1 second and 24 hours.");
  }
  return seconds;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function encodeIdentifier(value: string) {
  const compactUuid = value
    .toLowerCase()
    .match(
      /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/,
    );
  return compactUuid
    ? `u${compactUuid.slice(1).join("")}`
    : encodeURIComponent(value);
}

function decodeIdentifier(value: string) {
  const compactUuid = value.match(/^u([0-9a-f]{32})$/);
  if (!compactUuid) return decodeURIComponent(value);
  const uuid = compactUuid[1];
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}
