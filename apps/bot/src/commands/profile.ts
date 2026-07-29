import type {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  getPlayerByDiscordId,
  getPlayerScouterProfile,
  type PlayerScouterProfile,
} from "@salbot/db";
import { db } from "../lib/db";

type ProfileDependencies = {
  siteUrl?: string;
};

type ProfilePlayer = {
  id: string;
  discord_id: string | null;
  discord_username: string;
  ign: string;
  display_alias: string | null;
};

const SELECT_PREFIX = "profile_season";

export const data = {
  name: "profile",
  description: "View a player's scouter stats and full SAL profile.",
  options: [
    {
      type: 6, // USER
      name: "player",
      description: "Discord player to view (defaults to you).",
      required: false,
    },
  ],
} as const;

export async function execute(
  interaction: ChatInputCommandInteraction,
  dependencies: ProfileDependencies = {},
): Promise<void> {
  const target = interaction.options.getUser("player") ?? interaction.user;
  const player = await getPlayerByDiscordId(db, target.id);
  if (!player) {
    await interaction.reply({
      content: "That Discord user is not linked to a SAL player profile.",
      ephemeral: true,
    });
    return;
  }

  const profile = await getPlayerScouterProfile(db, player.id);
  await interaction.reply({
    ...buildProfileResponse(
      player,
      profile,
      interaction.user.id,
      target.id,
      dependencies.siteUrl ?? process.env.SAL_SITE_URL,
    ),
    ephemeral: true,
  });
}

export async function handleSeasonSelect(
  interaction: StringSelectMenuInteraction,
  dependencies: ProfileDependencies = {},
): Promise<void> {
  const [prefix, ownerDiscordId, targetDiscordId, ...extra] =
    interaction.customId.split(":");
  if (
    prefix !== SELECT_PREFIX ||
    extra.length > 0 ||
    !ownerDiscordId ||
    !targetDiscordId
  ) {
    await interaction.reply({
      content: "This profile selector is invalid. Run /profile again.",
      ephemeral: true,
    });
    return;
  }
  if (interaction.user.id !== ownerDiscordId) {
    await interaction.reply({
      content: "Only the person who opened this profile can change its season.",
      ephemeral: true,
    });
    return;
  }

  const player = await getPlayerByDiscordId(db, targetDiscordId);
  if (!player) {
    await interaction.update({
      content: "This player is no longer linked to a SAL profile.",
      embeds: [],
      components: [],
    });
    return;
  }

  const profile = await getPlayerScouterProfile(
    db,
    player.id,
    interaction.values[0],
  );
  await interaction.update(
    buildProfileResponse(
      player,
      profile,
      ownerDiscordId,
      targetDiscordId,
      dependencies.siteUrl ?? process.env.SAL_SITE_URL,
    ),
  );
}

function buildProfileResponse(
  player: ProfilePlayer,
  profile: PlayerScouterProfile,
  ownerDiscordId: string,
  targetDiscordId: string,
  siteUrl?: string,
) {
  const seasonName = profile.selectedSeason?.name ?? "No active season";
  const url = buildProfileUrl(siteUrl, player.id, profile.selectedSeason?.id);
  const embed = new EmbedBuilder()
    .setColor(0x22d3ee)
    .setTitle(`${player.display_alias ?? player.ign} — Scouters`)
    .setDescription(`Scouter results for **${seasonName}**.`)
    .addFields(
      {
        name: "Games",
        value: String(profile.summary.gamesPlayed),
        inline: true,
      },
      {
        name: "Record",
        value: `${profile.summary.wins}-${profile.summary.losses}`,
        inline: true,
      },
      {
        name: "Avg KDA",
        value: profile.summary.averageKda.toFixed(2),
        inline: true,
      },
      {
        name: "Avg Damage",
        value: profile.summary.averageDamage.toLocaleString("en-US"),
        inline: true,
      },
    )
    .setFooter({ text: `SAL player ${player.id}` })
    .setTimestamp();
  if (url) embed.setURL(url);

  const components: Array<
    ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
  > = [];
  if (url) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Scouters")
          .setStyle(ButtonStyle.Link)
          .setURL(url),
      ),
    );
  }

  if (profile.availableSeasons.length > 0) {
    const customId = `${SELECT_PREFIX}:${ownerDiscordId}:${targetDiscordId}`;
    if (customId.length > 100) {
      throw new Error("Profile selector exceeds Discord limits.");
    }
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder("Choose a scouter season")
          .addOptions(
            profile.availableSeasons.slice(0, 25).map((season) => ({
              label: season.name.slice(0, 100),
              value: season.id,
              default: season.id === profile.selectedSeason?.id,
            })),
          ),
      ),
    );
  }

  return { embeds: [embed], components };
}

function buildProfileUrl(
  siteUrl: string | undefined,
  playerId: string,
  seasonId?: string,
): string | null {
  if (!siteUrl) return null;
  try {
    const url = new URL(`/players/${encodeURIComponent(playerId)}`, siteUrl);
    if (seasonId) url.searchParams.set("season", seasonId);
    return url.toString();
  } catch {
    return null;
  }
}
