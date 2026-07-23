# SALBot Commands

Every current and accepted planned SALBot slash command, what it does, and who
can run it.

The **Current Quick Reference** table is the same command surface the bot posts
for `/help`. Keep it and `apps/bot/src/commands/help.ts` in sync when a command
is implemented, removed, or changed. Commands in **Accepted planned commands**
must not appear in `/help` or be described to operators as live until their
handlers, database contracts, permissions, and deployment configuration ship.

---

## Current Quick Reference

| Command                 | Who      | What it does                                                                                                                 |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/report-result`        | Captains | Report a completed match's score. Posts a public receipt, opens a proof-upload thread, and sends the result to admin review. |
| `/reschedule`           | Captains | Request a new date/time for an upcoming match. Posts a public receipt and sends the request to admin review.                 |
| `/request-admin-review` | Everyone | Escalate an issue (score dispute, scheduling, eligibility, other) directly to admins. No public receipt.                     |
| `/rules`                | Everyone | Ask a question about the league ruleset. Answered by an AI assistant restricted to the official rules text.                  |
| `/update-ign`           | Everyone | Request an in-game name change with screenshot proof. **Not yet implemented** — replies asking you to see an admin for now.  |
| `/division-role-config` | Admins   | Map a division (`solar`/`lunar`/`terra`) to a Discord role, or list current mappings.                                        |
| `/division-sync`        | Admins   | Bulk-link players' Discord accounts and sync division roles from a roster CSV. Preview, then apply.                          |
| `/help`                 | Everyone | Show this list with a link to the full reference.                                                                            |

"Captains" means a `players` row with `is_captain = true` and `discord_id` linked to the caller. "Admins" means a row in `admin_users`.

---

## Accepted planned commands

These commands are accepted by
[ADR-009](adrs/ADR-009-roster-transactions-discord-workflow.md) but are not yet
registered. Their names and scopes are the implementation contract.

| Command                     | Who                                       | Channel scope                                                 | What it will do                                                                                                                                                      |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/trade`                    | Division captains; admins for remediation | Matching division trade-block channel                         | Open an ephemeral offer wizard, then post a revisioned proposal with **Accept**, **Counter**, and **Decline** controls. Accepted terms still require admin approval. |
| `/claim`                    | Division captains; admins for remediation | Matching division trade-block channel                         | Submit an available-player claim for admin approval. A pending claim does not reserve the player.                                                                    |
| `/drop`                     | Division captains; admins for remediation | Matching division trade-block channel                         | Submit a roster drop for admin approval. A ban or suspension is an admin-only approval option.                                                                       |
| `/draft-position-swap`      | Division captains; admins for remediation | Matching division trade-block channel; only before room start | Exchange two organizations' complete base draft positions with no other compensation.                                                                                |
| `/captain-role-config`      | Admins                                    | Any admin-operable channel; ephemeral response                | Set or list the canonical Captain role for Solar, Lunar, or Terra.                                                                                                   |
| `/organization-role-config` | Admins                                    | Any admin-operable channel; ephemeral response                | Set or list an organization's canonical Discord role and mobile tag.                                                                                                 |
| `/broadcast-role-config`    | Admins                                    | Any admin-operable channel; ephemeral response                | Set or list the Caster or Production role mapping.                                                                                                                   |

“Division captains” are authorized by the active season, organization,
division-specific Captain role, and organization role. A global
`players.is_captain` flag by itself is not sufficient for roster commands. An
organization may have a team in every division; authorization is resolved for
the command channel's division rather than assigning the organization to only
one division.

### `/trade` (planned)

1. Verify that the command is in the configured trade-block channel for the
   captain's division.
2. Ask for the captain's organization and offered players in an ephemeral
   wizard.
3. Ask for the opposing organization and requested players.
4. Require **Post Proposal** on a private review before anything is public.
5. Allow only the opposite organization's authorized captain to **Accept**,
   **Counter**, or **Decline** the current revision.
6. Open a prefilled ephemeral wizard for **Counter**, then flip proposer and
   recipient on the new revision.
7. Route accepted terms through a linked `pending_actions` record. Captain
   acceptance never changes a roster.

Uneven trades are valid. Draft slots, money, future considerations, and other
compensation are not valid roster-trade assets. Execution is blocked if a
resulting team lacks roster capacity.

### `/claim` (planned)

The captain selects the authorized organization and searches available players
by name. Autocomplete narrows results as text is entered so the full
cross-division pool is never dumped into Discord.

The normal pool is division-local. A captain may manually search one division
lower: Terra may claim from Solar, Solar may claim from Lunar, and Lunar has no
lower division. A team cannot reach past the adjacent lower division. The
database rechecks season eligibility and availability at approval time.
Submission time may inform waiver priority, but a pending claim does not reserve
the player.

### `/drop` (planned)

The captain selects an authorized organization and current roster member,
reviews the request privately, and submits it to the shared admin pipeline.
Routine public notices omit private reasons. During approval, an admin may
separately apply a ban or suspension when the reason warrants discipline, such
as a self-drop.

### `/draft-position-swap` (planned)

The initiating captain selects both organizations in the same division. The
proposal exchanges their complete predetermined draft positions across all
snake rounds. Counterpart consent and admin approval are required. The command
accepts no additional compensation and closes once the division room starts.

### Planned role-configuration commands

`/captain-role-config`, `/organization-role-config`, and
`/broadcast-role-config` follow the setup safety contract:

- validate the caller against `admin_users`;
- read and write mappings through `packages/db`;
- never grant authority from a Discord role alone;
- append immutable `audit_logs` with actor and old/new values; and
- return setup output ephemerally.

`/organization-role-config` also owns the canonical short tag used in mobile
transaction messages, such as `FF`, `TC`, or `EV`.

---

## Detailed Reference

### `/report-result`

**Who:** Captains only. Resolved via `players.discord_id` + `is_captain = true` → `players.org_id` → matches where that org plays home or away and `status = 'scheduled'`.

**Flow** (three interactive steps):

1. Command replies with a dropdown of the captain's eligible upcoming matches.
2. Selecting a match shows a dropdown to pick the winning org.
3. Selecting the winner opens a modal asking for the score (e.g. `2-1`, `3-2`).

**On submit:**

- Creates a `pending_actions` row (`type: 'match_result'`).
- Posts a public "Under Review" receipt embed to that division's results channel (`CHANNEL_RESULTS_SOLAR` / `_LUNAR` / `_TERRA`).
- Opens a proof-upload thread under the receipt, named `proof-week-{week}-{home-tag}-vs-{away-tag}`. Screenshot counts are tracked **in memory only** — they reset if the bot restarts before the result is approved.
- Posts an admin review card with **Approve / Deny / ⚠️ Needs Info** buttons to `#admin-review` (`CHANNEL_ADMIN_REVIEW`).

**On admin Approve:** the match is marked `completed` with the winner/score, the proof thread is closed and archived, and both embeds are updated in place (not deleted).

### `/reschedule`

**Who:** Captains only — same resolution and eligible-match dropdown as `/report-result`.

**Flow:** select a match, then a modal asks for the new date (`YYYY-MM-DD`), new time (`HH:MM`, ET), and an optional reason.

**On submit:** posts a public receipt to that division's reschedules channel (`CHANNEL_RESCHEDULES_SOLAR` / `_LUNAR` / `_TERRA`) and an admin review card to `#admin-review`. No proof thread — reschedules don't need one.

### `/request-admin-review`

**Who:** Everyone — no captain or admin check.

**Options:** `issue_type` (choice: Score Dispute, Scheduling Issue, Eligibility Concern, Other) and `description` (free text, up to 1000 characters).

**On submit:** posts only an admin review card — no public receipt (the issue may be sensitive) and no linked match (there is no match picker on this command).

### `/rules`

**Who:** Everyone.

**Flow:** takes a free-text `question`, sends it plus the full ruleset text to OpenRouter with a system prompt that restricts answers to that ruleset, and returns the answer in an embed citing the section(s) used.

Requires `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`, default `google/gemini-2.0-flash-001`). Without a working key, the command fails gracefully with a message telling the user to ask an admin directly.

### `/update-ign`

**Status: not implemented.** The command is registered and appears in Discord's command list, but running it just replies with an ephemeral message telling the player to ask an admin — the actual IGN-change flow (screenshot proof, admin review card) is Phase 2 work.

Intended flow, per the code's own comments (`apps/bot/src/commands/update-ign.ts`):

1. Resolve the target player (the invoker, or an admin-specified `player` option).
2. Verify the invoker is a registered player or an admin.
3. Restrict non-admins to running the command inside `DISCORD_ALIAS_CHANNEL_IDS`.
4. Validate the `proof` attachment is an image.
5. Create a `pending_actions` row (`type: 'alias_change'`).
6. Post an admin review card with Approve/Deny buttons.

### `/division-role-config`

**Who:** Admins only (must exist in `admin_users`).

- `set division:<id> role:<@role>` — upserts `division_role_mappings` and writes an `audit_logs` entry (`action_type: 'division_role_mapping_updated'`).
- `list` — prints the current division → role mappings.

### `/division-sync`

**Who:** Admins only.

- **`preview csv:<file>`** — CSV with `division,discord_username` header columns. For each row: resolves `discord_username` to a guild member (exact, case-insensitive match — fails on duplicates or accounts not found in the server), then to a Supabase player by `players.discord_username`, and checks the target division has a configured role mapping. Reports matched / skipped / conflict / error counts and a per-row breakdown. Makes no changes. If anything is actionable, returns a confirmation token valid for 10 minutes (held in memory, tied to the admin who ran preview).
- **`apply token:<token>`** — replays a recent preview for the same admin: links `players.discord_id` only where it's currently empty (never overwrites a different existing id — that's a conflict), removes the player's old division role(s), adds the new one, and writes an `audit_logs` entry per identity link. Requires the bot's Discord role to sit above every division role it manages, or Discord silently rejects the role change.

### `/help`

Posts the Quick Reference table above as an embed, plus a link to this document on GitHub.

---

## Cross-Cutting Behavior

For everything that isn't specific to one command — the admin review card's button behavior, stale-approval protection, status embed updates, proof-thread attachment handling, and channel configuration — see [`workflows/discord-workflows.md`](workflows/discord-workflows.md).

For authoritative transaction execution, role synchronization, the public
bulletin, and draft-conclusion behavior, see
[`adrs/ADR-009-roster-transactions-discord-workflow.md`](adrs/ADR-009-roster-transactions-discord-workflow.md).
