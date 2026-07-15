// /update-ign — player requests an IGN / display name change with screenshot proof.
// Admin approves or denies via the review card in #admin-review.
//
// Channel restriction: players can only invoke this in DISCORD_ALIAS_CHANNEL_IDS.
// Admins (in admin_users) bypass the channel check and can target any player via the
// optional `player` option.

import type { ChatInputCommandInteraction } from 'discord.js';

export const data = {
  name: 'update-ign',
  description: 'Request an in-game name change. Requires a screenshot as proof.',
  options: [
    {
      type: 3, // STRING
      name: 'new_ign',
      description: 'Your new in-game name',
      required: true,
    },
    {
      type: 11, // ATTACHMENT
      name: 'proof',
      description: 'Screenshot showing your new IGN in-game',
      required: true,
    },
    {
      type: 6, // USER
      name: 'player',
      description: '(Admin only) Run this on behalf of another player',
      required: false,
    },
  ],
} as const;

// Phase 2 implementation is not built yet. Until then, execute() just tells the
// player to see an admin — the command definition above is kept stable so it
// can be wired up later without breaking this option schema.
// Full flow (planned):
//   1. Resolve target player (invoker or admin-provided user option)
//   2. Verify invoker is registered player OR is admin (check admin_users)
//   3. Channel check: non-admins must be in DISCORD_ALIAS_CHANNEL_IDS
//   4. Validate attachment is an image MIME type
//   5. createPendingAction({ type: 'alias_change', payload: AliasChangePayload })
//   6. Post admin review card to #admin-review with Approve / Deny buttons
//   7. Ephemeral confirmation to invoker
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    content: "IGN changes aren't available yet — please ask an admin to update your IGN for now.",
    ephemeral: true,
  });
}
