# Database Schema

Supabase is the source of truth. The database is shared with the `sal-draft-league` website.

SALbot does NOT own the full schema. It operates additively on an existing database.

---

## Existing Tables (owned by sal-draft-league)

These tables were created by the sal-draft-league migrations. SALbot reads from them but does not redefine or recreate them.

### `divisions`

```sql
id            text PRIMARY KEY  -- 'solar' | 'lunar' | 'terra'
name          text NOT NULL
description   text NOT NULL
tier          integer NOT NULL
accent_color  text NOT NULL
```

### `orgs`

Teams in the league. The bot uses `org_id` everywhere, never `team_id`.

```sql
id              text PRIMARY KEY
name            text NOT NULL
tag             text NOT NULL       -- 3-letter abbreviation e.g. "HRX"
division_id     text NOT NULL REFERENCES divisions(id)
logo_initials   text NOT NULL
logo_gradient   text NOT NULL
primary_color   text NOT NULL
accent_gradient text NOT NULL
captain_id      text REFERENCES players(id) DEFERRABLE INITIALLY DEFERRED
founded         text
social_links    jsonb
archived_at     timestamptz         -- set = hidden from public queries
deletion_scheduled_at timestamptz
```

### `players`

```sql
id                   text PRIMARY KEY
org_id               text REFERENCES orgs(id) ON DELETE SET NULL
discord_username     text NOT NULL
ign                  text NOT NULL           -- in-game name
avatar_initials      text NOT NULL
avatar_gradient      text NOT NULL
primary_role         text NOT NULL
secondary_roles      jsonb NOT NULL DEFAULT '[]'
is_starter           boolean NOT NULL DEFAULT false
is_captain           boolean NOT NULL DEFAULT false
division_id          text REFERENCES divisions(id)
status               text NOT NULL
stats                jsonb
discord_id           text UNIQUE             -- linked via OAuth
profile_claimed      boolean NOT NULL DEFAULT false
display_alias        text                    -- custom display name; NULL falls back to ign
archived_at          timestamptz
deletion_scheduled_at timestamptz
```

Captain resolution: find player by `discord_id` where `is_captain = true`.

### `matches`

```sql
id              text PRIMARY KEY
division_id     text NOT NULL REFERENCES divisions(id)
home_org_id     text NOT NULL REFERENCES orgs(id)
away_org_id     text NOT NULL REFERENCES orgs(id)
scheduled_date  date NOT NULL
scheduled_time  time NOT NULL
status          text NOT NULL  -- 'scheduled' | 'live' | 'completed' | 'postponed'
week            integer NOT NULL
home_score      integer
away_score      integer
stream_url      text
vod_url         text
archived_at     timestamptz
deletion_scheduled_at timestamptz
-- SALbot-added columns (see migration):
winner_org_id       text REFERENCES orgs(id)
score               text            -- formatted "2-1"
proof_thread_id     text
proof_thread_url    text
screenshot_count    integer NOT NULL DEFAULT 0
screenshot_expected integer
```

### `admin_users`

```sql
discord_id       text PRIMARY KEY
role             text NOT NULL  -- 'super_admin' | 'admin'
discord_username text NOT NULL DEFAULT ''
display_name     text NOT NULL DEFAULT ''
created_at       timestamptz NOT NULL DEFAULT now()
```

Bot uses this to verify admin identity on button interactions.

---

## SALbot Tables (added by SALbot migration)

These tables are created by `database/migrations/20250101000000_initial_schema.sql`.

### `pending_actions`

The approval queue. Every captain approval command creates one before any match/stat mutation.

```sql
id                          text PRIMARY KEY DEFAULT gen_random_uuid()::text
type                        text NOT NULL
  -- 'match_result' | 'reschedule' | 'admin_review'
status                      text NOT NULL DEFAULT 'pending'
  -- 'pending' | 'pending_info' | 'approved' | 'denied' | 'cancelled'
requested_by_discord_id     text NOT NULL
match_id                    text REFERENCES matches(id)
division_id                 text REFERENCES divisions(id)
payload_json                jsonb NOT NULL DEFAULT '{}'
admin_note                  text
source_discord_message_url  text
admin_review_message_id     text    -- Discord message ID of the review card
public_receipt_message_id   text    -- Discord message ID of the public receipt
approved_by_discord_id      text
approved_at                 timestamptz
created_at                  timestamptz NOT NULL DEFAULT now()
updated_at                  timestamptz NOT NULL DEFAULT now()
```

### `audit_logs`

Immutable. Written on every SALbot mutation. Never updated, never deleted.

Distinct from `admin_audit_log` (website admin actions).

```sql
id                text PRIMARY KEY DEFAULT gen_random_uuid()::text
action_type       text NOT NULL
entity_type       text NOT NULL    -- 'match' | 'pending_action' | 'player_stat'
entity_id         text NOT NULL
pending_action_id text REFERENCES pending_actions(id)
actor_discord_id  text NOT NULL
old_value_json    jsonb
new_value_json    jsonb
note              text
created_at        timestamptz NOT NULL DEFAULT now()
```

### `division_role_mappings`

Discord role mappings for league divisions. Admins manage these through `/division-role-config`; role IDs are not secrets, but writes still go through the bot service role and are audited.

```sql
division_id           text PRIMARY KEY REFERENCES divisions(id)
discord_role_id       text NOT NULL
updated_by_discord_id text NOT NULL
created_at            timestamptz NOT NULL DEFAULT now()
updated_at            timestamptz NOT NULL DEFAULT now()
```

### `pending_stat_records`

ForgeLens OCR output (Phase 4). Admin reviews before writing to `player_stats`.

```sql
id                      text PRIMARY KEY DEFAULT gen_random_uuid()::text
match_id                text NOT NULL REFERENCES matches(id)
player_id               text REFERENCES players(id)
screenshot_url          text NOT NULL
extracted_json          jsonb NOT NULL DEFAULT '{}'
stats_json              jsonb
confidence              numeric(4,3) NOT NULL  -- 0.000 – 1.000
source                  text NOT NULL DEFAULT 'ocr'  -- 'ocr' | 'manual'
status                  text NOT NULL DEFAULT 'pending'
  -- 'pending' | 'approved' | 'rejected' | 'corrected' | 'superseded'
reviewed_by_discord_id  text
reviewed_at             timestamptz
correction_note         text
created_at              timestamptz NOT NULL DEFAULT now()
updated_at              timestamptz NOT NULL DEFAULT now()
```

### `player_stats`

Official stats. Written only after admin approval of a `pending_stat_record`.

```sql
id                      text PRIMARY KEY DEFAULT gen_random_uuid()::text
match_id                text NOT NULL REFERENCES matches(id)
player_id               text NOT NULL REFERENCES players(id)
pending_stat_record_id  text REFERENCES pending_stat_records(id)
kills                   integer
deaths                  integer
assists                 integer
damage_dealt            integer
healing_done            integer
god_played              text
role                    text
created_at              timestamptz NOT NULL DEFAULT now()
UNIQUE (match_id, player_id)
```

---

## Relationship Summary

```
[existing] seasons
[existing] divisions
  └── [existing] orgs
        └── [existing] players (discord_id links to Discord user)
  └── [existing] matches ── home_org_id / away_org_id
        │
        ├── [SALbot] pending_actions
        ├── [SALbot] pending_stat_records → [SALbot] player_stats
        └── proof_thread_id (Discord thread)

[SALbot] audit_logs → (entity_type + entity_id) polymorphic
                    → pending_actions
[existing] admin_users (Discord OAuth admins)
```

---

## ID Types

All existing tables use `text` primary keys. SALbot's new tables use `text` PKs generated with `gen_random_uuid()::text` for consistency.

Foreign keys from SALbot tables to existing tables are `text` to match.

---

## Mutation Rules

See [`mutation-patterns.md`](mutation-patterns.md) for the full contract.

1. Every mutation to `matches` or `player_stats` requires a prior `pending_action`.
2. Every mutation writes a corresponding `audit_logs` entry.
3. `audit_logs` is INSERT-only. No UPDATE, no DELETE.
4. `pending_stat_records` are reviewed → then a new `player_stats` row is written.
5. `player_stats` is written only by the approval handler after admin approval.
6. Division role mapping and player identity sync mutations are bot-admin actions and write directly to `audit_logs`.
