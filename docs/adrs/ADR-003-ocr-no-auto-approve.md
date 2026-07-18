# ADR-003: OCR Output Never Directly Updates Official Stats

> **Implementation status:** Future Phase 4 constraint. ForgeLens is not implemented or deployed.

**Status:** Superseded by [ADR-008](ADR-008-confidence-gated-stat-auto-publication.md)
**Date:** 2025-01-01
**Deciders:** Platform architecture

---

## Context

ForgeLens extracts player stats from game screenshots using OCR. The question is: can high-confidence OCR output be automatically committed to `player_stats` without human review?

---

## Decision

OCR output is never directly written to `player_stats`. All OCR output produces `pending_stat_records` that require admin review before promotion to official stats.

This applies even to records with confidence = 1.0.

---

## Rationale

- **OCR is not infallible** — even high-confidence extractions can be wrong. A stat listed as confidence 0.96 can still have an incorrect player linkage if two players have similar display names. Stats can be from the wrong match (wrong screenshot uploaded by mistake).
- **Player linking is a human problem** — ForgeLens extracts a `player_name` string. Mapping that string to the correct `players.discord_id` requires knowing the player database. Automated linking based on fuzzy name matching has an unacceptable error rate.
- **Tournament/prizing accountability** — player stat records that affect standings or prizing claims must be attributable to a human reviewer. "The bot approved it automatically" is not an acceptable answer in a prizing dispute.
- **Correction audit trail** — requiring human review creates a natural checkpoint where errors are caught before they become official. Fixing an error after auto-approval is harder and requires a `stat_corrected` override entry.
- **Trust is earned** — in a future iteration, if ForgeLens demonstrates sustained near-perfect accuracy with correct player linking over a full season, auto-approval for a specific subset of records could be revisited via a new ADR.

---

## Consequences

### Positive

- Every official stat has a human accountable for its approval
- Errors are caught at review time, not after the fact
- Full audit trail from screenshot to official stat
- ForgeLens errors do not cause incorrect standings

### Negative

- Admin workload includes stat review in addition to match approval
- High match volume may create a stat review backlog
- Stat records may lag behind the match result by hours or days

### Risks

- Review backlog if ForgeLens produces many records per match (mitigated by batch approval for high-confidence records)
- Admins rubber-stamping without reviewing (mitigated by UI that highlights uncertain fields)

---

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| Auto-approve confidence >= 0.95 | Player linking errors still occur at high confidence; prizing accountability requires human sign-off |
| Auto-approve with post-hoc dispute window | Creates incorrect official records that must be corrected; harder to explain to players |
| Full manual stat entry (no OCR) | Does not scale; OCR still saves significant admin time even without auto-approval |
