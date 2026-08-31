# salbot

**SAL League Operations Platform**

A lightweight competition operations platform for the SAL league. This is not just a Discord bot — Discord is the workflow intake layer. The current platform combines this repository's bot with Supabase and the separately maintained [`sal-site`](https://github.com/diese-tech/sal-site) web application. ForgeLens OCR remains a future design.

## Repository Status

- `apps/bot` is the active application in this repository. At the reviewed commit, its package and the active shared/database packages pass 34 tests in total.
- [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site) is the separate web/control-center application.
- ForgeLens is future architecture only; there is no ForgeLens runtime package in this workspace.
- Railway is the intended bot host. The reproducible container/Railway contract landed in [#50](https://github.com/diese-tech/lab-salbot/pull/50), and [#49](https://github.com/diese-tech/lab-salbot/pull/49) verifies its non-root production image in CI. Readiness and Railway staging proof remain tracked in [#45](https://github.com/diese-tech/lab-salbot/issues/45).
- [`diese-tech/sal-database`](https://github.com/diese-tech/sal-database) is the designated sole owner of active Supabase migrations, generated types, schema releases, and production pushes. SQL in this repository is pre-contract history.

See [`docs/audit-status.md`](docs/audit-status.md) for current findings and verification evidence.

---

## Platform Identity

This platform exists to solve three operational problems:

1. **Accountability** — every match result, reschedule, and admin action must be traceable, attributable, and recoverable.
2. **Compliance** — Hi-Rez tournament and prizing requirements demand timestamped evidence, screenshot archives, and auditable receipts.
3. **Scale** — manual Discord moderation does not scale. Structured workflows reduce admin cognitive load and surface the right information at the right time.

---

## Architecture

Current production components:

```
Discord ──► salbot ──► Supabase ◄── sal-site
 workflow     intake    source of     web/control center
   UI          API        truth
```

OCR-assisted scout extraction is an accepted Phase 4 design under ADR-008.
There is no extraction runtime package or deployment in the current workspace.

### Component Responsibilities

| Component                                                | Status                                | Role                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase**                                             | Current                               | Authoritative runtime state; the schema contract release process is owned by [`diese-tech/sal-database`](https://github.com/diese-tech/sal-database). SALbot vendors and verifies immutable `db-v1.2.0` at commit `195a0792a396354d7809d7dcbb85a9cdfd4d8030`. |
| **Discord Bot**                                          | Current; this repository              | Workflow intake, captain commands, admin operations, public receipts, review cards, and proof threads.                                                                                                                                                        |
| **[`sal-site`](https://github.com/diese-tech/sal-site)** | Current; separate repository          | Public website and operational control center.                                                                                                                                                                                                                |
| **OCR extraction runtime**                               | Accepted Phase 4 design; not deployed | Processes paired scout screenshots into confidence-gated, reviewable stat batches.                                                                                                                                                                            |

**Discord is not a database. Supabase is.**

---

## Why Not a Bot

Standard Discord bots process messages and react to events. This platform uses Discord as a structured form-entry and receipt-delivery surface. The actual state of the league — matches, schedules, standings, player stats — lives entirely in Supabase. Discord posts are receipts, not records.

This distinction matters for:

- **Recovery** — if the bot restarts, no data is lost. Supabase has everything.
- **Auditability** — every change is traceable regardless of Discord message history.
- **Correctness** — dropdown-driven match selection eliminates typos and fuzzy matching ambiguity.
- **Compliance** — public Discord posts become timestamped evidence archives, not the source of truth.

---

## Core Workflows

### `/report-result`

An authorized Discord operator selects a current-season match from a Supabase-driven dropdown → enters winner + score → system creates:

1. Public embed in `#match-results-[division]`
2. Dedicated proof thread with an **Enter stats** button
3. Admin review card in `#admin-review`
4. Pending action in Supabase
5. Audit log entry

The host uploads screenshots once in the sal-site correction flow. After host
submission, SALBot mirrors the durable stored images into the proof thread and
posts an idempotent admin stats-review card. Official stats remain
site/database approval-only.

`/report-result` and `/log-scouter` authorize from the centrally configured
`SAL_OPERATOR_ROLE_IDS` and `SAL_ADMIN_ROLE_IDS`. OAuth/player linkage supplies
identity and profile data only; it is not a command permission gate.

### `/reschedule`

Captain selects scheduled match → requests new date/time → admin review workflow triggered.

### `/request-admin-review`

Catch-all escalation. Creates an admin review card for any issue not covered by structured commands.

### `/division-role-config`

Admin-only setup command. Admins map each SAL division to a Discord role from inside Discord. Mappings are stored in Supabase and audited.

### `/division-sync`

Admin-only identity and role synchronization workflow. Admins upload a roster CSV, preview proposed Discord identity links and role changes, then apply the sync with a short-lived confirmation token.

### Roster transaction command scope

ADR-009 defines the roster command surface. The `/trade`, `/drop`,
`/captain-role-config`, and `/organization-role-config` slices are implemented:

- `/trade` and `/drop` use guided, season-scoped captain, organization
  owner/advisor, and administrator submission in division trade-block channels;
- `/captain-role-config` and `/organization-role-config` provide audited admin
  mapping; and
- completed trades and drops use durable transaction bulletin and Discord
  division-team role-reconciliation workers.

`/claim`, `/draft-position-swap`, `/broadcast-role-config`, draft
conclusion delivery, web transaction forms, and historical reconciliation UI
remain accepted future work. See [`docs/commands.md`](docs/commands.md) for the
complete permission and channel-scope contract.

---

## Command Philosophy

**Commands are the official workflow. Message scanning is the safety net.**

Captains are expected to use slash commands. The bot may optionally scan channels for fallback detection, but scanned messages never become authoritative without a corresponding pending action processed through the normal pipeline.

This means:

- Every legitimate action has a corresponding `pending_actions` record.
- Admins always review before mutations occur.
- No state changes happen silently.

---

## Current Match-Workflow Evidence System

The current `/report-result` and `/reschedule` workflows produce the applicable
posts below. This is not a universal contract for planned roster commands.

| Post              | Location                                                 | Purpose                                        |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Public receipt    | `#match-results-[division]` or `#reschedules-[division]` | Transparency, compliance, prizing verification |
| Admin review card | `#admin-review`                                          | Triage, approval, workflow actions             |

Proof threads attached to match reports:

- Track screenshot upload progress (`0/6 uploaded → 4/6 → ✅ complete`)
- Are stored as evidence references in Supabase Storage
- Provide the proposed input surface for a future ForgeLens implementation

Roster workflows use different destinations: trade proposals post in
the matching division trade-block channel, roster submissions enter private
admin review, and only completed operations publish to the consolidated
transactions channel. See [`docs/commands.md`](docs/commands.md) and
[`docs/workflows/discord-workflows.md`](docs/workflows/discord-workflows.md).

---

## Status Emoji Semantics

| Emoji | Meaning                 |
| ----- | ----------------------- |
| 📝    | Received / under review |
| 📸    | Awaiting proof upload   |
| ⚠️    | Needs info              |
| ✅    | Approved                |
| ❌    | Denied                  |
| 🔁    | Revised                 |

---

## Future OCR Design

The OCR extraction runtime is not implemented or deployed. The accepted Phase 4
design processes paired scout screenshots and creates canonical stat-review
records with field-level confidence. OCR never directly mutates official stats.
Under ADR-008, a complete game may publish through the audited database RPC
before human review only when every confidence and deterministic gate passes.
The published extraction remains internally flagged until an authorized human
clears the flag.

```
Screenshot uploaded
→ OCR-assisted extraction
→ Field confidence and deterministic validation
→ Canonical stat-review batch created
→ Auto-publish as review-flagged, or route to manual review
→ Human unflag, dispute, or correction remains auditable
```

---

## Monorepo Structure

```
salbot/
├── apps/
│   └── bot/              # Discord bot (Discord.js, TypeScript)
├── packages/
│   ├── db/               # Supabase client and query helpers
│   └── shared/           # Shared types, constants, utility functions
├── docs/                 # Operations docs and future design specifications
├── database/
│   ├── migrations/       # Pre-contract SQL history; not active ownership
│   └── seeds/            # Development seed data
└── .github/
    ├── workflows/        # CI/CD
    └── ISSUE_TEMPLATE/   # Issue templates
```

The website/control center is maintained in [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site), not as a package in this workspace.

---

## Operational Goals

- **Zero silent mutations** — every state change is logged to `audit_logs`.
- **Human-in-the-loop approvals** — no automated approval of match results or stat records.
- **Recovery by default** — every action is reversible or correctable through audited admin workflows and `sal-site`.
- **Compliance-grade receipts** — public Discord posts constitute Hi-Rez acceptable evidence archives.
- **Multi-league ready** — all entities are scoped by `division_id`. Adding a new league requires no schema changes.

---

## Documentation

Full documentation lives in [`docs/`](docs/). Start with:

Current operations docs:

- [`docs/architecture/operations.md`](docs/architecture/operations.md) - reusable bot operations engine
- [`docs/deployment/discord.md`](docs/deployment/discord.md) - Discord setup and command registration
- [`docs/deployment/railway.md`](docs/deployment/railway.md) - production container and Railway deployment contract
- [`docs/architecture/overview.md`](docs/architecture/overview.md) — system design
- [`docs/onboarding/getting-started.md`](docs/onboarding/getting-started.md) — contributor setup
- [`docs/workflows/discord-workflows.md`](docs/workflows/discord-workflows.md) — captain and admin workflows
- [`docs/database/schema.md`](docs/database/schema.md) — data model
- [`docs/adrs/`](docs/adrs/) — architecture decision records

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## License

See [`LICENSE`](LICENSE). This source is publicly viewable but is not open source.
