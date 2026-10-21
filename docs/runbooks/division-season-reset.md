# Next-season division channel rebuild

## For the admin team

This prepares a fresh set of Solar, Lunar and Terra channels for a later season.
The intended future reset replaces only the three active division categories and
their agreed channels. Archives, leadership, information, support, other categories
and all existing roles stay as they are.

**Nothing is being reset now. The script only captures an inventory and writes a
preview. It cannot delete channels, create channels, change permissions, restart
the bot or update the database. There is no apply mode.**

The starter layout proposes these eight channels in each division:

| Channel                    | Purpose to confirm                                     |
| -------------------------- | ------------------------------------------------------ |
| `{division}-announcements` | Division notices; decide who can post                  |
| `general`                  | Division conversation                                  |
| `tier-list`                | Division discussion                                    |
| `reschedules`              | Scheduling; decide captain and staff posting access    |
| `captain-chat`             | Private captain/staff conversation                     |
| `match-report`             | Match reporting; confirm SALbot destination            |
| `sub-approval`             | Substitute requests and approvals                      |
| `Join to Yap`              | Voice channel; confirm the voice-generator integration |

These are editable starter names, not an approved final setup. In particular,
the announcement name is normalized to plural across divisions. Do not copy the
old exceptions automatically. The admin team still needs to agree who can see,
post and moderate in each channel, including captains, division members, staff
and bots. Permission profile names in the template are placeholders; they do
not contain deployable permission rules.

## What is scaffolded

- `scripts/division-season-reset.example.json`: public template without real
  server IDs or access-control exports.
- `scripts/division-season-reset.mjs capture`: **GET-only** inventory capture.
- `scripts/division-season-reset.mjs plan`: offline JSON and readable Markdown
  previews, exact division scope, preserved-channel list, inventory drift,
  routing review and unresolved work.
- `pnpm test:season-reset`: offline scope and read-only transport tests.

All plans say `readyToExecute: false` and `executionImplemented: false`.
Do not wire this into startup, slash commands, Railway deploys or a scheduler.

## Prepare a private configuration

This repository is public. Keep snapshots, channel IDs, permission exports and
plans under `.local/season-reset/`, which is ignored by Git. Never paste tokens
into commands, plans or documentation.

Copy the example to `.local/season-reset/config.json`. Set:

1. The exact server ID and the next season's label.
2. The exact active Solar, Lunar and Terra category IDs and expected names.
3. `expectedChannelIds` for every direct child reviewed in each active category.
   This pins scope; new, moved or missing children are called out as blockers.
4. Archive category IDs in `protectedCategoryIds` as an additional protection.
   Every category outside the three selected IDs is preserved anyway.

Category names are checked after ID lookup, never used to discover deletion
targets. Protected categories and categories named archive/saved cannot be
selected. Ordinary roles and member assignments are outside this reset scope.

## Generate a preview

Use Node 24 from a checkout. No dependency installation is needed for this
standalone script. Have the existing bot token available through `DISCORD_TOKEN`,
`BOT_TOKEN` or `DISCORD_BOT_TOKEN`; never print it. If a local `.env.local` already
contains it, Node can load that file:

```sh
node --env-file=.env.local scripts/division-season-reset.mjs capture --guild YOUR_GUILD_ID --out .local/season-reset/snapshot.json
pnpm season:reset:plan --config .local/season-reset/config.json --snapshot .local/season-reset/snapshot.json --out .local/season-reset/plan.json
```

If the token is already in the environment, omit `--env-file`. Substitute the
real guild ID only in private commands/configuration. The capture uses the
[Discord guild, guild-channel and role GET endpoints](https://docs.discord.com/developers/resources/guild#get-guild-channels).
It starts no gateway client and requests no member or message content.

Open `plan.json.md` first. The JSON also lists every preserved channel and the
old-to-new ID mapping slots. No output overwrites an existing file: use a new
filename for subsequent snapshots/plans. A plan is a review artifact, not an
approval or an executable deletion manifest.

The production Docker image does not include these repository scripts. Running
them from a checkout avoids a deployment. Do not run the normal bot entrypoint
or add dependencies to a production container for this preview.

## Before implementing execution later

1. **Agree the scope and access rules.** Review the exact current category and
   child IDs, channel names, staff permissions and any legitimate bot exceptions.
   Preserve all archives and other non-division areas. Do not add account-specific
   exceptions merely because they existed before.
2. **Decide what history must survive.** Deleting active channels destroys their
   messages and proof threads. Existing archives staying in place does not back
   up active channels. Export or otherwise retain required season/compliance
   evidence before a future deletion. Recreating names is not a rollback.
3. **Drain old workflows and collect a fresh snapshot.** Resolve pending reports,
   proof/stat reviews and outbox work before retiring destinations. Recheck
   parent IDs and pinned child lists immediately before destructive operations.
   An older preview is not evidence that today's scope is safe.
4. **Prepare and verify replacements before retiring the old channels.** New
   channels get new IDs. Persist a resumable execution journal and old-to-new ID
   mapping; test actual member access and bot delivery before deletion. Any
   later destructive phase needs separate explicit authorization.
5. **Update routing and integrations.** `apps/bot/src/lib/channels.ts` uses
   `CHANNEL_RESULTS_SOLAR/LUNAR/TERRA`, `CHANNEL_RESCHEDULES_SOLAR/LUNAR/TERRA`
   and `CHANNEL_TRADE_BLOCK_SOLAR/LUNAR/TERRA`. The eight-channel starter has
   no trade-block: explicitly decide whether those configured destinations stay
   outside scope or need an additional channel. Preserve shared admin-review and
   transactions channels. Inspect alias channel allowlists, database-held receipt
   and proof references, other bots, webhooks, invites, panels and voice generators.
   Do not remap historical evidence references to empty new channels.
6. **Implement against existing authorization/audit conventions.** A later
   admin workflow must validate the actor through `admin_users` and follow
   existing operations/auditing boundaries. Database contract changes belong to
   `diese-tech/sal-database`; this scaffold performs no Supabase writes.

There is no reset date scheduled and no execution command to run yet. When the
team is ready, review a fresh preview, finish the missing execution work, and
authorize the exact destructive scope separately.

## Limitations

The snapshot is metadata, not a message backup. Discord's guild-channel listing
excludes threads; thread retention must be reviewed separately. Capture is
sequential rather than transactional. Plans preserve the recorded scope but do
not prove live access, integration readiness or historical evidence retention.
