import type { ChatInputCommandInteraction, Role } from 'discord.js';
import { db } from '../lib/db';
import { listCaptainRoleMappings, requireAdmin, setCaptainRoleMapping } from '../lib/operations';

export const data = {
  name: 'captain-role-config', description: 'Configure division-specific Captain roles.',
  options: [
    { type: 1, name: 'set', description: 'Set a Captain role for a division.', options: [
      { type: 3, name: 'division', description: 'solar, lunar, or terra', required: true },
      { type: 8, name: 'role', description: 'Captain Discord role', required: true },
    ] },
    { type: 1, name: 'list', description: 'List configured Captain roles.' },
  ],
} as const;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const admin = await requireAdmin(db, interaction.user.id);
  if (admin.status !== 'success') { await interaction.editReply(admin.reason); return; }
  if (interaction.options.getSubcommand() === 'set') {
    const role = interaction.options.getRole('role', true) as Role;
    const result = await setCaptainRoleMapping(db, {
      divisionId: interaction.options.getString('division', true),
      discordRoleId: role.id, actorDiscordId: interaction.user.id,
    });
    await interaction.editReply(result.status === 'success'
      ? `Configured the ${result.data.divisionId} Captain role as ${role}.` : result.reason);
    return;
  }
  const mappings = await listCaptainRoleMappings(db);
  await interaction.editReply(mappings.length
    ? mappings.map((mapping) => `\`${mapping.division_id}\` -> <@&${mapping.discord_role_id}>`).join('\n')
    : 'No Captain role mappings are configured.');
}
