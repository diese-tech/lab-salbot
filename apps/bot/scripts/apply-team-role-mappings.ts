import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@salbot/db";

type Mapping = {
  divisionId: string;
  orgId: string;
  orgTag: string;
  orgName: string;
  discordRoleId: string;
};

type Artifact = {
  schemaVersion: number;
  seasonId: string;
  seasonName: string;
  reviewedAt: string;
  mappings: Mapping[];
};

const DISCORD_ROLE_ID = /^\d{17,20}$/;
const EXPECTED_DIVISIONS = ["terra", "solar", "lunar"] as const;

async function main(): Promise<void> {
  const artifactPath = resolve(
    process.argv.find((arg) => arg.endsWith(".json")) ??
      "../../config/discord-team-role-mappings/s2.json",
  );
  const apply = process.argv.includes("--apply");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Artifact;
  validateArtifact(artifact);

  console.log(
    `Validated ${artifact.mappings.length} team-role mappings for ${artifact.seasonName} (${artifact.seasonId}).`,
  );
  for (const divisionId of EXPECTED_DIVISIONS) {
    console.log(`\n${divisionId.toUpperCase()}`);
    for (const mapping of artifact.mappings.filter(
      (row) => row.divisionId === divisionId,
    )) {
      console.log(
        `${mapping.orgTag.padEnd(3)} ${mapping.orgName.padEnd(22)} <@&${mapping.discordRoleId}>`,
      );
    }
  }
  if (!apply) {
    console.log(
      "\nPreview only. Re-run with --apply after reviewing the organization names and roles.",
    );
    return;
  }

  const url = requiredEnvironment("SUPABASE_URL");
  const key = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const actorDiscordId = requiredEnvironment(
    "TEAM_ROLE_MAPPING_ACTOR_DISCORD_ID",
  );
  const db = createClient(url, key);
  const { data: season, error: seasonError } = await db
    .from("seasons")
    .select("id,name")
    .eq("id", artifact.seasonId)
    .single();
  if (seasonError || !season)
    throw seasonError ?? new Error("Season not found.");
  if (season.name !== artifact.seasonName) {
    throw new Error(
      `Season name mismatch: artifact=${artifact.seasonName}, database=${season.name}`,
    );
  }

  const { data: teams, error: teamError } = await db
    .from("season_orgs")
    .select("division_id,org_id,org:orgs!inner(name,tag)")
    .eq("season_id", artifact.seasonId);
  if (teamError) throw teamError;
  const canonicalTeams = new Map(
    (teams ?? []).map((row) => {
      const org = Array.isArray(row.org) ? row.org[0] : row.org;
      return [
        `${row.division_id}:${row.org_id}`,
        { name: org?.name, tag: org?.tag },
      ];
    }),
  );
  for (const mapping of artifact.mappings) {
    const team = canonicalTeams.get(`${mapping.divisionId}:${mapping.orgId}`);
    if (
      !team ||
      team.name !== mapping.orgName ||
      team.tag?.toUpperCase() !== mapping.orgTag.toUpperCase()
    ) {
      throw new Error(
        `Canonical organization mismatch for ${mapping.divisionId}/${mapping.orgTag} (${mapping.orgName}).`,
      );
    }
  }

  const { data, error } = await db.rpc(
    "set_season_organization_role_mappings",
    {
      p_actor_discord_id: actorDiscordId,
      p_season_id: artifact.seasonId,
      p_mappings: artifact.mappings.map((mapping) => ({
        division_id: mapping.divisionId,
        org_id: mapping.orgId,
        discord_role_id: mapping.discordRoleId,
      })),
    },
  );
  if (error) throw error;
  console.log(`\nApplied audited mappings: ${JSON.stringify(data)}`);
}

function validateArtifact(artifact: Artifact): void {
  if (
    artifact.schemaVersion !== 1 ||
    !artifact.seasonId ||
    !artifact.seasonName ||
    !Array.isArray(artifact.mappings) ||
    artifact.mappings.length !== 36
  ) {
    throw new Error(
      "Expected a schemaVersion 1 artifact with exactly 36 mappings.",
    );
  }
  const teamKeys = new Set<string>();
  const roleIds = new Set<string>();
  for (const mapping of artifact.mappings) {
    if (
      !EXPECTED_DIVISIONS.includes(
        mapping.divisionId as (typeof EXPECTED_DIVISIONS)[number],
      ) ||
      !mapping.orgId ||
      !mapping.orgTag ||
      !mapping.orgName ||
      !DISCORD_ROLE_ID.test(mapping.discordRoleId)
    ) {
      throw new Error(`Invalid mapping: ${JSON.stringify(mapping)}`);
    }
    const teamKey = `${mapping.divisionId}:${mapping.orgId}`;
    if (teamKeys.has(teamKey))
      throw new Error(`Duplicate season team: ${teamKey}`);
    if (roleIds.has(mapping.discordRoleId))
      throw new Error(`Duplicate Discord role: ${mapping.discordRoleId}`);
    teamKeys.add(teamKey);
    roleIds.add(mapping.discordRoleId);
  }
  for (const divisionId of EXPECTED_DIVISIONS) {
    const count = artifact.mappings.filter(
      (mapping) => mapping.divisionId === divisionId,
    ).length;
    if (count !== 12)
      throw new Error(
        `${divisionId} must contain exactly 12 organization mappings.`,
      );
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when --apply is used.`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
