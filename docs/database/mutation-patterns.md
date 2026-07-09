# Mutation Patterns

This document defines the contract for how state changes happen. Every engineer touching data mutations should read this first.

---

## The Core Rule

**No match, player_stat, or standings mutation happens without:**

1. A `pending_action` record that triggered it
2. A corresponding `audit_log` entry written immediately after

This is enforced by convention and should eventually be enforced by Supabase RLS or a server-side function layer.

Admin-only operational mutations, such as linking `players.discord_id`, updating `division_role_mappings`, or synchronizing Discord roles, do not create `pending_actions`. They must still validate the admin actor and write `audit_logs` with `actor_discord_id`, old values, and new values.

---

## Mutation Sequence

For every state-changing action:

```
1. Validate the actor has permission (captain role, admin role)
2. Validate the action is legal (match is in eligible state, etc.)
3. Write pending_action { status: 'pending' }
4. Write audit_log { action: 'pending_action_created' }
5. ... admin reviews ...
6. Execute mutation (UPDATE matches SET ...)
7. Write audit_log { action: '...', old_value_json, new_value_json }
8. Update pending_action { status: 'approved' }
```

Steps 6–8 should execute in a transaction where possible.

---

## Approved Mutations

### Match result recorded

```
UPDATE matches
SET status = 'completed',
    winner_team_id = $1,
    score = $2,
    completed_at = now()
WHERE id = $match_id

INSERT INTO audit_logs (action_type, entity_type, entity_id, pending_action_id, actor_discord_id, old_value_json, new_value_json)
VALUES ('match_result_recorded', 'match', $match_id, $pending_action_id, $actor, $old, $new)
```

### Match rescheduled

```
UPDATE matches
SET scheduled_at = $new_time
WHERE id = $match_id

INSERT INTO audit_logs (...)
VALUES ('match_rescheduled', 'match', $match_id, ...)
```

### Stat approved

```
INSERT INTO player_stats (match_id, player_id, pending_stat_record_id, kills, deaths, ...)
VALUES (...)

UPDATE pending_stat_records SET status = 'approved', reviewed_by_discord_id = $actor, reviewed_at = now()
WHERE id = $record_id

INSERT INTO audit_logs (...)
VALUES ('stat_approved', 'player_stat', $new_stat_id, ...)
```

---

## What Is NOT Allowed

- Direct `UPDATE matches SET ...` without a `pending_action_id` reference in the audit log
- Any mutation that does not write to `audit_logs`
- Deleting `audit_logs` rows for any reason
- Updating `audit_logs` rows after creation
- ForgeLens writing to `player_stats` directly

---

## Admin Override Pattern

The website admin panel supports direct overrides (e.g., correcting a score after the fact). These are allowed but must:

1. Still write to `audit_logs` with `action_type = 'admin_override'`
2. Include a `note` explaining the reason
3. Reference the admin's Discord ID as `actor_discord_id`

An override without an audit log entry is a bug.

---

## Direct Admin Operation Pattern

Some admin-only operations are setup or identity-maintenance tasks rather than captain-submitted approvals. These include:

- linking an empty `players.discord_id`
- updating `division_role_mappings`
- synchronizing Discord division roles

These operations must:

1. Validate the actor through `admin_users`
2. Preview conflicts before applying when the operation is bulk or destructive
3. Refuse to overwrite conflicting identity data automatically
4. Write to `audit_logs` with `pending_action_id = null`
5. Include `actor_discord_id`, `old_value_json`, and `new_value_json`

An audited direct admin operation is valid even without a `pending_action_id`.

---

## Idempotency

Pending action creation should be idempotent where possible. If a captain submits `/report-result` twice for the same match within a short window (e.g., Discord retry), the system should:

1. Check for an existing `pending_action` for this `match_id` with `status = 'pending'`
2. If found, acknowledge and link to existing review card rather than creating a duplicate
3. Log the duplicate attempt

This prevents duplicate admin review cards clogging the review channel.
