# Stat Approval Lifecycle

> **Status:** Legacy Phase 4 review design. ADR-008 supersedes the human-review-only publication rule. Use ADR-008 and the consolidated implementation specification for new work.

The extraction service never writes directly to official stats. Under ADR-008,
a complete game may publish through the transactional database RPC before human
review when every confidence and deterministic gate passes. Auto-published
games remain internally review-flagged.

---

## Lifecycle States

```
pending_stat_record created by ForgeLens
  │
  ├── [admin approves] → player_stats row written
  │
  ├── [admin edits + approves] → corrected player_stats row written
  │
  ├── [admin relinks player + approves] → player_stats row written with correct player_id
  │
  ├── [admin rejects] → status = 'rejected', no stat written
  │
  └── [admin queues for re-OCR] → ForgeLens re-processes screenshot
```

---

## Admin Review Actions

### Quick Approve

Available when `confidence >= 0.85` and `player_id` is resolved.

One click. Writes `player_stats` from `pending_stat_record.stats_json`.

### Edit + Approve

Admin edits one or more fields in the review UI. Corrected values are written to `player_stats`. Original OCR output is preserved in `pending_stat_record.extracted_json` for audit purposes.

### Relink Player

If ForgeLens could not link `player_name` to a player:

1. Admin searches for the player by name or Discord handle
2. Selects matching player
3. `pending_stat_record.player_id` is updated
4. Admin then approves

### Reject

Admin marks the record as `rejected` with a reason. No stat is written. If the screenshot was unreadable, admin may enter stats manually.

### Re-run OCR

If the admin believes ForgeLens made a significant error:

1. Admin selects "Re-run OCR"
2. ForgeLens re-processes the screenshot with current pipeline
3. A new `pending_stat_record` is created
4. Old record is marked `superseded`

---

## Batch Approval

The admin panel supports batch operations on a match's stat records:

- Select all records above threshold → Approve all
- Select specific records → Approve selected

Each approval still writes individual `audit_log` entries.

---

## Stat Approval Audit Trail

When a stat is approved:

```sql
INSERT INTO audit_logs (
  action_type,
  entity_type,
  entity_id,
  pending_action_id,
  actor_discord_id,
  new_value_json
) VALUES (
  'stat_approved',
  'player_stat',
  $new_player_stat_id,
  null,
  $admin_discord_id,
  $stats_json
);
```

When a stat is corrected before approval:

```sql
INSERT INTO audit_logs (
  action_type,
  entity_type,
  entity_id,
  actor_discord_id,
  old_value_json,   -- ForgeLens extracted values
  new_value_json,   -- admin-corrected values
  note              -- optional reason
) VALUES (...)
```

---

## Stats Correction After Approval

If an error is found after a stat is already approved (e.g., a captain disputes a number):

1. Admin opens match in website panel
2. Navigates to player stat for that match
3. Admin override creates a new `player_stats` row with corrected values
4. Old `player_stats` row is **not deleted** — it is superseded
5. New row is flagged as a correction (references old row)
6. `audit_log` entry written with `action_type = 'stat_corrected'`

This preserves the full history of stat changes.
