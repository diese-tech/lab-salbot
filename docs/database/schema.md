# Database Schema

Supabase is the runtime source of truth shared by SALbot and `sal-site`.

[`diese-tech/sal-database`](https://github.com/diese-tech/sal-database) is the designated sole owner of active migrations, generated types, schema releases, drift detection, and production database pushes. This document explains the shape SALbot consumes; it does not grant this repository schema ownership. Until the initial contract release is adopted, the definitions below are application expectations rather than proof of released or production schema. SQL retained under `database/migrations/` is pre-contract history and must not be pushed to the shared production project.

---

## Shared Tables (owned by sal-database)

These tables are owned by the canonical database contract. SALbot reads from them but does not redefine or recreate them.

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
season_id       text REFERENCES seasons(id)
archived_at     timestamptz
deletion_scheduled_at timestamptz
-- Bot-facing columns (defined by the canonical schema contract):
winner_org_id       text REFERENCES orgs(id)
score               text            -- formatted "2-1"
proof_thread_id     text
proof_thread_url    text
screenshot_count    integer NOT NULL DEFAULT 0
screenshot_expected integer
```

Two writers complete matches, with different column coverage:

- **SALbot approval** (`completeMatch`) sets `status`, `winner_org_id`, `home_score`,
  `away_score`, and `score`.
- **Website admin match report** sets `status`, `home_score`, and `away_score` only —
  `winner_org_id` and `score` stay NULL for site-reported matches, so bot code must not
  assume they are populated on every completed match.

Neither path updates `standings`. Standings are owned by the website and recalculated
only from Admin → Standings (or the site's match-report submit flow) — see the
[admin operations runbook](../runbooks/admin-operations.md).

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

## Bot-facing operational tables

These tables must be part of the canonical `sal-database` schema before consumer adoption. The legacy `database/migrations/20250101000000_initial_schema.sql` file is retained only as pre-contract evidence.

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
game_number             integer NOT NULL DEFAULT 1
kills                   integer
deaths                  integer
assists                 integer
damage_dealt            integer
damage_mitigated        integer
healing_done            integer
god_played              text
role                    text
won                     boolean
created_at              timestamptz NOT NULL DEFAULT now()
UNIQUE (match_id, player_id, game_number)
```

After each approval the bot recomputes the affected player's `players.stats` JSONB
aggregate from the full `player_stats` history. The website consumes both layers:
headline numbers on player pages come from the `players.stats` aggregate (fed only
by this pipeline), and the public player / team / gods pages also query
`player_stats` directly (via the site's `stats-data` helpers, under an anon
public-read policy). Schema changes here are public-site-facing.

### Website stat tables (`match_reports`, `player_match_stats`)

The website's admin match-report flow writes to two tables the bot never touches:
`match_reports` (report lifecycle) and `player_match_stats` (per-game stat lines,
replaced atomically via the site's `replace_match_report_stats` RPC). These are a
**parallel pipeline** to SALbot's `pending_stat_records` → `player_stats`: rows in
`player_match_stats` do not update `players.stats` and are not displayed on player
pages today. Do not treat the two stat stores as interchangeable.

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
