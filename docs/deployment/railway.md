# Railway Deployment

SALbot runs as one long-lived Discord gateway process on Railway. The committed
deployment contract is:

- Node.js 24.16.0 in a multi-stage Docker build, pinned to the official
  `bookworm-slim` multi-platform digest
- pnpm 9.0.0 with a frozen lockfile
- a production-only portable workspace bundle produced by `pnpm deploy`
- the unprivileged `node` user in the final image
- `node dist/index.js` as the only production process
- restart on failure, with at most ten retries
- zero configured deployment overlap and a 30-second SIGTERM drain window
- `/healthz` on Railway's injected `PORT`, with a 120-second startup timeout

`/healthz` returns 200 only after Discord is ready, the database probe succeeds,
and the outbox worker completes its first claim. It returns 503 during startup,
dependency loss, and shutdown drain. Responses contain only readiness flags and
outbox counts/age, never credentials or raw dependency errors.

## Create or Reconfigure the Service

1. Connect the Railway service to `diese-tech/lab-salbot`.
2. Use the repository root as the service root directory.
3. Set the config-file path to `/railway.toml` if the service does not use
   Railway's default root config discovery.
4. Confirm the deployment details show `Dockerfile` as the builder and
   `node dist/index.js` as the start command.
5. In service scaling, select exactly one region and set that region to one
   replica. The region identifier is environment-specific, so replica placement
   is an explicit Railway setting rather than a guessed value in
   `railway.toml`.
6. Remove any dashboard override for deployment overlap. The committed config
   sets `overlapSeconds = "0"`; the deployment details must show zero seconds.
7. Leave serverless/app-sleep behavior disabled for this long-lived gateway
   consumer.

SALbot is not designed for horizontal scaling. A second replica or an overlap
override can open a second Discord gateway session and duplicate external
projections. Treat the one-replica and zero-overlap settings as release gates.

## Runtime Variables

Set secrets only in Railway; do not add them to the image or repository.

Required at process startup:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Railway injects `PORT`; local runs default to `3000`.

Required for all current result, reschedule, and review workflows:

- `CHANNEL_ADMIN_REVIEW`
- `CHANNEL_RESULTS_SOLAR`
- `CHANNEL_RESULTS_LUNAR`
- `CHANNEL_RESULTS_TERRA`
- `CHANNEL_RESCHEDULES_SOLAR`
- `CHANNEL_RESCHEDULES_LUNAR`
- `CHANNEL_RESCHEDULES_TERRA`

Feature-specific variables:

- `SAL_SITE_URL` and `SAL_SITE_INTERNAL_TOKEN` deliver durable standings
  recalculation events. Missing or invalid values cause bounded outbox retries
  and eventual dead-lettering; database decisions remain committed.
- `OPENROUTER_API_KEY` enables `/rules`; `OPENROUTER_MODEL_RULES` selects its
  cheap/free text model. Task-specific model variables fall back to the legacy
  `OPENROUTER_MODEL`, then the committed default.
- `OPENROUTER_MODEL_VISION` reserves a multimodal model for image extraction.
  The current scouter OCR call runs in sal-site, where the same variable must
  be configured.

The process fails fast when a startup-required variable is absent. Missing
channel variables are logged at startup and fail only the affected workflow.

## Slash Command Registration

Discord's command picker only shows commands that have been explicitly
registered against the guild via `PUT /applications/{id}/guilds/{guild}/commands`
(`discord.js`'s `Routes.applicationGuildCommands`). This is independent of
deploying the bot process: a merged, running command handler that was never
registered is invisible in Discord even though `/help` (a static embed) lists
it and the bot would handle it correctly if it were ever invoked.

The `Deploy Discord Commands` GitHub Actions workflow
(`.github/workflows/deploy-commands.yml`) runs `pnpm --filter @salbot/bot
deploy:commands` on every push to `main`, registering the full command set.
It requires `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` as
GitHub Actions repository secrets — set them to the same values as the
Railway service's copies. These are separate credential stores; if the
Discord bot token is ever rotated in Railway, update the GitHub secret too or
this workflow will start failing (or silently register against a stale
client ID/guild) the next time a command changes.

This is deliberately not folded into the Railway deploy itself:
`railway.toml` clears `preDeployCommand` and the runtime image intentionally
ships only the compiled bot, no dev scripts (`tsx`, `scripts/deploy-commands.ts`
are not present in the runtime image) — see the `[build]`/`[deploy]` comments
in `railway.toml`.

If commands are ever missing from Discord despite this workflow being green,
run `pnpm --filter @salbot/bot deploy:commands` manually with the production
credentials as a fallback, and check the workflow's run history for the real
cause first.

## Deployment Verification

Run these checks in staging before promoting a deployment contract change:

1. Verify the build log uses the committed Dockerfile, frozen pnpm install, and
   all three workspace builds.
2. Confirm `/healthz` returns 503 before Discord/outbox initialization, then
   transitions to 200 with all four readiness flags truthful.
3. Verify the runtime log reaches `[bot] Ready as ...` once.
4. Verify the first structured `operation_outbox` claim succeeds, including
   after restarting with a committed event waiting in the queue.
5. Verify Railway shows one active deployment, one region, and one replica.
6. Redeploy the same revision. Confirm the outgoing process logs its SIGTERM
   shutdown and the deployment details report zero overlap.
7. During drain, confirm `/healthz` returns 503, new commands are rejected, and
   the process exits before Railway's 30-second SIGKILL deadline. If an active
   projection exceeds 25 seconds, confirm its lease is released for retry.
8. Run a read-only bot/database command, then one disposable Discord projection
   suitable for staging. Confirm there is exactly one response or message.
9. Confirm an intentional process failure follows the ten-retry `ON_FAILURE`
   policy, while a clean platform stop is not restarted as a crash.

Record the deployment ID, commit SHA, timestamps, replica count, relevant log
lines, and projection message ID in the private remediation ledger. Repository
configuration alone is not proof that Railway applied the settings or that a
redeploy avoided duplicate Discord work.

## Rollback

Redeploy the last known-good image or commit from Railway, then repeat the
singleton and Discord projection checks above. Do not work around a failed
deployment by temporarily adding replicas or overlap.
