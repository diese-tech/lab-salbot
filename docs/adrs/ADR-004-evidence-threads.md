# ADR-004: Dedicated Proof Threads for Screenshot Collection

**Status:** Accepted
**Date:** 2025-01-01
**Deciders:** Platform architecture

---

## Context

Match results require screenshot evidence. The question is where screenshots should be collected:

1. Inline with the slash command (attachments in the command interaction)
2. In a dedicated proof thread created by the bot
3. In a general evidence channel

---

## Decision

A dedicated proof thread is created per match report. Screenshots are uploaded to the thread, not inline to the command.

---

## Rationale

- **Volume** — a best-of-3 match requires 6 screenshots minimum. A best-of-5 requires 10. Discord's slash command interaction does not gracefully support 6–10 attachment fields. Proof threads provide an unlimited upload surface.
- **Timing** — captains may not have all screenshots immediately. Proof threads allow uploading over minutes or hours after submitting the result.
- **Dual-captain participation** — both Team A and Team B captains should be able to contribute screenshots. A thread is accessible to all participants; a command interaction is not.
- **Organization** — one thread per match keeps evidence organized and queryable. A general channel becomes unmanageable at scale.
- **Future ForgeLens watch surface** — a future ForgeLens implementation can watch specific proof threads rather than scanning all channels, which is more efficient and reliable.
- **Compliance** — the thread URL is stored in `matches.proof_thread_url` and archived to Supabase Storage. This creates a durable evidence link that survives Discord CDN URL expiration.

---

## Consequences

### Positive

- No screenshot upload limit per match
- Captains can upload after the fact
- Both captains can contribute
- A future ForgeLens implementation has a clear watch surface
- Thread URL is a permanent compliance reference

### Negative

- More Discord API interactions (thread creation, initial message, progress updates)
- If thread creation fails, error handling must create a fallback or retry
- Thread archive requires storage budget

### Risks

- Thread creation may fail (Discord outage, rate limit); mitigated by retry logic and fallback instructions in the bot's error message
- Thread deletion by a Discord admin removes evidence; mitigated by Supabase Storage archival

---

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| Inline command attachments | 6–10 attachments in a single interaction is poor UX; timing constraint (must upload at command time) |
| General evidence channel | Unorganized; hard to link specific screenshots to specific matches |
| Email/external upload | Too much friction for captains; outside Discord workflow |
