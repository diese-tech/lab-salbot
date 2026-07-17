# Contributing to salbot

This document is the starting point for anyone contributing to the SAL operations platform. Read it before opening a PR.

---

## Repository Philosophy

This is an operations-critical platform. Match results, standings, and compliance evidence flow through it. Changes here affect real league outcomes and real prizing decisions. That requires:

- **Careful review** before merging anything touching the approval pipeline, audit logs, or match mutations.
- **Documented intent** — PRs must explain *why*, not just *what*.
- **No silent mutations** — if code touches `matches`, `player_stats`, or `standings`, it must write to `audit_logs`.
- **Test coverage for approval paths** — every approval/denial/needs-info path must be covered.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready. Protected. |
| `develop` | Integration branch. Feature branches merge here first. |
| `feature/*` | New features. Branch from `develop`. |
| `fix/*` | Bug fixes. Branch from `develop` (or `main` for hotfixes). |
| `hotfix/*` | Critical production fixes. Branch from `main`. |

---

## Local Development

See [`docs/onboarding/local-development.md`](docs/onboarding/local-development.md) for full setup instructions.

Quick start:

```bash
# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env.local

# Start local Supabase
supabase start

# Run migrations
supabase db push

# Start the bot in development mode
pnpm --filter @salbot/bot dev
```

The web/control-center application is maintained separately in [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site). ForgeLens is a future design and has no runtime package in this workspace.

---

## Commit Conventions

Format: `type(scope): description`

| Type | Use |
|------|-----|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure without behavior change |
| `docs` | Documentation only |
| `chore` | Build, config, tooling |
| `test` | Tests only |
| `migration` | Database migration |

Examples:

```
feat(bot): add /report-result command with proof thread creation
fix(bot): prevent duplicate pending_actions on command retry
migration: add confidence_score to pending_stat_records
docs(adrs): add ADR-003 OCR no-auto-approve
```

---

## Pull Request Requirements

All PRs must:

- [ ] Link to a related issue or describe the problem being solved
- [ ] Include test coverage for new approval paths
- [ ] Not touch `audit_logs` schema without an ADR
- [ ] Not introduce a command that mutates match state without going through `pending_actions`
- [ ] Pass CI (lint, typecheck, tests)

---

## Architecture Decisions

If you are proposing a change that affects:

- Source of truth boundaries
- Approval pipeline behavior
- Audit log schema
- OCR pipeline behavior
- Database mutation patterns

Write an ADR first. See [`docs/adrs/`](docs/adrs/) for examples and the ADR template at [`docs/adrs/template.md`](docs/adrs/template.md).

---

## Questions

For architecture questions, open a GitHub Discussion. For urgent operational issues, follow [`docs/runbooks/incident-handling.md`](docs/runbooks/incident-handling.md).
