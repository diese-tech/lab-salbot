import type { Attachment, ChatInputCommandInteraction, Guild } from 'discord.js';
import { randomUUID } from 'crypto';
import { db } from '../lib/db';
import {
  getRequiredDivisionRole,
  linkDiscordIdIfEmpty,
  normalizeDivisionId,
  requireAdmin,
  resolvePlayerIdentity,
  syncDivisionRole,
  writeOperationAudit,
  type OperationResult,
  type ResolvedIdentity,
} from '../lib/operations';

declare const fetch: (input: string) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

type CsvRow = {
  rowNumber: number;
  division: string;
  discordUsername: string;
};

type PreviewRow = {
  rowNumber: number;
  division: string;
  discordUsername: string;
  identityResult: OperationResult<ResolvedIdentity>;
  roleResult?: OperationResult<unknown>;
};

type PreviewSession = {
  token: string;
  adminDiscordId: string;
  createdAt: number;
  rows: PreviewRow[];
};

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const previewSessions = new Map<string, PreviewSession>();

export const data = {
  name: 'division-sync',
  description: 'Preview and apply SAL player identity and division role sync.',
  options: [
    {
      type: 1, // SUB_COMMAND
      name: 'preview',
      description: 'Preview division sync changes from a roster CSV.',
      options: [
        {
          type: 11, // ATTACHMENT
          name: 'csv',
          description: 'CSV with division and discord_username columns.',
          required: true,
        },
      ],
    },
    {
      type: 1, // SUB_COMMAND
      name: 'apply',
      description: 'Apply a recent division sync preview.',
      options: [
        {
          type: 3, // STRING
          name: 'token',
          description: 'Confirmation token returned by preview.',
          required: true,
        },
      ],
    },
  ],
} as const;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const adminResult = await requireAdmin(db, interaction.user.id);
  if (adminResult.status !== 'success') {
    await interaction.editReply(adminResult.reason);
    return;
  }

  if (!interaction.guild) {
    await interaction.editReply('This command must be used inside the SAL Discord server.');
    return;
  }

  pruneExpiredPreviewSessions();

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'preview') {
    await handlePreview(interaction, interaction.guild);
    return;
  }

  if (subcommand === 'apply') {
    await handleApply(interaction);
    return;
  }

  await interaction.editReply('Unknown division sync action.');
}

async function handlePreview(interaction: ChatInputCommandInteraction, guild: Guild) {
  const attachment = interaction.options.getAttachment('csv', true) as Attachment;
  let csv: string;
  try {
    csv = await downloadCsv(attachment);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply(message);
    return;
  }

  const parsed = parseRosterCsv(csv);

  if (parsed.status !== 'success') {
    await interaction.editReply(parsed.reason);
    return;
  }

  const duplicateDiscordUsernames = findDuplicates(
    parsed.data.map((row) => row.discordUsername.trim().toLowerCase())
  );
  const duplicateRows = new Set(
    parsed.data
      .filter((row) => duplicateDiscordUsernames.has(row.discordUsername.trim().toLowerCase()))
      .map((row) => row.rowNumber)
  );

  const rows: PreviewRow[] = [];
  const resolvedDiscordIds = new Map<string, number[]>();

  for (const row of parsed.data) {
    const division = normalizeDivisionId(row.division);
    let identityResult = await resolvePlayerIdentity(db, guild, row.discordUsername);

    if (duplicateRows.has(row.rowNumber)) {
      identityResult = {
        status: 'conflict',
        reason: 'CSV contains duplicate discord_username values.',
        details: { discordUsername: row.discordUsername },
      };
    }

    if (identityResult.status === 'success') {
      const discordId = identityResult.data.member.user.id;
      const existing = resolvedDiscordIds.get(discordId) ?? [];
      existing.push(row.rowNumber);
      resolvedDiscordIds.set(discordId, existing);
    }

    const roleResult = await getRequiredDivisionRole(db, division);
    rows.push({
      rowNumber: row.rowNumber,
      division,
      discordUsername: row.discordUsername,
      identityResult,
      roleResult,
    });
  }

  for (const row of rows) {
    if (row.identityResult.status !== 'success') continue;
    const duplicateRowsForId = resolvedDiscordIds.get(row.identityResult.data.member.user.id) ?? [];
    if (duplicateRowsForId.length > 1) {
      row.identityResult = {
        status: 'conflict',
        reason: 'Multiple CSV rows resolve to the same Discord account.',
        details: { rows: duplicateRowsForId },
      };
    }
  }

  const actionableRows = rows.filter(isPreviewRowActionable);
  const token = actionableRows.length > 0 ? createPreviewSession(interaction.user.id, rows) : null;

  await interaction.editReply(formatPreviewSummary(rows, token));
}

async function handleApply(interaction: ChatInputCommandInteraction) {
  const token = interaction.options.getString('token', true).trim();
  const session = previewSessions.get(token);

  if (!session || Date.now() - session.createdAt > PREVIEW_TTL_MS) {
    previewSessions.delete(token);
    await interaction.editReply('That confirmation token is missing or expired. Run preview again.');
    return;
  }

  if (session.adminDiscordId !== interaction.user.id) {
    await interaction.editReply('That confirmation token belongs to a different admin.');
    return;
  }

  const results: string[] = [];
  let linked = 0;
  let roleSynced = 0;
  let skipped = 0;
  let conflicts = 0;
  let failures = 0;

  for (const row of session.rows) {
    if (!isPreviewRowActionable(row)) {
      conflicts += 1;
      results.push(`Row ${row.rowNumber}: conflict - ${previewRowConflictReason(row)}`);
      continue;
    }

    const identity = row.identityResult.data;

    try {
      const linkResult = await linkDiscordIdIfEmpty(db, identity);
      if (linkResult.status === 'success') {
        linked += 1;
        await writeOperationAudit(db, {
          actionType: 'discord_identity_linked',
          entityType: 'player',
          entityId: identity.player.id,
          actorDiscordId: interaction.user.id,
          oldValueJson: { discordId: null },
          newValueJson: {
            discordId: identity.member.user.id,
            discordUsername: identity.discordUsername,
          },
          note: `Linked Discord ID for ${identity.player.ign}.`,
        });
      } else if (linkResult.status === 'skipped') {
        skipped += 1;
      } else if (linkResult.status === 'conflict') {
        conflicts += 1;
        results.push(`Row ${row.rowNumber}: conflict - ${linkResult.reason}`);
        continue;
      }

      const roleResult = await syncDivisionRole(db, {
        member: identity.member,
        divisionId: row.division,
        actorDiscordId: interaction.user.id,
      });

      if (roleResult.status === 'success') roleSynced += 1;
      else if (roleResult.status === 'skipped') skipped += 1;
      else {
        conflicts += 1;
        results.push(`Row ${row.rowNumber}: ${roleResult.status} - ${roleResult.reason}`);
      }
    } catch (err) {
      failures += 1;
      const message = err instanceof Error ? err.message : String(err);
      results.push(`Row ${row.rowNumber}: failure - ${message}`);
    }
  }

  previewSessions.delete(token);

  await interaction.editReply(
    [
      '**Division sync applied.**',
      `Identity links: ${linked}`,
      `Role updates: ${roleSynced}`,
      `Skipped: ${skipped}`,
      `Conflicts: ${conflicts}`,
      `Failures: ${failures}`,
      results.length > 0 ? `\n${truncateLines(results, 15).join('\n')}` : '',
    ].filter(Boolean).join('\n')
  );
}

async function downloadCsv(attachment: Attachment) {
  if (attachment.contentType && !attachment.contentType.includes('csv') && !attachment.name?.endsWith('.csv')) {
    throw new Error('Attachment must be a CSV file.');
  }

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Could not download CSV attachment: HTTP ${response.status}`);
  return response.text();
}

function parseRosterCsv(csv: string): OperationResult<CsvRow[]> {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { status: 'error', reason: 'CSV must include a header and at least one row.' };
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const divisionIndex = headers.indexOf('division');
  const usernameIndex = headers.indexOf('discord_username');

  if (divisionIndex === -1 || usernameIndex === -1) {
    return { status: 'error', reason: 'CSV must include division and discord_username columns.' };
  }

  const rows: CsvRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const columns = splitCsvLine(lines[index]);
    const division = columns[divisionIndex]?.trim() ?? '';
    const discordUsername = columns[usernameIndex]?.trim() ?? '';

    if (!division || !discordUsername) {
      return { status: 'error', reason: `Row ${index + 1} is missing division or discord_username.` };
    }

    rows.push({ rowNumber: index + 1, division, discordUsername });
  }

  return { status: 'success', data: rows };
}

function splitCsvLine(line: string) {
  const columns: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      columns.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  columns.push(current);
  return columns;
}

function createPreviewSession(adminDiscordId: string, rows: PreviewRow[]) {
  const token = randomUUID().slice(0, 8);
  previewSessions.set(token, { token, adminDiscordId, createdAt: Date.now(), rows });
  return token;
}

function pruneExpiredPreviewSessions() {
  for (const [token, session] of previewSessions) {
    if (Date.now() - session.createdAt > PREVIEW_TTL_MS) previewSessions.delete(token);
  }
}

function isPreviewRowActionable(row: PreviewRow): row is PreviewRow & {
  identityResult: { status: 'success'; data: ResolvedIdentity };
} {
  return row.identityResult.status === 'success' && row.roleResult?.status === 'success';
}

function previewRowConflictReason(row: PreviewRow) {
  if (row.identityResult.status !== 'success') return row.identityResult.reason;
  if (row.roleResult?.status !== 'success') return row.roleResult?.reason ?? 'Missing role mapping.';
  return 'Unknown conflict.';
}

function formatPreviewSummary(rows: PreviewRow[], token: string | null) {
  const matched = rows.filter(isPreviewRowActionable).length;
  const skipped = rows.filter((row) => row.identityResult.status === 'skipped').length;
  const conflicts = rows.filter(
    (row) => row.identityResult.status === 'conflict' || row.roleResult?.status === 'conflict'
  ).length;
  const errors = rows.filter(
    (row) => row.identityResult.status === 'error' || row.roleResult?.status === 'error'
  ).length;

  const detailLines = rows.map((row) => {
    if (isPreviewRowActionable(row)) {
      return `Row ${row.rowNumber}: matched ${row.discordUsername} -> ${row.division}`;
    }
    return `Row ${row.rowNumber}: ${previewRowConflictReason(row)}`;
  });

  return [
    '**Division sync preview complete.**',
    `Matched: ${matched}`,
    `Skipped: ${skipped}`,
    `Conflicts: ${conflicts}`,
    `Errors: ${errors}`,
    token ? `\nApply token: \`${token}\` (expires in 10 minutes)` : '\nNo apply token created because there are no actionable rows.',
    '',
    ...truncateLines(detailLines, 15),
  ].join('\n');
}

function findDuplicates(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value));
}

function truncateLines(lines: string[], maxLines: number) {
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `...and ${lines.length - maxLines} more rows.`];
}
