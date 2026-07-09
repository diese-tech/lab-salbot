# Operations Engine

The Operations Engine is the shared helper layer for Discord-driven admin workflows.

It lives under:

```txt
apps/bot/src/lib/operations/
```

Slash commands collect input and render responses. The Operations Engine owns reusable business rules:

- Admin validation through `admin_users`
- Discord username lookup
- Supabase player identity resolution
- Discord ID linking
- Division role mapping lookup
- Division role synchronization
- Audit log helpers
- Structured operation results

## Structured Results

Expected business outcomes return structured statuses:

```ts
type OperationStatus = 'success' | 'skipped' | 'conflict' | 'error';
```

Expected conflicts, such as a missing Discord user or an existing mismatched `players.discord_id`, are returned to the command and summarized for the admin. They are not treated as unhandled crashes.

## Division Role Configuration

Admins configure division roles from Discord:

```txt
/division-role-config set division:solar role:@Solar
/division-role-config list
```

Mappings are stored in `division_role_mappings` and changes are written to `audit_logs`.

## Division Sync

`/division-sync preview` accepts a CSV with:

```csv
division,discord_username
solar,diese
```

The bot resolves the Discord username in the guild, extracts the Discord user ID, and matches Supabase players by `players.discord_username`.

`/division-sync apply` requires the confirmation token produced by preview. Apply mode links empty `players.discord_id` values, refuses mismatched IDs, removes old known division roles, adds the configured division role, and writes audit logs for mutations.
