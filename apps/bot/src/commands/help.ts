import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

export const data = {
  name: "help",
  description: "Browse SALBot actions by player, captain/owner, or admin role.",
} as const;

type HelpTab = "player" | "captain" | "admin";
const DOCS_URL =
  "https://github.com/diese-tech/lab-salbot/blob/main/docs/commands.md";

const HELP: Record<
  HelpTab,
  {
    title: string;
    intro: string;
    commands: Array<{ name: string; purpose: string; use: string }>;
  }
> = {
  player: {
    title: "Player Commands",
    intro:
      "Everyday self-service actions. The bot walks you through each command.",
    commands: [
      {
        name: "/profile",
        purpose: "View linked player stats.",
        use: "Run it and choose a season when prompted.",
      },
      {
        name: "/rules",
        purpose: "Ask a league-rules question.",
        use: "Type your question naturally.",
      },
      {
        name: "/request-admin-review",
        purpose: "Privately ask admins to review an issue.",
        use: "Choose the issue type and explain what happened.",
      },
    ],
  },
  captain: {
    title: "Captain & Organization Commands",
    intro: "Team operations with permission called out per action.",
    commands: [
      {
        name: "/trade",
        purpose:
          "Captains, org owners/advisors, and admins: propose or respond to a roster trade.",
        use: "Use it in your division trade-block channel; select organizations and players from menus.",
      },
      {
        name: "/drop",
        purpose:
          "Captains, org owners/advisors, and admins: request an administrator-reviewed roster drop.",
        use: "Use it in your division trade-block channel; select the player and confirm.",
      },
      {
        name: "/reschedule",
        purpose: "Captains and admins: request a new match time.",
        use: "Select the match, then enter the proposed time and reason.",
      },
    ],
  },
  admin: {
    title: "Admin Commands",
    intro:
      "Admins may run every player, captain, owner/advisor, and operator workflow when intervention is needed.",
    commands: [
      {
        name: "/trade · /drop",
        purpose: "Submit roster transactions for any active organization.",
        use: "Use the same guided menus as captains and owners.",
      },
      {
        name: "Admin Review buttons",
        purpose: "Approve, deny, or request information.",
        use: "Drop approval also requires selecting eligible, suspended, or season-ineligible.",
      },
      {
        name: "/captain-role-config",
        purpose: "Map each division Captain role.",
        use: "Set or list division-wide Captain roles.",
      },
      {
        name: "/organization-role-config",
        purpose: "Map organization owner/advisor authority roles.",
        use: "These roles authorize transactions but are never assigned to players.",
      },
      {
        name: "/division-role-config · /division-sync",
        purpose: "Maintain division roles and bulk identity sync.",
        use: "Preview bulk changes before applying.",
      },
      {
        name: "/report-result · /log-scouter",
        purpose: "Run official match and scouter operations.",
        use: "Follow the command prompts and proof workflow.",
      },
    ],
  },
};

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.reply({
    embeds: [helpEmbed("player")],
    components: [helpTabs("player")],
    ephemeral: true,
  });
}

export async function handleHelpButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const tab = interaction.customId.split(":")[1];
  if (!isHelpTab(tab)) return;
  await interaction.update({
    embeds: [helpEmbed(tab)],
    components: [helpTabs(tab)],
  });
}

export function helpEmbed(tab: HelpTab): EmbedBuilder {
  const content = HELP[tab];
  return new EmbedBuilder()
    .setColor(
      tab === "admin" ? 0xed4245 : tab === "captain" ? 0xfee75c : 0x5865f2,
    )
    .setTitle(content.title)
    .setURL(DOCS_URL)
    .setDescription(
      `${content.intro}\n\nYou do not need to memorize syntax—start a command and use the menus.`,
    )
    .addFields(
      content.commands.map((command) => ({
        name: command.name,
        value: `${command.purpose}\n*How:* ${command.use}`,
      })),
    )
    .setFooter({
      text: "Use the tabs below to switch roles • Full reference in the title link",
    });
}

function helpTabs(active: HelpTab) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    tabButton("player", "Player", active),
    tabButton("captain", "Captain / Org", active),
    tabButton("admin", "Admin", active),
  );
}

function tabButton(
  tab: HelpTab,
  label: string,
  active: HelpTab,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`help:${tab}`)
    .setLabel(label)
    .setStyle(tab === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(tab === active);
}

function isHelpTab(value: string | undefined): value is HelpTab {
  return value === "player" || value === "captain" || value === "admin";
}
