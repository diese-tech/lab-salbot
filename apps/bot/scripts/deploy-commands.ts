// Run once to register / update slash commands with Discord.
// Usage: pnpm --filter @salbot/bot deploy:commands

import { REST, Routes } from 'discord.js';

// Only the Discord registration credentials — not requiredEnvNames() from
// ../src/lib/config, which also demands SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// for the bot process's own startup. This script never touches Supabase, and
// callers (e.g. CI) shouldn't need to hand it that credential to run.
const REQUIRED_ENV = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'] as const;

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`${missing.join(', ')} are required`);
  process.exit(1);
}

async function main() {
  const [
    reportResult,
    reschedule,
    requestAdminReview,
    updateIgn,
    rules,
    divisionRoleConfig,
    divisionSync,
    logScouter,
    profile,
    help,
    trade,
    captainRoleConfig,
    organizationRoleConfig,
  ] = await Promise.all([
    import('../src/commands/report-result'),
    import('../src/commands/reschedule'),
    import('../src/commands/request-admin-review'),
    import('../src/commands/update-ign'),
    import('../src/commands/rules'),
    import('../src/commands/division-role-config'),
    import('../src/commands/division-sync'),
    import('../src/commands/log-scouter'),
    import('../src/commands/profile'),
    import('../src/commands/help'),
    import('../src/commands/trade'),
    import('../src/commands/captain-role-config'),
    import('../src/commands/organization-role-config'),
  ]);

  const commands = [
    reportResult.data,
    reschedule.data,
    requestAdminReview.data,
    updateIgn.data,
    rules.data,
    divisionRoleConfig.data,
    divisionSync.data,
    logScouter.data,
    profile.data,
    help.data,
    trade.data,
    captainRoleConfig.data,
    organizationRoleConfig.data,
  ];

  const rest = new REST().setToken(token);

  console.log(`Registering ${commands.length} slash commands to guild ${guildId}...`);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('Commands registered successfully.');
}

main().catch((err) => {
  console.error('Failed to register commands:', err);
  process.exit(1);
});
