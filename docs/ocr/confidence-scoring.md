# Confidence Scoring

> **Status:** Accepted Phase 4 design under ADR-008. The extraction runtime and auto-publication RPC are not implemented or deployed.

Confidence scoring helps route complete-game screenshot extractions. It is one input to publication, not proof that a value is correct.

---

## Principles

1. Model confidence alone never publishes statistics.
2. Confidence is stored per field, per player, and per game batch.
3. Every required field for every expected player must be present.
4. Auto-publication uses the lowest required-field confidence, not a weighted average that can hide one weak field.
5. Deterministic evidence, identity, aggregate, duplicate, and transactional gates are mandatory.
6. A failed field or gate routes the entire game to review.
7. Confidence values are treated as routing scores until calibration proves how closely they match real error probabilities.

---

## Field-Level Scores

Each extracted field receives a normalized score from `0.0` through `1.0` plus provenance describing how it was produced.

| Score | Routing interpretation |
|---|---|
| `> 0.97` | Eligible for the confidence portion of auto-publication |
| `0.85 - 0.97` | High confidence but requires human review |
| `0.60 - 0.84` | Flagged review; highlight the field |
| `< 0.60` | Manual correction required |

Exact matches against canonical gods, items, roles, and other known-value sets may improve a field's validation state, but they do not bypass screenshot pairing or identity checks.

Required fields are defined by an immutable extraction-schema version. Optional fields may be null only when that schema explicitly marks them optional.

---

## Record and Game Scores

Weighted averages may be displayed to help reviewers prioritize work, but they never determine auto-publication.

```text
player_min_confidence = minimum(required field scores for one player)
game_min_confidence = minimum(player_min_confidence for every expected player)
```

The confidence gate passes only when:

```text
game_min_confidence > 0.97
```

`0.97` itself does not pass. Missing fields do not receive a default confidence and always fail the gate.

---

## Deterministic Game Gates

Confidence eligibility is followed by these non-model checks:

- one scoreboard and one match-details screenshot are present;
- cross-image player and stat fingerprints indicate the same game;
- every expected player appears exactly once;
- team membership and win/loss signals agree;
- KDA and configured team/game totals reconcile;
- known gods and items resolve to canonical IDs or an explicit unresolved state;
- player identity is exact or creates one provisional IGN identity;
- no duplicate game, contradictory extraction, or unresolved dispute exists;
- screenshot hashes, model, prompt, schema, and validator versions are recorded;
- the Owner-controlled auto-publication feature flag is enabled.

The database RPC revalidates authoritative gates before it publishes anything.

---

## Routing

| Condition | Route | Publication behavior |
|---|---|---|
| Every required field `> 0.97` and every deterministic gate passes | Auto-publish, review-flagged | Publish the complete game immediately; keep an internal human-review flag |
| Confidence is high but any field is `<= 0.97` | Standard review | Do not publish until an authorized human resolves the game |
| Any field is `0.60 - 0.84` or pairing/identity needs confirmation | Flagged review | Highlight uncertain evidence and require correction or confirmation |
| Any required field is `< 0.60`, missing, or invalid | Manual correction | Block quick approval and require corrected structured values |
| Duplicate, contradictory, disputed, or unauthorized input | Exception review | Do not publish; show the explicit failing gate |

Auto-publication is all-or-nothing for the game. There is no per-player partial publication.

---

## Review Flag

Every auto-published game starts with an internal `review_state = flagged` while retaining `publication_state = published`.

The admin review UI shows:

- game and player minimum confidence;
- per-field confidence;
- exact failed or passed deterministic gates;
- both source images;
- raw extracted values;
- model, prompt, schema, and validation versions;
- provisional player identities;
- duplicate and aggregate checks;
- audit and projection state.

An authorized Owner or Admin may clear or restore the flag without rewriting stat values. Every flag transition is audited. Moderators may inspect and annotate but cannot clear the flag or correct official stats.

---

## Calibration and Change Control

Calibration compares stored confidence scores with human-reviewed outcomes. Track at least:

- false auto-publication rate;
- false manual-routing rate;
- field accuracy by screenshot resolution and type;
- player identity and provisional-card accuracy;
- screenshot-pairing accuracy;
- correction and dispute rate;
- model, prompt, schema, and validator version.

A model, prompt, required-field schema, or validation change requires renewed acceptance evidence before auto-publication remains enabled. Owners can disable the flag immediately without a deployment.

See [ADR-008](../adrs/ADR-008-confidence-gated-stat-auto-publication.md) for the authoritative decision, mutation path, risks, and release gates.
