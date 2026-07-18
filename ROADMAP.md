# ROADMAP.md — SAL Operations Platform

> **Historical planning snapshot.** The current remediation sequence is tracked through [`docs/audit-status.md`](docs/audit-status.md) and its linked GitHub issues. The checkboxes below are preserved for context and are not the current implementation ledger.

This is not a commitment list.

This is a planning tool for deciding what to build next, in what order, and why.

---

## Current State

**Phase 0 complete. Operations foundation partially implemented.**

The repository scaffold is in place:
- active pnpm workspace for `apps/bot`, `packages/db`, and `packages/shared`
- full documentation system
- architecture decision records
- initial Supabase schema and migrations
- typed query helpers
- command stubs and several implemented bot commands
- Operations Engine under `apps/bot/src/lib/operations`
- `/division-role-config`
- `/division-sync` preview/apply

The captain match approval pipeline remains the main MVP focus. Admin-only identity and division role operations are implemented as audited direct operations.

The current web/control-center application is maintained in [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site), not this workspace. ForgeLens has no runtime scaffold or deployment; it remains future Phase 4 design.

---

## Phase 1 — Core Approval Pipeline

**Goal:** A captain can submit a match result. An admin can approve it. The match record in Supabase updates. Everything is audited.

### Deliverables

- [ ] Captain identity resolution middleware
- [ ] `/report-result` — full command with match dropdown, winner/score input
- [ ] `pending_action` creation on submission
- [ ] Public receipt embed — `#match-results-[division]`
- [ ] Proof thread creation under receipt embed
- [ ] Screenshot upload tracking (count, progress message updates)
- [ ] Admin review card — `#admin-review` with Approve / Deny / Needs Info / Open Admin Panel
- [ ] Approval handler — match mutation + `audit_log` write + embed updates
- [ ] Denial handler — embed updates + captain notification
- [ ] Needs Info handler — embed update + captain ping with admin note
- [ ] Idempotency — duplicate submission detection and graceful handling
- [ ] Supabase Storage archival of proof screenshots

### Done When

An admin approves a `/report-result` submission and `matches.status = 'completed'` with correct winner, score, and `audit_log` entry. Bot restart loses nothing.

---

## Phase 2 — Bot Completeness

**Goal:** All captain commands working.

### Deliverables

- [ ] `/reschedule` — match dropdown + new time proposal + admin review
- [ ] `/request-admin-review` — catch-all escalation
- [ ] `/rules` — captain rules assistant backed by LLM (OpenRouter) over `docs/rules/`
- [ ] `/update-ign` — IGN change request with screenshot proof + admin approval
- [ ] Discord embed update reliability (stale message handling)
- [ ] Error handling and captain-facing error messages
- [ ] Bot deployment configuration (Railway / Fly / VPS)

### Done When

All three commands work end-to-end. Admins can process any captain request from `#admin-review` alone.

---

## Phase 3 — `sal-site` Web Control Center

**Repository:** [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site), maintained and deployed separately.

**Goal:** Continue making `sal-site` a fully functional alternative to Discord triage.

### Deliverables

- [ ] Keep the shared pending-action contract aligned with salbot
- [ ] Admin review queue — list, filter, paginate by type/status/division
- [ ] Pending action detail view — approve/deny/needs-info from `sal-site`
- [ ] Match detail view with full `audit_logs` timeline
- [ ] Score correction and match edit UI
- [ ] Proof thread screenshot gallery view

### Done When

An admin can process any pending action from `sal-site` without touching Discord. Its approval path goes through the same `pending_actions` pipeline as Discord buttons.

---

## Phase 4 — OCR-Assisted Scout Extraction

**Status:** Implementation design accepted in ADR-008. No extraction runtime package or deployment exists yet.

**Goal:** Screenshots are processed automatically and stats appear in an admin review queue.

### Deliverables

- [ ] Approve the Phase 4 implementation boundary and create a runtime package
- [ ] Webhook receiver for screenshot uploads from bot
- [ ] OCR pipeline (Tesseract or cloud provider)
- [ ] Stat extraction and confidence scoring
- [ ] `pending_stat_records` creation with `confidence` field
- [ ] Confidence-based routing (standard / flagged / manual queue)
- [ ] Complete-game auto-publication above the ADR-008 gate
- [ ] Non-blocking review flag, human unflag, dispute, and correction workflow
- [ ] Admin stat review UI in `sal-site`
- [ ] Player name linking UI
- [ ] Stat approval → `player_stats` write + `audit_log`
- [ ] ForgeLens retry queue with dead-letter handling

### Done When

A verified scoreboard and match-details pair produces one complete-game stat
batch. Games passing every ADR-008 gate publish immediately and remain
review-flagged; all other games enter manual review. Publication, unflagging,
disputes, and corrections retain a complete audit trail.

---

## Phase 5 — Standings and Player Pages

**Goal:** Public-facing league data derived entirely from approved records.

### Deliverables

- [ ] Standings calculation from `matches` where `status = 'completed'`
- [ ] Standings display per division
- [ ] Player profile pages (match history, KDA, damage, healing)
- [ ] Team pages (roster, standings, averages)

### Done When

`sal-site` shows accurate standings and player stats. All data derives from Supabase; no manual entry required.

---

## Phase 6 — Operational Hardening

**Goal:** Production-ready for a full season.

### Deliverables

- [ ] Stale pending action alerts (pending > 24h notification)
- [ ] Admin dashboard: queue depth, unreviewed stats, missing proof
- [ ] ForgeLens calibration on real match data
- [ ] RLS policies verified and enforced
- [ ] Supabase Storage backup policy
- [ ] Disaster recovery drill

---

## Future Possibilities (Uncommitted)

These are ideas that may never happen. They are listed here to prevent them from invading MVP scope.

- Public API for third-party stats integrations
- Mobile-optimized captain workflow
- Multi-season archival and season scaffolding tooling
- Discord bot scanning as a fallback intake (requires careful idempotency design)
- Tournament bracket management

---

## Deferred Features

| Feature | Reason Deferred |
|---------|----------------|
| Additional `sal-site` admin workflows | Phase 3 — tracked in the separate web repository |
| ForgeLens OCR | Phase 4 — not blocking match operations |
| Standings | Phase 5 — depends on confirmed match pipeline |
| Public player pages | Phase 5 — depends on approved stats |
| Confidence-gated auto-publication | Planned in Phase 4 under ADR-008; enablement requires calibration and staging evidence |

---

## Risks

| Risk | Type | Status |
|------|------|--------|
| Captain adoption of slash commands | Product | Mitigated by low-friction UX and onboarding |
| Discord CDN URL expiry for evidence | Operational | Mitigated by Supabase Storage archival in Phase 1 |
| ForgeLens OCR accuracy on low-res screenshots | Technical | Mitigated by confidence routing and manual correction |
| Admin review backlog at scale | Operational | Mitigated by batch approval in Phase 3 `sal-site` work |
| Multi-admin race condition on approvals | Technical | Mitigated by atomic `WHERE status='pending'` claim |
