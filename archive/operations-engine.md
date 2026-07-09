# Operations Engine

Archived after implementation of the Operations Engine helper layer under `apps/bot/src/lib/operations/`.

Original planning document moved from `docs/architecture/operations-engine.md`.

## Purpose
The Operations Engine is a shared backend helper layer for SAL admin workflows.

It exists so slash commands do not duplicate Discord lookup, Supabase identity linking, role synchronization, admin checks, or audit logging.

## Implemented Direction
- Commands remain thin orchestration layers.
- Shared business logic lives under `apps/bot/src/lib/operations/`.
- Expected business outcomes return structured operation results.
- `/division-sync` is the first consumer.
- Division role mappings are stored in Supabase and managed from Discord.
