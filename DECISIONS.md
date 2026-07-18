# DECISIONS.md — SAL Operations Platform

Preserves architectural, operational, and product reasoning.

Without this, projects accumulate forgotten tradeoffs, repeated debates, and architecture drift.

For detailed technical ADRs, see `docs/adrs/`. This file captures higher-level product and operational decisions.

---

## 2025-01-01 — Monorepo with pnpm Workspaces

> Superseded in part by the 2026-07-16 active-workspace decision below. This section is retained as historical context.

### Decision

Single repository with pnpm workspaces containing `apps/bot`, `apps/web`, `packages/db`, `packages/shared`, `services/forgelens`.

### Why

- `packages/db` and `packages/shared` need to be consumed by both the bot and the website with shared TypeScript types
- A monorepo enforces that all components stay in sync on schema changes
- A single CI pipeline covers the entire platform

### Expected Benefits

- Shared types prevent the bot and website from drifting on data shapes
- Single `pnpm install` for the whole platform in development
- Schema changes propagate to both consumers simultaneously

### Tradeoffs

- Slightly more complex initial setup (turbo, tsconfig references)
- pnpm lockfile must be maintained across all packages

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Separate repos per component | Type drift between bot and website; no shared package mechanism without publishing |
| npm workspaces | Less mature tooling than pnpm for monorepos |
| Yarn workspaces | Team preference for pnpm |

### Risks

- Lockfile conflicts if multiple contributors touch different packages simultaneously

---

## 2025-01-01 — Supabase as Source of Truth

### Decision

Supabase (PostgreSQL) owns all authoritative state. Discord is a display and intake surface only.

### Why

Discord message history is unreliable as a data store: messages can be deleted, edited, or pruned. Bot memory is lost on restart. Neither is queryable for structured data.

Supabase provides durability, structured queries, RLS, and direct access from both the bot and the website.

### Expected Benefits

- Bot restarts lose no data
- Website has complete, accurate data without Discord sync
- Disputes resolved by querying the database, not scrolling history
- Full audit trail in `audit_logs`

### Tradeoffs

- Every operation requires a Supabase round-trip
- Supabase outage = full system halt

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Discord as state | Non-queryable, non-durable, rate-limited |
| Bot in-memory state | Lost on restart; not shared with website |
| SQLite | Not accessible by website; not cloud-native |

See `docs/adrs/ADR-001-supabase-source-of-truth.md` for full reasoning.

---

## 2025-01-01 — All Approvals Through Shared pending_actions Pipeline

### Decision

Every workflow that requires admin approval creates a `pending_actions` record. No separate approval infrastructure per workflow type.

### Why

One approval pipeline is easier to maintain, test, and reason about than three. Admins have one review surface. Audit trail is consistent across all types.

### Expected Benefits

- Single `#admin-review` channel for all actions
- New workflow types require a new handler, not a new pipeline
- Race condition protection works the same for all types

### Tradeoffs

- `payload_json` shape varies by action type and requires documentation discipline
- A bug in the core approval handler affects all workflow types simultaneously

See `docs/adrs/ADR-005-pending-actions.md` for full reasoning.

---

## 2025-01-01 — OCR Never Directly Approves Stats (Superseded)

### Decision

If ForgeLens is implemented, it creates `pending_stat_records`. Stats are written to `player_stats` only after human admin approval.

### Why

OCR is imperfect. Player name linking is a human problem. Tournament/prizing accountability requires a human sign-off. An admin saying "the bot approved it automatically" is not acceptable in a prizing dispute.

### Expected Benefits

- Every official stat is attributable to a human reviewer
- Errors caught at review time, not after the fact
- Full audit trail from screenshot to official stat

### Tradeoffs

- Admin workload includes stat review
- Stat records may lag behind match results by hours

See `docs/adrs/ADR-003-ocr-no-auto-approve.md` for full reasoning.

---

## 2026-07-18 - Confidence-Gated OCR Stats May Publish Before Human Review

### Decision

OCR still never writes directly to official stat tables. A complete game may
publish immediately through one audited, service-role-only database transaction
when every required field for every player is above 0.97 and all deterministic
pairing, identity, aggregate, duplicate, and evidence checks pass.

Auto-published records remain internally flagged until an authorized human
clears the flag. Any failed gate routes the entire game to manual review.

### Why

Preseason scouting needs trustworthy stats to appear the same or next day.
Complete scoreboard and match-details pairs provide enough redundant evidence
to validate a game as a unit, while a non-blocking review flag and immutable
audit trail preserve human oversight.

### Expected Benefits

- Same-day publication for complete, high-confidence games
- Manual review focuses on exceptions, flags, and disputes
- Full model, prompt, evidence, confidence, validation, and audit provenance

### Tradeoffs

- An incorrect extraction may be visible before a human reviews it
- The database RPC, review-state model, correction flow, and acceptance suite
  become operationally critical

See `docs/adrs/ADR-008-confidence-gated-stat-auto-publication.md` for the full
decision and release gates.

---

## 2025-01-01 — Discord.js for Bot (Not Eris or Sapphire)

### Decision

Use `discord.js` v14 directly without a framework layer (Sapphire, Commando, etc.).

### Why

- discord.js is the most actively maintained Discord library for Node.js
- Framework layers add abstraction that obscures the underlying behavior at MVP scale
- A small team maintaining a small command set does not need Sapphire's plugin system

### Expected Benefits

- Direct access to Discord.js primitives without translation layer
- Smaller dependency surface
- Easier debugging

### Tradeoffs

- More boilerplate for command registration vs. a framework
- No automatic command discovery

### Future Revisit Conditions

If the command count exceeds ~15 or if multiple contributors struggle with the command registration pattern, evaluate Sapphire.

---

## 2025-01-01 — Proof Threads Over Inline Attachments

### Decision

Screenshots are collected in a dedicated Discord proof thread per match, not as inline attachments in the slash command.

### Why

A best-of-3 match requires 6 screenshots minimum. A best-of-5 requires 10. Discord slash command interactions do not gracefully support this volume. Proof threads allow uploading over time and from both captains.

### Expected Benefits

- No screenshot upload limit per match
- Both captains can contribute
- A future ForgeLens implementation has a clean watch surface
- Thread URL is a permanent compliance reference

### Tradeoffs

- Thread creation can fail under Discord rate limits
- Thread deletion removes Discord-side evidence (mitigated by Supabase Storage archival)

See `docs/adrs/ADR-004-evidence-threads.md` for full reasoning.

---

## 2025-05-21 — LLM Rules Assistant: Stuffed Context Over Vector RAG

### Decision

Use full-ruleset context injection ("stuffed context") instead of vector RAG for the `/rules` captain command.

### Why

The SAL rulebook is small (order of thousands of tokens). Stuffing the entire ruleset into a cached system prompt is simpler, cheaper, and more accurate than a retrieval pipeline at this scale. No pgvector, no embedding pipeline, no retrieval misses.

### Expected Benefits

- Captains get instant, consistent answers to rules questions without admin involvement
- Admins maintain the ruleset in `docs/rules/` via standard code review
- Prompt caching makes repeat queries near-free

### Tradeoffs

- Answers are advisory only — the system prompt enforces that admin rulings are final
- If the ruleset ever approaches 50k tokens, retrieval becomes necessary

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Vector RAG + pgvector | Unnecessary complexity at rulebook scale |
| Hardcoded FAQ responses | Can't handle novel questions; brittle to maintain |

See `docs/adrs/ADR-007-llm-rules-assistant.md` for full reasoning.

---

## 2026-07-16 — Restrict the Active Workspace to Deployed Components

### Decision

The active pnpm workspace contains only `apps/bot`, `packages/db`, and `packages/shared`.

The current website/control center is maintained in the separate [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site) repository. ForgeLens remains a Phase 4 architecture proposal; it has no runtime package or deployment until that phase is explicitly approved.

### Why

- The removed `apps/web` and `services/forgelens` packages contained placeholders, not working applications.
- Placeholder packages inflated installs, builds, and dependency audits.
- Treating them as active made contributor and deployment documentation disagree with production reality.
- Keeping the ForgeLens constraints as design documentation preserves prior safety decisions without presenting an imaginary service as operational.

### Expected Benefits

- One install and CI graph for the code this repository actually ships.
- Clear ownership between salbot and `sal-site`.
- Future ForgeLens implementation begins from an approved design rather than a misleading empty package.

### Tradeoffs

- Cross-repository website changes require coordinated pull requests.
- A future ForgeLens implementation must deliberately add its package and operational surface when Phase 4 begins.

---

# What Should Be Logged Here

- Architecture decisions
- Database decisions
- Deployment and hosting strategy changes
- Auth strategy changes
- Dependency decisions
- Workflow changes
- Scaling decisions

Do not log typo fixes, formatting changes, or trivial copy edits.

---

# Decision Philosophy

A good decision log reduces fear.

Future maintainers should understand why the system looks the way it does, what constraints existed, and what tradeoffs were accepted.
