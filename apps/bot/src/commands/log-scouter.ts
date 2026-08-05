import { randomUUID } from "crypto";
import type {
  Attachment,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
} from "discord.js";
import {
  getCurrentScouterSeason,
  getScouterMatchReceipt,
  type ScouterReceipt as DatabaseScouterReceipt,
} from "@salbot/db";
import { db } from "../lib/db";
import { hasCommandAccess } from "../lib/command-access";
import {
  cancelScouterDraft,
  confirmScouterDraft,
  extractScouterDraft,
  getScouterDraft,
  reviseScouterDraft,
  ScouterIngestError,
} from "../lib/scouter-ingest";
import {
  applyScouterParticipantCorrection,
  buildScouterConfirmModal,
  buildScouterGameEditModal,
  buildScouterParticipantEditModal,
  buildScouterReviewComponents,
  buildScouterReviewEmbed,
  parseScouterReviewState,
  requireScouterConfirmationReady,
  applyScouterGameCorrection,
  SCOUTER_REVIEW_IDS,
  type ScouterReviewState,
} from "../lib/scouter-review";
import {
  getScouterImagePublicUrl,
  uploadScouterImage,
} from "../lib/scouter-storage";

export type ScouterReceipt = DatabaseScouterReceipt;

export type UploadState = {
  matchScopeId: string;
  gameOrdinal: number;
  totalGames: number;
  seasonId: string;
  ownerDiscordId: string;
};

const BUTTON_PREFIX = "sc_up";
const MODAL_PREFIX = "sc_modal";

export const data = {
  name: "log-scouter",
  description: "Upload SMITE 2 screenshots and record a scouter match.",
  options: [
    {
      type: 4, // INTEGER
      name: "games",
      description: "Number of games in this match (default 2).",
      required: false,
      min_value: 1,
      max_value: 5,
    },
  ],
} as const;

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!hasCommandAccess(interaction.member, "log-scouter")) {
    await interaction.reply({
      content:
        "You need an authorized SAL operator or admin Discord role to log scouter matches.",
      ephemeral: true,
    });
    return;
  }

  const season = await getCurrentScouterSeason(db);
  if (!season) {
    await interaction.reply({
      content:
        "No active or pre-season season is configured. Ask an admin to create or activate the preseason first.",
      ephemeral: true,
    });
    return;
  }

  const totalGames = interaction.options.getInteger("games") ?? 2;
  const state: UploadState = {
    matchScopeId: randomUUID(),
    gameOrdinal: 1,
    totalGames,
    seasonId: season.id,
    ownerDiscordId: interaction.user.id,
  };

  await interaction.reply({
    embeds: [buildScouterProgressEmbed(state, interaction.user.id)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildUploadButton(state),
      ),
    ],
  });
}

export async function handleUploadButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const state = parseUploadState(interaction.customId);
  if (interaction.user.id !== state.ownerDiscordId) {
    await interaction.reply({
      content: "Only the host who started this upload can continue it.",
      ephemeral: true,
    });
    return;
  }
  if (!hasCommandAccess(interaction.member, "log-scouter")) {
    await interaction.reply({
      content: "You are no longer authorized to continue this scouter upload.",
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(buildUploadModal(state));
}

export async function handleUploadModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const state = parseUploadState(interaction.customId);
  await interaction.deferReply({ ephemeral: true });

  if (
    interaction.user.id !== state.ownerDiscordId ||
    !hasCommandAccess(interaction.member, "log-scouter")
  ) {
    await interaction.editReply(
      "You are no longer authorized to continue this scouter upload.",
    );
    return;
  }

  const scoreboard = interaction.fields
    .getUploadedFiles("scoreboard", true)
    .first();
  const details = interaction.fields.getUploadedFiles("details", true).first();
  if (!scoreboard || !details) {
    await interaction.editReply(
      "Both the SCOREBOARD and DETAILS screenshots are required.",
    );
    return;
  }

  try {
    const [scoreboardImage, detailsImage] = await Promise.all([
      uploadScouterImage(db, toScouterAttachment(scoreboard), {
        matchScopeId: state.matchScopeId,
        gameOrdinal: state.gameOrdinal,
        kind: "scoreboard",
      }),
      uploadScouterImage(db, toScouterAttachment(details), {
        matchScopeId: state.matchScopeId,
        gameOrdinal: state.gameOrdinal,
        kind: "details",
      }),
    ]);

    const draft = await extractScouterDraft({
      scoreboardImagePath: scoreboardImage.path,
      detailsImagePath: detailsImage.path,
      gameOrdinal: state.gameOrdinal,
      hostedByDiscordId: interaction.user.id,
      seasonId: state.seasonId,
      ...(state.gameOrdinal > 1 ? { scouterMatchId: state.matchScopeId } : {}),
    });

    const reviewState: ScouterReviewState = {
      draftId: draft.draftId,
      totalGames: state.totalGames,
      ownerDiscordId: state.ownerDiscordId,
    };
    await requirePublicMessage(interaction.message).edit({
      embeds: [
        buildScouterReviewEmbed(draft, state.gameOrdinal, interaction.user.id),
      ],
      components: buildScouterReviewComponents(draft, reviewState),
    });
    await interaction.editReply(
      `OCR draft ready for game ${state.gameOrdinal}. Review the public message; nothing has been recorded yet.`,
    );
  } catch (error) {
    await interaction.editReply(formatScouterError(error));
  }
}

export async function handleReviewSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const { state } = parseScouterReviewState(
    interaction.customId,
    SCOUTER_REVIEW_IDS.edit,
  );
  if (!hasReviewAccess(interaction.user.id, interaction.member, state)) {
    await interaction.reply({
      content: "Only the still-authorized host can edit this scouter draft.",
      ephemeral: true,
    });
    return;
  }

  try {
    const participantIndex = Number(interaction.values[0]);
    if (
      !Number.isInteger(participantIndex) ||
      participantIndex < 0 ||
      participantIndex > 9
    ) {
      throw new Error("Selected scouter participant is invalid.");
    }
    const draft = await getScouterDraft(state.draftId, interaction.user.id);
    if (draft.status !== "pending") {
      throw new Error("This scouter draft is no longer pending.");
    }
    await interaction.showModal(
      buildScouterParticipantEditModal(draft, state, participantIndex),
    );
  } catch (error) {
    await interaction.reply({
      content: formatScouterError(error),
      ephemeral: true,
    });
  }
}

export async function handleGameEditButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const { state } = parseScouterReviewState(
    interaction.customId,
    SCOUTER_REVIEW_IDS.editGame,
  );
  if (!hasReviewAccess(interaction.user.id, interaction.member, state)) {
    await interaction.reply({
      content: "Only the still-authorized host can edit this scouter draft.",
      ephemeral: true,
    });
    return;
  }
  try {
    const draft = await getScouterDraft(state.draftId, interaction.user.id);
    if (draft.status !== "pending") {
      throw new Error("This scouter draft is no longer pending.");
    }
    await interaction.showModal(buildScouterGameEditModal(draft, state));
  } catch (error) {
    await interaction.reply({
      content: formatScouterError(error),
      ephemeral: true,
    });
  }
}

export async function handleGameEditModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const { state } = parseScouterReviewState(
    interaction.customId,
    SCOUTER_REVIEW_IDS.editGameModal,
  );
  await interaction.deferReply({ ephemeral: true });
  if (!hasReviewAccess(interaction.user.id, interaction.member, state)) {
    await interaction.editReply(
      "Only the still-authorized host can edit this scouter draft.",
    );
    return;
  }
  try {
    const current = await getScouterDraft(state.draftId, interaction.user.id);
    const gameOrdinal = requireDraftNumber(current.gameOrdinal, "game ordinal");
    const revised = await reviseScouterDraft({
      draftId: state.draftId,
      hostedByDiscordId: interaction.user.id,
      expectedRevision: current.revision,
      game: applyScouterGameCorrection(current.game, interaction.fields),
    });
    await requirePublicMessage(interaction.message).edit({
      embeds: [
        buildScouterReviewEmbed(revised, gameOrdinal, interaction.user.id),
      ],
      components: buildScouterReviewComponents(revised, state),
    });
    await interaction.editReply(
      `Updated game details. Review revision ${revised.revision} before confirming.`,
    );
  } catch (error) {
    await interaction.editReply(formatScouterError(error));
  }
}

export async function handleReviewEditModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const { state, participantIndex } = parseScouterReviewState(
    interaction.customId,
    SCOUTER_REVIEW_IDS.editModal,
  );
  await interaction.deferReply({ ephemeral: true });
  if (!hasReviewAccess(interaction.user.id, interaction.member, state)) {
    await interaction.editReply(
      "Only the still-authorized host can edit this scouter draft.",
    );
    return;
  }

  try {
    if (participantIndex === undefined) {
      throw new Error("Selected scouter participant is invalid.");
    }
    const current = await getScouterDraft(state.draftId, interaction.user.id);
    const gameOrdinal = requireDraftNumber(current.gameOrdinal, "game ordinal");
    const revisedGame = applyScouterParticipantCorrection(
      current.game,
      participantIndex,
      interaction.fields,
    );
    const revised = await reviseScouterDraft({
      draftId: state.draftId,
      hostedByDiscordId: interaction.user.id,
      expectedRevision: current.revision,
      game: revisedGame,
    });
    await requirePublicMessage(interaction.message).edit({
      embeds: [
        buildScouterReviewEmbed(revised, gameOrdinal, interaction.user.id),
      ],
      components: buildScouterReviewComponents(revised, state),
    });
    await interaction.editReply(
      `Updated participant ${participantIndex + 1}. Review revision ${revised.revision} before confirming.`,
    );
  } catch (error) {
    await interaction.editReply(formatScouterError(error));
  }
}

export async function handleConfirmButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const { state } = parseScouterReviewState(
    interaction.customId,
    SCOUTER_REVIEW_IDS.confirm,
  );
  if (!hasReviewAccess(interaction.user.id, interaction.member, state)) {
    await interaction.reply({
      content: "Only the still-authorized host can confirm this scouter draft.",
      ephemeral: true,
    });
    return;
  }
  await interaction.showModal(buildScouterConfirmModal(state));
}

export async function handleConfirmModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const { state } = parseScouterReviewState(
    interaction.customId,
    SCOUTER_REVIEW_IDS.confirmModal,
  );
  await interaction.deferReply({ ephemeral: true });
  if (!hasReviewAccess(interaction.user.id, interaction.member, state)) {
    await interaction.editReply(
      "Only the still-authorized host can confirm this scouter draft.",
    );
    return;
  }

  try {
    const current = await getScouterDraft(state.draftId, interaction.user.id);
    const gameOrdinal = requireDraftNumber(current.gameOrdinal, "game ordinal");
    const seasonId = current.seasonId;
    if (!seasonId) {
      throw new Error("Scouter draft is missing its season scope.");
    }
    const identityOverrideReason = requireScouterConfirmationReady(
      current,
      interaction.fields.getTextInputValue("override_reason"),
    );
    const result = await confirmScouterDraft({
      draftId: state.draftId,
      hostedByDiscordId: interaction.user.id,
      expectedRevision: current.revision,
      ...(identityOverrideReason ? { identityOverrideReason } : {}),
    });
    const publicMessage = requirePublicMessage(interaction.message);

    if (result.code === "existing") {
      await publicMessage.edit({
        embeds: [
          buildAlreadyRecordedEmbed(result.receiptUrl, interaction.user.id),
        ],
        components: [],
      });
      await interaction.editReply(
        `Already recorded — receipt: ${result.receiptUrl}`,
      );
      return;
    }

    if (gameOrdinal < state.totalGames) {
      const nextState: UploadState = {
        matchScopeId: result.scouterMatchId,
        gameOrdinal: gameOrdinal + 1,
        totalGames: state.totalGames,
        seasonId,
        ownerDiscordId: state.ownerDiscordId,
      };
      await publicMessage.edit({
        embeds: [
          buildScouterProgressEmbed(
            nextState,
            interaction.user.id,
            gameOrdinal,
          ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            buildUploadButton(nextState),
          ),
        ],
      });
      await interaction.editReply(
        `✅ Game ${gameOrdinal} confirmed and recorded. Use the public upload button for game ${nextState.gameOrdinal}.`,
      );
      return;
    }

    await publishFinalScouterReceipt(
      publicMessage,
      result.scouterMatchId,
      result.receiptUrl,
      interaction.user.id,
    );
    await interaction.editReply(
      `✅ Scouter match recorded: ${publicMessage.url}`,
    );
  } catch (error) {
    await interaction.editReply(formatScouterError(error));
  }
}

export async function handleCancelButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const { state } = parseScouterReviewState(
    interaction.customId,
    SCOUTER_REVIEW_IDS.cancel,
  );
  await interaction.deferReply({ ephemeral: true });
  if (!hasReviewAccess(interaction.user.id, interaction.member, state)) {
    await interaction.editReply(
      "Only the still-authorized host can cancel this scouter draft.",
    );
    return;
  }
  try {
    const result = await cancelScouterDraft(state.draftId, interaction.user.id);
    await interaction.message.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(0x747f8d)
          .setTitle("Scouter Draft Cancelled")
          .setDescription(
            "No canonical scouter game was written from this draft.",
          )
          .addFields({ name: "Host", value: `<@${interaction.user.id}>` })
          .setTimestamp(),
      ],
      components: [],
    });
    await interaction.editReply(
      result.code === "already_cancelled"
        ? "This draft was already cancelled."
        : "Draft cancelled.",
    );
  } catch (error) {
    await interaction.editReply(formatScouterError(error));
  }
}

export function buildUploadButton(state: UploadState): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(serializeUploadState(BUTTON_PREFIX, state))
    .setLabel(`Upload Game ${state.gameOrdinal}`)
    .setStyle(ButtonStyle.Primary);
}

export function parseUploadState(customId: string): UploadState {
  const [
    prefix,
    matchScopeId,
    ordinalRaw,
    totalRaw,
    seasonId,
    ownerDiscordId,
    ...extra
  ] = customId.split(":");
  const gameOrdinal = Number(ordinalRaw);
  const totalGames = Number(totalRaw);
  if (
    (prefix !== BUTTON_PREFIX && prefix !== MODAL_PREFIX) ||
    extra.length > 0 ||
    !matchScopeId ||
    !seasonId ||
    !ownerDiscordId ||
    !Number.isInteger(gameOrdinal) ||
    !Number.isInteger(totalGames) ||
    gameOrdinal < 1 ||
    totalGames < gameOrdinal ||
    totalGames > 5
  ) {
    throw new Error(
      "Invalid or expired scouter upload state. Run /log-scouter again.",
    );
  }
  return {
    matchScopeId: decodeStateIdentifier(matchScopeId),
    gameOrdinal,
    totalGames,
    seasonId: decodeStateIdentifier(seasonId),
    ownerDiscordId: decodeURIComponent(ownerDiscordId),
  };
}

export function buildScouterReceiptEmbed(
  receipt: ScouterReceipt,
  hostedByDiscordId: string,
  receiptUrl: string,
): EmbedBuilder {
  const participants = receipt.games.flatMap((game) => game.participants);
  const linked = participants.filter(
    (participant) => participant.playerId !== null,
  ).length;
  const unlinked = [
    ...new Set(
      participants
        .filter((participant) => participant.playerId === null)
        .map((participant) => participant.rawIgn),
    ),
  ];
  const results = receipt.games
    .map((game) => {
      const winner = game.winningSide
        ? game.winningSide.charAt(0).toUpperCase() + game.winningSide.slice(1)
        : "Unknown winner";
      const smiteId = game.smiteMatchId ? ` — ${game.smiteMatchId}` : "";
      return `Game ${game.gameOrdinal}: ${winner}${smiteId}`;
    })
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("✅ Scouter Match Recorded")
    .setURL(receiptUrl)
    .addFields(
      { name: "Season", value: receipt.seasonId, inline: true },
      { name: "Games", value: String(receipt.games.length), inline: true },
      { name: "Hosted By", value: `<@${hostedByDiscordId}>`, inline: true },
      { name: "Results", value: results || "No games recorded." },
      {
        name: "Participants",
        value: `${participants.length} extracted · ${linked} linked · ${participants.length - linked} unlinked`,
      },
    )
    .setFooter({ text: `Scouter match ${receipt.id}` })
    .setTimestamp(new Date(receipt.hostedAt));

  if (unlinked.length > 0) {
    embed.addFields({
      name: "Unlinked IGNs",
      value: unlinked.join(", ").slice(0, 1024),
    });
  }
  return embed;
}

function buildUploadModal(state: UploadState): ModalBuilder {
  const scoreboard = new FileUploadBuilder()
    .setCustomId("scoreboard")
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired();
  const details = new FileUploadBuilder()
    .setCustomId("details")
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired();

  return new ModalBuilder()
    .setCustomId(serializeUploadState(MODAL_PREFIX, state))
    .setTitle(`Scouter Game ${state.gameOrdinal} of ${state.totalGames}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("SCOREBOARD tab screenshot")
        .setDescription("Upload the end-of-game SCOREBOARD image.")
        .setFileUploadComponent(scoreboard),
      new LabelBuilder()
        .setLabel("DETAILS tab screenshot")
        .setDescription("Upload the matching end-of-game DETAILS image.")
        .setFileUploadComponent(details),
    );
}

function buildScouterProgressEmbed(
  state: UploadState,
  hostedByDiscordId: string,
  completedGame?: number,
): EmbedBuilder {
  const description = completedGame
    ? `Game ${completedGame} is confirmed. The host can now upload game ${state.gameOrdinal}.`
    : `The host can upload game ${state.gameOrdinal}. This message will become the final receipt after every game is reviewed and confirmed.`;
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Scouter Match Upload")
    .setDescription(description)
    .addFields(
      {
        name: "Progress",
        value: `${state.gameOrdinal - 1} / ${state.totalGames} games`,
        inline: true,
      },
      { name: "Hosted By", value: `<@${hostedByDiscordId}>`, inline: true },
      { name: "Season", value: state.seasonId, inline: true },
    )
    .setFooter({
      text: "Each OCR result must be reviewed before it is recorded.",
    })
    .setTimestamp();
}

function buildAlreadyRecordedEmbed(
  receiptUrl: string,
  hostedByDiscordId: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("Scouter Game Already Recorded")
    .setURL(receiptUrl)
    .setDescription(
      `[Open the existing receipt](${receiptUrl}). No duplicate was written.`,
    )
    .addFields({ name: "Submitted By", value: `<@${hostedByDiscordId}>` })
    .setTimestamp();
}

async function publishFinalScouterReceipt(
  publicMessage: Message,
  scouterMatchId: string,
  receiptUrl: string,
  hostedByDiscordId: string,
) {
  const receipt = await getScouterMatchReceipt(db, scouterMatchId);
  const files = receipt.games.flatMap((game) => [
    {
      attachment: getScouterImagePublicUrl(db, game.scoreboardImagePath),
      name: attachmentName(
        game.gameOrdinal,
        "scoreboard",
        game.scoreboardImagePath,
      ),
    },
    {
      attachment: getScouterImagePublicUrl(db, game.detailsImagePath),
      name: attachmentName(game.gameOrdinal, "details", game.detailsImagePath),
    },
  ]);
  await publicMessage.edit({
    embeds: [buildScouterReceiptEmbed(receipt, hostedByDiscordId, receiptUrl)],
    components: [],
    files,
  });
  await publicMessage.react("✅");
}

function serializeUploadState(
  prefix: typeof BUTTON_PREFIX | typeof MODAL_PREFIX,
  state: UploadState,
) {
  const customId = [
    prefix,
    encodeStateIdentifier(state.matchScopeId),
    state.gameOrdinal,
    state.totalGames,
    encodeStateIdentifier(state.seasonId),
    encodeURIComponent(state.ownerDiscordId),
  ].join(":");
  if (customId.length > 100) {
    throw new Error("Scouter upload state exceeds Discord limits.");
  }
  return customId;
}

function encodeStateIdentifier(value: string): string {
  const compactUuid = value
    .toLowerCase()
    .match(
      /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/,
    );
  return compactUuid
    ? `u${compactUuid.slice(1).join("")}`
    : encodeURIComponent(value);
}

function decodeStateIdentifier(value: string): string {
  const compactUuid = value.match(/^u([0-9a-f]{32})$/);
  if (!compactUuid) return decodeURIComponent(value);

  const uuid = compactUuid[1];
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}

function hasReviewAccess(
  userId: string,
  member: ButtonInteraction["member"],
  state: ScouterReviewState,
) {
  return (
    userId === state.ownerDiscordId && hasCommandAccess(member, "log-scouter")
  );
}

function requireDraftNumber(value: number | undefined, label: string) {
  if (!Number.isInteger(value) || (value ?? 0) < 1) {
    throw new Error(`Scouter draft is missing its ${label}.`);
  }
  return value as number;
}

function toScouterAttachment(attachment: Attachment) {
  return {
    id: attachment.id,
    url: attachment.url,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

function requirePublicMessage(message: Message | null): Message {
  if (!message) {
    throw new Error(
      "Could not locate the public scouter upload message. Run /log-scouter again.",
    );
  }
  return message;
}

function attachmentName(
  gameOrdinal: number,
  kind: "scoreboard" | "details",
  path: string,
) {
  const extension = path.split(".").at(-1)?.toLowerCase() || "jpg";
  return `game-${gameOrdinal}-${kind}.${extension}`;
}

function formatScouterError(error: unknown): string {
  if (error instanceof ScouterIngestError) {
    const raw = error.rawResponse
      ? `\n\nRaw OCR response:\n\`\`\`\n${error.rawResponse.slice(0, 1200)}\n\`\`\``
      : "";
    return `Scouter workflow failed: ${error.message}${raw}`.slice(0, 1900);
  }
  return `Scouter workflow failed: ${error instanceof Error ? error.message : String(error)}`.slice(
    0,
    1900,
  );
}
