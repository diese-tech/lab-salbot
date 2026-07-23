# Discord Deployment

This guide covers Discord-side setup for SALbot.

## Required Application Settings

In the Discord Developer Portal:

1. Create or open the SALbot application.
2. Create a bot user.
3. On the **Bot** page, enable both privileged intents: **Server Members Intent**
   and **Message Content Intent**. The bot process requests
   `Guilds`, `GuildMembers`, `GuildMessages`, and `MessageContent`
   (`apps/bot/src/index.ts`) — if either privileged toggle is off, Discord
   closes the gateway connection immediately with `Error: Used disallowed
intents` and the bot crash-loops on boot. Presence Intent is not needed.
4. Copy the bot token into the deployment environment as `DISCORD_TOKEN`.
5. Copy the application client ID into `DISCORD_CLIENT_ID`.
6. Copy the target server ID into `DISCORD_GUILD_ID`.

`/division-sync` resolves actual Discord account usernames against guild members, so the bot needs the Server Members intent. Message Content Intent is required to read message text in commands/threads that rely on it.

## Required Bot Permissions

The bot needs:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Create Public Threads
- Send Messages in Threads
- Use Slash Commands
- Manage Roles

For division and organization role sync, the bot's highest Discord role must be
above every managed role it needs to add or remove. Discord will reject role
changes if the bot role is lower than the target role.

## Inviting the Bot to a Server

In the Developer Portal, go to **OAuth2 → URL Generator**:

1. Under **Scopes**, check `bot` and `applications.commands`.
2. Under **Bot Permissions**, check exactly the eight permissions listed above
   (View Channels, Send Messages, Embed Links, Read Message History, Create
   Public Threads, Send Messages in Threads, Use Slash Commands, Manage Roles).
   This produces permissions integer `311653649408`.
3. Open the generated URL, pick the server, authorize.
4. In **Server Settings → Roles**, drag the bot's role above every division
   role (Solar/Lunar/Terra) before running any division sync commands.

Or build the invite link directly:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=311653649408&scope=bot%20applications.commands
```

## Slash Command Registration

After changing command definitions or installing the bot in a new server, run:

```bash
pnpm --filter @salbot/bot deploy:commands
```

The command requires:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Supabase configuration is required because command modules share the same runtime imports as the bot.

## Admin Setup

Admins must exist in the `admin_users` table before they can use admin-only commands.

After commands are registered:

1. Run `/division-role-config set` for each division.
2. Select the Discord role using the role picker.
3. Run `/division-role-config list` to confirm mappings.
4. Run `/division-sync preview` with a roster CSV.
5. Run `/division-sync apply` with the preview token when the report looks correct.

Role IDs are not secrets. They are stored in Supabase so admins can manage mappings from Discord without deployment access.

## Planned roster workflow setup

Do not register the ADR-009 commands until the matching `sal-database` contract,
query helpers, handlers, and approval dispatchers are deployed.

The roster workflow adds these channel variables:

- `CHANNEL_TRADE_BLOCK_SOLAR`
- `CHANNEL_TRADE_BLOCK_LUNAR`
- `CHANNEL_TRADE_BLOCK_TERRA`
- `CHANNEL_TRANSACTIONS`

`CHANNEL_ADMIN_REVIEW` remains the single private destination for roster
approval cards, delivery ambiguity alerts, and failed organization-role
reconciliation.

Before enabling `/trade`, `/claim`, `/drop`, or `/draft-position-swap`:

1. Configure each division-specific Captain role with
   `/captain-role-config`.
2. Configure every canonical organization role and mobile tag with
   `/organization-role-config`.
3. Configure Caster and Production roles with `/broadcast-role-config`.
4. Place the bot role above every organization role it will reconcile.
5. Verify that each trade-block command is rejected outside its configured
   division channel.
6. Verify that an accepted captain action still waits for an `admin_users`
   decision through `pending_actions`.
7. Verify completed-operation delivery and role-reconciliation failure alerts
   in a non-production guild before enabling production commands.

The transaction channel needs View Channel, Send Messages, Embed Links, and Read
Message History so the worker can reconcile stable delivery markers before
retrying an ambiguous post. Trade-block channels need command use, message send,
embed, component, and autocomplete access. SALBot does not need draft-room
administration permissions because draft-room controls remain in `sal-site`.
