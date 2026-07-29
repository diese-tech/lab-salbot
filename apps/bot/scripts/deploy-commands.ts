// Run once to register / update slash commands with Discord.
// Usage: pnpm --filter @salbot/bot deploy:commands

import { REST, Routes } from 'discord.js';
import { requiredEnvNames } from '../src/lib/config';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

const missing = requiredEnvNames().filter((name) => !process.env[name]);
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
