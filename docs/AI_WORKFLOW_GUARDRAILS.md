# AI Workflow Guardrails

Rules for AI-assisted implementation on the SAL operations platform.

These guardrails exist because this platform affects real league standings, prizing decisions, and compliance records.

A mistake here is not just a bug. It may affect real people.

---

## Non-Negotiable Rules

### 1. Every mutation writes to audit_logs

If your code changes `matches`, `player_stats`, `standings`, player identity links, or division role mappings, it must write to `audit_logs` with:
- `action_type`
- `entity_type` and `entity_id`
- `actor_discord_id`
- `old_value_json` and `new_value_json`

No exceptions.

### 2. No direct match mutations without a pending_action

Match state changes must flow:

```
captain command
→ pending_action created
→ admin review
→ approval
→ mutation executed
→ audit_log written
```

There is no shortcut path.

Admin-only operational setup and identity maintenance is the exception. Commands such as `/division-role-config` and `/division-sync` may mutate `division_role_mappings`, `players.discord_id`, and Discord roles directly after validating `admin_users`. They still must write `audit_logs`.

### 3. OCR never writes to player_stats

ForgeLens creates `pending_stat_records` only.

`player_stats` rows are written only by the approval handler after an admin explicitly approves a `pending_stat_record`.

### 4. audit_logs are immutable

Never generate code that UPDATEs or DELETEs `audit_logs` rows.

Corrections are new rows. History is preserved.

### 5. Supabase is the state

Never store authoritative state in bot memory, Discord message content, or the ForgeLens service.

All reads for match data, player data, and pending actions come from Supabase.

Short-lived confirmation tokens for preview/apply flows may live in bot memory, but they are not authoritative state. If the bot restarts, the admin must run preview again.

---

## Implementation Defaults

### Default: smallest safe change

When asked to implement a feature:

- implement only what is requested
- do not add related features "while I'm in here"
- do not refactor surrounding code unless it is necessary to complete the task
- do not introduce new abstractions for code that only exists once

### Default: no speculative architecture

Do not introduce:

- message queues unless the current architecture demonstrably needs them
- caching layers unless a specific performance problem is identified
- additional service boundaries unless the current services are clearly overloaded
- feature flags unless rollout control is an explicit requirement

### Default: handle errors at boundaries

Validate input from:

- Discord interactions (user-provided score strings, etc.)
- External APIs (Supabase errors, Discord API errors)

Do not add defensive checks for internal function call sequences where the caller controls the input.

---

## Out of Scope (Do Not Implement)

These features are explicitly deferred. Do not implement them unless `ROADMAP.md` has been updated to include them in the current phase.

- Website admin panel (Phase 3)
- ForgeLens OCR pipeline (Phase 4)
- Standings calculation (Phase 5)
- Player/team pages (Phase 5)
- OCR auto-approval
- Bot message scanning as an intake path
- Multi-season archival tooling
- Public API for stats
- Tournament bracket management

If a user asks for one of these during a Phase 1 or Phase 2 implementation session, note that it is deferred and do not implement it.

---

## What Requires Human Review Before Merging

Any change that:

- modifies `pending_actions` lifecycle states
- adds a new `pending_action` type
- changes `audit_logs` schema
- changes how `matches` mutations work
- changes ForgeLens OCR pipeline behavior
- modifies approval handler logic

These are operationally critical paths. Flag them for explicit review, not just CI passing.

---

## Architecture Boundaries

| Component | Can write to | Cannot write to |
|-----------|-------------|----------------|
| Discord bot | `pending_actions`, `audit_logs`, `matches` (via approval handler) | `player_stats` directly |
| Discord bot admin operations | `audit_logs`, `division_role_mappings`, empty `players.discord_id`, Discord roles | conflicting `players.discord_id` overwrites |
| ForgeLens | `pending_stat_records` | `player_stats`, `matches`, `pending_actions` |
| Website | Any table via service role | (none, but all mutations must write audit_log) |
| Supabase RLS | Enforces boundaries | N/A |

---

## Before Calling Implementation Complete

- [ ] Does the approval path write to `audit_logs`?
- [ ] Does the command create a `pending_action` before any mutation?
- [ ] If it is an admin-only setup or identity operation, does it validate `admin_users` and write `audit_logs`?
- [ ] Does the bot use the dropdown pattern for match selection (not free text)?
- [ ] Is error handling scoped to real failure modes (not defensive theatre)?
- [ ] Is the feature within the current phase scope?
- [ ] Do the tests cover the approval path?

If any answer is no, do not mark the task complete.

---

## References

- `AGENTS.md` — implementation rules overview
- `docs/architecture/overview.md` — system design
- `docs/database/mutation-patterns.md` — mutation contract
- `docs/database/audit-philosophy.md` — audit log rules
- `docs/workflows/approval-pipeline.md` — approval infrastructure
- `docs/adrs/` — why the system looks this way
