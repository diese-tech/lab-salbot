import { randomUUID } from "crypto";
import type {
  Attachment,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message,
  ModalSubmitInteraction,
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
import { ScouterIngestError, submitScouterGame } from "../lib/scouter-ingest";
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

    const result = await submitScouterGame({
      scoreboardImagePath: scoreboardImage.path,
      detailsImagePath: detailsImage.path,
      gameOrdinal: state.gameOrdinal,
      hostedByDiscordId: interaction.user.id,
      seasonId: state.seasonId,
      ...(state.gameOrdinal > 1 ? { scouterMatchId: state.matchScopeId } : {}),
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

    if (state.gameOrdinal < state.totalGames) {
      const nextState: UploadState = {
        ...state,
        matchScopeId: result.scouterMatchId,
        gameOrdinal: state.gameOrdinal + 1,
      };
      await publicMessage.edit({
        embeds: [
          buildScouterProgressEmbed(
            nextState,
            interaction.user.id,
            state.gameOrdinal,
          ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            buildUploadButton(nextState),
          ),
        ],
      });
      await interaction.editReply(
        `✅ Game ${state.gameOrdinal} recorded. Use the public upload button for game ${nextState.gameOrdinal}.`,
      );
      return;
    }

    const receipt = await getScouterMatchReceipt(db, result.scouterMatchId);
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
        name: attachmentName(
          game.gameOrdinal,
          "details",
          game.detailsImagePath,
        ),
      },
    ]);

    await publicMessage.edit({
      embeds: [
        buildScouterReceiptEmbed(
          receipt,
          interaction.user.id,
          result.receiptUrl,
        ),
      ],
      components: [],
      files,
    });
    await publicMessage.react("✅");
    await interaction.editReply(
      `✅ Scouter match recorded: ${publicMessage.url}`,
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
    ? `Game ${completedGame} is recorded. The host can now upload game ${state.gameOrdinal}.`
    : `The host can upload game ${state.gameOrdinal}. This message will become the final receipt.`;
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
      text: "Original screenshots will be attached here after OCR succeeds.",
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
  if (customId.length > 100)
    throw new Error("Scouter upload state exceeds Discord limits.");
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
  if (!message)
    throw new Error(
      "Could not locate the public scouter upload message. Run /log-scouter again.",
    );
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
    return `Scouter ingest failed: ${error.message}${raw}`.slice(0, 1900);
  }
  return `Scouter upload failed: ${error instanceof Error ? error.message : String(error)}`.slice(
    0,
    1900,
  );
}
