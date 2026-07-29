import type { ChatInputCommandInteraction } from 'discord.js';
import { getRuleset } from '../lib/ruleset';
import { askOpenRouter } from '../lib/openrouter';

export const data = {
  name: 'rules',
  description: 'Ask a question about SAL league rules.',
  options: [
    {
      type: 3, // STRING
      name: 'question',
      description: 'What do you want to know?',
      required: true,
    },
  ],
} as const;

const SYSTEM_PROMPT_TEMPLATE = (ruleset: string) => `\
You are the SAL (Serpent Ascension League) rules assistant.

Your ONLY knowledge source is the ruleset below. Do not use outside knowledge.

Rules:
${ruleset}

Instructions:
- Answer based ONLY on the ruleset above.
- If the ruleset does not cover the question, say so clearly and tell the captain to open an admin ticket for a ruling.
- Always cite the section heading(s) you used (e.g. "Per the Rosters & Substitutions section:").
- Be concise. Captains want a quick, clear answer.
- State at the end: "Admin rulings are final and may override this answer."
`;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.get('question')?.value as string | undefined;
  if (!question) {
    await interaction.reply({ content: 'Please provide a question.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const ruleset = getRuleset();
    const answer = await askOpenRouter('rules-qa', SYSTEM_PROMPT_TEMPLATE(ruleset), question);

    await interaction.editReply({
      embeds: [
        {
          title: '📖 SAL Rules',
          description: answer,
          color: 0x5865f2,
          footer: { text: 'Advisory only — admin rulings are final.' },
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({
      content: `Could not retrieve rules answer: ${message}. Please ask an admin directly.`,
    });
  }
}
