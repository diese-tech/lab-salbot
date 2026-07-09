# Supabase Deployment

---

## Project Setup

1. Create a Supabase project at supabase.com
2. Note the project URL and API keys
3. Add keys to `.env.local` (development) and deployment environment variables (production)

---

## Running Migrations

Development (local):

```bash
supabase db push
```

Production:

```bash
supabase db push --db-url $PRODUCTION_DB_URL
```

Migrations are in `database/migrations/`. They run in filename order. Do not rename migration files after they have been applied to any environment.

The division sync workflow requires the `division_role_mappings` migration. This table stores Discord role IDs selected by admins from `/division-role-config`.

---

## Generating TypeScript Types

After any schema change:

```bash
pnpm --filter @salbot/db generate
```

Commit the updated `packages/db/src/types/database.types.ts`.

---

## Storage Buckets

Create the following bucket in Supabase Storage:

| Bucket | Access | Purpose |
|--------|--------|---------|
| `evidence` | Private | Screenshot archives |

Storage path convention:

```
evidence/{season}/{division_slug}/week-{week}/{match_id}/{filename}
```

---

## RLS Policies

Row-Level Security must be configured for all tables. Key policies:

- `audit_logs`: INSERT only via service role; no UPDATE, no DELETE (see ADR-006)
- `division_role_mappings`: READ/WRITE via service role only; admins manage rows through Discord bot commands
- `matches`: READ for authenticated users; WRITE via service role only
- `pending_actions`: READ for authenticated users; WRITE via service role only
- `player_stats`: READ for public; WRITE via service role only

RLS policy files live in `infra/supabase/`.

---

## Backups

Supabase managed hosting includes daily backups on paid plans.

For compliance purposes, consider exporting `audit_logs` and `evidence` storage to cold storage (e.g., S3) at end of each season.
