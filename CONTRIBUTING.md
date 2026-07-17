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

This repository uses trunk-based development. Branch from `main`, keep the branch short-lived, and open a pull request back to `main`. There is no `develop` branch.

| Branch | Purpose |
|--------|---------|
| `main` | Protected integration and production branch. |
| `feature/*` | New feature branch created from `main`. |
| `fix/*` | Bug-fix branch created from `main`. |
| `hotfix/*` | Urgent production fix created from `main`. |

---

## Local Development

See [`docs/onboarding/local-development.md`](docs/onboarding/local-development.md) for full setup instructions.

Quick start:

```bash
# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env.local

# Start the canonical local database from a sibling checkout
cd ../sal-database
npm ci
npx supabase start
npx supabase db reset
cd ../lab-salbot

# Start the bot in development mode
pnpm --filter @salbot/bot dev
```

The web/control-center application is maintained separately in [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site). ForgeLens is a future design and has no runtime package in this workspace.

[`diese-tech/sal-database`](https://github.com/diese-tech/sal-database) is the sole owner of active Supabase migrations, generated types, schema releases, and database pushes. The SQL under this repository's `database/migrations/` directory is pre-contract history. Make schema changes in `sal-database` through an isolated issue and PR; do not push the historical SALbot sequence to the shared project.

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
| `contract` | Consumer change for a released database contract |

Examples:

```
feat(bot): add /report-result command with proof thread creation
fix(bot): prevent duplicate pending_actions on command retry
contract(db): sync generated types for db-v1.1.0
docs(adrs): add ADR-003 OCR no-auto-approve
```

---

## Pull Request Requirements

All PRs must:

- [ ] Link to a related issue or describe the problem being solved
- [ ] Include test coverage for new approval paths
- [ ] Not touch `audit_logs` schema without an ADR
- [ ] Not introduce a command that mutates match state without going through `pending_actions`
- [ ] Keep schema DDL in a separate `diese-tech/sal-database` issue and PR
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
