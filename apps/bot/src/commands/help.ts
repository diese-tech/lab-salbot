// /help — posts the short command list. Keep this in sync with the Quick
// Reference table in docs/commands.md (the full reference this links to).

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

export const data = {
  name: 'help',
  description: 'List SALBot commands and get a link to the full reference.',
} as const;

const COMMAND_LIST = [
  ['/report-result', 'SAL Operators / Admins', "Report a completed match's score."],
  ['/reschedule', 'Captains', 'Request a new date/time for an upcoming match.'],
  ['/request-admin-review', 'Everyone', 'Escalate an issue directly to admins.'],
  ['/rules', 'Everyone', 'Ask a question about the league ruleset.'],
  ['/update-ign', 'Everyone', 'Request an in-game name change. *(Not yet implemented — ask an admin for now.)*'],
  ['/division-role-config', 'Admins', 'Map a division to a Discord role, or list mappings.'],
  ['/division-sync', 'Admins', "Bulk-sync players' Discord identity and division roles from a CSV."],
  ['/log-scouter', 'SAL Operators / Admins', 'Upload SMITE 2 screenshots and record a public scouter receipt.'],
  ['/profile', 'Everyone', "View your or another linked player's scouter stats."],
  ['/help', 'Everyone', 'Show this list.'],
] as const;

const DOCS_URL = 'https://github.com/diese-tech/lab-salbot/blob/main/docs/commands.md';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const commandList = COMMAND_LIST.map(
    ([name, who, summary]) => `**\`${name}\`** — ${who}\n${summary}`
  ).join('\n\n');
  const description = `${commandList}\n\n📖 [Full command reference](${DOCS_URL}) — exactly what each command does, step by step.`;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('SALBot Commands')
    .setURL(DOCS_URL)
    .setDescription(description);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
