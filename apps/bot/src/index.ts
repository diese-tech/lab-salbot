import { Client, GatewayIntentBits } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  claimOperationOutbox,
  completeOperationOutbox,
  failOperationOutbox,
  getOperationOutboxHealth,
  isAdminUser,
  markOperationOutboxNeedsReconciliation,
} from "@salbot/db";
import { db } from "./lib/db";
import { validateRequiredEnv, warnOnMissingChannelEnv } from "./lib/config";
import { subscribeToGodDraftRecaps } from "./lib/god-draft-recap";
import { handleProofUpload, activeProofThreads } from "./lib/proof-thread";
import { toUserMessage } from "./lib/errors";
import { createOutboxProjector } from "./lib/outbox-projections";
import { registerOutboxDrain } from "./lib/outbox-runtime";
import { OperationOutboxWorker } from "./lib/outbox-worker";
import { OutboxLagMonitor } from "./lib/outbox-lag-monitor";
import {
  startHealthServer,
  type RunningHealthServer,
} from "./lib/health-server";
import { ReadinessMonitor } from "./lib/readiness";
import { createShutdownHandler } from "./lib/shutdown";

// Command modules
import * as reportResult from "./commands/report-result";
import * as reschedule from "./commands/reschedule";
import * as requestAdminReview from "./commands/request-admin-review";
import * as updateIgn from "./commands/update-ign";
import * as rules from "./commands/rules";
import * as divisionRoleConfig from "./commands/division-role-config";
import * as divisionSync from "./commands/division-sync";
import * as logScouter from "./commands/log-scouter";
import * as profile from "./commands/profile";
import * as help from "./commands/help";
import * as trade from "./commands/trade";
import * as drop from "./commands/drop";
import * as captainRoleConfig from "./commands/captain-role-config";
import * as organizationRoleConfig from "./commands/organization-role-config";

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
  handleDropEligibilityButton,
  handleDropEligibilityModal,
} from "./handlers/approval";

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
  [logScouter.data.name, logScouter],
  [profile.data.name, profile],
  [help.data.name, help],
  [trade.data.name, trade],
  [drop.data.name, drop],
  [captainRoleConfig.data.name, captainRoleConfig],
  [organizationRoleConfig.data.name, organizationRoleConfig],
]);

validateRequiredEnv();
warnOnMissingChannelEnv();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function componentLog(component: string) {
  return (
    level: "info" | "warn" | "error",
    event: string,
    details: Record<string, unknown> = {},
  ) => {
    const message = JSON.stringify({ component, event, ...details });
    if (level === "error") console.error(message);
    else if (level === "warn") console.warn(message);
    else console.log(message);
  };
}

const outboxWorker = new OperationOutboxWorker(
  {
    claim: (workerId, limit) => claimOperationOutbox(db, workerId, limit),
    project: createOutboxProjector(client, db),
    complete: (outboxId, workerId, externalId) =>
      completeOperationOutbox(db, outboxId, workerId, externalId),
    fail: (outboxId, workerId, error, retryAfterSeconds) =>
      failOperationOutbox(db, outboxId, workerId, error, retryAfterSeconds),
    reconcileAmbiguity: (outboxId, workerId, error) =>
      markOperationOutboxNeedsReconciliation(db, outboxId, workerId, error),
    log: componentLog("operation_outbox"),
  },
  { workerId: `${hostname()}:${process.pid}:${randomUUID()}` },
);
registerOutboxDrain(() => outboxWorker.drainNow());

// Samples outbox backlog age on an interval so a stuck or slow-draining
// outbox surfaces in logs/metrics on its own, not only when someone polls
// /healthz. See docs/observability.md.
const outboxLagMonitor = new OutboxLagMonitor({
  checkHealth: () => getOperationOutboxHealth(db),
  log: componentLog("operation_outbox_lag"),
});

const readiness = new ReadinessMonitor({
  isDiscordReady: () => client.isReady(),
  getOutboxStatus: () => outboxWorker.getStatus(),
  checkDatabase: () => getOperationOutboxHealth(db),
});
let healthServer: RunningHealthServer | undefined;

const shutdown = createShutdownHandler({
  beginDrain: () => readiness.beginDrain(),
  stopOutbox: () => outboxWorker.stop(25_000),
  stopOutboxLagMonitor: () => outboxLagMonitor.stop(),
  destroyDiscord: () => client.destroy(),
  closeHealthServer: async () => {
    if (healthServer) await healthServer.close();
  },
  exit: (code) => process.exit(code),
  log: (message, error) => console.error(message, error),
});

// ── Process-level safety handlers ──────────────────────────────────────────────
// Log-and-continue on unhandled rejections so a stray rejected promise doesn't
// take the whole bot down (Node >=15 terminates the process by default).
process.on("unhandledRejection", (reason) => {
  console.error("[bot] Unhandled rejection:", reason);
});

// Graceful shutdown on SIGTERM (e.g. Railway redeploys killing the process mid-operation).
process.on("SIGTERM", () => {
  console.log("[bot] SIGTERM received, shutting down...");
  void shutdown();
});

client.once("ready", async () => {
  console.log(`[bot] Ready as ${client.user?.tag}`);
  console.log(`[bot] Loaded commands: ${[...commands.keys()].join(", ")}`);
  console.log(
    "[bot] Required intents: Guilds, GuildMembers, GuildMessages, MessageContent",
  );
  console.log(
    "[bot] Required permissions: Manage Roles for /division-sync role updates",
  );
  console.log(
    `[bot] Admin review channel: ${process.env.CHANNEL_ADMIN_REVIEW ?? "NOT SET"}`,
  );
  subscribeToGodDraftRecaps(client, db);
  await outboxWorker.start();
  outboxLagMonitor.start();
});

// ── Interaction handler ────────────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  try {
    if (readiness.isDraining()) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: "SALBot is restarting. Please retry in a moment.",
          ephemeral: true,
        });
      }
      return;
    }

    // Slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
      return;
    }

    // String select menus
    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      if (id === "rr_match") {
        await reportResult.handleMatchSelect(interaction);
      } else if (id.startsWith("rr_winner:")) {
        await reportResult.handleWinnerSelect(interaction);
      } else if (id === "rs_match") {
        await reschedule.handleMatchSelect(interaction);
      } else if (id.startsWith("profile_season:")) {
        await profile.handleSeasonSelect(interaction);
      } else if (id.startsWith("sc_ed:")) {
        await logScouter.handleReviewSelect(interaction);
      } else if (id.startsWith("tr_counter_offer:")) {
        await trade.handleTradeCounterSelect(interaction);
      } else if (id.startsWith("tr_")) {
        await trade.handleTradeSelect(interaction);
      } else if (id.startsWith("dr_")) {
        await drop.handleDropSelect(interaction);
      }
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("help:")) {
        await help.handleHelpButton(interaction);
        return;
      }
      if (interaction.customId.startsWith("tr_")) {
        await trade.handleTradeWizardButton(interaction);
        return;
      }
      if (interaction.customId.startsWith("dr_")) {
        await drop.handleDropButton(interaction);
        return;
      }
      if (interaction.customId.startsWith("trade:")) {
        await trade.handleTradeActionButton(interaction);
        return;
      }
      if (interaction.customId.startsWith("mr_stats:")) {
        await reportResult.handleEnterStatsButton(interaction);
        return;
      }
      if (interaction.customId.startsWith("sc_up:")) {
        await logScouter.handleUploadButton(interaction);
        return;
      }
      if (interaction.customId.startsWith("sc_cf:")) {
        await logScouter.handleConfirmButton(interaction);
        return;
      }
      if (interaction.customId.startsWith("sc_eg:")) {
        await logScouter.handleGameEditButton(interaction);
        return;
      }
      if (interaction.customId.startsWith("sc_ca:")) {
        await logScouter.handleCancelButton(interaction);
        return;
      }

      if (interaction.customId.startsWith("drop_eligibility:")) {
        const [, eligibility, pendingActionId] =
          interaction.customId.split(":");
        const isAdmin = await isAdminUser(db, interaction.user.id);
        if (!isAdmin) {
          await interaction.reply({
            content: "Only admins can use this button.",
            ephemeral: true,
          });
          return;
        }
        if (
          eligibility !== "eligible" &&
          eligibility !== "suspended_until" &&
          eligibility !== "ineligible_for_season"
        ) {
          throw new Error("Unsupported drop eligibility control.");
        }
        await handleDropEligibilityButton(
          interaction,
          pendingActionId,
          eligibility,
        );
        return;
      }

      const [action, entityId] = interaction.customId.split(":");

      // Admin-only actions
      if (
        [
          "approve",
          "deny",
          "needs_info",
          "approve_stat",
          "reject_stat",
        ].includes(action)
      ) {
        const isAdmin = await isAdminUser(db, interaction.user.id);
        if (!isAdmin) {
          await interaction.reply({
            content: "Only admins can use this button.",
            ephemeral: true,
          });
          return;
        }
      }

      if (action === "approve")
        await handleApproveButton(interaction, entityId);
      else if (action === "deny") await handleDenyButton(interaction, entityId);
      else if (action === "needs_info")
        await handleNeedsInfoButton(interaction, entityId);
      else if (action === "approve_stat")
        await handleApproveStatButton(interaction, entityId);
      else if (action === "reject_stat")
        await handleRejectStatButton(interaction, entityId);
      return;
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;
      if (id.startsWith("rr_score:")) {
        await reportResult.handleScoreModal(interaction);
      } else if (id.startsWith("rs_modal:")) {
        await reschedule.handleRescheduleModal(interaction);
      } else if (id.startsWith("modal_deny:")) {
        const pendingActionId = id.split(":")[1];
        await handleDenyModal(interaction, pendingActionId);
      } else if (id.startsWith("modal_needs_info:")) {
        const pendingActionId = id.split(":")[1];
        await handleNeedsInfoModal(interaction, pendingActionId);
      } else if (id.startsWith("modal_reject_stat:")) {
        const statRecordId = id.split(":")[1];
        await handleRejectStatModal(interaction, statRecordId);
      } else if (id.startsWith("modal_drop_eligibility:")) {
        const [, eligibility, pendingActionId] = id.split(":");
        if (
          eligibility !== "suspended_until" &&
          eligibility !== "ineligible_for_season"
        ) {
          throw new Error("Unsupported drop eligibility modal.");
        }
        const isAdmin = await isAdminUser(db, interaction.user.id);
        if (!isAdmin) {
          await interaction.reply({
            content: "Only admins can submit this decision.",
            ephemeral: true,
          });
          return;
        }
        await handleDropEligibilityModal(
          interaction,
          pendingActionId,
          eligibility,
        );
      } else if (id.startsWith("sc_modal:")) {
        await logScouter.handleUploadModal(interaction);
      } else if (id.startsWith("sc_em:")) {
        await logScouter.handleReviewEditModal(interaction);
      } else if (id.startsWith("sc_gm:")) {
        await logScouter.handleGameEditModal(interaction);
      } else if (id.startsWith("sc_cm:")) {
        await logScouter.handleConfirmModal(interaction);
      }
      return;
    }
  } catch (err) {
    console.error("[bot] Unhandled interaction error:", err);
    try {
      if (!interaction.isRepliable()) return;
      const content = toUserMessage(err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    } catch {
      /* ignore */
    }
  }
});

// ── Proof thread screenshot tracking (Phase 1 stub) ────────────────────────────────

client.on("messageCreate", async (message) => {
  if (readiness.isDraining()) return;
  if (message.author.bot || message.attachments.size === 0) return;
  if (!activeProofThreads.has(message.channelId)) return;
  await handleProofUpload(client, message.channelId, message.attachments.size);
});

const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

void startHealthServer(readiness, { port })
  .then(async (server) => {
    healthServer = server;
    console.log(`[bot] Health server listening on port ${server.port}`);
    await client.login(process.env.DISCORD_TOKEN);
  })
  .catch(async (error) => {
    // Bind and login failures are fatal. A permanently non-ready process must
    // exit so Railway can apply the configured restart policy.
    console.error("[bot] Fatal startup failure:", error);
    await healthServer?.close().catch(() => undefined);
    process.exit(1);
  });
