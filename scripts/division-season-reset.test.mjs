import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildPlan,
  captureSnapshot,
  main,
  renderPlan,
} from "./division-season-reset.mjs";

const id = (n) => String(100000000000000000n + BigInt(n));
async function fixture() {
  const config = JSON.parse(
    await readFile(
      new URL("./division-season-reset.example.json", import.meta.url),
      "utf8",
    ),
  );
  config.guildId = id(1);
  config.protectedCategoryIds = [id(90)];
  const channels = [];
  config.divisions.forEach((d, i) => {
    d.categoryId = id(10 + i);
    d.expectedChannelIds = [id(20 + i)];
    channels.push({
      id: d.categoryId,
      name: d.expectedCategoryName,
      type: 4,
      parent_id: null,
    });
    channels.push({
      id: id(20 + i),
      name: "general",
      type: 0,
      parent_id: d.categoryId,
      position: i,
    });
  });
  channels.push({
    id: id(90),
    name: "Season 2 saved channels",
    type: 4,
    parent_id: null,
  });
  channels.push({ id: id(91), name: "general", type: 0, parent_id: id(90) });
  channels.push({ id: id(92), name: "Leadership", type: 4, parent_id: null });
  channels.push({ id: id(93), name: "general", type: 0, parent_id: id(92) });
  return {
    config,
    snapshot: {
      schemaVersion: 1,
      guild: { id: id(1), name: "Synthetic test guild" },
      capturedAt: "2026-01-01T00:00:00.000Z",
      channels,
      roles: [],
    },
  };
}

test("pins three division IDs while preserving archives and same-named channels elsewhere", async () => {
  const { config, snapshot } = await fixture();
  const original = JSON.stringify({ config, snapshot });
  const plan = buildPlan(config, snapshot);
  assert.equal(plan.readyToExecute, false);
  assert.equal(plan.executionImplemented, false);
  assert.equal(plan.totals.existingChildren, 3);
  assert.equal(plan.totals.proposedChildren, 24);
  assert.deepEqual(
    new Set(plan.preserved.map((c) => c.id)),
    new Set([id(90), id(91), id(92), id(93)]),
  );
  assert.equal(JSON.stringify({ config, snapshot }), original);
  assert.match(renderPlan(plan), /Nothing has been changed/);
  assert.match(plan.replacements[0].routingReview[2].note, /no trade-block/);
  assert(
    plan.replacements.every((d) =>
      d.proposedChildren.every((c) => c.permissionOverwrites === null),
    ),
  );
});

test("refuses wrong guilds, renamed categories, protected IDs and archive categories", async () => {
  const { config, snapshot } = await fixture();
  assert.throws(
    () => buildPlan({ ...config, guildId: id(2) }, snapshot),
    /different guild/,
  );
  const renamed = structuredClone(snapshot);
  renamed.channels[0].name = "Unexpected rename";
  assert.throws(() => buildPlan(config, renamed), /name changed/);
  assert.throws(
    () => buildPlan({ ...config, protectedCategoryIds: [id(10)] }, snapshot),
    /cannot be reset/,
  );
  const archive = structuredClone(config);
  archive.divisions[0].categoryId = id(90);
  archive.divisions[0].expectedCategoryName = "Season 2 saved channels";
  archive.protectedCategoryIds = [];
  assert.throws(() => buildPlan(archive, snapshot), /cannot be reset/);
});

test("reports new, moved, missing and unsupported children instead of silently accepting scope drift", async () => {
  const { config, snapshot } = await fixture();
  snapshot.channels.push({
    id: id(30),
    name: "new-channel",
    type: 15,
    parent_id: id(10),
  });
  snapshot.channels.find((c) => c.id === id(20)).parent_id = id(92);
  const plan = buildPlan(config, snapshot);
  assert.deepEqual(plan.replacements[0].unreviewedChildIds, [id(30)]);
  assert.deepEqual(plan.replacements[0].missingChildIds, [id(20)]);
  assert(plan.preserved.some((c) => c.id === id(20)));
  assert(plan.blockers.some((b) => b.includes("non-text/voice")));
  assert.equal(plan.readyToExecute, false);
});

test("rejects ambiguous IDs and malformed template entries", async () => {
  const { config, snapshot } = await fixture();
  const duplicate = structuredClone(config);
  duplicate.divisions[1].categoryId = duplicate.divisions[0].categoryId;
  assert.throws(() => buildPlan(duplicate, snapshot), /multiple divisions/);
  const template = structuredClone(config);
  template.channelTemplate[1].key = template.channelTemplate[0].key;
  assert.throws(() => buildPlan(template, snapshot), /unique/);
  assert.throws(
    () =>
      buildPlan(config, {
        ...snapshot,
        channels: [...snapshot.channels, snapshot.channels[0]],
      }),
    /Duplicate snapshot/,
  );
});

test("capture transport permits only the three inventory GET requests and never includes credentials in output", async () => {
  const calls = [];
  const snapshot = await captureSnapshot(
    id(1),
    "synthetic-secret-not-a-token",
    async (url, options) => {
      calls.push({ url, method: options.method });
      assert.equal(options.method, "GET");
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith("/channels") || url.endsWith("/roles")
            ? []
            : { id: id(1), name: "Test guild" },
      };
    },
  );
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      `https://discord.com/api/v10/guilds/${id(1)}`,
      `https://discord.com/api/v10/guilds/${id(1)}/channels`,
      `https://discord.com/api/v10/guilds/${id(1)}/roles`,
    ],
  );
  assert(!JSON.stringify(snapshot).includes("synthetic-secret"));
  await assert.rejects(
    captureSnapshot(id(1), "synthetic-secret", async () => ({
      ok: false,
      status: 403,
    })),
    /HTTP 403/,
  );
});

test("unknown and apply-like CLI modes fail before reading config or connecting to Discord", async () => {
  await assert.rejects(main(["apply", "--confirm", "yes"]), /not implemented/);
  await assert.rejects(main(["plan", "--apply", "yes"]), /Unknown/);
  await assert.rejects(main(["plan", "--config"]), /missing option/);
});
