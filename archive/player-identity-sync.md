# Player Identity Sync

Archived after implementation of the Discord-admin player identity and division role sync workflow.

Original planning document moved from `docs/features/player-identity-sync.md`.

## Objective
Implement an admin workflow that imports a roster CSV, resolves Discord usernames to Discord user IDs, stores those IDs in Supabase, synchronizes division roles, and produces an audit summary.

## Phase 0 - Foundation
- Deploy SALbot to Railway.
- Configure Discord Developer Portal.
- Configure bot permissions/intents.
- Register slash commands.
- Verify bot is online with existing commands.

## Phase 1 - Preview
- Admin-only `/division-sync`.
- Accept CSV attachment.
- Parse division + discord_username.
- Resolve Discord members.
- Compare against players table.
- Show preview only.

## Phase 2 - Apply
- Persist discord_id when missing.
- Never overwrite conflicting discord_id values automatically.
- Assign/remove division roles.
- Skip already-correct members.
- Write audit logs.
- Return success/failure summary.

## Future
- Support discord_id CSVs.
- Website upload workflow.
- Conflict resolution UI.
