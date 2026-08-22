# Observability

What the bot logs on its own, without anyone polling `/healthz`, and what to do
when a log line crosses from informational into actionable.

All log lines are single-line JSON on stdout/stderr (`console.log` /
`console.warn` / `console.error`) with a `component` and `event` field, so
they can be filtered and alerted on in whatever log platform ingests Railway's
process output.

---

## Outbox backlog lag

**Component:** `operation_outbox_lag` (`apps/bot/src/lib/outbox-lag-monitor.ts`)

The durable operation outbox (`docs/database/` — `operation_outbox` table,
drained by `apps/bot/src/lib/outbox-worker.ts`) is how match results, stat
records, and admin decisions eventually reach Discord even if Discord or the
bot process is briefly unavailable. A backlog that stops draining is silent
to users until someone notices Discord isn't updating — this monitor makes
it loud instead.

Every 60 seconds (`OutboxLagMonitor`, started alongside the outbox worker in
`index.ts`) the bot samples the oldest `pending`/`processing` row's age and
the current dead-letter count, and logs exactly one of:

| Event | Level | Meaning |
|---|---|---|
| `outbox_lag_ok` | info | Oldest pending row is under 5 minutes old (or there is no backlog). |
| `outbox_lag_warning` | warn | Oldest pending row is 5–15 minutes old. Draining is falling behind. |
| `outbox_lag_alert` | error | Oldest pending row is over 15 minutes old. Treat as an incident. |
| `outbox_dead_letters_present` | error | One or more rows exhausted their retries (logged alongside whichever lag event fired). |
| `outbox_lag_check_failed` | error | The health check itself failed (e.g. Supabase unreachable). |

`outbox_lag_alert` and `outbox_dead_letters_present` are the two lines worth
paging on. On either:

1. Check `GET /healthz` for the same `deadLetterCount` / `oldestPendingAgeSeconds` figures.
2. Follow **P2: Pending Actions Stuck** in `docs/runbooks/incident-handling.md`.
3. Dead-letter rows need a human decision (retry vs. discard) — they do not
   self-heal. Query `operation_outbox where state = 'dead_letter'` to see what's stuck.
4. Also query `operation_outbox where state = 'needs_reconciliation'` for
   ambiguous Discord sends. Confirm the target channel first, then use the
   database `reconcile_operation_outbox` contract to link the existing message
   or explicitly authorize one retry.

Thresholds are configurable per `OutboxLagMonitorOptions` (`warnLagSeconds`,
`alertLagSeconds`, default 300/900) if 5/15 minutes stops being the right
bar for a given deployment's traffic.

---

## OpenRouter model routing

**Component:** `openrouter` (`apps/bot/src/lib/openrouter.ts`)

Model choice per task is environment-driven (`OPENROUTER_MODEL_RULES`,
`OPENROUTER_MODEL_VISION`, falling back to `OPENROUTER_MODEL`, falling back to
a hardcoded default) so it can be changed without a deploy — which also means
it can silently drift without anyone noticing which model is actually live.
Every call now logs which model a task resolved to and what it cost:

| Event | Level | Fields |
|---|---|---|
| `model_routed` | info | `task`, `model`, `latencyMs`, `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCostUsd` |
| `model_routing_failed` | error | `task`, `model`, `latencyMs`, plus `status` (HTTP failure) or `error` (network/transport failure) |

`estimatedCostUsd` is computed from a small hand-maintained `$/1M token`
table in `openrouter.ts` — it is a rough order-of-magnitude figure for
spotting a runaway/misrouted task, not a reconciled billing number. A model
not in that table logs `estimatedCostUsd: null` rather than guessing; add its
rate to `MODEL_COST_PER_MILLION_TOKENS` if it becomes the default for a task.

These lines accumulate for as long as normal log retention holds (the ask was
"at least a week of visibility" — this is always-on, not sampled, so it
holds for however long the log platform retains stdout). To answer "which
model is `rules-qa` actually using in production," filter `component:
openrouter AND event:model_routed AND task:rules-qa` and look at the most
recent `model` field, or aggregate `estimatedCostUsd` over a week for a rough
per-task spend.
