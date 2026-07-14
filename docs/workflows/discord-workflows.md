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

Admin-only operational commands, such as division role setup and division sync, do not use `pending_actions` because the admin is already taking the action directly. They still validate `admin_users` and write `audit_logs` for every mutation.

---

## Captain Resolution

Every captain command (`/report-result`, `/reschedule`) starts with identity resolution:

```
Discord user ID
  → players table (discord_id, is_captain = true)
  → player.org_id
  → orgs.id
  → eligible matches for that org (status = 'scheduled', home_org_id or away_org_id matches)
```

If the Discord user is not found in `players`, or is not flagged as a captain, the command returns an ephemeral error. The user is not shown a match dropdown.

This prevents:
- Unregistered users submitting results
- Non-captains submitting on behalf of their org
- Match selection from the wrong division

---

## Admin Review Card — Button Behaviors

Every review card (`/report-result`, `/reschedule`, `/request-admin-review`) has exactly three buttons:

| Button | Behavior |
|--------|---------|
| **Approve** | Executes the mutation for that action type. Updates the public receipt embed (if any) to ✅. Updates the review card. Writes an audit log. |
| **Deny** | Shows a modal for the denial reason (required). Updates the receipt embed to ❌ and the review card. Writes an audit log. DMs the submitting captain with the reason. |
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
- On admin **Approve**, the thread is archived and locked with a closing message. Deny and Needs Info leave the thread open so captains can upload additional evidence and the admin can re-review.

---

## Channel Configuration

| Channel | Purpose | Configured via |
|---------|---------|--------|
| `CHANNEL_ADMIN_REVIEW` | All admin review cards, all divisions | Single env var |
| `CHANNEL_RESULTS_SOLAR` / `_LUNAR` / `_TERRA` | Public match receipts, one per division | Env var per division |
| `CHANNEL_RESCHEDULES_SOLAR` / `_LUNAR` / `_TERRA` | Public reschedule receipts, one per division | Env var per division |

Channel IDs live entirely in bot deployment environment variables (`apps/bot/src/lib/channels.ts`) — they are **not** stored in the `divisions` table or anywhere in Supabase. Adding a division requires adding its channel env vars to the deployment, not a database migration.
