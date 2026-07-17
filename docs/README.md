# Documentation Index

## Production Audit

- [`audit-production-readiness-2026-07-14.md`](audit-production-readiness-2026-07-14.md) - **authoritative platform audit** (findings, launch plan, go/no-go); maintained identically in sal-site

## Start Here

- [`onboarding/getting-started.md`](onboarding/getting-started.md) - new contributor orientation
- [`onboarding/local-development.md`](onboarding/local-development.md) - local setup
- [`ROADMAP.md`](ROADMAP.md) - phased implementation plan
- [`operational-philosophy.md`](operational-philosophy.md) - founding principles

## Architecture

- [`architecture/overview.md`](architecture/overview.md) - system design and component responsibilities
- [`architecture/platform-split.md`](architecture/platform-split.md) - boundary definitions
- [`architecture/data-flow.md`](architecture/data-flow.md) - per-workflow data diagrams
- [`architecture/operations.md`](architecture/operations.md) - reusable bot operations engine

## Database

- [`database/schema.md`](database/schema.md) - table definitions and relationships
- [`database/mutation-patterns.md`](database/mutation-patterns.md) - how state changes happen
- [`database/audit-philosophy.md`](database/audit-philosophy.md) - audit log design and rules

## Workflows

- [`commands.md`](commands.md) - every slash command, what it does, and who can run it
- [`workflows/discord-workflows.md`](workflows/discord-workflows.md) - cross-cutting behavior: review cards, proof threads, channel config
- [`workflows/proof-threads.md`](workflows/proof-threads.md) - proof thread lifecycle
- [`workflows/approval-pipeline.md`](workflows/approval-pipeline.md) - shared approval infrastructure

## Future OCR / ForgeLens Design

These documents specify Phase 4 constraints. ForgeLens is not implemented or deployed.

- [`ocr/forgelens-integration.md`](ocr/forgelens-integration.md) - ingestion, pipeline, output
- [`ocr/confidence-scoring.md`](ocr/confidence-scoring.md) - scoring model and routing
- [`ocr/stat-approval-lifecycle.md`](ocr/stat-approval-lifecycle.md) - admin review of stat records

## Architecture Decision Records

| ADR | Decision |
|-----|---------|
| [ADR-001](adrs/ADR-001-supabase-source-of-truth.md) | Supabase as single source of truth |
| [ADR-002](adrs/ADR-002-commands-primary-workflow.md) | Commands over parsing |
| [ADR-003](adrs/ADR-003-ocr-no-auto-approve.md) | OCR output never auto-approved |
| [ADR-004](adrs/ADR-004-evidence-threads.md) | Dedicated proof threads |
| [ADR-005](adrs/ADR-005-pending-actions.md) | Unified pending_actions pipeline |
| [ADR-006](adrs/ADR-006-immutable-audit-logs.md) | Immutable audit logs |

New ADRs: copy [`adrs/template.md`](adrs/template.md).

## Runbooks

- [`runbooks/incident-handling.md`](runbooks/incident-handling.md) - live incident response
- [`runbooks/admin-operations.md`](runbooks/admin-operations.md) - common admin tasks

## Deployment

- [`deployment/discord.md`](deployment/discord.md) - Discord application, intents, permissions, and command registration
- [`deployment/supabase.md`](deployment/supabase.md) - database and storage

The web/control-center deployment belongs to [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site).
