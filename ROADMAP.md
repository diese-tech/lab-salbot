# ROADMAP.md — SAL Operations Platform

This is not a commitment list.

This is a planning tool for deciding what to build next, in what order, and why.

---

## Current State

**Phase 0 complete. Operations foundation partially implemented.**

The repository scaffold is in place:
- monorepo structure
- full documentation system
- architecture decision records
- initial Supabase schema and migrations
- typed query helpers
- command stubs and several implemented bot commands
- Operations Engine under `apps/bot/src/lib/operations`
- `/division-role-config`
- `/division-sync` preview/apply

The captain match approval pipeline remains the main MVP focus. Admin-only identity and division role operations are implemented as audited direct operations.

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

## Phase 3 — Website Admin Panel

**Goal:** The website becomes a fully functional alternative to Discord triage.

### Deliverables

- [ ] Next.js project setup with Supabase auth
- [ ] Admin review queue — list, filter, paginate by type/status/division
- [ ] Pending action detail view — approve/deny/needs-info from website
- [ ] Match detail view with full `audit_logs` timeline
- [ ] Score correction and match edit UI
- [ ] Proof thread screenshot gallery view

### Done When

An admin can process any pending action from the website without touching Discord. The website approval goes through the same `pending_actions` pipeline as Discord buttons.

---

## Phase 4 — ForgeLens OCR

**Goal:** Screenshots are processed automatically and stats appear in an admin review queue.

### Deliverables

- [ ] ForgeLens service scaffold and deployment
- [ ] Webhook receiver for screenshot uploads from bot
- [ ] OCR pipeline (Tesseract or cloud provider)
- [ ] Stat extraction and confidence scoring
- [ ] `pending_stat_records` creation with `confidence` field
- [ ] Confidence-based routing (standard / flagged / manual queue)
- [ ] Admin stat review UI in website
- [ ] Player name linking UI
- [ ] Stat approval → `player_stats` write + `audit_log`
- [ ] ForgeLens retry queue with dead-letter handling

### Done When

A proof thread screenshot produces a `pending_stat_record` an admin can review and approve, producing a `player_stats` row with full audit trail.

---

## Phase 5 — Standings and Player Pages

**Goal:** Public-facing league data derived entirely from approved records.

### Deliverables

- [ ] Standings calculation from `matches` where `status = 'completed'`
- [ ] Standings display per division
- [ ] Player profile pages (match history, KDA, damage, healing)
- [ ] Team pages (roster, standings, averages)

### Done When

The website shows accurate standings and player stats. All data derives from Supabase; no manual entry required.

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

- OCR auto-approval for sustained high-accuracy records (requires new ADR)
- Public API for third-party stats integrations
- Mobile-optimized captain workflow
- Multi-season archival and season scaffolding tooling
- Discord bot scanning as a fallback intake (requires careful idempotency design)
- Tournament bracket management

---

## Deferred Features

| Feature | Reason Deferred |
|---------|----------------|
| Website admin panel | Phase 3 — Discord approval sufficient for MVP |
| ForgeLens OCR | Phase 4 — not blocking match operations |
| Standings | Phase 5 — depends on confirmed match pipeline |
| Public player pages | Phase 5 — depends on approved stats |
| Auto-approval | Post-Phase 4 — requires calibration data and new ADR |

---

## Risks

| Risk | Type | Status |
|------|------|--------|
| Captain adoption of slash commands | Product | Mitigated by low-friction UX and onboarding |
| Discord CDN URL expiry for evidence | Operational | Mitigated by Supabase Storage archival in Phase 1 |
| ForgeLens OCR accuracy on low-res screenshots | Technical | Mitigated by confidence routing and manual correction |
| Admin review backlog at scale | Operational | Mitigated by batch approval in Phase 3 website |
| Multi-admin race condition on approvals | Technical | Mitigated by atomic `WHERE status='pending'` claim |
