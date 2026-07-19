# ADR-008: Confidence-Gated OCR Stats May Publish Before Human Review

> **Implementation status:** Accepted design. Database RPCs, extraction runtime, feature gates, and review UI are not yet implemented.

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** SAL platform owners
**Supersedes:** ADR-003

---

## Context

ADR-003 required every OCR-derived stat record to wait for explicit human approval. That policy protected official records while extraction quality and player linking were unproven, but it also guaranteed that player statistics would lag behind submitted games and created an admin bottleneck during preseason scouting.

SAL now needs scout screenshots to populate the site the same day whenever the evidence is complete and internally consistent. A scout game normally has two screenshots: one scoreboard image and one match-details image. One verified pair contains the statistics for every player in that game. The system must make trustworthy results visible quickly without allowing a model confidence number to bypass evidence, identity, consistency, audit, or rollback controls.

---

## Decision

OCR-assisted extraction may publish a complete game's statistics immediately when every auto-publication condition passes. The threshold is strictly greater than `0.97`, not greater than or equal to `0.97`.

Model confidence alone is never sufficient. Auto-publication requires all of the following:

1. The game has both required screenshot types: scoreboard and match details.
2. The two images are paired to the same game by deterministic player/stat fingerprints and cross-image consistency checks.
3. Every expected player row is present exactly once and each required field is extracted.
4. Every required field for every player has confidence greater than `0.97`.
5. Player identity is unambiguous. An unknown IGN may map to one new provisional player identity, but it must not be fuzzy-linked to an existing Discord account.
6. Team, win/loss, KDA, totals, game identifiers, and other configured aggregate checks pass.
7. No duplicate game, conflicting extraction, unresolved dispute, or contradictory evidence exists.
8. The exact extraction schema, prompt version, model identifier, validation version, screenshot hashes, per-field confidence, and validation results are persisted.
9. The Owner-controlled auto-publication feature flag is enabled and its release acceptance gate is recorded.

If any condition fails, the entire game goes to human review. The system must not publish only the high-confidence players from an incomplete game.

### Canonical mutation path

The extraction service never writes directly to `player_stats` or public aggregates. It creates the canonical stat-review records and calls one service-role-only PostgreSQL RPC. That RPC must, in one transaction:

- lock the extraction and game records;
- re-run authoritative validations;
- create or resolve provisional player identities without fuzzy Discord linking;
- insert or update the official per-game stat rows;
- transition the extraction batch to `auto_published`;
- set its internal review state to `flagged`;
- write immutable lifecycle and domain audit rows under a system actor;
- enqueue projections and notifications in the durable operation outbox.

Any domain, audit, or outbox failure rolls back the whole transaction. A retry returns idempotently and never creates duplicate stats or audits.

### Publication and review are separate states

An auto-published extraction is visible immediately in player history and aggregates when the transaction commits. It is also internally flagged for human review.

- `publication_state = published` means the stats are currently visible and included in aggregates.
- `review_state = flagged` means an authorized human has not cleared the automatic review flag.

An Owner or Admin with the stat-review capability may inspect the evidence and clear the flag without rewriting the stat values. Clearing or restoring a flag writes an audit event. Moderators may inspect, annotate, and recommend an outcome but cannot clear the flag or correct official stats.

The internal review flag is not the same as a player dispute. Public history may identify the source as auto-extracted, but it must show `Disputed - Under Review` only after a dispute or an authorized reviewer identifies a material concern.

### Corrections and disputes

Flagging, unflagging, or disputing a published extraction does not silently remove or alter statistics. A correction uses the same transactional decision path, records before and after values, recomputes affected aggregates idempotently, and preserves the original extraction and audit trail.

Owners can disable auto-publication immediately without a deployment. Disabling it sends all new extractions to manual review but does not roll back previously published records.

---

## Rationale

- **Complete-game validation is stronger than a single confidence number.** The two-image evidence pair provides redundant player, team, and stat signals that can reject mismatched games.
- **All-or-nothing publication avoids mixed truth.** A game is one coherent statistical event. Publishing only some players would create incorrect team totals and confusing player histories.
- **Immediate visibility supports preseason scouting.** Players and organizations can see useful history on the same or next day without waiting for a manual queue.
- **A non-blocking review flag preserves human oversight.** Admins can audit automation after publication and focus first on exceptions and disputes.
- **The database remains authoritative.** A service RPC, immutable audits, and the outbox preserve the existing transactional and recovery standards.
- **Provisional identities prevent data loss.** Unknown IGNs retain their history without guessing a Discord owner. A later verified claim enriches the same player card.

---

## Consequences

### Positive

- High-quality scout statistics appear quickly.
- Admin effort shifts from approving every extraction to reviewing flags, exceptions, and disputes.
- Every automated decision retains evidence, confidence, validation, model, and audit provenance.
- One failed player or field safely routes the whole game to review.
- Human review can clear a flag without generating duplicate stat rows.

### Negative

- Some incorrect statistics may become visible before human review.
- The extraction service, validation suite, database RPC, review queue, and projection logic become more complex.
- Auto-published records create a review backlog unless the admin queue supports useful filters and prioritization.
- Model, prompt, or extraction-schema changes require renewed acceptance evidence before auto-publication remains enabled.

### Risks and controls

- **Overconfident model output:** confidence is only one gate; deterministic evidence and aggregate checks are mandatory.
- **Wrong player linkage:** unknown names create provisional identities; fuzzy Discord linking is prohibited.
- **Mismatched screenshots:** pairing uses cross-image fingerprints and ambiguous pairs require human confirmation.
- **Duplicate publication:** database uniqueness, row locks, idempotency keys, and terminal retries prevent duplicate game records.
- **Incorrect public totals:** corrections and aggregate projections are transactional and idempotent.
- **Unbounded automation risk:** Owner kill switch, staged rollout, and renewed validation after model or schema changes.

Revisit this decision if false auto-publications are repeated, evidence pairing cannot be made deterministic, audit/outbox atomicity is not proven, or the correction backlog exceeds the league's operating capacity.

---

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Continue requiring human approval for every extraction | Creates predictable stat delays and a large preseason review queue even when the evidence is complete. |
| Publish each player independently above 0.97 | Produces partial games and invalid team/player aggregates when any row fails. |
| Trust model confidence without deterministic validation | A model can be confidently wrong about screenshot pairing, player identity, or a field value. |
| Publish without a review flag | Removes the lightweight human oversight requested for automatically published records. |
| Let the extraction service write directly to official tables | Bypasses database validation, transactional audit, idempotency, and outbox guarantees. |

---

## Required acceptance evidence

Before the auto-publication flag can be enabled:

- representative screenshot-pair tests cover clear, compressed, cropped, mismatched, duplicate, and incomplete evidence;
- no evaluated game produces a false auto-publication;
- forced domain, audit, and outbox failures roll back every stat row;
- retry and concurrent execution produce one game mutation and one audit set;
- provisional player creation and later identity claiming produce no duplicate history;
- flagged, unflagged, disputed, corrected, and re-flagged states are tested;
- a staging run proves immediate publication, admin review, correction, public history, aggregate recalculation, and outbox delivery;
- the Owner feature gate records the evidence and confirmation that enabled it.
