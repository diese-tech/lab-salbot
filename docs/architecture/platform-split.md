# Platform Split

This document defines the precise boundary of responsibility for each platform component. When a proposed feature is ambiguous, use this document to determine where it belongs.

---

## Decision Framework

For any new feature, ask:

1. Does it store or modify authoritative state? → **Supabase**
2. Does it need fast captain/admin interaction? → **Discord Bot**
3. Does it require detailed editing, history, or correction? → **Website**
4. Does it process image data to extract stats? → **ForgeLens**

---

## Discord Bot — Allowed

- Slash command registration and handling
- Reading eligible matches for a captain from Supabase (dropdown population)
- Creating `pending_actions` records
- Posting public receipt embeds
- Creating and tracking proof threads
- Posting admin review cards with action buttons
- Handling button interactions (approve/deny/needs-info)
- Updating embed status on pending_action state changes
- Tracking screenshot upload count in proof threads
- Notifying admins of pending review queue changes
- Managing division role mappings through admin-only commands
- Linking empty `players.discord_id` values through audited admin operations
- Synchronizing Discord division roles from Supabase mappings

## Discord Bot — NOT Allowed

- Directly mutating `matches`, `standings`, or `player_stats` without a `pending_actions` entry
- Overwriting conflicting `players.discord_id` values automatically
- Storing any entity state internally (in-memory or otherwise) as a substitute for Supabase
- Acting as a fallback database for anything
- Making final approval decisions autonomously

---

## Website — Allowed

- Full admin review queue with filters and pagination
- Complex match corrections (score edits, result relinking)
- Stat review and manual override of pending stat records
- Audit log history browsing with full diff views
- Standings display and standings recalculation triggers
- Player and team profile pages
- Admin override of any entity
- Download/export of evidence archives

## Website — NOT Allowed

- Being the only place an admin can perform urgent actions (Discord approval must remain functional)
- Bypassing `audit_logs` on any mutation

---

## ForgeLens — Allowed

- Watching proof thread screenshot uploads (via webhook or polling)
- OCR processing of screenshot images
- Player stat extraction
- Confidence score calculation
- Creating `pending_stat_records`
- Triggering admin notification on new pending stat records

## ForgeLens — NOT Allowed

- Writing directly to `player_stats`
- Approving its own extractions
- Modifying `pending_actions` records (those belong to the bot/website)

---

## Supabase — Allowed

Everything authoritative. All entities. All relationships. All mutations.

## Supabase — NOT Allowed

Being used directly by the Discord bot for complex business logic without a structured service layer. Raw Supabase queries should be isolated to `packages/db` query helpers to prevent ad-hoc mutations scattered across the codebase.

---

## Edge Cases

**Q: Should the bot perform match validation (e.g., check if a score is plausible)?**

A: Light validation in the bot is fine (e.g., score format). Business validation (e.g., is this score consistent with this division's rules) should live in `packages/shared` so both bot and website enforce the same rules.

**Q: Should the website have its own approval buttons?**

A: Yes. The website approval actions go through the same `pending_actions` mutation path as Discord button presses. The pipeline is shared.

**Q: What if Discord goes down?**

A: All state is in Supabase. The website remains fully operational. The website admin panel becomes the fallback approval surface.

**Q: Why can `/division-sync` mutate without a `pending_action`?**

A: It is an admin-only setup and identity maintenance workflow, not a captain-submitted approval. It validates the admin, previews conflicts, refuses destructive identity overwrites, and writes `audit_logs` for every mutation.
