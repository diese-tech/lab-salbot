# salbot

**SAL League Operations Platform**

A lightweight competition operations platform for the SAL league. This is not just a Discord bot — Discord is the workflow intake layer. The current platform combines this repository's bot with Supabase and the separately maintained [`sal-site`](https://github.com/diese-tech/sal-site) web application. ForgeLens OCR remains a future design.

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

ForgeLens is retained as a Phase 4 architecture proposal only. There is no ForgeLens runtime package or deployment in the current workspace.

### Component Responsibilities

| Component | Status | Role |
|-----------|--------|------|
| **Supabase** | Current | Authoritative state. Owns all entities, relationships, lifecycle, and identifiers. |
| **Discord Bot** | Current; this repository | Workflow intake, captain commands, admin operations, public receipts, review cards, and proof threads. |
| **[`sal-site`](https://github.com/diese-tech/sal-site)** | Current; separate repository | Public website and operational control center. |
| **ForgeLens** | Future Phase 4 design | Proposed OCR processor for screenshot stat extraction and human-reviewed pending records. |

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

Captain selects eligible match from Supabase-driven dropdown → enters winner + score → system creates:

1. Public embed in `#match-results-[division]`
2. Dedicated proof thread for screenshot upload
3. Admin review card in `#admin-review`
4. Pending action in Supabase
5. Audit log entry

Screenshots are uploaded to the proof thread, not inline to the command. This supports 6–10 screenshots per match without degrading UX.

### `/reschedule`

Captain selects scheduled match → requests new date/time → admin review workflow triggered.

### `/request-admin-review`

Catch-all escalation. Creates an admin review card for any issue not covered by structured commands.

### `/division-role-config`

Admin-only setup command. Admins map each SAL division to a Discord role from inside Discord. Mappings are stored in Supabase and audited.

### `/division-sync`

Admin-only identity and role synchronization workflow. Admins upload a roster CSV, preview proposed Discord identity links and role changes, then apply the sync with a short-lived confirmation token.

---

## Command Philosophy

**Commands are the official workflow. Message scanning is the safety net.**

Captains are expected to use slash commands. The bot may optionally scan channels for fallback detection, but scanned messages never become authoritative without a corresponding pending action processed through the normal pipeline.

This means:
- Every legitimate action has a corresponding `pending_actions` record.
- Admins always review before mutations occur.
- No state changes happen silently.

---

## Evidence System

Every actionable command produces two posts:

| Post | Location | Purpose |
|------|----------|---------|
| Public receipt | `#match-results-[division]` or `#reschedules-[division]` | Transparency, compliance, prizing verification |
| Admin review card | `#admin-review` | Triage, approval, workflow actions |

Proof threads attached to match reports:

- Track screenshot upload progress (`0/6 uploaded → 4/6 → ✅ complete`)
- Are stored as evidence references in Supabase Storage
- Provide the proposed input surface for a future ForgeLens implementation

---

## Status Emoji Semantics

| Emoji | Meaning |
|-------|---------|
| 📝 | Received / under review |
| 📸 | Awaiting proof upload |
| ⚠️ | Needs info |
| ✅ | Approved |
| ❌ | Denied |
| 🔁 | Revised |

---

## Future OCR Design

ForgeLens is not implemented or deployed. The Phase 4 design would process proof-thread screenshots and generate pending stat records with confidence scores. If implemented, **OCR must never directly mutate official stats**; every extracted stat must pass through admin review.

```
Screenshot uploaded
→ ForgeLens OCR
→ Confidence score generated
→ Pending stat record created
→ Admin review / manual correction
→ Official stat written
```

---

## Monorepo Structure

```
salbot/
├── apps/
│   └── bot/              # Discord bot (Discord.js, TypeScript)
├── packages/
│   ├── db/               # Supabase client, generated types, query helpers
│   └── shared/           # Shared types, constants, utility functions
├── docs/                 # Operations docs and future design specifications
├── database/
│   ├── migrations/       # SQL migration files
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

Internal — diese-tech. All rights reserved.
