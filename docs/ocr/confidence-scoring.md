# Confidence Scoring

> **Status:** Future Phase 4 design specification. ForgeLens is not implemented or deployed.

Confidence scoring is the proposed way ForgeLens would signal how much admins should trust an extracted stat record.

---

## Why Confidence Scoring Exists

OCR is imperfect. Game screenshots vary in resolution, aspect ratio, font rendering, and overlay visibility. A record extracted at 0.95 confidence is nearly certain to be correct. A record at 0.55 confidence almost certainly has at least one wrong field and requires manual review.

Rather than pretending all OCR output is equally reliable, the system assigns confidence and routes records accordingly.

---

## Field-Level Scoring

Each extracted field gets a score:

| Score | Meaning |
|-------|---------|
| 1.00 | Exact match against a known value set (e.g., god name matched against known god list) |
| 0.90+ | High OCR confidence, no ambiguous characters |
| 0.70–0.89 | Minor ambiguity (e.g., 0 vs O, 1 vs I in numeric fields) |
| 0.50–0.69 | Significant ambiguity or partial extraction |
| < 0.50 | Unreadable or likely incorrect |

---

## Record-Level Score

The record confidence is calculated as:

```
record_confidence = weighted_average(field_scores)
```

Where critical fields (`player_name`, `kills`, `deaths`) carry higher weight than informational fields (`role`, `god_played`).

If any critical field has confidence < 0.50, the record confidence is capped at 0.55 regardless of other fields.

---

## Routing by Confidence

| Range | Queue | Admin Behavior |
|-------|-------|---------------|
| `0.85 – 1.00` | Standard review | One-click approve |
| `0.60 – 0.84` | Flagged review | Prompted to verify fields before approving |
| `< 0.60` | Manual correction | Cannot quick-approve; must edit or confirm each field |

---

## Confidence in the Review UI

The admin stat review UI shows:

- Overall record confidence (color-coded: green/yellow/red)
- Per-field confidence indicators
- Highlighted fields that are below threshold
- The raw OCR text for comparison

This makes manual correction fast: admins see exactly which fields ForgeLens was uncertain about.

---

## Calibration

The confidence model should be calibrated against real match screenshots over time. As the system accumulates approved records, the system can build a training set to improve both OCR and confidence scoring.

Calibration is a future milestone; the initial scoring model is heuristic.
