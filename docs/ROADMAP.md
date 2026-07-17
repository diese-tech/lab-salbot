# Implementation Roadmap

Phased plan from scaffold to production-ready platform.

The active workspace contains only `apps/bot`, `packages/db`, and `packages/shared`. The web/control center is [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site). ForgeLens remains future design and has no runtime package or deployment.

---

## Phase 0: Foundation

**Goal:** Repository scaffold, documentation, schema design. No production logic.

Deliverables:
- [x] Repository structure
- [x] Documentation system
- [x] Architecture Decision Records
- [x] Database schema proposal
- [x] Workflow documentation
- [x] Operational philosophy
- [x] Contributor onboarding
- [ ] Local development verified end-to-end
- [ ] Initial Supabase migrations written
- [ ] TypeScript types generated

Additional operations foundation now implemented:

- [x] Operations Engine under `apps/bot/src/lib/operations`
- [x] `/division-role-config`
- [x] `/division-sync` preview/apply
- [x] `division_role_mappings` migration

The captain match approval pipeline remains the main MVP focus.

---

## Phase 1: Bot Core — Approval Pipeline

**Goal:** Working approval pipeline with a single command. No OCR dependency.

Scope:
- Supabase client + `packages/db` query helpers
- Captain identity resolution (Discord ID → player → team)
- `/report-result` command:
  - Match dropdown from Supabase
  - Winner/score input
  - `pending_action` creation
  - Public receipt embed
  - Proof thread creation
  - Admin review card with buttons
- Approval button handler:
  - Approve → mutate match → audit log
  - Deny → update embeds
  - Needs Info → update embeds, ping captain
- Idempotency: duplicate submission protection
- Screenshot upload tracking in proof threads

**Done when:** An admin can receive a `/report-result` submission, review it in Discord, approve it, and the match record in Supabase shows the correct result with an audit log entry.

---

## Phase 2: Bot Completeness

**Goal:** All captain commands working.

Scope:
- `/reschedule` command + approval handler
- `/request-admin-review` command
- Embed update reliability (stale Discord message handling)
- Supabase Storage archival of proof thread screenshots
- Status emoji updates across all flows
- Bot error handling and graceful failure messages

**Done when:** All three commands work end-to-end with correct audit trails.

---

## Phase 3: `sal-site` Web Control Center

**Repository:** [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site), maintained and deployed separately.

**Goal:** Continue making `sal-site` a functional alternative to Discord triage.

Scope:
- Shared pending-action contract aligned with salbot
- Admin review queue (list, filter, paginate)
- Pending action detail view with approve/deny/needs-info
- Match detail view with full audit history
- Basic match correction UI (score edit, winner change)

**Done when:** An admin can process any pending action from `sal-site` without touching Discord.

---

## Phase 4: ForgeLens Integration

**Status:** Future design only. No ForgeLens runtime package or deployment exists.

**Goal:** Screenshots are OCR-processed and stats appear in admin review.

Scope:
- Approved implementation boundary and a deliberately created runtime package
- Webhook receiver from bot
- OCR pipeline (initial implementation; Tesseract or cloud provider)
- `pending_stat_records` creation
- Confidence scoring (initial heuristic model)
- Admin stat review UI in `sal-site`
- Player name linking UI
- Stat approval → `player_stats` write
- Audit log for stat approvals

**Done when:** A proof thread screenshot produces a `pending_stat_record` that an admin can review and approve, resulting in a `player_stats` row with a full audit trail.

---

## Phase 5: Standings + Player Pages

**Goal:** Public-facing league data.

Scope:
- Standings calculation from approved match results
- Standings display in `sal-site` (per division)
- Player profile pages (match history, stat averages)
- Team pages (roster, standings, results)

**Done when:** `sal-site` shows accurate, current standings and player stats derived entirely from approved records in Supabase.

---

## Phase 6: Operational Hardening

**Goal:** Production-ready for a full season.

Scope:
- Alert system for stuck pending actions (e.g., pending > 24 hours)
- Admin dashboard: pending queue depth, unreviewed stat records, missing proof
- ForgeLens retry queue with dead-letter handling
- Supabase Storage archival audit
- Load testing approval pipeline
- RLS policies verified
- Backup and recovery drill

---

## Deferred (Post-Season 1)

- ForgeLens confidence model calibration against real data
- Auto-approval consideration for sustained high-accuracy OCR (requires new ADR)
- Multi-season support (season archival, new season scaffolding)
- Public API for stats (third-party integrations)
- Mobile-optimized captain workflow

---

## MVP Boundaries

The MVP is Phase 1 + Phase 2. The core value proposition is:

> Captains submit structured match results. Admins approve them. Supabase records them. Every action is auditable.

OCR and additional `sal-site` workflows are force multipliers — not prerequisites for league operations.
