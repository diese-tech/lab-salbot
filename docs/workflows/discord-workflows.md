# Discord Workflows

This document covers every Discord-facing workflow in the platform: what triggers it, what it produces, and what the admin sees.

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

Every captain command starts with identity resolution:

```
Discord user ID
  → players table (discord_id)
  → player.team_id
  → teams.id
  → eligible matches for that team
```

If the Discord user is not found in `players` or is not a captain, the command returns an ephemeral error. The user is not shown a match dropdown.

This prevents:
- Unregistered users submitting results
- Non-captains submitting on behalf of their team
- Match selection from the wrong division

---

## `/report-result`

### Input

| Field | Source |
|-------|--------|
| Match | Supabase dropdown (week, teams, time) |
| Winner | Select: Team A / Team B |
| Score | Text: "2-1" |

Score format: `{winner_games}-{loser_games}`. Validated before submission.

### Outputs

**1. Public receipt embed** — posted in `#match-results-[division]`

```
📝 Match Report — Week 3

Team A vs Team B
Winner: Team A
Score: 2-1

Submitted by: @captain
Submitted at: 2025-01-15 18:00 UTC

Status: 📝 Under Review
```

**2. Proof thread** — created under the receipt embed

```
Thread name: proof-week-3-team-a-vs-team-b

Initial message:
📸 Proof Upload

Upload your match screenshots here.
Expected: 6 screenshots (2-1 → 3 games × 2 screenshots)

Progress: 0/6 uploaded
```

**3. Admin review card** — posted in `#admin-review`

```
🔍 Match Result — Pending Review

Match: Week 3 · Team A vs Team B · sal-w3-gold-004
Winner: Team A  |  Score: 2-1
Submitted by: @captain · Division: Gold

Proof Thread: [link]
Match Record: [supabase link]

[Approve] [Deny] [⚠️ Needs Info] [Open Admin Panel]
```

---

## `/reschedule`

### Input

| Field | Source |
|-------|--------|
| Match | Supabase dropdown (eligible future matches only) |
| New date/time | Date+time picker |
| Reason | Optional text |

### Outputs

**1. Public receipt** — posted in `#reschedules-[division]`

```
🔁 Reschedule Request — Week 3

Team A vs Team B
Current time: 2025-01-15 20:00 UTC
Requested time: 2025-01-17 18:00 UTC

Submitted by: @captain

Status: 📝 Under Review
```

**2. Admin review card** — posted in `#admin-review`

```
🔍 Reschedule Request — Pending Review

Match: Week 3 · Team A vs Team B
Current: 2025-01-15 20:00 UTC
Requested: 2025-01-17 18:00 UTC
Reason: —

[Approve] [Deny] [⚠️ Needs Info] [Open Admin Panel]
```

---

## `/request-admin-review`

Catch-all escalation for anything not covered by structured commands.

### Input

| Field | Source |
|-------|--------|
| Issue type | Select: Match result · Scheduling · Player issue · Other |
| Description | Text (required) |
| Related match | Supabase dropdown (optional) |

### Outputs

**1. Admin review card** — posted in `#admin-review`

Includes full description and optional match link. No public receipt (may be sensitive).

---

## `/division-role-config`

Admin-only setup command for division role mappings.

### Subcommands

| Subcommand | Purpose |
|------------|---------|
| `set` | Maps a division id to a Discord role selected from the role picker |
| `list` | Shows configured division role mappings |

### Behavior

`/division-role-config set` stores the selected Discord role ID in `division_role_mappings`. Role IDs are not secrets; they are stored in Supabase so admins can manage mappings without deployment access.

Every mapping change writes an `audit_logs` entry with:

- `action_type = 'division_role_mapping_updated'`
- `entity_type = 'division_role_mapping'`
- `entity_id = division_id`
- `actor_discord_id = admin Discord ID`

The command requires the invoking Discord user to exist in `admin_users`.

---

## `/division-sync`

Admin-only player identity and division role sync workflow.

### Preview Input

`/division-sync preview` accepts a CSV attachment:

```csv
division,discord_username
solar,diese
lunar,player2
gaia,player3
```

`discord_username` means the actual Discord account username. The bot resolves that username in the guild, extracts the Discord user ID, and matches the Supabase player by `players.discord_username`.

### Preview Output

Preview mode reports:

- matched rows
- duplicate CSV usernames
- usernames missing from the Discord server
- players missing from Supabase
- conflicting existing `players.discord_id` values
- missing division role mappings

Preview mode does not update Supabase, change Discord roles, or write audit logs.

If there are actionable rows, the bot returns a short-lived confirmation token.

### Apply Behavior

`/division-sync apply token:[token]` applies a recent preview for the same admin.

Apply mode:

1. Links `players.discord_id` only when it is empty.
2. Refuses to overwrite a different existing `players.discord_id`.
3. Removes old known division roles.
4. Adds the configured role for the CSV division.
5. Writes audit logs for identity links and role updates.
6. Returns a final summary of updates, skips, conflicts, and failures.

Confirmation tokens are in-memory and expire after 10 minutes. If the bot restarts or the token expires, run preview again.

The bot must have the Discord Manage Roles permission and its highest role must be above every division role it manages.

---

## Admin Review Card — Button Behaviors

| Button | Behavior |
|--------|---------|
| **Approve** | Executes mutation. Updates receipt embed to ✅. Updates review card. Writes audit log. |
| **Deny** | Updates receipt embed to ❌. Updates review card. Shows modal for denial reason. Writes audit log. |
| **⚠️ Needs Info** | Updates receipt embed to ⚠️. Updates review card. Shows modal for info request. Bot pings the submitting captain. |
| **Open Admin Panel** | Sends ephemeral link to the website admin panel with full context pre-loaded. |

### Stale Approval Protection

When an admin presses a button on a review card:

1. Bot loads the current `pending_action` from Supabase
2. Verifies `status == 'pending'`
3. If already approved/denied, shows ephemeral error: "This action has already been processed."

This prevents double-approval race conditions when multiple admins are reviewing simultaneously.

---

## Status Embed Updates

When a `pending_action` status changes, the bot edits the relevant Discord messages:

- Public receipt embed: status field updated with new emoji
- Admin review card: status field updated, buttons disabled

The bot does not delete old cards. They are updated in place to preserve history in the Discord channel.

---

## Attachment Handling in Proof Threads

When a message with attachments is posted in a proof thread:

1. Bot validates it's an image attachment
2. Increments `matches.screenshot_count`
3. Updates proof thread progress message
4. Stores URL reference (optionally archives to Supabase Storage)
5. Emits event for ForgeLens to process

Non-image attachments are ignored for screenshot counting but not deleted.

---

## Channel Configuration

| Channel | Purpose | Naming |
|---------|---------|--------|
| `#admin-review` | All admin review cards, all divisions | Fixed name |
| `#match-results-{slug}` | Public match receipts per division | Dynamic per division |
| `#reschedules-{slug}` | Public reschedule receipts per division | Dynamic per division |

Channel IDs are stored in the `divisions` table and in environment config, not hardcoded in bot logic.
