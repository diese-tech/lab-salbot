# Supabase Deployment

[`diese-tech/sal-database`](https://github.com/diese-tech/sal-database) is the sole owner of active Supabase migrations, generated types, schema releases, drift detection, and production database pushes. SALbot is a contract consumer. This repository must not push schema changes to the shared project.

---

## Project Setup

Follow the canonical repository's local database and restore runbooks. Add the resulting local project URL and service-role key to SALbot's `.env.local`. Production database credentials belong only in the protected database deployment environment; SALbot needs its runtime URL and service-role key, not schema-push authority.

---

## Migration Ownership

The SQL under `database/migrations/` records SALbot's pre-contract history. Do not run it as an active sequence against local, staging, or production databases, and do not add new production migrations here.

Open an isolated issue and PR in `diese-tech/sal-database` for every schema change. Its protected workflow owns local reset, lint, migration planning, authenticated production push, ledger parity, schema assertions, generated types, and the immutable contract release. The recovery drill in [`sal-site#156`](https://github.com/diese-tech/sal-site/issues/156) must pass before initial baseline adoption.

---

## Consuming Generated Types

SALbot will vendor the generated `Database` type under `packages/db/src/types/` and pin the exact database release, commit, migration head, and type hash in its contract lock. Consumer adoption is tracked in [lab-salbot#41](https://github.com/diese-tech/lab-salbot/issues/41); at the reviewed commit, the vendored type and lock are not yet present.

Do not regenerate production contract types independently in this repository. Use the contract synchronization command introduced by #41, then let CI verify the vendored hash against the exact `sal-database` commit.

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

RLS and storage policy DDL belongs in `diese-tech/sal-database` with the migration and database assertions. This repository documents the access SALbot requires but does not own those policies.

---

## Backups

Backup retention, PITR availability, and restoration are unverified until the scratch-project drill in [`sal-site#156`](https://github.com/diese-tech/sal-site/issues/156) is complete. Do not infer recoverability from a plan name or dashboard setting. Database baseline adoption stops if the restored data or schema is incomplete or inconsistent.
