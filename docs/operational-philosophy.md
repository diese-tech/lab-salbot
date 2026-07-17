# Operational Philosophy

These are the founding principles of the SAL operations platform. When a design decision is unclear, come back here.

---

## 1. Single Source of Truth

**Supabase owns all state. Nothing else does.**

If a piece of data matters — a match result, a schedule, a player's team, a pending admin action — it exists in Supabase. It is not cached in the bot's memory, inferred from Discord message history, or implied by channel structure.

This means:

- The bot can restart and lose nothing
- The website has complete, accurate data without syncing from Discord
- A dispute can be resolved by querying the database, not scrolling through channel history

When in doubt: does this belong in Supabase? If it affects league operations, yes.

---

## 2. Human-in-the-Loop Approvals

**No state-changing decision is made autonomously.**

Match results are submitted by captains and reviewed by admins. Stats are extracted by OCR and reviewed by admins. Reschedules are requested by captains and approved by admins.

The system automates intake, routing, and notification. It does not automate approval.

This is intentional. League decisions affect standings, prizing, and player records. A player disputing a result deserves to know a human reviewed and approved the outcome.

The one exception — and it must never become a habit — is administrative override, which is always logged with the admin's identity and a note.

---

## 3. Compliance-Grade Evidence

**Every actionable workflow produces a timestamped, archived receipt.**

Public Discord posts are not cosmetic. They are:

- Timestamped evidence of match submission
- Screenshot archives linked to match records
- Publicly visible for player transparency
- Structured for Hi-Rez prizing verification

This means public receipts should be treated as operational artifacts, not notifications. They are not deleted when a match is approved. They are not edited in ways that erase their original content. Their URLs are stored in Supabase.

---

## 4. Commands Over Parsing

**Structured input beats clever parsing.**

A captain who uses `/report-result` gives the system:
- A verified identity
- A match selected from a validated list
- A winner from a fixed set of options
- A score in a validated format

A captain who posts "Team A beat Team B 2-1" gives the system an ambiguous string that might refer to the right match, might have the right teams, might have the right score, and might or might not have been intended as an official submission.

Commands are not a convenience. They are the integrity layer.

---

## 5. Discord as Workflow UI, Not Database

**Discord is a user interface. Supabase is the database.**

Discord's role in this platform is:
- Accepting structured input via commands
- Displaying receipts and status updates
- Delivering admin notifications
- Providing an approval button surface

Discord's role is explicitly NOT:
- Storing match results in channel messages
- Tracking standings in pinned posts
- Being the authoritative source for any entity

This constraint protects the platform against Discord message deletion, rate limits, API changes, and the fundamental unreliability of treating a chat platform as a persistence layer.

---

## 6. No Silent Mutations

**Every state change is logged, attributed, and recoverable.**

There is no such thing as "just fix it in the database." Every change to a match, player stat, or standing:

- Writes an `audit_log` entry
- Carries the identity of the person who made the change
- Records the before and after values
- Is recoverable from that log

This is not bureaucracy. It is the basic contract of a system that affects real prizing outcomes. If something goes wrong, the audit log is how you answer "what happened?"

---

## 7. Low Admin Cognitive Load

**The system surfaces the right information at the right time.**

Admins should not have to hunt for context. An admin review card should contain:

- What was submitted
- Who submitted it
- Which match it refers to
- What the current state is
- What action is requested
- A direct link to full context if needed

Admins deal with many reviews. Every piece of missing context is a friction point that slows operations. Design review cards to be self-contained.

---

## 8. Boring Infrastructure

**Prefer simple and reliable over clever and fragile.**

This platform will be maintained by a small team. Every abstraction layer is a liability. Every clever pattern is a maintenance cost.

Concrete preferences:
- SQL over ORM magic for complex queries
- Direct Supabase client calls over elaborate service abstractions
- Explicit over implicit
- Documented over undocumented
- Tested approval paths over assumed correctness

When a simple approach works, use it. The league needs reliability, not elegance.

---

## 9. Recovery by Default

**The system is designed to be wrong and corrected, not right by default.**

Mistakes happen. A captain submits the wrong score. An OCR record has the wrong player name. An admin accidentally approves a denial.

The system handles this by:
- Making corrections accessible through `sal-site`
- Requiring every correction to write an audit log entry
- Preserving original records when corrections are made
- Never deleting history

A system designed for recovery is more trustworthy than one that assumes perfection.

---

## 10. Multi-League by Default

**Every entity carries a `division_id`.**

The schema does not assume a single division or a single season. Every match, team, player assignment, and standing row is scoped to a division. Adding a new division is a data operation, not a code change.

This constraint adds minor complexity to queries but ensures the platform can grow horizontally without architectural debt.
