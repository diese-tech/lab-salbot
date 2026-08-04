# Discord Workflows

This document covers behavior that's shared across multiple commands: what
triggers the admin review pipeline, how review cards behave, and how proof
threads work. For what each individual command does, see
[`../commands.md`](../commands.md).

---

## Command Philosophy

Slash commands are the official intake method. Message scanning is a safety net only.

Why this matters:

- Commands produce structured, validated input with known fields
- Captain approval commands create deterministic pending_actions
- Commands guarantee a proof thread and admin review card are created
- Scanned messages are ambiguous and cannot guarantee completeness

Captains are expected to use commands. If a captain posts a score in chat without using the command, the bot may optionally detect it and prompt them to use the command, but the scan result itself is not treated as an official submission.

Admin-only operational commands, such as division role setup, division sync,
and captain/organization/broadcast role mapping, do not use `pending_actions`
because the admin is already taking the setup action directly. They still
validate `admin_users` and write `audit_logs` for every mutation.

Roster mutations are different: `/trade`, `/claim`, `/drop`, and
`/draft-position-swap` always use the shared `pending_actions` pipeline, even
after captain consent. Only database approval execution changes canonical
rosters or draft positions.

---

## Operational Command Authorization

`/report-result` and `/log-scouter` use current Discord server roles as their
authorization source:

```
Discord guild member roles
  → SAL_OPERATOR_ROLE_IDS or SAL_ADMIN_ROLE_IDS
  → operational command capability
```

OAuth, `players.discord_id`, and roster captain state remain identity/business
data. They neither grant nor deny these command capabilities. Missing or
malformed role configuration fails closed. `/report-result` then presents the
scheduled, non-archived matches in the current season; downstream pending
action and admin review safeguards are unchanged.

`/reschedule` still uses its existing linked-captain/org match filter. It is
not part of the initial ADR-009 role-authorization migration.

See
[`ADR-009`](../adr/ADR-009-discord-role-backed-operational-command-authorization.md)
for the supersession and capability contract.

Planned roster commands use the stricter season-scoped authorization defined in
ADR-009:

```
Discord user ID
  → active-season player identity
  → division-specific Captain role
  → organization role
  → organization team in the command channel's division
```

Both roles are required. This survives captain changes without issuing
captain-specific links and allows one organization to field separate teams in
Solar, Lunar, and Terra.

---

## Admin Review Card — Button Behaviors

Every review card (`/report-result`, `/reschedule`, `/request-admin-review`) has exactly three buttons:

| Button            | Behavior                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approve**       | Executes the mutation for that action type. Updates the public receipt embed (if any) to ✅. Updates the review card. Writes an audit log.                            |
| **Deny**          | Shows a modal for the denial reason (required). Updates the receipt embed to ❌ and the review card. Writes an audit log. DMs the submitting captain with the reason. |
| **⚠️ Needs Info** | Shows a modal for what info is needed (required). Updates the receipt embed to ⚠️ and the review card. Writes an audit log. DMs the submitting captain with the note. |

Only users in `admin_users` can press these buttons — anyone else gets an ephemeral "Only admins can use this button" reply.

### Stale Approval Protection

When an admin presses a button on a review card:

1. Bot claims the `pending_action` row atomically (first admin to click wins).
2. If another admin already claimed it, the presser gets an ephemeral "This action was already processed by another admin" reply and nothing else happens.

This prevents double-approval race conditions when multiple admins are reviewing simultaneously.

---

## Status Embed Updates

When a `pending_action` status changes, the bot edits the relevant Discord messages in place:

- Public receipt embed (if the action type has one — `/request-admin-review` does not): status field and color updated.
- Admin review card: status field and color updated, buttons removed.

The bot does not delete old cards — they're updated in place to preserve history in the channel.

---

## Proof Threads (`/report-result` only)

When a captain reports a result, the bot opens a thread under the public receipt:

- Named `proof-week-{week}-{home-tag}-vs-{away-tag}`.
- Tracks a running screenshot count against an expected count derived from the score (e.g. a `2-1` result expects 3 games × 2 screenshots = 6).
- Any message with an image attachment posted in the thread increments the count and edits the thread's tracking message.
- **Screenshot counts are tracked in memory only** (`activeProofThreads` in `apps/bot/src/lib/proof-thread.ts`) — a bot restart before the result is approved loses in-flight progress tracking, though the uploaded images themselves remain in the thread. Full persistence is a future phase.
- On a terminal admin decision (**Approve**, **Deny**, or stale cancellation),
  the durable outbox worker posts one marked closing message and archives the
  thread. **Needs Info** leaves the thread and admin controls open so captains
  can upload evidence and the admin can make a final decision.

## Durable decision delivery

Approve, Deny, Needs Info, stat approval, and stat rejection call the
service-role decision RPCs from the pinned database contract. Each RPC commits
the domain mutation, immutable audit rows, and `operation_outbox` events in one
PostgreSQL transaction.

SALBot claims outbox work at startup, immediately after a decision, and every
five seconds. The database owns `FOR UPDATE SKIP LOCKED`, 60-second leases, and
ten-attempt dead-lettering. The bot applies jittered exponential retry delays
capped at fifteen minutes. Edit-in-place projections are replay safe; DMs and
thread messages carry a stable `sal-outbox:<id>` marker and are reconciled
before creation. Needs Info is the only non-terminal decision and therefore
preserves the admin card controls.

Worker logs are structured JSON with the outbox ID, topic, attempt, event age,
retry delay, and dead-letter state. A clean shutdown stops new claims and waits
for the active drain before disconnecting Discord.

---

## Channel Configuration

| Channel                                           | Purpose                                                                       | Configured via       |
| ------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------- |
| `CHANNEL_ADMIN_REVIEW`                            | All admin review cards, all divisions                                         | Single env var       |
| `CHANNEL_RESULTS_SOLAR` / `_LUNAR` / `_TERRA`     | Public match receipts, one per division                                       | Env var per division |
| `CHANNEL_RESCHEDULES_SOLAR` / `_LUNAR` / `_TERRA` | Public reschedule receipts, one per division                                  | Env var per division |
| `CHANNEL_TRADE_BLOCK_SOLAR` / `_LUNAR` / `_TERRA` | Informal trade discussion and official roster-command entry, one per division | Env var per division |
| `CHANNEL_TRANSACTIONS`                            | Completed league-wide roster transaction and draft-conclusion bulletin        | Single env var       |

Channel IDs live entirely in bot deployment environment variables (`apps/bot/src/lib/channels.ts`) — they are **not** stored in the `divisions` table or anywhere in Supabase. Adding a division requires adding its channel env vars to the deployment, not a database migration.

Plain-language trade-block messages, including “OTB,” never trigger a command
or database action.

---

## Planned roster transaction lifecycle

1. Captain command input and review remain ephemeral.
2. Explicit submission creates durable transaction state and a linked
   `pending_actions` record.
3. Trade proposals post a public division-channel card for counterpart consent.
4. Accepted trades, claims, drops, and draft-position swaps enter the existing
   private admin-review pipeline.
5. Approval executes one authoritative database transaction, including the
   immutable audit entry and durable outbox event.
6. The bot publishes the completed operation to `CHANNEL_TRANSACTIONS`.
7. Claims, drops, trades, and reversals reconcile Discord organization roles
   from the resulting canonical roster.
8. Failed role reconciliation alerts `CHANNEL_ADMIN_REVIEW`; it never rolls
   back the database operation or exposes private reasons publicly.

The public mobile format uses one leading division chip and canonical
organization tags:

```text
[SOLAR] FF traded Crow to TC for The_Expert133
[LUNAR] EV claimed XGN Ninja
```

Draft picks are not individually posted. After an administrator successfully
uses **End Draft & Publish Rosters** in `sal-site`, the durable conclusion event
produces one transactions-channel message with a short link to the division's
canonical roster page.

SALBot does not open, start, pause, undo, redo, or end draft rooms. Those
controls and audience-specific draft views belong to `sal-site`; SALBot only
delivers the resulting durable Discord event.
