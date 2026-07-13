import type { ChatInputCommandInteraction, Role } from 'discord.js';
import { db } from '../lib/db';
import {
  listConfiguredDivisionRoles,
  requireAdmin,
  setDivisionRoleMapping,
} from '../lib/operations';

export const data = {
  name: 'division-role-config',
  description: 'Configure SAL division Discord roles.',
  options: [
    {
      type: 1, // SUB_COMMAND
      name: 'set',
      description: 'Set the Discord role for a division.',
      options: [
        {
          type: 3, // STRING
          name: 'division',
          description: 'Division id, such as solar, lunar, or terra.',
          required: true,
        },
        {
          type: 8, // ROLE
          name: 'role',
          description: 'Discord role for this division.',
          required: true,
        },
      ],
    },
    {
      type: 1, // SUB_COMMAND
      name: 'list',
      description: 'List configured division roles.',
    },
  ],
} as const;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const adminResult = await requireAdmin(db, interaction.user.id);
  if (adminResult.status !== 'success') {
    await interaction.editReply(adminResult.reason);
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'set') {
    await handleSet(interaction);
    return;
  }

  if (subcommand === 'list') {
    await handleList(interaction);
    return;
  }

  await interaction.editReply('Unknown division role config action.');
}

async function handleSet(interaction: ChatInputCommandInteraction) {
  const division = interaction.options.getString('division', true);
  const role = interaction.options.getRole('role', true) as Role;

  const result = await setDivisionRoleMapping(db, {
    divisionId: division,
    discordRoleId: role.id,
    actorDiscordId: interaction.user.id,
  });

  if (result.status === 'success') {
    await interaction.editReply(`Configured \`${result.data.divisionId}\` to use ${role}.`);
    return;
  }

  await interaction.editReply(`${result.reason}`);
}

async function handleList(interaction: ChatInputCommandInteraction) {
  const mappings = await listConfiguredDivisionRoles(db);

  if (mappings.length === 0) {
    await interaction.editReply('No division role mappings are configured yet.');
    return;
  }

  await interaction.editReply(
    mappings
      .map((mapping) => `\`${mapping.division_id}\` -> <@&${mapping.discord_role_id}>`)
      .join('\n')
  );
}
