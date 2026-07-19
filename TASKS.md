# TASKS.md — SAL Operations Platform

Tracks active implementation work.

Goal: operational clarity.

Not fake productivity.

---

# In Progress

## Current Focus

**Phase 1 — `/report-result` + approval pipeline.**

See `ROADMAP.md` Phase 1 for full scope.

Completed operations foundation now includes the Operations Engine, `/division-role-config`, and `/division-sync` preview/apply. Current active work remains the captain approval pipeline.

### Active Tasks

- [ ] Captain identity resolution middleware (`getCaptainByDiscordId` → team)
- [ ] `/report-result` command handler — match dropdown population from Supabase
- [ ] Winner/score modal input with format validation
- [ ] `pending_action` creation on command submission
- [ ] Public receipt embed builder (division channel post)
- [ ] Proof thread creation under receipt embed
- [ ] Admin review card builder (`#admin-review` post)
- [ ] Approve button interaction handler → match mutation + audit log
- [ ] Deny button interaction handler → embed updates + captain notification
- [ ] Needs Info button interaction handler → captain ping with note
- [ ] Duplicate submission guard (idempotency check)

### Risks / Unknowns

- Discord thread creation rate limits under high volume
- Proof thread screenshot counting reliability if bot restarts mid-session

---

# To Do

## Foundation

- [x] Repository scaffold
- [x] Documentation system
- [x] Architecture Decision Records (6)
- [x] Initial Supabase schema migration
- [x] `packages/db` query helpers
- [x] `packages/shared` types and score parser
- [x] CI (typecheck, lint, test)
- [x] Operations Engine
- [x] `/division-role-config`
- [x] `/division-sync` preview/apply
- [x] `division_role_mappings` migration

## MVP — Phase 1

- [ ] `/report-result` command end-to-end
- [ ] Screenshot upload tracking in proof threads
- [ ] Supabase Storage archival of screenshots
- [ ] Admin embed update on approval/denial

## MVP — Phase 2

- [ ] `/reschedule` command
- [ ] `/request-admin-review` command
- [ ] `/rules` command (OpenRouter LLM over `docs/rules/`)
- [ ] `/update-ign` command (IGN change with proof + admin approval)
- [ ] Bot deployment configuration

## Operations / Stability

- [ ] Bot reconnect and session recovery on restart
- [ ] Error boundary on button interactions (prevent double-approval crash)
- [ ] Channel config validation on startup
- [ ] Live Discord/Supabase smoke test for `/division-role-config` and `/division-sync`

## Future Work

- [ ] Additional `sal-site` admin workflows (Phase 3; separate repository)
- [ ] OCR-assisted scout extraction runtime (Phase 4; accepted in ADR-008, not deployed)
- [ ] Standings calculation (Phase 5)
- [ ] Player/team pages (Phase 5)

---

# Done

## Recently Completed

- [x] Repository scaffold with full monorepo structure
- [x] README, AGENTS.md, MVP.md, ROADMAP.md, TASKS.md, DECISIONS.md
- [x] docs/ system: architecture, database, workflows, OCR, runbooks, onboarding, deployment
- [x] 6 Architecture Decision Records
- [x] Initial Supabase schema migration (all core tables)
- [x] `packages/db` typed query helpers
- [x] `packages/shared` types, constants, score parser
- [x] CI configuration (GitHub Actions: typecheck, lint, test)
- [x] ESLint + TypeScript config across all workspaces
- [x] pnpm workspace + lockfile

## Important Completed Milestones

- Phase 0 scaffold complete — PR #1 open against main

---

# Blocked

None currently.

---

# Deferred

| Task | Reason Deferred |
|------|----------------|
| Additional `sal-site` admin workflows | Phase 3 — Discord approval sufficient for MVP |
| ForgeLens OCR | Phase 4 — not blocking match operations |
| Standings display | Phase 5 — depends on confirmed result pipeline |
| Confidence-gated OCR auto-publication | Planned under ADR-008; blocked by extraction, transactional RPC, calibration, and staging gates |
| Bot message scanning fallback | Commands-first; scanning adds complexity without clear benefit at MVP scale |

---

# Operational Notes

- Development seeds in `database/seeds/001_development.sql` — includes test captains with placeholder Discord IDs
- Replace `000000000000000001` / `000000000000000002` in seeds with real test Discord IDs before local testing
- Channel IDs in `.env.local` must be filled in before bot commands can post to correct channels
