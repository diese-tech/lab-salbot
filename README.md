# SALBot

**SALBot is the Discord operations layer for the Serpent Ascension League (SAL).**

Discord is the workflow surface; Supabase is the authoritative state store. SALBot turns league actions such as match reporting, reschedules, roster transactions, and admin review into structured, auditable workflows instead of relying on free-form moderation.

> **Status:** Active platform development. The Discord bot is the live application in this repository; Railway is the intended runtime host.

## Platform Role

SAL is intentionally split across repositories:

```text
Discord users ──► SALBot ──► Supabase ◄── sal-site
                               ▲
                               │
                         sal-database
                       contract owner
```

- **This repository (`lab-salbot`)** owns Discord workflow intake, review cards, receipts, role reconciliation, and bot-side operations.
- [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site) owns the public website and web control surfaces.
- [`diese-tech/sal-database`](https://github.com/diese-tech/sal-database) owns active Supabase migrations, generated types, schema releases, and production database pushes.

Legacy SQL in this repository is historical; shared schema changes belong in `sal-database`.

## Core Workflows

SALBot currently supports structured operations including:

- match result reporting and proof/evidence threads;
- reschedule requests;
- admin-review escalation;
- division role configuration and synchronization;
- audited captain and organization role mapping;
- roster trades and drops;
- durable transaction bulletins and Discord role reconciliation;
- public receipts and staff review surfaces.

See [`docs/commands.md`](docs/commands.md) for the current command, permission, and channel-scope contract.

## Operating Principles

- **Supabase is authoritative.** Discord posts are workflow controls and receipts, not the database.
- **No silent mutations.** Important state changes are auditable and attributable.
- **Authorization is re-evaluated at mutation time.** Message/component visibility is not a security boundary.
- **Human review remains explicit where league policy requires it.**
- **Durable operations should recover safely.** Discord delivery failures should not create ambiguous league state.
- **Repository boundaries matter.** Application repositories consume the database contract rather than redefining it.

## Repository Structure

```text
apps/
  bot/              Discord bot application
packages/
  db/               Supabase client/query helpers
  shared/           Shared types and utilities
docs/                Architecture, operations, deployment, ADRs
database/            Pre-contract SQL history and development seed data
.github/              CI and issue templates
```

## Local Development

Start with [`docs/onboarding/getting-started.md`](docs/onboarding/getting-started.md) for the current contributor setup.

Useful documentation:

- [`docs/architecture/overview.md`](docs/architecture/overview.md) — system architecture
- [`docs/architecture/operations.md`](docs/architecture/operations.md) — reusable operations engine
- [`docs/workflows/discord-workflows.md`](docs/workflows/discord-workflows.md) — captain/admin workflows
- [`docs/deployment/discord.md`](docs/deployment/discord.md) — Discord setup and registration
- [`docs/deployment/railway.md`](docs/deployment/railway.md) — production runtime contract
- [`docs/database/schema.md`](docs/database/schema.md) — current data model reference
- [`docs/adrs/`](docs/adrs/) — architecture decisions
- [`docs/audit-status.md`](docs/audit-status.md) — current findings and verification evidence

## Validation and Release Discipline

Use the repository's current package scripts and CI workflows as the authoritative validation contract. A green build or test run does not automatically prove deployment or live Discord acceptance when an issue explicitly requires runtime evidence.

Before claiming a workflow complete, distinguish:

```text
implemented → automated validation → reviewed → merged → deployed → live accepted
```

## Future Work

Accepted future work includes additional roster/draft operations, web transaction surfaces, historical reconciliation tooling, and the planned OCR-assisted extraction path. Future OCR remains a reviewable evidence workflow and must not silently become authoritative league state.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

See [`LICENSE`](LICENSE). This source is publicly viewable but is **not open source**.
