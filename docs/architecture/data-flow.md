# Data Flow

Per-workflow data flows. Use this when tracing a bug or designing a new workflow feature.

> **Status:** ForgeLens/OCR steps in this document are future Phase 4 design. There is no ForgeLens runtime or deployment today.

---

## `/report-result` — Full Flow

```
[Discord: Captain]
  │
  │ /report-result (slash command)
  ▼
[Bot: command handler]
  │ 1. Resolve captain's Discord ID → player record → team
  │ 2. Query Supabase: eligible matches for captain's team
  │ 3. Render match dropdown (week, teams, scheduled time)
  │
  │ [Captain selects match, enters winner + score]
  ▼
[Bot: modal/select submission handler]
  │ 4. Validate score format
  │ 5. Write pending_action { type: 'match_result', status: 'pending' }
  │ 6. Write audit_log { action: 'pending_action_created' }
  │ 7. Post public receipt embed → #match-results-[division]
  │ 8. Create proof thread under receipt embed
  │ 9. Post initial thread message: "0/N screenshots uploaded"
  │ 10. Post admin review card → #admin-review
  │
[Supabase: pending_actions]
  │ pending_action { id, type, status: 'pending', match_id, payload_json }
  │
[Discord: proof thread open]
  │ [Captains upload screenshots]
  ▼
[Bot: message event handler — proof thread]
  │ 11. Detect new attachment in proof thread
  │ 12. Increment screenshot count in thread message
  │ 13. Store attachment URL reference in Supabase Storage (optional archive)
  │ 14. [Future Phase 4] Emit event to ForgeLens for OCR processing
  │
[Future ForgeLens: OCR processor]
  │ 15. Receive screenshot URL
  │ 16. Run OCR
  │ 17. Extract player stats
  │ 18. Calculate confidence score
  │ 19. Write pending_stat_record { match_id, player_id?, stats, confidence }
  │
[Discord: #admin-review]
  │ [Admin presses Approve button]
  ▼
[Bot: button interaction handler]
  │ 20. Verify admin role
  │ 21. Load pending_action from Supabase
  │ 22. Execute match mutation:
  │     - matches.status = 'completed'
  │     - matches.winner_team_id = [winner]
  │     - matches.score = [score]
  │     - matches.completed_at = now()
  │ 23. Write audit_log { actor, old_value, new_value, pending_action_id }
  │ 24. Update pending_action.status = 'approved'
  │ 25. Update public receipt embed → ✅ Approved
  │ 26. Update admin review card → ✅ Approved
```

---

## `/reschedule` — Full Flow

```
[Discord: Captain]
  │ /reschedule
  ▼
[Bot]
  │ 1. Resolve captain → team
  │ 2. Fetch eligible future matches
  │ 3. Show match dropdown + date/time picker
  │
  │ [Captain selects match + new proposed time]
  ▼
[Bot: submission handler]
  │ 4. Write pending_action { type: 'reschedule', payload: { new_time } }
  │ 5. Post public receipt → #reschedules-[division]
  │ 6. Post admin review card → #admin-review
  │
[Admin: approve]
  │ 7. matches.scheduled_at = new_time
  │ 8. Write audit_log
  │ 9. Update pending_action.status = 'approved'
  │ 10. Update public receipt → ✅
```

---

## Pending Action Lifecycle

```
created (pending)
  │
  ├── [admin: needs info] → pending_info (⚠️)
  │     │
  │     └── [captain responds / admin updates] → pending (📝)
  │
  ├── [admin: deny] → denied (❌)
  │
  └── [admin: approve] → approved (✅)
        │
        └── mutation executed + audit_log written
```

---

## Future OCR Stat Record Lifecycle

```
[Future Phase 4] ForgeLens creates pending_stat_record
  │
  ├── confidence >= threshold → admin review queue
  │
  └── confidence < threshold → manual review queue (flagged)
        │
[Admin reviews]
  │
  ├── approve as-is → official player_stat written
  │
  ├── edit values → edited values written as official player_stat
  │
  ├── relink player → correct player_id attached, then written
  │
  └── reject → pending_stat_record.status = 'rejected', no stat written
```
