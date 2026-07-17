# Local Development

Step-by-step setup for running the active salbot workspace locally.

Database ownership is external to this repository. Use a sibling [`diese-tech/sal-database`](https://github.com/diese-tech/sal-database) checkout for the pinned Supabase CLI, active migrations, reset, seed, and generated contract types. SQL under this repository's `database/migrations/` directory is pre-contract history and must not be treated as an active sequence.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 24 LTS | Runtime |
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

## 3. Start the Canonical Local Database

```bash
cd ../sal-database
npm ci
npx supabase start
npx supabase db reset
cd ../lab-salbot
```

This starts the local Supabase stack from the canonical repository and rebuilds it from that repository's single active migration sequence and deterministic seed.

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

## 4. Verify the Database Contract

Run the `sal-database` repository's documented contract checks before starting SALbot. Do not run `supabase db push` from this checkout. A local reset is sufficient for application development; production pushes are manual, protected operations owned by `sal-database`.

---

## 5. Synchronize TypeScript Types

The database contract synchronization command and vendored generated type are tracked in [lab-salbot#41](https://github.com/diese-tech/lab-salbot/issues/41). Once available, use that command to copy the type from the exact locked `sal-database` release and verify its hash. Do not generate an unpinned production contract independently in this repository.

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
cd ../sal-database
npx supabase db reset
```

### Add a new migration

Open an isolated issue and PR in [`diese-tech/sal-database`](https://github.com/diese-tech/sal-database), then follow its baseline/deployment and contract-release runbooks. Do not add the migration to `lab-salbot`.

### View local Supabase Studio

Open `http://localhost:54323` for a full database GUI.

---

## Troubleshooting

**Bot commands not showing in Discord**

Run `pnpm --filter @salbot/bot deploy:commands` after any command registration changes. Discord caches command lists.

**Types out of sync**

Run the contract synchronization command introduced by [#41](https://github.com/diese-tech/lab-salbot/issues/41) and verify the pinned release, commit, migration head, and type hash.

**Supabase won't start**

Ensure Docker is running. Try `supabase stop && supabase start`.

**pnpm workspace issues**

Run `pnpm install` from the monorepo root. Do not run `npm install` in individual packages.
