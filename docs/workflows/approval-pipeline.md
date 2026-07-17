# Approval Pipeline

All approvals in the platform flow through the same infrastructure. There is one pipeline, not one per command type.

---

## Pipeline Components

```
[Captain Command]
      │
      ▼
[pending_actions: status=pending]
      │
      ▼
[Admin Review Card: Discord #admin-review]
      │
      ├── [Approve] ──────────────────────────────────────────────┐
      │                                                            ▼
      ├── [Deny] ─────────────────────────────────────────[status=denied]
      │
      ├── [Needs Info] ─────────────────────────────────[status=pending_info]
      │         │
      │         └── [Captain responds / Admin updates] ──[status=pending]
      │
      └── [Open Admin Panel] ─────────────────────────[website deep link]
                                                              │
                                                        [approve/deny/edit]
                                                              │
                                                       [same pipeline]
```

---

## pending_action States

| State | Meaning |
|-------|---------|
| `pending` | Awaiting admin review |
| `pending_info` | Admin has requested more information |
| `approved` | Approved; mutation has been executed |
| `denied` | Denied; no mutation executed |
| `cancelled` | Cancelled before admin review (e.g., captain withdrew) |

---

## What Triggers Approval

The bot's button interaction handler:

1. Reads `pending_action.id` from button custom_id
2. Loads full pending_action from Supabase
3. Validates actor has admin role
4. Validates `pending_action.status == 'pending'`
5. Dispatches to appropriate handler for `pending_action.type`

The handler for each type:
- Executes the specific mutation (`match_result_recorded`, `match_rescheduled`, etc.)
- Writes `audit_log`
- Updates `pending_action.status = 'approved'`
- Updates Discord embeds

This architecture means adding a new workflow type requires:
1. New command handler (creates `pending_action` with new `type`)
2. New approval handler (processes approved `pending_action` of that `type`)
3. No changes to the core approval infrastructure

---

## Race Condition Protection

Multiple admins may have `#admin-review` open simultaneously. Two admins pressing Approve on the same card at the same moment is handled by:

1. Both button presses hit the approval handler
2. First handler reads `status = 'pending'` and proceeds
3. Second handler reads `status = 'approved'` (already updated by first)
4. Second handler returns ephemeral error: "Already processed by @admin"

This requires either:
- Optimistic locking (`UPDATE pending_actions SET status = 'approved' WHERE status = 'pending' AND id = $id`)
- Or Supabase row-level locking in a transaction

---

## Needs Info Flow

When an admin selects Needs Info:

1. Bot shows a modal: "Describe what additional information is needed"
2. Admin enters text
3. `pending_action.status = 'pending_info'`
4. `pending_action.admin_note = [text]`
5. Public receipt embed updated to ⚠️
6. Bot pings the submitting captain in the proof thread (or via DM) with the note
7. Captain responds / re-uploads / contacts admin
8. Admin manually resets status to `pending` via admin panel, or presses new Approve/Deny

---

## Denial Flow

When an admin denies:

1. Bot shows a modal: "Reason for denial (optional)"
2. `pending_action.status = 'denied'`
3. Public receipt embed updated to ❌
4. Admin review card updated to ❌ with reason shown
5. Submitting captain is pinged with denial reason

No mutation is executed on denial.

---

## `sal-site` Approval

The separately maintained [`sal-site`](https://github.com/diese-tech/sal-site) application can also process approvals. Its workflow uses the same `pending_actions` mutation path as Discord button presses; it is not a shortcut around the pipeline.

---

## Audit Coverage

Every state transition of a `pending_action` writes an `audit_log` entry:

| Transition | audit_log action_type |
|------------|----------------------|
| Created | `pending_action_created` |
| Approved | `pending_action_approved` |
| Denied | `pending_action_denied` |
| Needs Info | `pending_action_needs_info` |
| Cancelled | `pending_action_cancelled` |

The resulting mutation (match updated, etc.) writes its own separate `audit_log` entry.
