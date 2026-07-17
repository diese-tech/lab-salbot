# Architecture Overview

## System Design

The current SAL operations platform combines this repository's Discord bot, Supabase, and the separately maintained [`sal-site`](https://github.com/diese-tech/sal-site). ForgeLens is a future Phase 4 design. Each component has a distinct responsibility; blurring these boundaries is a common source of operational bugs.

```
Discord ──► salbot ──► Supabase ◄── sal-site
 workflow     intake    source of     web/control center
   UI          API        truth

Future Phase 4: proof screenshots ──► ForgeLens ──► pending_stat_records
```

---

## Components

### Supabase

**Role:** Authoritative state.

Supabase owns everything that matters:

- Match records and lifecycle
- Schedules and divisions
- Player/team relationships
- Standings
- Pending actions
- Audit logs
- Evidence references
- OCR stat records
- Proof thread metadata

Supabase is the system of record. No other component is allowed to be the "real" source of any entity.

### Discord Bot

**Role:** Workflow intake UI.

The bot handles:

- Captain slash commands (intake forms)
- Public receipt embeds (league-facing evidence posts)
- Proof thread creation and management
- Admin review card posting
- Approval button interaction handling
- Screenshot upload tracking
- Admin-only division role configuration
- Admin-only player identity and division role sync

The bot does **not** store state. It reads from Supabase and writes back to Supabase. It uses Discord as a display surface.

### `sal-site`

**Status:** Current, separate repository.

**Role:** Public website and operational control center.

The website handles:

- Admin review queue (full view, not just quick triage)
- Complex match edits and corrections
- Score relinking
- Stat review and manual correction
- Audit history browsing
- Standings display
- Player and team pages
- Admin override capabilities

`sal-site` is where detailed web work happens. Discord is where fast triage happens. This repository does not contain a web application package.

### ForgeLens (Future)

**Status:** Phase 4 design only; no runtime or deployment exists today.

**Role:** OCR processor.

A future ForgeLens implementation would:

- Watch proof threads for new screenshots
- Process images through an OCR pipeline
- Extract player stats
- Assign confidence scores
- Create `pending_stat_records` for admin review

If implemented, ForgeLens must never directly write to official stats. It produces pending records only.

---

## Data Flow

### Match Report Flow

```
Captain: /report-result
→ Bot validates captain, fetches eligible matches from Supabase
→ Captain selects match from dropdown
→ Bot creates pending_action (type: match_result)
→ Bot posts public receipt embed in #match-results-[division]
→ Bot creates proof thread under the receipt embed
→ Bot posts admin review card in #admin-review
→ Bot writes audit log entry
→ Captain uploads screenshots to proof thread
→ [Future Phase 4] ForgeLens processes screenshots → pending_stat_records
→ Admin reviews pending_action
→ Admin approves → match.status = completed, winner/score written
→ Audit log records mutation with actor, old value, new value
```

### Reschedule Flow

```
Captain: /reschedule
→ Bot validates captain, fetches eligible matches
→ Captain selects match + proposes new time
→ Bot creates pending_action (type: reschedule)
→ Bot posts public receipt in #reschedules-[division]
→ Bot posts admin review card in #admin-review
→ Admin approves → match.scheduled_at mutated
→ Audit log records mutation
```

### Division Sync Flow

```
Admin: /division-role-config set
-> Bot stores division_role_mappings in Supabase
-> Bot writes audit log entry

Admin: /division-sync preview
-> Bot parses roster CSV
-> Bot resolves Discord usernames to Discord IDs
-> Bot matches Supabase players by players.discord_username
-> Bot reports missing users, missing players, conflicts, and missing role mappings
-> Bot returns a short-lived confirmation token

Admin: /division-sync apply
-> Bot links empty players.discord_id values
-> Bot refuses conflicting discord_id overwrites
-> Bot removes old known division roles
-> Bot adds the configured division role
-> Audit log records identity and role mutations
```

---

## Approval Pipeline

All approvals use the same infrastructure. There is one approval pipeline, not one per workflow type.

Admin-only setup and identity maintenance operations do not use the approval pipeline. They validate `admin_users` directly and write `audit_logs`.

Admin review cards support four actions:

| Action | Behavior |
|--------|---------|
| **Approve** | Executes the mutation. Writes audit log. Updates Discord embeds. |
| **Deny** | Marks pending_action as denied. Updates Discord embeds. Optional admin note. |
| **Needs Info** | Marks pending_action as pending_info. Updates embeds with ⚠️. |
| **Open Admin Panel** | Deep links to `sal-site` with full context. |

---

## Multi-League Design

All entities carry a `division_id`. The schema supports multiple concurrent divisions without structural changes. Adding a new division means inserting a new `divisions` row and configuring the corresponding Discord channels.

---

## Failure Modes and Recovery

| Failure | Impact | Recovery |
|---------|--------|---------|
| Bot offline | No new commands processed | Bot restart; pending_actions already in Supabase are not lost |
| Discord message deleted | Receipt lost from Discord | Evidence still in Supabase Storage and audit logs |
| Future OCR failure | Stats not extracted | Match approval remains independent; use `sal-site` manual review when that Phase 4 flow exists |
| Bad approval | Incorrect match mutation | Correction via `sal-site`; audit log preserved |
| Supabase outage | Full system halt | No state loss; bot reconnects on restore |

---

## See Also

- [`platform-split.md`](platform-split.md) — detailed component boundaries
- [`data-flow.md`](data-flow.md) — per-workflow data diagrams
- [`../database/schema.md`](../database/schema.md) — data model
- [`../adrs/`](../adrs/) — decision records
