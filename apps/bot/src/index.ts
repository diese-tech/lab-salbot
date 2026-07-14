import { Client, GatewayIntentBits } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { isAdminUser } from '@salbot/db';
import { db } from './lib/db';
import { validateRequiredEnv } from './lib/config';
import { subscribeToGodDraftRecaps } from './lib/god-draft-recap';
import { handleProofUpload, activeProofThreads } from './lib/proof-thread';

// Command modules
import * as reportResult from './commands/report-result';
import * as reschedule from './commands/reschedule';
import * as requestAdminReview from './commands/request-admin-review';
import * as updateIgn from './commands/update-ign';
import * as rules from './commands/rules';
import * as divisionRoleConfig from './commands/division-role-config';
import * as divisionSync from './commands/division-sync';

// Approval handlers
import {
  handleApproveButton,
  handleDenyButton,
  handleDenyModal,
  handleNeedsInfoButton,
  handleNeedsInfoModal,
  handleApproveStatButton,
  handleRejectStatButton,
  handleRejectStatModal,
} from './handlers/approval';

type CommandModule = {
  data: { name: string };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

const commands = new Map<string, CommandModule>([
  [reportResult.data.name, reportResult],
  [reschedule.data.name, reschedule],
  [requestAdminReview.data.name, requestAdminReview],
  [updateIgn.data.name, updateIgn],
  [rules.data.name, rules],
  [divisionRoleConfig.data.name, divisionRoleConfig],
  [divisionSync.data.name, divisionSync],
]);

validateRequiredEnv();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`[bot] Ready as ${client.user?.tag}`);
  console.log(`[bot] Loaded commands: ${[...commands.keys()].join(', ')}`);
  console.log('[bot] Required intents: Guilds, GuildMembers, GuildMessages, MessageContent');
  console.log('[bot] Required permissions: Manage Roles for /division-sync role updates');
  console.log(`[bot] Admin review channel: ${process.env.CHANNEL_ADMIN_REVIEW ?? 'NOT SET'}`);
  subscribeToGodDraftRecaps(client, db);
});

// ── Interaction handler ────────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
      return;
    }

    // String select menus
    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      if (id === 'rr_match') {
        await reportResult.handleMatchSelect(interaction);
      } else if (id.startsWith('rr_winner:')) {
        await reportResult.handleWinnerSelect(interaction);
      } else if (id === 'rs_match') {
        await reschedule.handleMatchSelect(interaction);
      }
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      const [action, entityId] = interaction.customId.split(':');

      // Admin-only actions
      if (['approve', 'deny', 'needs_info', 'approve_stat', 'reject_stat'].includes(action)) {
        const isAdmin = await isAdminUser(db, interaction.user.id);
        if (!isAdmin) {
          await interaction.reply({ content: 'Only admins can use this button.', ephemeral: true });
          return;
        }
      }

      if (action === 'approve') await handleApproveButton(interaction, entityId);
      else if (action === 'deny') await handleDenyButton(interaction, entityId);
      else if (action === 'needs_info') await handleNeedsInfoButton(interaction, entityId);
      else if (action === 'approve_stat') await handleApproveStatButton(interaction, entityId);
      else if (action === 'reject_stat') await handleRejectStatButton(interaction, entityId);
      return;
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;
      if (id.startsWith('rr_score:')) {
        await reportResult.handleScoreModal(interaction);
      } else if (id.startsWith('rs_modal:')) {
        await reschedule.handleRescheduleModal(interaction);
      } else if (id.startsWith('modal_deny:')) {
        const pendingActionId = id.split(':')[1];
        await handleDenyModal(interaction, pendingActionId);
      } else if (id.startsWith('modal_needs_info:')) {
        const pendingActionId = id.split(':')[1];
        await handleNeedsInfoModal(interaction, pendingActionId);
      } else if (id.startsWith('modal_reject_stat:')) {
        const statRecordId = id.split(':')[1];
        await handleRejectStatModal(interaction, statRecordId);
      }
      return;
    }
  } catch (err) {
    console.error('[bot] Unhandled interaction error:', err);
    try {
      if (!interaction.isRepliable()) return;
      const content = 'An unexpected error occurred. Please try again.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    } catch { /* ignore */ }
  }
});

// ── Proof thread screenshot tracking (Phase 1 stub) ────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot || message.attachments.size === 0) return;
  if (!activeProofThreads.has(message.channelId)) return;
  await handleProofUpload(client, message.channelId, message.attachments.size);
});

client.login(process.env.DISCORD_TOKEN);
