# Getting Started

Welcome to the SAL operations platform. This guide covers what you need to know to contribute.

---

## What You're Working On

This is not a Discord bot project. It is a competition operations platform. The Discord bot is one component of four. Before writing code, read:

1. [`docs/architecture/overview.md`](../architecture/overview.md) — system design and component responsibilities
2. [`docs/operational-philosophy.md`](../operational-philosophy.md) — founding principles
3. [`docs/architecture/platform-split.md`](../architecture/platform-split.md) — what belongs where
4. [`docs/database/mutation-patterns.md`](../database/mutation-patterns.md) — how state changes are made

If you are adding a new feature that touches the approval pipeline, audit logs, or OCR pipeline, read the relevant ADR in [`docs/adrs/`](../adrs/) first.

---

## Local Development Setup

See [`local-development.md`](local-development.md) for the full setup walkthrough.

Prerequisites:
- Node.js 20+
- pnpm 9+
- Docker (for local Supabase)
- Supabase CLI

---

## Repository Structure

```
salbot/
├── apps/bot/        Discord bot (Discord.js + TypeScript)
├── apps/web/        Next.js admin panel
├── packages/db/     Supabase client + generated types
├── packages/shared/ Shared types + utilities
├── services/forgelens/ OCR/stat extraction service
├── docs/            All documentation
├── database/        SQL migrations + schema docs
├── infra/           Supabase config
└── scripts/         Setup + maintenance scripts
```

---

## Key Concepts

### pending_actions

Every captain approval command creates a `pending_action`. No match mutation happens without one. Admin-only setup and identity commands, such as division role mapping and division sync, are audited direct operations instead. See [`docs/workflows/approval-pipeline.md`](../workflows/approval-pipeline.md) and [`docs/database/mutation-patterns.md`](../database/mutation-patterns.md).

### audit_logs

Every mutation writes an `audit_log` entry. This is not optional. If your code changes a match, player stat, standing, identity link, or division role mapping and does not write to `audit_logs`, it is a bug. See [`docs/database/audit-philosophy.md`](../database/audit-philosophy.md).

### match selection dropdowns

Captains do not type team names. The bot resolves the captain's identity, finds their team, and shows a dropdown of eligible matches from Supabase. This avoids typos and fuzzy matching. Your command handlers should follow this pattern.

---

## First PR Checklist

- [ ] Does my change touch the approval pipeline? → Read the pipeline ADRs.
- [ ] Does my change mutate a match, player_stat, or standing? → Does it write to `audit_logs`?
- [ ] Does my change add a new captain approval command? → Does it produce a `pending_action`?
- [ ] Does my change add an admin-only setup or identity command? → Does it validate `admin_users` and write `audit_logs`?
- [ ] Does my change add a new pending_action type? → Does it have an approval handler?
- [ ] Have I added tests for the new approval path?

---

## Questions

Open a GitHub Discussion. For urgent operational issues, see [`docs/runbooks/incident-handling.md`](../runbooks/incident-handling.md).
