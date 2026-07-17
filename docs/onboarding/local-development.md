# Local Development

Step-by-step setup for running the active salbot workspace locally.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Runtime |
| pnpm | 9+ | Package manager |
| Docker | 24+ | Local Supabase |
| Supabase CLI | Latest | Local DB management |

Install Supabase CLI:

```bash
npm install -g supabase
```

---

## 1. Clone and Install

```bash
git clone https://github.com/diese-tech/lab-salbot
cd lab-salbot
pnpm install
```

---

## 2. Environment Setup

```bash
cp .env.example .env.local
```

Edit `.env.local` with:

- A Discord test bot token (create a test application at discord.com/developers)
- A test Discord guild ID
- Local Supabase values (filled in after step 3)

---

## 3. Start Local Supabase

```bash
supabase start
```

This starts a local Supabase stack (PostgreSQL, Auth, Storage, Studio) via Docker.

On first run, it will print your local credentials:

```
API URL: http://localhost:54321
DB URL: postgresql://postgres:postgres@localhost:54322/postgres
Studio URL: http://localhost:54323
anon key: eyJ...
service_role key: eyJ...
```

Copy `API URL`, `anon key`, and `service_role key` into `.env.local`.

---

## 4. Run Migrations

```bash
supabase db push
```

This applies all migrations from `database/migrations/` to your local database.

Seed development data by applying the SQL seed file to your local database. There is not currently a root `db:seed` script.

```bash
psql "$DB_URL" -f database/seeds/001_development.sql
```

---

## 5. Generate TypeScript Types

```bash
pnpm --filter @salbot/db generate
```

If generated Supabase types are introduced, this regenerates them from your local schema. This checkout currently relies on typed query helpers rather than a committed generated types file.

---

## 6. Start the Bot

```bash
pnpm --filter @salbot/bot dev
```

Before starting, deploy commands to your test guild:

```bash
pnpm --filter @salbot/bot deploy:commands
```

Discord setup also requires the Server Members intent and Manage Roles permission. See [`../deployment/discord.md`](../deployment/discord.md).

---

## External and Future Components

The current web/control-center application is maintained in [`diese-tech/sal-site`](https://github.com/diese-tech/sal-site). Follow that repository's setup guide when developing the website alongside the bot.

ForgeLens is a future Phase 4 design. It has no package, process, or local-development command in this workspace.

---

## Common Tasks

### Reset local database

```bash
supabase db reset
psql "$DB_URL" -f database/seeds/001_development.sql
```

### Add a new migration

```bash
supabase migration new your_migration_name
```

Edit the generated file in `database/migrations/`. Then:

```bash
supabase db push
pnpm --filter @salbot/db generate
```

### View local Supabase Studio

Open `http://localhost:54323` for a full database GUI.

---

## Troubleshooting

**Bot commands not showing in Discord**

Run `pnpm --filter @salbot/bot deploy:commands` after any command registration changes. Discord caches command lists.

**Types out of sync**

Run `pnpm --filter @salbot/db generate` after any schema changes.

**Supabase won't start**

Ensure Docker is running. Try `supabase stop && supabase start`.

**pnpm workspace issues**

Run `pnpm install` from the monorepo root. Do not run `npm install` in individual packages.
