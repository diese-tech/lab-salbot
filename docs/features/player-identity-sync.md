# Player Identity Sync

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

## Completion
When this implementation is complete and verified in production:
1. Move this planning document and any superseded implementation notes into `/archive`.
2. Create `/archive` if it does not already exist.
3. Retain only user-facing documentation in active docs.
