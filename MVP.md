# MVP.md — SAL Operations Platform

## Product Goal

The MVP validates that structured, auditable league operations are possible with low admin overhead.

It is not a full-featured stats platform.

It is not a public-facing league website.

It is the minimum operational foundation: captains submit results, admins approve them, Supabase records them, and everything is auditable.

---

## The Problem

League administration in Discord is manual, unstructured, and fragile.

- Admins hunt through message history to find match results
- Evidence is scattered across channels and DMs
- No audit trail for prizing verification
- Wrong team names typed, wrong matches referenced
- No single place for match lifecycle state

This creates compliance risk and admin burnout.

---

## Target Users

| User | Role |
|------|------|
| Team captains | Submit match results and reschedules |
| League admins | Approve or deny pending actions |
| Operators | Monitor system health, correct errors |

---

## Core Workflow (MVP)

```
Captain: /report-result
→ Bot shows Supabase-driven match dropdown
→ Captain selects match, enters winner + score
→ Bot creates pending_action
→ Bot posts public receipt in #match-results-[division]
→ Bot creates proof thread for screenshot uploads
→ Bot posts admin review card in #admin-review
→ Admin presses Approve
→ match.status = completed, winner/score written
→ audit_log entry written
→ Embeds updated to ✅
```

This is the loop the MVP must complete reliably.

---

## MVP Scope

### Included

- [ ] Captain identity resolution (Discord ID → team)
- [ ] `/report-result` command with Supabase-driven match dropdown
- [ ] `pending_actions` creation on submission
- [ ] Public receipt embed posted to division channel
- [ ] Proof thread creation and screenshot count tracking
- [ ] Admin review card with Approve / Deny / Needs Info / Open Admin Panel buttons
- [ ] Approval handler: match mutation + audit log + embed updates
- [ ] Denial handler: embed updates + captain notification
- [ ] Needs Info handler: embed update + captain ping
- [ ] Idempotency: duplicate submission protection
- [ ] `/reschedule` command + approval handler
- [ ] `/request-admin-review` catch-all command
- [ ] All mutations write to `audit_logs`
- [ ] Supabase Storage archival of proof thread screenshots

### Explicitly Excluded From MVP

| Feature | Reason Excluded |
|---------|----------------|
| Additional `sal-site` admin workflows | Discord approval is sufficient for MVP operations |
| ForgeLens OCR | Stats can be entered manually at MVP scale |
| Player stats display | Depends on OCR pipeline |
| Standings calculation | Depends on confirmed match results pipeline |
| Public player/team pages | Post-MVP |
| Multi-season support | Season 1 only for MVP |
| Auto-approval for high-confidence OCR | Post-MVP; requires calibration data |
| Scanning / NLP fallback | Commands-first; scanning deferred |
| Alert system for stale pending actions | Operational hardening, post-MVP |

---

## Success Conditions

| Condition | Status |
|-----------|--------|
| Captain submits `/report-result` without support | ⬜ |
| Admin receives review card with full match context | ⬜ |
| Admin approval mutates match in Supabase | ⬜ |
| audit_log entry written on every approval | ⬜ |
| Public receipt updated on approval/denial | ⬜ |
| Proof thread created and screenshot count tracked | ⬜ |
| Bot restart loses no data | ⬜ |
| `/reschedule` end-to-end works | ⬜ |
| Duplicate submission handled gracefully | ⬜ |

---

## What Success Looks Like

An admin can process a full match week — results, reschedules, disputes — entirely through Discord, with every decision logged in Supabase and every public receipt posted to the division channel.

No match result is stored in Discord history. All state is in Supabase.

At the end of a match week, the audit log is a complete, attributable record of every action taken.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Bot offline during active match | All state is in Supabase; use the available `sal-site` admin tools as fallback |
| Discord CDN URL expiration for screenshots | Supabase Storage archival on upload |
| Race condition on double-approval | `claimPendingActionForApproval` uses atomic WHERE status='pending' |
| Captain adopts scanning instead of commands | Onboarding guide + bot prompts to use commands |
| Admin review backlog during peak weeks | Additional `sal-site` tooling can add filtering and batch actions |

---

## MVP Is Not

- A perfect product
- A feature-complete platform
- A public launch

The MVP is operational readiness for one season of SAL league management.

Everything else is Phase 2+.

---

## Implemented Operations Foundation

The repo also includes admin-only operations infrastructure that supports league setup and roster synchronization:

- Operations Engine helpers under `apps/bot/src/lib/operations`
- `/division-role-config` for Discord-managed division role mappings
- `/division-sync` preview/apply for player Discord ID linking and division role sync
- `division_role_mappings` Supabase migration

These workflows are audited direct admin operations. They do not replace the MVP match approval loop above.
