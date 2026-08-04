# ADR-009: Discord Role-Backed Operational Command Authorization

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decision owner:** SAL
- **Scope:** SALBot operational command authorization
- **Related:** #81, #80
- **Supersedes:** Any prior ADR, documentation, implementation assumption, or instruction that requires OAuth identity linkage, `players.discord_id`, roster captain state, or equivalent player-record linkage as a prerequisite for operational command authorization. Where this ADR conflicts with earlier guidance, **this ADR is authoritative**.

## Context

SALBot currently contains authorization paths that derive command access from linked application identity. A representative example is captain lookup through current-season roster/player records: a Discord user must resolve to a linked player, be on an active roster, and be marked `is_captain` before captain-gated functionality can proceed.

That model conflates two separate concerns:

1. **Identity/data linkage** — who a player is, their roster history, stats, IGN, profile, and related league data.
2. **Operational authorization** — who league staff currently trust to submit or operate workflows in Discord.

In practice, operational authority changes independently of player identity. Org owners may need the same submission capability as captains. Captains can change. A temporary substitute may be needed. Admins require override access. OAuth/player linkage can also be stale, missing, or incorrect even when the Discord server already reflects the user's current operational role.

This coupling has made legitimate command access fragile and creates unnecessary maintenance overhead.

Statistics must also remain independent from authorization. Whether stats originate from `/log-scouter` or the `/report-result` proof/OCR workflow, the canonical statistical history belongs to the players who produced it. Team and organization membership provide historical context for a game, but do not own the player's underlying stat history.

## Decision

**Discord server role IDs are the authoritative source for SALBot operational command authorization.**

SALBot will authorize trusted operational commands by checking the invoking Discord member's current server roles against centrally configured role-ID allowlists/capabilities.

The initial trusted operator set is expected to contain:

- Division 1 Captain role
- Division 2 Captain role
- Division 3 Captain role
- Org Owner role
- SAL admin role(s)

A dedicated interim-captain role is not required initially. Temporary exceptions can be handled by administrators unless repeated operational need justifies adding another managed role later.

### Authorization vs. identity

OAuth, player records, roster records, `players.discord_id`, `season_rosters.is_captain`, and similar data remain valid sources for **identity and business data**. They may be used to determine what player/profile/roster information to display or process.

They MUST NOT be required solely to determine whether an invoking Discord member is allowed to use an operational command covered by this ADR.

Holding an authorized Discord role is sufficient for the command authorization gate. Conversely, a database record saying a player is a captain does not grant command access when the Discord member does not hold an authorized role.

### Statistical ownership and attribution

Statistical records are **player-owned**. This applies to both scouter games and official match reports.

- A player's stats remain attached to that player across team, organization, and division changes.
- Official match-report stats are season-scoped where the competition context requires it, but ownership still remains with the player.
- When a player is assigned to a team/org for a game, the recorded game/stat row MUST also preserve the team/org represented at the time of that game.
- Organization/team aggregates are derived from those historical game-time attributions, not from the player's current roster membership.
- Trading or moving a player later MUST NOT retroactively move, remove, or reassign previously recorded statistics.

Example: if a player records 10 games for Org A and is then traded to Org B for 5 games, the player's season total contains all 15 games. Org A aggregates include only the first 10 games and Org B aggregates include only the later 5 games.

This supports both durable player histories and future organization-level analytics such as total kills, deaths, damage, or other aggregate records without corrupting historical attribution when rosters change.

### Initial command scope

This decision applies immediately to:

- `/report-result`
- `/log-scouter`

Future captain-, org-, or league-operator commands SHOULD use the same capability-based authorization layer unless a later ADR explicitly defines a different security requirement.

### `/log-scouter`

Authorization is based only on trusted operator capability. It is not scoped to the submitter's division or organization.

Scouter game/stat ownership remains player-centric. Extracted participant statistics follow canonical players regardless of who submitted the screenshots or which division/team those players later join. If a scouter game has a meaningful team/org context, that context may be recorded as historical attribution without changing player ownership of the stats.

### `/report-result`

`/report-result` uses the same Discord-role-backed authorization gate.

The invoking user's OAuth/player linkage is not an authorization prerequisite. Match context, pending-action workflow, evidence, admin review, audit logging, and other existing safeguards remain responsible for validating and controlling the resulting business mutation.

Stats extracted/recorded from an official match report remain attached to each player for that season. Each participant's game record should also preserve the org/team they represented in that match so organization-level aggregates can be calculated from historical participation. Current roster membership must never be used to retroactively reattribute prior games after a trade or roster move.

## Implementation direction

Authorization SHOULD be centralized behind a reusable capability helper rather than duplicated inside command handlers. Conceptually:

```ts
hasCommandAccess(member, 'report-result')
hasCommandAccess(member, 'log-scouter')
```

Role IDs MUST be centrally configurable rather than scattered as source literals. A shared operator allowlist is acceptable initially while preserving the ability to define capability-specific allowlists later.

Conceptual configuration:

```text
SAL_OPERATOR_ROLE_IDS=<division1-captain>,<division2-captain>,<division3-captain>,<org-owner>
SAL_ADMIN_ROLE_IDS=<admin-role-ids>
```

Existing helpers such as `getCaptainByDiscordId()` may remain when captain/player information is actually needed, but they MUST NOT be used as the authorization boundary for commands governed by this ADR.

Stat persistence/read models SHOULD preserve immutable game-time player/team/org attribution where needed for reporting. Aggregates should be computed from recorded participation history rather than joining historical stats to the player's current team/org.

## Consequences

### Positive

- Removes OAuth/player-link fragility from command access.
- Matches permissions to the place league operators already manage them: Discord.
- Supports captains, org owners, admins, and future trusted operator categories without schema gymnastics.
- Allows operational authority to change without rewriting player identity/history.
- Produces one reusable authorization model for current and future SALBot workflows.
- Keeps player statistics durable across trades and roster changes.
- Preserves historical team/org attribution for accurate organization analytics.

### Tradeoffs

- Discord role configuration becomes security-sensitive operational configuration.
- Incorrectly granting a trusted role grants the corresponding SALBot capability.
- Tests and deployment configuration must ensure required role IDs are present and correctly parsed.
- Business-context validation must remain in downstream workflows; role authorization only answers whether the user may initiate the operation.
- Historical attribution must be recorded at game time rather than reconstructed from current roster state.

These tradeoffs are acceptable because Discord roles directly represent the league's current operational authority and are easier to inspect, revoke, and manage than indirect OAuth/player/roster linkage. Game-time attribution also avoids corrupting historical statistics when players change teams.

## Required safeguards

- Admin role(s) retain authorized override access.
- Existing pending-action, human review, OCR verification, evidence, audit, and approval safeguards are not weakened by this decision.
- Missing/invalid authorization configuration must fail closed.
- Unauthorized members must receive no mutation capability.
- Authorization tests must cover every configured operator category, unauthorized users, missing/stale player linkage, and admin override.
- Historical stat queries must not infer past org/team ownership from a player's current roster assignment.

## Migration

1. Inventory operational command authorization paths that depend on linked player/OAuth/roster captain state.
2. Introduce a centralized Discord-role capability helper and configuration.
3. Migrate `/report-result` and `/log-scouter` to the new authorization boundary.
4. Remove authorization dependence on `getCaptainByDiscordId()` and equivalent identity lookups while retaining those queries where actual identity/business data is needed.
5. Add tests proving authorized Discord roles work with missing/stale player linkage and unauthorized users remain blocked.
6. Verify official match-report stat persistence records game-time player/team/org attribution rather than relying on current roster state.
7. Update conflicting documentation to reference this ADR.

## Supersession rule

This ADR intentionally replaces earlier architectural guidance wherever that guidance treats OAuth linkage, player linkage, roster membership, or database captain status as the authoritative permission gate for SALBot operational commands.

Earlier documents remain historical context, but implementations MUST follow this ADR when the instructions conflict.
