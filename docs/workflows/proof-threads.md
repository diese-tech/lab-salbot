# Proof Thread Lifecycle

Proof threads are the evidence collection surface for match results. They bridge the gap between structured command input and the reality that matches require 6–10 screenshots that captains upload over minutes.

---

## Creation

A proof thread is created immediately after `/report-result` is submitted, as a Discord thread attached to the public receipt embed.

Thread name format:

```
proof-week-{week}-{team-a-slug}-vs-{team-b-slug}
```

Example:

```
proof-week-3-team-a-vs-team-b
```

Thread parent channel: `#match-results-[division]`

---

## Initial State

When created, the bot posts an initial message in the thread:

```
📸 Proof Upload Thread

This is the official proof submission thread for:
Week 3 · Team A vs Team B

Upload your match screenshots here.
Expected: 6 screenshots (Score: 2-1 · 3 games × 2 per game)

Progress: 0/6 uploaded

Both teams' captains may upload screenshots.
Screenshots are retained as match evidence.
```

The `screenshot_expected` count is derived from the submitted score:

| Score | Games | Expected Screenshots |
|-------|-------|---------------------|
| 2-0 | 2 | 4 |
| 2-1 | 3 | 6 |
| 3-0 | 3 | 6 |
| 3-1 | 4 | 8 |
| 3-2 | 5 | 10 |

Formula: `games_played × 2`

---

## Upload Progress Tracking

As screenshots are uploaded, the bot edits the initial thread message:

```
Progress: 0/6 uploaded
Progress: 2/6 uploaded
Progress: 4/6 uploaded
✅ 6/6 screenshots uploaded — minimum proof complete
```

Both captains (Team A and Team B) may upload screenshots. The bot accepts attachments from any league participant, not just the submitting captain.

---

## Admin Approval Interaction

When an admin approves a match result:

- If `screenshot_count < screenshot_expected`: admin sees a warning on the review card
- Admin can choose to approve anyway (e.g., proof is elsewhere) or request missing screenshots via Needs Info
- If `screenshot_count == 0`: admin sees a hard warning; approval is still allowed but must be intentional

The bot does not block approval on missing screenshots by default. Admin judgment is the final gate.

---

## Thread Closure

After admin approval:

1. Bot posts a final message in the thread: "✅ Match result approved. This thread is now closed."
2. Thread is archived (locked from new posts)
3. Thread metadata (URL, message IDs) stored in `matches.proof_thread_url`

After denial:

1. Bot posts: "❌ Match result denied. [reason if provided]"
2. Thread remains open for potential re-submission

---

## Storage Archival

Screenshot attachments from proof threads should be archived to Supabase Storage as a compliance measure. Discord CDN URLs expire; Supabase Storage URLs do not.

Archive path format:

```
evidence/{season}/{division_slug}/week-{week}/{match_id}/{filename}
```

Example:

```
evidence/2025-spring/gold/week-3/sal-w3-gold-004/screenshot-001.png
```

The `result_screenshot_url` column on `matches` stores the primary evidence URL. Additional screenshots are tracked in a separate `match_screenshots` junction table (future iteration).

---

## Future ForgeLens Trigger

> **Status:** Future Phase 4 design. ForgeLens is not implemented or deployed, and uploads do not currently trigger OCR.

A future implementation may emit this processing event for each uploaded attachment:

```
proof_thread_screenshot_uploaded event
  → screenshot URL
  → match_id
  → division_id
  → uploader_discord_id
```

ForgeLens would process asynchronously. OCR results would appear as `pending_stat_records` and would not affect the approval flow for the match result itself.

---

## Failure Handling

| Failure | Behavior |
|---------|---------|
| Bot offline during upload | Screenshots not counted. Admin manually adjusts or re-triggers through `sal-site`. |
| Future ForgeLens unavailable | No OCR occurs. Match approval remains independent and screenshots remain evidence. |
| Screenshot count desync | `sal-site` shows the database count from `matches.screenshot_count`; an admin can correct it. |
| Proof thread deleted | Match approval unaffected. URL stored in Supabase. Screenshot URLs in storage. |
