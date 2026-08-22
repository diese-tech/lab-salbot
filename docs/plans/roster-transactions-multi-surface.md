# Roster Transactions: Multi-Surface Extension

**Status:** Future interface extension. Not part of the initial SALBot `/trade` implementation.

**Authoritative references:**
- `docs/commands.md`
- `docs/adrs/ADR-009-roster-transactions-discord-workflow.md`
- canonical roster-transaction contracts owned by `diese-tech/sal-database`

## Current Discord contract

SALBot `/trade` remains the first planned transaction interface. Captains initiate proposals in the matching division trade-block channel through an ephemeral wizard. The opposing organization may accept, counter, or decline the current revision. Captain acceptance never mutates a roster; accepted terms still require administrator approval and authoritative database execution.

Completed transactions are published by SALBot to the single league-wide `CHANNEL_TRANSACTIONS` channel after successful canonical execution. Division trade-block channels are proposal/consent surfaces, not the final transaction ledger. Completed messages retain division context through the leading division chip and canonical organization tags.

## Future `sal-site` entry point

`sal-site` may later expose the same roster-transaction system through a guided web form. This must be a second interface over the existing transaction engine, not a second transaction engine.

Discord and web clients must operate on the same durable transaction, revision, consent, `pending_actions`, approval, execution, audit, outbox, and reversal contracts. A proposal created on one surface may be acted on from another surface without creating duplicate proposals or parallel state.

A likely web trade flow is:

1. Resolve the authenticated user's authorized organization context.
2. Select the acting organization and offered roster players.
3. Select another organization in the same division and requested roster players.
4. Privately review the complete current terms.
5. Explicitly submit the proposal.
6. Expose incoming/current proposals and canonical revision state.
7. Permit accept, counter, decline, withdraw, or revoke-consent actions only when the authoritative transaction state and actor permissions allow them.
8. Route accepted terms through the same admin approval and database execution path used by Discord.

The website must never bypass counterpart consent, administrator approval, capacity/eligibility checks, stale-revision protection, or canonical database execution.

## Organization-owner expansion

The future web interface may allow authenticated organization owners, or an equivalent organization-level representative, to initiate roster transactions.

This authority must be resolved server-side against canonical identity, active season, organization, division, and owner/representative permissions. It must not be inferred solely from a client-side label, profile field, or Discord role.

An organization may participate in multiple divisions, so authorization must be evaluated for the specific organization and division involved in the transaction.

### Open governance decision

Before implementing organization-owner transaction controls, decide whether an organization owner may:

- initiate proposals only; or
- initiate and provide binding organization consent, including accept, counter, decline, withdraw, and revoke-consent actions.

Do not silently resolve this question during the initial `/trade` implementation.

## Cross-surface invariants

Regardless of where a transaction begins:

- there is one canonical transaction and current revision;
- roster mutations remain database-authoritative;
- counterpart consent remains required for trades;
- accepted terms still require administrator approval;
- execution rechecks season, division, eligibility, roster capacity, transaction state, and concurrency;
- completed mutations append the canonical immutable audit record;
- completed operations use the same durable outbox events;
- SALBot continues to publish completed roster transactions to `CHANNEL_TRANSACTIONS` from durable operation state;
- Discord organization-role reconciliation remains downstream of canonical execution and does not roll back committed roster state on Discord failure.

## Initial `/trade` implementation boundary

The first SALBot `/trade` implementation should implement the Discord interaction surface only. It should not build the future `sal-site` form or organization-owner authorization model.

However, shared transaction/domain contracts must remain transport-neutral. Discord-specific wizard state, embeds, messages, component IDs, and channel concerns must not become authoritative business-state requirements. This preserves `sal-site` as a future trusted client without duplicating roster logic.
