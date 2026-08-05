// Run once to register / update slash commands with Discord.
// Usage: pnpm --filter @salbot/bot deploy:commands

import { REST, Routes } from 'discord.js';
import { loadCommandManifest } from '../src/command-manifest';

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
// The aggregate check above is useful for operators; this explicit guard also
// narrows all three values for TypeScript before Discord.js receives them.
if (!token || !clientId || !guildId) process.exit(1);

async function main(credentials: { token: string; clientId: string; guildId: string }) {
  const commands = await loadCommandManifest();

  const rest = new REST().setToken(credentials.token);

  console.log(`Registering ${commands.length} slash commands to guild ${credentials.guildId}...`);
  await rest.put(Routes.applicationGuildCommands(credentials.clientId, credentials.guildId), { body: commands });
  console.log('Commands registered successfully.');
}

main({ token, clientId, guildId }).catch((err) => {
  console.error('Failed to register commands:', err);
  process.exit(1);
});
