# Vercel Deployment (Web Panel)

The `apps/web` Next.js admin panel deploys to Vercel.

---

## Setup

1. Connect the `diese-tech/lab-salbot` repository to Vercel
2. Set root directory to `apps/web` (or use Vercel's monorepo detection)
3. Configure environment variables (see below)

---

## Environment Variables

Set in Vercel project settings:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # Server-side only — never expose to client
```

`SUPABASE_SERVICE_ROLE_KEY` must only be used in server components and API routes. It must never be prefixed with `NEXT_PUBLIC_`.

---

## Deployment Triggers

- Push to `main` → production deployment
- Push to `develop` → preview deployment
- Pull requests → preview deployment

---

## Build Command

Vercel auto-detects Next.js. If overriding:

```
pnpm --filter @salbot/web build
```

---

## Notes

The web panel does not run the bot or ForgeLens. It is stateless server-side rendering against Supabase. No persistent process is required.
