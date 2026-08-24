import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { RosterDrop } from "@salbot/db";

export function buildDropAdminEmbed(drop: RosterDrop): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("Roster Drop — Admin Review")
    .setDescription(`Transaction ${drop.id} • ${drop.divisionId.toUpperCase()}`)
    .addFields(
      {
        name: "Organization",
        value: `${drop.organization.name} (${drop.organization.tag})`,
        inline: true,
      },
      { name: "Player", value: drop.player.name, inline: true },
      {
        name: "Choose post-drop eligibility",
        value: [
          "**Eligible** — immediately available as a same-division free agent.",
          "**Suspend** — unavailable until the private expiration time.",
          "**Season Ineligible** — unavailable for the rest of this season.",
        ].join("\n"),
      },
      {
        name: "Safety",
        value:
          "Approval revalidates roster ownership and open-drop settings in the database. No roster has changed yet.",
      },
    )
    .setFooter({ text: `sal-drop-review:${drop.pendingActionId}` })
    .setTimestamp();
}

export function buildDropApprovalButtons(actionId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`drop_eligibility:eligible:${actionId}`)
      .setLabel("Approve — Eligible")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`drop_eligibility:suspended_until:${actionId}`)
      .setLabel("Approve — Suspend")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`drop_eligibility:ineligible_for_season:${actionId}`)
      .setLabel("Approve — Season Ineligible")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`deny:${actionId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`needs_info:${actionId}`)
      .setLabel("Needs Info")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function buildCompletedDropLine(drop: RosterDrop): string {
  return `[${drop.divisionId.toUpperCase()}] ${drop.organization.tag} dropped ${drop.player.name}`;
}
