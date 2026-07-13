# Admin Operations Runbook

Common admin tasks and how to perform them correctly.

---

## Approving a Match Result

Approvals are Discord-only. The website has no pending-actions review queue —
`pending_actions` is read and written exclusively by the bot.

1. Locate the pending review card in `#admin-review`
2. Verify the match details (week, teams, score) match expectation
3. Check proof thread link — verify screenshot count is reasonable
4. Press **Approve**
5. Bot updates public receipt to ✅ and disables review card buttons

**Standings follow-up:** approval marks the match completed and records scores, but it
does **not** update the website's standings table. After approving results, go to the
website's Admin → Standings page and recalculate on demand (or standings will refresh
the next time an admin submits a match report on the site).

---

## Denying a Match Result

1. Open review card (Discord or website)
2. Press **Deny**
3. Enter reason (required)
4. Captain is notified in the proof thread
5. Captain may re-submit via `/report-result`

---

## Requesting More Information

1. Press **⚠️ Needs Info** on the review card
2. Enter the specific information needed (e.g., "Please re-upload screenshots — they appear to be from the wrong match")
3. Captain is pinged in the proof thread with the note
4. When captain has responded, return to the review card and approve or deny

---

## Correcting a Score After Approval

Only use this if a score was approved incorrectly.

1. Navigate to the website's Admin → Matches, open the match, and correct the score
   and status. The site logs the change to `admin_audit_log` (`save_match`).
2. Editing a match on the website does not update the bot-owned
   `matches.winner_org_id` / `matches.score` columns set by the original approval —
   if the winner changed, correct those columns in Supabase as well.
3. Write the required `audit_logs` entry for the override (see the
   [Admin Override Pattern](../database/mutation-patterns.md)): `action_type =
   'admin_override'`, `actor_discord_id` = the admin's Discord ID, old/new values,
   and a `note` explaining the reason. An override without an `audit_logs` entry is
   a bug — `admin_audit_log` alone does not satisfy the contract.
4. Recalculate standings from Admin → Standings.
5. The original approved action remains in the bot's `audit_logs` — this is correct;
   corrections create new records rather than rewriting history.

---

## Linking a Player to an OCR Record

When ForgeLens extracts stats but cannot match the in-game name to a player:

1. Navigate to Admin → Stats → Pending Review
2. Filter by `player_id IS NULL`
3. For each unlinked record, search for the player by display name or Discord handle
4. Select the matching player
5. Approve the record

---

## Configuring Division Roles

Division roles are managed from Discord so admins do not need deployment or database access.

1. Run `/division-role-config set`
2. Enter the division id, such as `solar`, `lunar`, or `terra`
3. Select the Discord role for that division
4. The bot stores the mapping in Supabase and writes an `audit_logs` entry

To review configured mappings, run:

```txt
/division-role-config list
```

The bot must have the Discord Manage Roles permission, and its highest role must be above every division role it needs to assign or remove.

---

## Previewing Division Sync

Use `/division-sync preview` to validate a roster CSV before any mutation happens.

CSV format:

```csv
division,discord_username
solar,diese
lunar,player2
terra,player3
```

The `discord_username` column must contain the actual Discord account username. The bot resolves that username in the server, extracts the Discord user ID, and matches the player by `players.discord_username` in Supabase.

Preview mode does not:

- Update `players.discord_id`
- Change Discord roles
- Write audit logs

The preview response reports matched rows, conflicts, missing users, missing players, and missing division role mappings. If there are actionable rows, the bot returns a short-lived confirmation token.

---

## Applying Division Sync

After previewing, run `/division-sync apply token:[token]`.

Apply mode:

1. Links `players.discord_id` only when it is empty
2. Refuses to overwrite a different existing `players.discord_id`
3. Removes old known division roles
4. Adds the configured role for the player's CSV division
5. Writes `audit_logs` entries for identity links and role updates
6. Returns a final summary of updates, skips, conflicts, and failures

If the token is expired or belongs to a different admin, run preview again.

---

## Manually Entering Stats

When a screenshot is unreadable or ForgeLens has failed:

1. Navigate to Admin → Matches → [Match ID] → Stat Entry
2. Select the player
3. Enter stats manually
4. Submit — creates a `pending_stat_record` with `source = 'manual'`, `confidence = 1.0`
5. Approve via normal review flow

---

## Viewing Audit History for a Match

1. Navigate to Admin → Matches → [Match ID] → Audit History
2. Full timeline of all events: pending action created, approved, stats extracted, stats approved, any overrides

This view is the authoritative record for any dispute.

---

## Correcting a Player's Team Assignment

1. Navigate to Admin → Players → [Player]
2. Click Edit
3. Change `team_id`
4. Add a note (reason for change)
5. System writes audit log entry

This does not retroactively change historical match records. If matches need to be re-attributed, that is a separate admin override on each affected match.
