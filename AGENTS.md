# AGENTS.md - SAL Operations Platform

This file defines the rules for AI-assisted implementation on this project.

Read this before implementing anything.

## What This Project Is

A competition operations platform for the SAL league.

This repository ships the Discord workflow application and its shared packages. The wider platform also uses the separate `diese-tech/sal-site` web application; ForgeLens remains future design. The system's job is:

- structured match result intake
- admin approval pipelines
- compliance-grade evidence collection
- future OCR-assisted stat extraction design
- audit-logged state management
- admin identity and role operations

## What Supabase Owns

Supabase is the single source of truth.

Supabase owns:

- match records and lifecycle
- schedules and standings
- player/team relationships
- Discord identity links
- division role mappings
- pending actions
- audit logs
- evidence references
- stat records

Discord is a display and intake surface only. Do not treat Discord message history as a data store.

## Architecture Rules

### No Direct Match or Stat Mutations Outside Canonical Workflows

Every match result or reschedule must:

1. Create a `pending_action` record
2. Go through admin review
3. Execute the mutation on approval
4. Write to `audit_logs`

Stat extraction must create canonical stat-review records. A complete game may
publish before human review only through the confidence-gated,
service-role-only transaction defined by ADR-008. That path still writes
immutable audits, uses the durable outbox, is idempotent, and leaves the
auto-published extraction flagged for human review. The extraction service
never writes directly to official stat tables.

Admin-only operational setup and identity maintenance is the exception. Commands such as `/division-role-config` and `/division-sync` may mutate `division_role_mappings`, `players.discord_id`, and Discord roles directly after validating `admin_users`. Those mutations must still write `audit_logs` and must not overwrite conflicting identity data automatically.

### No Silent Mutations

Every state change to `matches`, `player_stats`, `standings`, player identity links, or division role mappings must write an `audit_logs` entry with:

- `actor_discord_id`
- `old_value_json`
- `new_value_json`

### audit_logs Are Immutable

Never update or delete `audit_logs` rows.

Corrections are new rows, not edits.

### OCR Auto-Publication Is Confidence-Gated and Reviewable

OCR-assisted extraction creates canonical stat-review records and never writes
directly to `player_stats`. Under ADR-008, a complete game may publish
immediately only when every required field for every player is above the 0.97
threshold and all deterministic evidence, identity, aggregate, duplicate, and
transactional checks pass. Otherwise the whole game requires human review.

Auto-published extractions remain internally flagged until an authorized human
clears the flag. Publishing, flagging, unflagging, disputing, and correcting are
all audited.

## Command Rules

Slash commands are the official workflow.

Message scanning is a fallback only.

Scanning must never autonomously create a `pending_action` without human confirmation.

## Match Selection

Captains do not type team names.

Bot resolves:

1. Discord user ID to player record
2. Player record to team
3. Team to eligible matches from Supabase dropdown

Always use the dropdown pattern for captain match workflows. Never ask captains to type team names.

## Implementation Constraints

Do not:

- Add features beyond what the current phase requires
- Introduce in-memory state as a substitute for Supabase reads
- Skip `audit_logs` on any mutation to match-related tables
- Skip `audit_logs` on any player identity or division role mapping mutation
- Allow an extraction service to write directly to `player_stats`
- Create duplicate approval systems; use `pending_actions`
- Add error handling for scenarios that cannot happen
- Write clever abstractions without clear justification

Do:

- Write to `audit_logs` on every state mutation
- Route all approvals through `pending_actions`
- Use audited direct admin operations for setup and identity maintenance that does not require pending approval
- Use Supabase dropdowns for match selection
- Keep command handlers thin; business logic belongs in `packages/shared` or service functions
- Protect against double-approval race conditions on pending actions

## Current Phase

Core bot and operations foundation is in progress.

Completed foundation includes the Operations Engine, `/division-role-config`, and `/division-sync` preview/apply. The captain approval pipeline remains an active implementation area.

See `ROADMAP.md` for phase definitions.

See `MVP.md` for scope boundaries.

## Before Implementing Any New Feature

1. Is it in the current phase scope? If not, stop.
2. Does it mutate match state? If yes, does it go through `pending_actions`?
3. Is it an admin-only setup or identity operation? If yes, does it validate `admin_users` and write `audit_logs`?
4. Does it write to `audit_logs`?
5. Does it add an approval handler if it adds a new `pending_action` type?
6. Is the captain workflow using the dropdown pattern?
7. If stats auto-publish, does the complete game satisfy every ADR-008 gate and remain review-flagged?

If any answer is wrong, fix it before merging.

## Key Files

| File | Purpose |
|------|---------|
| `docs/architecture/overview.md` | System design |
| `docs/architecture/platform-split.md` | Component boundaries |
| `docs/architecture/operations.md` | Operations Engine |
| `docs/database/schema.md` | Table definitions |
| `docs/database/mutation-patterns.md` | How state changes |
| `docs/workflows/approval-pipeline.md` | Approval infrastructure |
| `docs/workflows/discord-workflows.md` | Discord-facing workflows |
| `docs/adrs/` | Why the system looks this way |
| `docs/AI_WORKFLOW_GUARDRAILS.md` | Implementation safety rules |

## Queries Go Through packages/db

Do not write raw Supabase queries inline in command handlers.

All Supabase interactions belong in `packages/db/src/queries/`.

This prevents ad-hoc mutations scattered across the codebase.
