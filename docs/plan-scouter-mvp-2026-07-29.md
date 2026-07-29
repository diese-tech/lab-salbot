# Scouter MVP audit — 2026-07-29

**Verified live:** `lab-salbot@ec5cc26`, `sal-site@7a09a10`, `sal-database@08f0737`, plus `sal-site` issue #75 and its closing comment. **Decision:** D1 is ready; D2 is blocked until its repository and release number are corrected.

## `lab-salbot`

`TASKS.md` is stale. `/report-result` is an 8,698-byte implemented command registered at startup and in command deployment. It resolves the captain by Discord ID, loads eligible matches, collects winner and score, creates an idempotency-protected `pending_action`, posts public/admin embeds, opens a proof thread, persists the thread reference, and updates screenshot counts. Approval remains a separate admin workflow.

Image handling is tracking only. `proof-thread.ts` observes attachment counts in active in-memory threads and increments `matches.screenshot_count`; it does not validate, download, upload, or persist attachment URLs. Original images remain in Discord. Tracking state is lost on restart even though the count and thread reference are in Supabase.

The canonical database config contains one Storage bucket: public `match-screenshots`, 10 MiB per object, MIME allowlist `image/jpeg`, `image/png`, `image/webp`, `image/gif`; anonymous read and service-role object access are configured. The bot has no Storage uploader today.

Reusable operations code exists for `requireAdmin`, Discord username/player identity resolution, audited mutations, division-role operations, and typed success/skipped/conflict/error results. Reuse the result type and audit wrapper. Add database-package queries for scouter authorization and writes; command handlers must not contain raw Supabase queries. Authorization tables actually present are `players.is_captain` and `admin_users`; there is no `org_owners` table. The future command therefore authorizes captains or admins only unless ownership is represented elsewhere before D4.

## `sal-site` OCR and player profile

Issue #75 is closed. The implemented flow is upload → `match-screenshots` public URL → extract route → admin review → transactional submit. `POST /api/admin/match-reports/[id]/extract` fetches each public image, converts it to a base64 data URL, calls OpenRouter chat completions, strips optional code fences, parses JSON, normalizes values, stores `match_reports.extracted_data`, and returns `{ games }`. Per-game output is `{ gameNumber, winningSide: "home"|"away"|"unknown", players[] }`; each player carries `ign`, `side`, optional `god`/`role`, K/D/A, optional `damageDealt`, and optional `damageMitigated`.

The OpenRouter multimodal client is a private `callOpenRouter` function inside the extract route, not a shared utility. It uses `OPENROUTER_MODEL` (default `google/gemini-2.0-flash-001`) and prompt-only JSON instructions; there is no runtime response-schema validation or structured-output schema. It is not reusable as-is. D3 must first extract the transport into a shared utility, then let the existing admin route and new `scouter-ocr.ts` share it while keeping separate prompts and Zod schemas. Scouter needs a new internal endpoint because its two-image input, fields, auth, idempotency, and atomic write contract differ from admin match reports.

The player page exists at `src/app/players/[id]/page.tsx`, not `[playerId]`. It renders identity/status/captain/team/roles, cached `players.stats`, god pool, official per-game history, and season history. The `players.stats` JSON shape enforced by `league-data.ts` is exactly `{ kills, deaths, assists, gamesPlayed, wins }`, all numbers. Adding scouter fields to that object would break the strict Zod parser unless it is extended; season-specific scouter aggregates belong in new queries/tables rather than overwriting this unscoped official-stat cache.

## Database release decision and next step

The supplied D2 assumptions are obsolete. `sal-database` is the canonical migration/type/release boundary and is already at immutable `db-v1.3.0`; `db-v1.1.0` already exists. Do not add a new ordinal migration to `sal-site`, do not edit its legacy schema snapshot as the source of truth, and do not attempt to recut `db-v1.1.0`.

Correct D2 to: add one forward timestamped migration under `sal-database/supabase/migrations`, update contract tests, regenerate `generated/database.types.ts` after a clean local Supabase reset, advance `contract.json` to `db-v1.4.0`, refresh recovery attestation, merge to `main`, then manually dispatch **Plan and deploy production database contract** with the exact commit, `db-v1.4.0`, `DEPLOY_PRODUCTION`, and the independent restore-evidence SHA-256. The workflow performs reset/lint/pgTAP/type drift, protected dry-run approval, protected apply, parity checks, and only then creates the immutable release. Finally update both consumers' lock manifests and vendored types.

**Immediate next action:** owner approves the corrected `sal-database`/`db-v1.4.0` D2 boundary; then ship migration-only D2 without touching Fable 5's protected draft paths.
