import { randomUUID } from "node:crypto";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  createRosterDrop,
  getRosterTradeSetup,
  type RosterTradeOrganization,
} from "@salbot/db";
import { db } from "../lib/db";
import { getTradeDivisionForChannel } from "../lib/channels";
import { UserFacingError } from "../lib/errors";
import { requestImmediateOutboxDrain } from "../lib/outbox-runtime";
import { authorizedForRosterOrganization } from "../lib/roster-authorization";

export const data = {
  name: "drop",
  description:
    "Request an administrator-reviewed roster drop in this division.",
} as const;

type DropWizard = {
  id: string;
  actorDiscordId: string;
  channelId: string;
  seasonId: string;
  divisionId: string;
  organizations: RosterTradeOrganization[];
  orgId?: string;
  playerId?: string;
  expiresAt: number;
};

const dropWizards = new Map<string, DropWizard>();

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const divisionId = getTradeDivisionForChannel(interaction.channelId);
  if (!divisionId) {
    await interaction.reply({
      content: "Use `/drop` in your division’s configured trade-block channel.",
      ephemeral: true,
    });
    return;
  }
  if (!interaction.guildId) {
    await interaction.reply({
      content: "`/drop` is only available in the SAL server.",
      ephemeral: true,
    });
    return;
  }
  const setup = await getRosterTradeSetup(db, divisionId);
  if (!setup || !setup.dropsOpen) {
    await interaction.reply({
      content: "Drops are not currently open for this division.",
      ephemeral: true,
    });
    return;
  }
  if (!setup.captainRoleId) {
    await interaction.reply({
      content: "The Captain role is not configured for this division.",
      ephemeral: true,
    });
    return;
  }
  const authorizedOrganizations = setup.organizations.filter((org) =>
    authorizedForRosterOrganization(
      interaction.member,
      interaction.user.id,
      setup.captainRoleId!,
      org,
    ),
  );
  if (authorizedOrganizations.length === 0) {
    await interaction.reply({
      content:
        "You are not an admin, organization owner/advisor, or current captain in this division.",
      ephemeral: true,
    });
    return;
  }

  const wizard: DropWizard = {
    id: randomUUID().slice(0, 12),
    actorDiscordId: interaction.user.id,
    channelId: interaction.channelId,
    seasonId: setup.seasonId,
    divisionId,
    organizations: setup.organizations,
    expiresAt: Date.now() + 15 * 60_000,
  };
  dropWizards.set(wizard.id, wizard);
  if (authorizedOrganizations.length === 1) {
    wizard.orgId = authorizedOrganizations[0].id;
    await interaction.reply({
      content: `**Roster Drop — Step 1 of 2:** Select a player from ${authorizedOrganizations[0].name}.`,
      components: [playerSelect(wizard, authorizedOrganizations[0])],
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({
    content:
      "**Roster Drop — Step 1 of 3:** Select the organization releasing the player.",
    components: [organizationSelect(wizard, authorizedOrganizations)],
    ephemeral: true,
  });
}

export async function handleDropSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [action, wizardId] = interaction.customId.split(":");
  const wizard = requireWizard(
    wizardId,
    interaction.user.id,
    interaction.channelId,
  );
  if (action === "dr_org") {
    const org = requireOrganization(wizard, interaction.values[0]);
    wizard.orgId = org.id;
    wizard.playerId = undefined;
    await interaction.update({
      content: `**Roster Drop — Step 2 of 3:** Select a player from ${org.name}.`,
      components: [playerSelect(wizard, org)],
    });
    return;
  }
  if (action !== "dr_player") return;
  const org = requireOrganization(wizard, wizard.orgId);
  const player = org.players.find(
    (candidate) => candidate.id === interaction.values[0],
  );
  if (!player)
    throw new UserFacingError(
      "That player is no longer on the selected roster.",
    );
  wizard.playerId = player.id;
  await interaction.update({
    content: [
      "**Roster Drop — Private Review**",
      `Organization: ${org.name} (${org.tag})`,
      `Player: ${player.name}`,
      "",
      "Submitting creates an admin review request. The roster will not change unless an admin approves it.",
    ].join("\n"),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`dr_submit:${wizard.id}`)
          .setLabel("Submit Drop Request")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`dr_cancel:${wizard.id}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function handleDropButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const [action, wizardId] = interaction.customId.split(":");
  const wizard = requireWizard(
    wizardId,
    interaction.user.id,
    interaction.channelId,
  );
  if (action === "dr_cancel") {
    dropWizards.delete(wizard.id);
    await interaction.update({
      content: "Drop request cancelled. Nothing was submitted.",
      components: [],
    });
    return;
  }
  if (action !== "dr_submit" || !wizard.orgId || !wizard.playerId) {
    throw new UserFacingError(
      "This drop request is incomplete. Start `/drop` again.",
    );
  }
  const setup = await getRosterTradeSetup(db, wizard.divisionId);
  const org = setup?.organizations.find(
    (candidate) => candidate.id === wizard.orgId,
  );
  const player = org?.players.find(
    (candidate) => candidate.id === wizard.playerId,
  );
  if (
    !setup ||
    setup.seasonId !== wizard.seasonId ||
    !setup.dropsOpen ||
    !setup.captainRoleId ||
    !org ||
    !player ||
    !authorizedForRosterOrganization(
      interaction.member,
      interaction.user.id,
      setup.captainRoleId,
      org,
    )
  ) {
    throw new UserFacingError(
      "Drop availability, roster state, or your authorization changed. Start `/drop` again.",
    );
  }
  await interaction.deferUpdate();
  const result = await createRosterDrop(db, {
    actorDiscordId: interaction.user.id,
    seasonId: wizard.seasonId,
    divisionId: wizard.divisionId,
    orgId: org.id,
    playerId: player.id,
  });
  dropWizards.delete(wizard.id);
  requestImmediateOutboxDrain();
  await interaction.editReply({
    content: `Drop request submitted for ${player.name}. No roster change has occurred; administrators must review it. Reference: ${result.transactionId}`,
    components: [],
  });
}

function organizationSelect(
  wizard: DropWizard,
  organizations: RosterTradeOrganization[],
) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`dr_org:${wizard.id}`)
      .setPlaceholder("Select an organization")
      .addOptions(
        organizations
          .slice(0, 25)
          .map((org) => ({ label: `${org.name} (${org.tag})`, value: org.id })),
      ),
  );
}

function playerSelect(wizard: DropWizard, org: RosterTradeOrganization) {
  if (org.players.length === 0)
    throw new UserFacingError(
      "That organization has no active rostered players.",
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`dr_player:${wizard.id}`)
      .setPlaceholder("Select the player to drop")
      .addOptions(
        org.players
          .slice(0, 25)
          .map((player) => ({ label: player.name, value: player.id })),
      ),
  );
}

function requireWizard(
  id: string,
  actorDiscordId: string,
  channelId: string,
): DropWizard {
  pruneWizards();
  const wizard = dropWizards.get(id);
  if (
    !wizard ||
    wizard.actorDiscordId !== actorDiscordId ||
    wizard.channelId !== channelId
  ) {
    throw new UserFacingError(
      "This private drop wizard expired or belongs to another user. Start `/drop` again.",
    );
  }
  return wizard;
}

function requireOrganization(
  wizard: DropWizard,
  orgId: string | undefined,
): RosterTradeOrganization {
  const org = orgId
    ? wizard.organizations.find((candidate) => candidate.id === orgId)
    : undefined;
  if (!org)
    throw new UserFacingError(
      "The selected organization is no longer available.",
    );
  return org;
}

function pruneWizards(): void {
  const now = Date.now();
  for (const [id, wizard] of dropWizards)
    if (wizard.expiresAt <= now) dropWizards.delete(id);
}
