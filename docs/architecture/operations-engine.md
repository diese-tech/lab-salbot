# Operations Engine

## Purpose
The Operations Engine is a shared backend helper layer for SAL admin workflows.

It exists so slash commands do not duplicate Discord lookup, Supabase identity linking, role synchronization, admin checks, or audit logging.

## Mental Model
Slash commands are buttons.
The Operations Engine is the shared machinery behind those buttons.

```txt
Slash Command
   ↓
Operations Engine
   ↓
Discord + Supabase
```

Commands should collect input and display results. The Operations Engine should handle the reusable operational logic.

## Why This Exists
Without a shared engine, each admin command would reimplement the same core logic:

- Find a Discord member
- Match that member to a player record
- Link a Discord ID
- Resolve division roles
- Assign or remove roles
- Validate admin permissions
- Write audit logs
- Return success, conflict, and error summaries

That would make future workflows harder to maintain and easier to break.

The engine keeps those behaviors centralized and reusable.

## Responsibilities
The Operations Engine should provide helpers for:

- Resolving Discord username to guild member
- Resolving Discord member to Supabase player
- Linking `players.discord_id` when empty
- Detecting Discord ID conflicts without overwriting automatically
- Validating admin users
- Resolving Discord roles for SAL divisions
- Assigning and removing Discord roles
- Writing audit log entries
- Returning structured results for command summaries

## Not Responsible For
The Operations Engine should not own:

- Slash command registration
- Slash command option definitions
- CSV parsing UI/interaction details
- Website screens
- Match scoring logic
- OCR/stat extraction
- Long-term player data modeling decisions outside the existing Supabase schema

## Suggested File Structure

```txt
apps/bot/src/lib/operations/
├── identity.ts
├── roles.ts
├── audit.ts
├── admin.ts
└── index.ts
```

### `identity.ts`
Handles Discord member lookup and player identity linking.

Example responsibilities:

- `resolveMemberByUsername()`
- `getPlayerByDiscordUsername()`
- `getPlayerByDiscordId()`
- `linkDiscordIdIfEmpty()`
- conflict detection when an existing `discord_id` does not match the resolved Discord member

### `roles.ts`
Handles division role resolution and role changes.

Example responsibilities:

- `getDivisionRole()`
- `syncDivisionRole()`
- `removeOldDivisionRoles()`
- skip already-correct members

### `admin.ts`
Handles reusable admin validation.

Example responsibilities:

- `requireAdmin()`
- structured admin failure response

### `audit.ts`
Wraps audit logging for bot operations.

Example responsibilities:

- `writeIdentityLinkedAudit()`
- `writeDivisionRoleSyncedAudit()`
- `writeConflictAudit()` if useful later

## First Consumer
The first feature that should use this engine is:

```txt
/division-sync
```

The `/division-sync` command should own:

- accepting the CSV attachment
- parsing rows
- running preview/apply mode
- displaying the summary to the admin

The Operations Engine should own:

- finding members
- matching players
- linking Discord IDs
- assigning division roles
- writing audit logs

## Structured Result Pattern
Operations helpers should return structured results instead of throwing for normal business conflicts.

Example:

```ts
type OperationResult<T> =
  | { status: 'success'; data: T }
  | { status: 'skipped'; reason: string }
  | { status: 'conflict'; reason: string; details?: Record<string, unknown> }
  | { status: 'error'; reason: string };
```

Normal conflicts, like an existing mismatched `discord_id`, should be returned as `conflict`, not treated as a crash.

Actual system failures, like Discord API errors or Supabase write failures, can still throw or return `error` depending on implementation.

## Implementation Rule
If a second command needs the same logic, that logic belongs in the Operations Engine, not inside the command file.

## Expected Future Consumers
Likely future commands/workflows:

- `/division-sync`
- `/captain-sync`
- `/role-audit`
- `/season-rollover`
- `/player-link`
- SAL-site admin upload flow that triggers bot-side Discord operations

## Relationship to Player Identity Sync
Player Identity Sync is the first major workflow that should use this architecture.

See:

```txt
docs/features/player-identity-sync.md
```

## Completion / Archival Rule
When the Operations Engine is implemented, verified, and no longer needs this planning document as active guidance:

1. Move this document and any superseded implementation notes into `/archive`.
2. Create `/archive` if it does not already exist.
3. Keep active architecture docs focused on current behavior, not implementation planning history.
