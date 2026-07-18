# ForgeLens Integration

> **Status:** Legacy Phase 4 integration design. No extraction runtime is deployed. ADR-008 supersedes any human-review-only or self-approval prohibition below with a confidence-gated, service-RPC auto-publication path that remains review-flagged.

ForgeLens would be the OCR/stat extraction service. It would consume proof-thread screenshots and generate pending stat records for admin review.

---

## Responsibilities

ForgeLens does exactly three things:

1. Ingest screenshots
2. Extract stats via OCR
3. Create `pending_stat_records` with confidence scores

It does **not**:
- Write to `player_stats`
- Approve its own output
- Modify `pending_actions`
- Make decisions about match outcomes

---

## Ingestion Trigger

When a screenshot is uploaded to a proof thread, the bot emits an event:

```json
{
  "event": "screenshot_uploaded",
  "match_id": "uuid",
  "screenshot_url": "https://cdn.discordapp.com/...",
  "division_id": "uuid",
  "uploaded_by_discord_id": "123456789",
  "uploaded_at": "2025-01-15T18:30:00Z"
}
```

ForgeLens can receive this via:
- Webhook POST from the bot
- Supabase realtime subscription on an `evidence_uploads` table
- Message queue (future)

The proposed initial approach is a direct webhook call from the bot to ForgeLens. It must be reviewed again when Phase 4 begins.

---

## OCR Pipeline

```
Screenshot URL received
  │
  ▼
Download image
  │
  ▼
Preprocessing (crop, enhance contrast, deskew)
  │
  ▼
OCR engine run (Tesseract or cloud provider)
  │
  ▼
Raw text extracted
  │
  ▼
Stat parser (game-specific field matching)
  │
  ▼
Stats object:
  {
    player_name: string,
    kills: number,
    deaths: number,
    assists: number,
    damage_dealt: number,
    healing_done: number,
    god_played: string,
    role: string
  }
  │
  ▼
Confidence scoring
  │
  ▼
INSERT pending_stat_record
```

---

## Confidence Scoring

Each extracted field receives an individual confidence score (0.0–1.0). An aggregate record confidence is calculated as the mean or minimum field confidence depending on criticality.

| Field | Weight |
|-------|--------|
| `player_name` | Critical — used for player linking |
| `kills` / `deaths` / `assists` | High |
| `damage_dealt` / `healing_done` | Medium |
| `god_played` | Medium |
| `role` | Low |

### Confidence Thresholds

| Score | Routing |
|-------|---------|
| `>= 0.85` | Standard admin review queue |
| `0.60 – 0.84` | Flagged review queue (admin alerted) |
| `< 0.60` | Manual correction queue (blocked from quick-approve) |

---

## pending_stat_record Output

```json
{
  "match_id": "uuid",
  "player_id": null,
  "screenshot_url": "https://...",
  "extracted_json": {
    "raw_ocr_text": "...",
    "ocr_engine": "tesseract-v5",
    "processing_time_ms": 1240
  },
  "stats_json": {
    "player_name": "Shadowclaw",
    "kills": 8,
    "deaths": 2,
    "assists": 5,
    "damage_dealt": 42000,
    "healing_done": 0,
    "god_played": "Loki",
    "role": "Jungle"
  },
  "confidence": 0.91
}
```

`player_id` starts as null. The admin review UI allows an admin to link a `player_name` string to a `players.id` row.

---

## Retry Behavior

If OCR processing fails (network error, malformed image, timeout):

1. ForgeLens logs the failure
2. Schedules a retry after 5 minutes (max 3 attempts)
3. After 3 failures, marks the screenshot as `ocr_failed` in the evidence record
4. Admin is notified that manual stat entry is required for this screenshot

---

## Player Name Linking

ForgeLens cannot reliably link `player_name` (a string from a game screenshot) to `players.discord_id`. This is a human task.

The admin review UI provides:
- The extracted `player_name` string
- A search box to find the matching `players` row
- Fuzzy match suggestions based on known display names

Once linked, the system remembers the `{player_name} → player_id` mapping for future OCR results from the same match.

---

## Manual Stat Entry

If OCR fails completely (unreadable screenshot, wrong angle, wrong resolution), admins can:

1. Open the admin panel for the match
2. Navigate to Stat Entry for the affected screenshot
3. Manually enter stats
4. Submit — this creates a `pending_stat_record` with `confidence = 1.0` and `source = 'manual'`
5. The record goes through the same approval path

---

## See Also

- [`confidence-scoring.md`](confidence-scoring.md) — detailed confidence model
- [`stat-approval-lifecycle.md`](stat-approval-lifecycle.md) — admin review process
