# Discord Deployment

This guide covers Discord-side setup for SALbot.

## Required Application Settings

In the Discord Developer Portal:

1. Create or open the SALbot application.
2. Create a bot user.
3. Enable the privileged Server Members Intent.
4. Copy the bot token into the deployment environment as `DISCORD_TOKEN`.
5. Copy the application client ID into `DISCORD_CLIENT_ID`.
6. Copy the target server ID into `DISCORD_GUILD_ID`.

`/division-sync` resolves actual Discord account usernames against guild members, so the bot needs the Server Members intent.

## Required Bot Permissions

The bot needs:

- View Channels
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Use Slash Commands
- Manage Roles

For division role sync, the bot's highest Discord role must be above every division role it needs to add or remove. Discord will reject role changes if the bot role is lower than the target role.

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
