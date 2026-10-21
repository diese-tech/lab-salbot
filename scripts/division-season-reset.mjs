import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DIVISIONS = ["solar", "lunar", "terra"];
const SNOWFLAKE = /^\d{17,20}$/;
const ARCHIVE_NAME = /archiv|saved/i;
const HELP = `Division season reset scaffold — preview only; Discord writes are not implemented.

Capture a fresh, private inventory (GET requests only):
  node scripts/division-season-reset.mjs capture --guild GUILD_ID --out .local/season-reset/snapshot.json

Preview a replacement plan, offline:
  node scripts/division-season-reset.mjs plan --config .local/season-reset/config.json --snapshot .local/season-reset/snapshot.json --out .local/season-reset/plan.json

See docs/runbooks/division-season-reset.md. There is no apply/delete/create mode.`;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function requireId(id, label) {
  requireValue(
    typeof id === "string" && SNOWFLAKE.test(id),
    `${label} must be a Discord ID stored as text.`,
  );
}

export function buildPlan(config, snapshot) {
  requireValue(config.schemaVersion === 1, "Unsupported config schemaVersion.");
  requireId(config.guildId, "guildId");
  requireValue(
    typeof config.nextSeason === "string" && config.nextSeason.trim(),
    "nextSeason is required.",
  );
  requireValue(
    snapshot.guild?.id === config.guildId,
    "Snapshot belongs to a different guild.",
  );
  requireValue(
    Number.isFinite(Date.parse(snapshot.capturedAt)),
    "Snapshot capturedAt is required.",
  );
  requireValue(
    Array.isArray(snapshot.channels),
    "Snapshot channels must be an array.",
  );
  requireValue(
    Array.isArray(config.protectedCategoryIds),
    "protectedCategoryIds must be an array.",
  );
  requireValue(
    Array.isArray(config.divisions) && config.divisions.length === 3,
    "Scope must contain exactly solar, lunar and terra.",
  );
  requireValue(
    new Set(config.divisions.map((d) => d.key)).size === 3 &&
      config.divisions.every((d) => DIVISIONS.includes(d.key)),
    "Division keys must be unique solar, lunar and terra.",
  );
  requireValue(
    Array.isArray(config.channelTemplate) &&
      config.channelTemplate.length > 0 &&
      config.channelTemplate.length <= 50,
    "channelTemplate must have between 1 and 50 entries.",
  );
  const templateKeys = new Set();
  for (const channel of config.channelTemplate) {
    requireValue(
      typeof channel.key === "string" &&
        /^[a-z0-9-]+$/.test(channel.key) &&
        !templateKeys.has(channel.key),
      "Template channel keys must be unique lowercase keys.",
    );
    templateKeys.add(channel.key);
    requireValue(
      ["text", "voice"].includes(channel.type),
      `Unsupported template type for ${channel.key}.`,
    );
    requireValue(
      typeof channel.name === "string" &&
        channel.name.length > 0 &&
        channel.name.length <= 100,
      `Invalid channel name for ${channel.key}.`,
    );
    requireValue(
      typeof channel.permissionProfile === "string" &&
        channel.permissionProfile.length > 0,
      `Permission profile is required for ${channel.key}.`,
    );
  }

  const channels = new Map();
  for (const channel of snapshot.channels) {
    requireId(channel.id, "Snapshot channel ID");
    requireValue(!channels.has(channel.id), "Duplicate snapshot channel ID.");
    requireValue(
      typeof channel.name === "string" && Number.isInteger(channel.type),
      "Snapshot channel name/type is missing.",
    );
    channels.set(channel.id, channel);
  }
  for (const id of config.protectedCategoryIds) {
    requireId(id, "Protected category ID");
    requireValue(
      channels.get(id)?.type === 4,
      `Protected category ${id} is missing or is not a category.`,
    );
  }
  const protectedIds = new Set(config.protectedCategoryIds);
  const selected = new Set();
  const replacements = [];
  const blockers = [
    "Execution is not implemented; this plan cannot delete or create channels.",
    "Admins must agree the new permissions and role bindings; profile names are placeholders, not approved ACLs.",
    "Confirm message/proof-thread retention and current-season workflow drainage before any future deletion.",
    "Inventory and reconfigure all bot/integration channel references, webhooks, panels, invites and voice generators before cutover.",
    "A metadata snapshot cannot restore deleted messages, threads or original channel IDs.",
  ];

  for (const key of DIVISIONS) {
    const division = config.divisions.find((d) => d.key === key);
    requireId(division.categoryId, `${key} categoryId`);
    requireValue(
      !selected.has(division.categoryId),
      "A category cannot belong to multiple divisions.",
    );
    const category = channels.get(division.categoryId);
    requireValue(
      category?.type === 4,
      `${key} category is missing or is not a category.`,
    );
    requireValue(
      category.name === division.expectedCategoryName,
      `${key} category name changed; review the scope again.`,
    );
    requireValue(
      !protectedIds.has(category.id) && !ARCHIVE_NAME.test(category.name),
      "Archive/protected categories cannot be reset.",
    );
    requireValue(
      Array.isArray(division.expectedChannelIds),
      `${key} expectedChannelIds must be an array.`,
    );
    division.expectedChannelIds.forEach((id) =>
      requireId(id, `${key} expected channel ID`),
    );
    requireValue(
      new Set(division.expectedChannelIds).size ===
        division.expectedChannelIds.length,
      `${key} has duplicate expected channel IDs.`,
    );
    const children = snapshot.channels
      .filter((c) => c.parent_id === category.id)
      .sort(
        (a, b) =>
          (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id),
      );
    const expected = new Set(division.expectedChannelIds);
    const unreviewed = children
      .filter((c) => !expected.has(c.id))
      .map((c) => c.id);
    const missing = division.expectedChannelIds.filter(
      (id) => !children.some((c) => c.id === id),
    );
    if (unreviewed.length || missing.length)
      blockers.push(
        `${key}: current children differ from the pinned inventory; review unreviewedChildIds/missingChildIds.`,
      );
    const unsupported = children.filter((c) => ![0, 2].includes(c.type));
    if (unsupported.length)
      blockers.push(
        `${key}: non-text/voice child channels require a separate retention and replacement decision.`,
      );
    selected.add(category.id);
    for (const child of children) selected.add(child.id);
    replacements.push({
      division: key,
      oldCategory: { id: category.id, name: category.name },
      oldChildren: children.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        position: c.position ?? null,
      })),
      unreviewedChildIds: unreviewed,
      missingChildIds: missing,
      proposedCategory: {
        logicalKey: `${key}/category`,
        name: division.expectedCategoryName,
        permissionProfile: "division-category-review-required",
      },
      proposedChildren: config.channelTemplate.map((c, order) => ({
        logicalKey: `${key}/${c.key}`,
        name: c.name.replaceAll("{division}", key),
        type: c.type,
        order,
        permissionProfile: c.permissionProfile,
        permissionOverwrites: null,
      })),
      oldToNewIds: children.map((c) => ({
        oldId: c.id,
        oldName: c.name,
        newId: null,
        targetLogicalKey: null,
        status: "Mapping requires review; do not guess from names.",
      })),
      routingReview: [
        {
          envName: `CHANNEL_RESULTS_${key.toUpperCase()}`,
          proposedLogicalKey: `${key}/match-report`,
        },
        {
          envName: `CHANNEL_RESCHEDULES_${key.toUpperCase()}`,
          proposedLogicalKey: `${key}/reschedules`,
        },
        {
          envName: `CHANNEL_TRADE_BLOCK_${key.toUpperCase()}`,
          proposedLogicalKey: null,
          note: "The eight-channel starter template has no trade-block. Decide whether its configured destination stays outside the division or add a reviewed replacement.",
        },
      ],
    });
  }
  const preserved = snapshot.channels
    .filter((c) => !selected.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parent_id ?? null,
      reason: "Outside the three pinned active division categories.",
    }));
  return {
    schemaVersion: 1,
    mode: "dry-run",
    executionImplemented: false,
    readyToExecute: false,
    guild: { id: snapshot.guild.id, name: snapshot.guild.name },
    nextSeason: config.nextSeason,
    capturedAt: snapshot.capturedAt,
    snapshotSha256: createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex"),
    scope:
      "Replace only the pinned active division categories and their reviewed direct children. Preserve everything else, including archives and roles.",
    totals: {
      categoriesProposedForReplacement: 3,
      existingChildren: replacements.reduce(
        (n, d) => n + d.oldChildren.length,
        0,
      ),
      proposedChildren: replacements.reduce(
        (n, d) => n + d.proposedChildren.length,
        0,
      ),
      preservedChannelsAndCategories: preserved.length,
    },
    replacements,
    preserved,
    blockers,
    limitations: [
      "Guild channel inventory excludes threads. Deleting a parent later would also destroy its message/thread content.",
      "The snapshot is sequential, not transactional. Capture a fresh inventory and recheck scope immediately before a future operation.",
      "Existing permission overwrites and personal exceptions are evidence only and are not copied into the proposed template.",
    ],
  };
}

export function renderPlan(plan) {
  const lines = [
    "# Next-season division rebuild preview",
    "",
    "**Nothing has been changed. Execution is not implemented.**",
    "",
    `Season label: ${plan.nextSeason}`,
    `Inventory captured: ${plan.capturedAt}`,
    "",
    "## What would be replaced later",
    "",
    "Only Solar, Lunar and Terra categories selected by exact ID, and their reviewed children. Other channels, categories, archives and all roles stay as they are.",
    "",
  ];
  for (const d of plan.replacements) {
    lines.push(
      `### ${d.oldCategory.name}`,
      "",
      `Existing children: ${d.oldChildren.length}. Proposed fresh children: ${d.proposedChildren.length}.`,
      "",
    );
    for (const c of d.oldChildren)
      lines.push(`- Existing: ${c.name} [${c.id}]`);
    lines.push("");
    for (const c of d.proposedChildren)
      lines.push(
        `- Proposed: ${c.name} (${c.type}); permissions still need admin review.`,
      );
    if (d.unreviewedChildIds.length || d.missingChildIds.length)
      lines.push(
        "",
        "**The current channel list does not match the pinned scope. Review before continuing.**",
      );
    lines.push("");
  }
  lines.push("## Still needed before any future reset", "");
  for (const blocker of plan.blockers) lines.push(`- ${blocker}`);
  lines.push(
    "",
    "The old messages cannot be recovered by recreating channel names. New channels get new IDs. This is not a message backup.",
    "",
  );
  return lines.join("\n");
}

export async function captureSnapshot(guildId, token, request = fetch) {
  requireId(guildId, "guild ID");
  requireValue(
    typeof token === "string" && token.length > 0,
    "Set DISCORD_TOKEN, BOT_TOKEN or DISCORD_BOT_TOKEN without printing it.",
  );
  const get = async (suffix) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await request(
        `https://discord.com/api/v10/guilds/${guildId}${suffix}`,
        {
          method: "GET",
          headers: { authorization: `Bot ${token}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.status === 429 && attempt < 2) {
        const retry = Number((await response.json()).retry_after);
        requireValue(
          Number.isFinite(retry) && retry >= 0 && retry <= 30,
          "Discord rate limit requires a later retry.",
        );
        await new Promise((r) => setTimeout(r, Math.ceil(retry * 1000)));
        continue;
      }
      requireValue(
        response.ok,
        `Discord inventory request failed: HTTP ${response.status}. No changes were made.`,
      );
      return response.json();
    }
  };
  const guild = await get("");
  requireValue(guild.id === guildId, "Discord returned a different guild.");
  const channels = await get("/channels");
  const roles = await get("/roles");
  requireValue(
    Array.isArray(channels) && Array.isArray(roles),
    "Discord inventory is incomplete.",
  );
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    guild: { id: guild.id, name: guild.name },
    channels,
    roles,
  };
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args[0] === "--help") {
    console.log(HELP);
    return;
  }
  const [command, ...rest] = args;
  requireValue(
    ["capture", "plan"].includes(command),
    "Only capture and plan are supported. Apply/delete/create execution is not implemented.",
  );
  const allowed =
    command === "capture"
      ? ["--guild", "--out"]
      : ["--config", "--snapshot", "--out"];
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    requireValue(
      allowed.includes(rest[i]) &&
        rest[i + 1] &&
        !rest[i + 1].startsWith("--") &&
        !options[rest[i]],
      "Unknown, repeated or missing option. Use --help.",
    );
    options[rest[i]] = rest[i + 1];
  }
  requireValue(
    allowed.every((k) => options[k]),
    `Required options: ${allowed.join(", ")}.`,
  );
  const out = resolve(options["--out"]);
  if (command === "capture") {
    const snapshot = await captureSnapshot(
      options["--guild"],
      process.env.DISCORD_TOKEN ||
        process.env.BOT_TOKEN ||
        process.env.DISCORD_BOT_TOKEN,
    );
    await saveJson(out, snapshot);
    console.log(
      `Read-only inventory saved to ${out}. No Discord changes were made.`,
    );
  } else {
    const config = JSON.parse(
      await readFile(resolve(options["--config"]), "utf8"),
    );
    const snapshot = JSON.parse(
      await readFile(resolve(options["--snapshot"]), "utf8"),
    );
    requireValue(
      out !== resolve(options["--config"]) &&
        out !== resolve(options["--snapshot"]),
      "Output cannot overwrite an input.",
    );
    const plan = buildPlan(config, snapshot);
    await saveJson(out, plan);
    await writeFile(`${out}.md`, renderPlan(plan), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      `Preview saved to ${out} and ${out}.md. ${plan.totals.existingChildren} existing division children reviewed. Execution remains unavailable.`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
