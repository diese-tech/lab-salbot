import type { ChatInputCommandInteraction, Role } from "discord.js";
import { db } from "../lib/db";
import {
  listOrganizationRoleMappings,
  requireAdmin,
  setOrganizationRoleMapping,
} from "../lib/operations";

export const data = {
  name: "organization-role-config",
  description: "Configure organization owner/advisor authority roles.",
  options: [
    {
      type: 1,
      name: "set",
      description: "Set an organization role.",
      options: [
        {
          type: 3,
          name: "organization",
          description: "Canonical organization ID",
          required: true,
        },
        {
          type: 8,
          name: "role",
          description: "Organization owner/advisor role",
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: "list",
      description: "List configured organization roles.",
    },
  ],
} as const;

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const admin = await requireAdmin(db, interaction.user.id);
  if (admin.status !== "success") {
    await interaction.editReply(admin.reason);
    return;
  }
  if (interaction.options.getSubcommand() === "set") {
    const role = interaction.options.getRole("role", true) as Role;
    const result = await setOrganizationRoleMapping(db, {
      orgId: interaction.options.getString("organization", true),
      discordRoleId: role.id,
      actorDiscordId: interaction.user.id,
    });
    await interaction.editReply(
      result.status === "success"
        ? `Configured ${result.data.orgName} (${result.data.orgTag}) owner/advisor authority as ${role}.`
        : result.reason,
    );
    return;
  }
  const mappings = await listOrganizationRoleMappings(db);
  await interaction.editReply(
    mappings.length
      ? mappings
          .map((mapping) => {
            const org = Array.isArray(mapping.org)
              ? mapping.org[0]
              : mapping.org;
            return `\`${org?.tag ?? mapping.org_id}\` -> <@&${mapping.discord_role_id}>`;
          })
          .join("\n")
      : "No organization role mappings are configured.",
  );
}
