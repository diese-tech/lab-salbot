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

The repository does not currently expose an HTTP readiness endpoint. Do not set
a Railway health-check path until
[`/healthz` issue #45](https://github.com/diese-tech/lab-salbot/issues/45) is
implemented and deployed.

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

Required for all current result, reschedule, and review workflows:

- `CHANNEL_ADMIN_REVIEW`
- `CHANNEL_RESULTS_SOLAR`
- `CHANNEL_RESULTS_LUNAR`
- `CHANNEL_RESULTS_TERRA`
- `CHANNEL_RESCHEDULES_SOLAR`
- `CHANNEL_RESCHEDULES_LUNAR`
- `CHANNEL_RESCHEDULES_TERRA`

Feature-specific variables:

- `SAL_SITE_URL` and `SAL_SITE_INTERNAL_TOKEN` enable standings recalculation.
- `OPENROUTER_API_KEY` enables `/rules`; `OPENROUTER_MODEL_RULES` selects its
  cheap/free text model. Task-specific model variables fall back to the legacy
  `OPENROUTER_MODEL`, then the committed default.
- `OPENROUTER_MODEL_VISION` reserves a multimodal model for image extraction.
  The current scouter OCR call runs in sal-site, where the same variable must
  be configured.

The process fails fast when a startup-required variable is absent. Missing
channel variables are logged at startup and fail only the affected workflow.

## Deployment Verification

Run these checks in staging before promoting a deployment contract change:

1. Verify the build log uses the committed Dockerfile, frozen pnpm install, and
   all three workspace builds.
2. Verify the runtime log reaches `[bot] Ready as ...` once.
3. Verify Railway shows one active deployment, one region, and one replica.
4. Redeploy the same revision. Confirm the outgoing process logs its SIGTERM
   shutdown and the deployment details report zero overlap.
5. Run a read-only bot/database command, then one disposable Discord projection
   suitable for staging. Confirm there is exactly one response or message.
6. Confirm an intentional process failure follows the ten-retry `ON_FAILURE`
   policy, while a clean platform stop is not restarted as a crash.

Record the deployment ID, commit SHA, timestamps, replica count, relevant log
lines, and projection message ID in the private remediation ledger. Repository
configuration alone is not proof that Railway applied the settings or that a
redeploy avoided duplicate Discord work.

## Rollback

Redeploy the last known-good image or commit from Railway, then repeat the
singleton and Discord projection checks above. Do not work around a failed
deployment by temporarily adding replicas or overlap.
