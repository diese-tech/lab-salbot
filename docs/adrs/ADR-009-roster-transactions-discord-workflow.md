# ADR-009: Roster Transactions Discord Workflow

- **Status:** Accepted
- **Date:** 2026-07-22
- **Owners:** SAL platform maintainers
- **Related database ADRs:**
  - [Season-scoped captain roster draft eligibility](https://github.com/diese-tech/sal-database/blob/main/docs/adr/0001-season-scoped-captain-roster-draft-eligibility.md)
  - [Roster transactions and public bulletin](https://github.com/diese-tech/sal-database/blob/main/docs/adr/0002-roster-transactions-and-public-bulletin.md)

## Context

SAL captains need a low-friction Discord workflow for proposing roster transactions without turning informal trade-block discussion into authoritative roster mutations. The database remains the source of truth for transaction state, approvals, roster capacity, season and division boundaries, and public ledger events. Discord is an interaction and delivery surface over that durable workflow.

Captains vary in technical comfort. The official trade flow therefore needs guided selections and explicit confirmations, while preserving normal conversation in each division's trade-block channel. Public transaction announcements must be concise enough for mobile Discord clients and consolidated for the entire league.

## Decision

### Discord channel structure

The bot is configured with:

- `CHANNEL_TRADE_BLOCK_TERRA`
- `CHANNEL_TRADE_BLOCK_SOLAR`
- `CHANNEL_TRADE_BLOCK_LUNAR`
- `CHANNEL_ADMIN_REVIEW`
- `CHANNEL_TRANSACTIONS`

Each division trade-block channel is an informal discussion space and the command surface for that division's roster mutations. The bot does not parse conversational phrases such as “on the block” or “OTB.” One consolidated transactions channel publishes completed transactions for the entire league.

### Official commands

The supported transaction entry points are:

- `/trade`
- `/claim`
- `/drop`
- `/draft-position-swap`

Commands validate that the initiating captain is authorized for the selected organization and that the organization belongs to the channel's division and active season.

### Guided trade wizard

`/trade` opens a private, ephemeral wizard:

1. **Your side:** select one of the captain's authorized organizations, then select one or more players offered from its current roster.
2. **Their side:** select the other organization in the same division, then select one or more requested players from its current roster.
3. **Review:** show the complete proposed exchange and require an explicit **Post Proposal** action.

Every step before **Post Proposal** is ephemeral. No incomplete selection, draft, validation error, or private review is posted publicly. Uneven player counts are allowed; draft slots or other compensation are not part of a roster trade.

After **Post Proposal**, the bot creates the durable pending transaction and posts a public proposal card in that division's trade-block channel. The card displays the complete exchange and provides **Accept**, **Counter**, and **Decline** buttons.

Only the authorized captain of the receiving organization may accept or decline. Acceptance requires confirmation of the exact current revision. The proposing captain may withdraw while the transaction is still pending.

### Counteroffers

**Counter** opens a prefilled ephemeral wizard for the receiving captain. The captain may change the organizations' selected players and privately review the result before explicitly posting it. Posting a counteroffer creates a new durable revision and invalidates acceptance of the prior revision. The public card is updated or superseded so that only the current revision can be acted upon.

### Claims, drops, and draft-position swaps

`/claim`, `/drop`, and `/draft-position-swap` use the same pattern: ephemeral guided input and review, followed by an explicit public submission. Claims do not reserve a player while pending. Draft-position swaps exchange the two organizations' complete base draft positions for all snake rounds, allow no additional compensation, and close when the affected draft room starts.

### Admin approval

Captain acceptance never mutates rosters directly. Accepted trades and submitted claims, drops, and draft-position swaps are routed to the existing private admin-review channel. Admin actions approve or reject the current durable revision.

Database execution remains authoritative and enforces season, division, eligibility, roster-capacity, transaction-state, and concurrency rules. If execution is blocked, the bot reports the reason without publishing a completed transaction.

### Durable event delivery

The bot consumes the database `operation_outbox` through a lease-based worker. It does not depend on an in-memory event or a live process surviving between approval and delivery. Each completed operation has a stable idempotency key, and the bot records delivery so retries cannot create duplicate Discord posts.

Completed transactions are published to the consolidated transactions channel in a compact form such as:

```text
[SOLAR] FF traded Crow to TC for The_Expert133
[LUNAR] EV claimed XGN Ninja
```

The leading division chip provides the division context. Mobile messages use each organization's canonical tag; richer embeds may expose full organization names. Public sanction reasons are not included in routine drop messages.

Normal draft picks are not posted individually to the transactions channel. When a division draft is finalized, its durable conclusion event produces one message:

```text
[SOLAR] Solar draft has concluded.
[View Solar rosters](https://example.invalid/rosters/solar)
```

The link targets the canonical division roster page and may use the league's approved short URL. Any roster screenshot posted by an admin is an optional follow-up and never blocks the bot's conclusion message.

## Consequences

- Captains get a guided workflow without exposing partial inputs or errors to the channel.
- Informal trade-block discussion remains human conversation and cannot accidentally mutate roster state.
- Public proposals provide visible consent controls, while final roster changes remain admin-gated.
- Counteroffers are explicit revisions, preventing stale acceptance from executing a superseded deal.
- Durable outbox consumption makes Discord delivery retryable and auditable.
- One consolidated transactions channel produces a league-wide bulletin while division tags and canonical organization tags keep posts readable on mobile.
- The bot depends on database transaction and outbox contracts owned by `sal-database`.

## Implementation ownership

### `diese-tech/sal-database`

- Own transaction records, revisions, participant consent, admin decisions, execution, and reversal links.
- Enforce season, division, roster-capacity, eligibility, and concurrency invariants.
- Emit stable, idempotent outbox events for proposals, completed transactions, reversals, and draft conclusions.

### `diese-tech/lab-salbot`

- Own channel configuration and command-channel guards.
- Implement the ephemeral command wizards, public proposal cards, and component authorization.
- Route accepted submissions to the private admin-review workflow.
- Lease, deliver, and acknowledge durable outbox events.
- Render transaction and draft-conclusion messages using canonical organization tags and roster links.
- Test permissions, stale revisions, retries, duplicate suppression, and mobile-safe output.

### `diese-tech/sal-site`

- Provide canonical roster URLs used by draft-conclusion messages.
- Render the same durable public transaction ledger for web users.
- Link its implementation documentation to this ADR and the canonical database ADRs.

## Acceptance criteria

1. Each division has a configured trade-block channel, and the league has one configured transactions channel.
2. Plain-language trade-block discussion causes no bot action.
3. Official transaction commands are accepted only in the correct division channel from an authorized captain or admin.
4. Every command setup, selection, counteroffer, validation, and review step remains ephemeral until the user explicitly submits or posts it.
5. `/trade` first selects the initiating organization and offered players, then the opposing organization and requested players.
6. Uneven player-for-player trades are supported without other compensation.
7. A public trade card appears only after **Post Proposal** and includes the complete current revision.
8. The receiving captain can accept, counter, or decline; unauthorized users cannot act on the card.
9. Acceptance is bound to an exact revision and cannot execute after a counteroffer supersedes it.
10. Counteroffers open a prefilled ephemeral wizard and become a new durable revision only after explicit posting.
11. Captain consent can be withdrawn before database execution.
12. Every roster mutation still requires admin approval.
13. Claims do not reserve players while pending.
14. Draft-position swaps exchange complete base positions, permit no additional compensation, and cannot be submitted after room start.
15. A blocked or rejected operation produces no completed transaction announcement.
16. Completed transactions publish once to the consolidated channel with a leading division chip and canonical organization tags.
17. Delivery retries do not duplicate public posts.
18. Routine public messages omit private administrative and sanction details.
19. Normal draft picks do not create individual transactions-channel messages.
20. Draft finalization publishes one division conclusion message containing only a link to the canonical rosters page; an admin screenshot is optional.
