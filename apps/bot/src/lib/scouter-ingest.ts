import { siteRequest as requestSite, type SiteRequestDependencies } from './site-request';

export type ScouterParticipant = {
  side: "order" | "chaos";
  rawIgn: string;
  godName?: string | null;
  role?: "solo" | "jungle" | "mid" | "support" | "carry" | null;
  playerLevel?: number | null;
  kills: number;
  deaths: number;
  assists: number;
  gpm?: number | null;
  playerDamage?: number | null;
  minionDamage?: number | null;
  jungleDamage?: number | null;
  structureDamage?: number | null;
  damageTaken?: number | null;
  damageMitigated?: number | null;
  selfHealing?: number | null;
  allyHealing?: number | null;
  wardsPlaced?: number | null;
};

export type ScouterGameDraft = {
  smiteMatchId: string | null;
  gameMode: string | null;
  winningSide: "order" | "chaos";
  matchLengthSeconds: number | null;
  participants: ScouterParticipant[];
};

export type ScouterIdentityDiagnostic = {
  index: number;
  side: "order" | "chaos";
  rawIgn: string;
  playerId: string | null;
  identityStatus: "linked" | "duplicate" | "unlinked" | "ambiguous";
};

export type ScouterDraftDiagnostics = {
  participantCount: number;
  duplicateIgns: string[];
  unlinkedIgns: string[];
  ambiguousIgns: string[];
  participants: ScouterIdentityDiagnostic[];
};

export type ScouterDraft = {
  draftId: string;
  revision: number;
  status: "pending" | "confirmed" | "cancelled";
  game: ScouterGameDraft;
  diagnostics: ScouterDraftDiagnostics;
  seasonId?: string;
  scouterMatchId?: string | null;
  gameOrdinal?: number;
  scoreboardImagePath?: string;
  detailsImagePath?: string;
};

export type ScouterParticipantSummary = {
  id: string;
  side: "order" | "chaos";
  rawIgn: string;
  playerId: string | null;
  godId: string | null;
  role: string | null;
  kills: number;
  deaths: number;
  assists: number;
  playerDamage: number | null;
  wardsPlaced: number | null;
};

export type ScouterConfirmResult = {
  code: "inserted" | "existing" | "already_confirmed";
  applied: boolean;
  draftId: string;
  revision: number;
  status: "confirmed";
  scouterMatchId: string;
  scouterGameId: string;
  receiptUrl: string;
  identityOverrideApplied?: boolean;
  participantsSummary?: ScouterParticipantSummary[];
};

export type ScouterExtractInput = {
  scoreboardImagePath: string;
  detailsImagePath: string;
  gameOrdinal: number;
  hostedByDiscordId: string;
  seasonId: string;
  scouterMatchId?: string;
  expectedSmiteMatchId?: string;
};

export type ScouterSiteDependencies = SiteRequestDependencies;

export class ScouterIngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rawResponse?: string,
  ) {
    super(message);
    this.name = "ScouterIngestError";
  }
}

function siteRequest(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body: Record<string, unknown> | undefined,
  dependencies: ScouterSiteDependencies,
): Promise<unknown> {
  return requestSite(path, method, body, dependencies, {
    unconfigured: 'Scouter ingestion is not configured. Ask an admin to set SAL_SITE_URL and SAL_SITE_INTERNAL_TOKEN.',
    fallback: (status) => `Scouter request failed with HTTP ${status}.`,
    create: (message, status, rawResponse) =>
      new ScouterIngestError(message, status, rawResponse),
  });
}

export async function extractScouterDraft(
  input: ScouterExtractInput,
  dependencies: ScouterSiteDependencies = {},
): Promise<ScouterDraft> {
  const body = await siteRequest(
    "/api/scouters/extract",
    "POST",
    {
      scoreboard_image_path: input.scoreboardImagePath,
      details_image_path: input.detailsImagePath,
      game_ordinal: input.gameOrdinal,
      hosted_by_discord_id: input.hostedByDiscordId,
      season_id: input.seasonId,
      ...(input.scouterMatchId
        ? { scouter_match_id: input.scouterMatchId }
        : {}),
      ...(input.expectedSmiteMatchId
        ? { expected_smite_match_id: input.expectedSmiteMatchId }
        : {}),
    },
    dependencies,
  );
  return parseDraft(body);
}

export async function getScouterDraft(
  draftId: string,
  hostedByDiscordId: string,
  dependencies: ScouterSiteDependencies = {},
): Promise<ScouterDraft> {
  const path = `/api/scouters/drafts/${encodeURIComponent(draftId)}?hosted_by_discord_id=${encodeURIComponent(hostedByDiscordId)}`;
  return parseDraft(await siteRequest(path, "GET", undefined, dependencies));
}

export async function reviseScouterDraft(
  input: {
    draftId: string;
    hostedByDiscordId: string;
    expectedRevision: number;
    game: ScouterGameDraft;
  },
  dependencies: ScouterSiteDependencies = {},
): Promise<ScouterDraft> {
  const path = `/api/scouters/drafts/${encodeURIComponent(input.draftId)}`;
  return parseDraft(
    await siteRequest(
      path,
      "PATCH",
      {
        hosted_by_discord_id: input.hostedByDiscordId,
        expected_revision: input.expectedRevision,
        game: input.game,
      },
      dependencies,
    ),
  );
}

export async function cancelScouterDraft(
  draftId: string,
  hostedByDiscordId: string,
  dependencies: ScouterSiteDependencies = {},
): Promise<{ code: "cancelled" | "already_cancelled"; applied: boolean }> {
  const path = `/api/scouters/drafts/${encodeURIComponent(draftId)}/cancel`;
  const body = await siteRequest(
    path,
    "POST",
    {
      hosted_by_discord_id: hostedByDiscordId,
    },
    dependencies,
  );
  if (
    !isRecord(body) ||
    (body.code !== "cancelled" && body.code !== "already_cancelled") ||
    typeof body.applied !== "boolean" ||
    body.status !== "cancelled"
  ) {
    throw new ScouterIngestError(
      "sal-site returned an invalid cancellation response.",
      502,
    );
  }
  return { code: body.code, applied: body.applied };
}

export async function confirmScouterDraft(
  input: {
    draftId: string;
    hostedByDiscordId: string;
    expectedRevision: number;
    identityOverrideReason?: string;
  },
  dependencies: ScouterSiteDependencies = {},
): Promise<ScouterConfirmResult> {
  const path = `/api/scouters/drafts/${encodeURIComponent(input.draftId)}/confirm`;
  const body = await siteRequest(
    path,
    "POST",
    {
      hosted_by_discord_id: input.hostedByDiscordId,
      expected_revision: input.expectedRevision,
      ...(input.identityOverrideReason
        ? { identity_override_reason: input.identityOverrideReason }
        : {}),
    },
    dependencies,
  );
  if (
    !isRecord(body) ||
    !["inserted", "existing", "already_confirmed"].includes(
      String(body.code),
    ) ||
    typeof body.applied !== "boolean" ||
    typeof body.draft_id !== "string" ||
    typeof body.revision !== "number" ||
    body.status !== "confirmed" ||
    typeof body.scouter_match_id !== "string" ||
    typeof body.scouter_game_id !== "string" ||
    typeof body.receipt_url !== "string"
  ) {
    throw new ScouterIngestError(
      "sal-site returned an invalid confirmation response.",
      502,
    );
  }
  return {
    code: body.code as ScouterConfirmResult["code"],
    applied: body.applied,
    draftId: body.draft_id,
    revision: body.revision,
    status: "confirmed",
    scouterMatchId: body.scouter_match_id,
    scouterGameId: body.scouter_game_id,
    receiptUrl: body.receipt_url,
    ...(typeof body.identity_override_applied === "boolean"
      ? { identityOverrideApplied: body.identity_override_applied }
      : {}),
    ...(Array.isArray(body.participants_summary)
      ? {
          participantsSummary:
            body.participants_summary as ScouterParticipantSummary[],
        }
      : {}),
  };
}


function parseDraft(body: unknown): ScouterDraft {
  if (
    !isRecord(body) ||
    typeof body.draft_id !== "string" ||
    typeof body.revision !== "number" ||
    !["pending", "confirmed", "cancelled"].includes(String(body.status)) ||
    !isGame(body.game) ||
    !isDiagnostics(body.diagnostics)
  ) {
    throw new ScouterIngestError(
      "sal-site returned an invalid scouter draft response.",
      502,
    );
  }
  return {
    draftId: body.draft_id,
    revision: body.revision,
    status: body.status as ScouterDraft["status"],
    game: body.game,
    diagnostics: body.diagnostics,
    ...(typeof body.season_id === "string" ? { seasonId: body.season_id } : {}),
    ...(typeof body.scouter_match_id === "string" ||
    body.scouter_match_id === null
      ? { scouterMatchId: body.scouter_match_id }
      : {}),
    ...(typeof body.game_ordinal === "number"
      ? { gameOrdinal: body.game_ordinal }
      : {}),
    ...(typeof body.scoreboard_image_path === "string"
      ? { scoreboardImagePath: body.scoreboard_image_path }
      : {}),
    ...(typeof body.details_image_path === "string"
      ? { detailsImagePath: body.details_image_path }
      : {}),
  };
}

function isGame(value: unknown): value is ScouterGameDraft {
  if (
    !isRecord(value) ||
    !Array.isArray(value.participants) ||
    value.participants.length !== 10
  )
    return false;
  if (value.winningSide !== "order" && value.winningSide !== "chaos")
    return false;
  return value.participants.every(
    (participant) =>
      isRecord(participant) &&
      (participant.side === "order" || participant.side === "chaos") &&
      typeof participant.rawIgn === "string" &&
      typeof participant.kills === "number" &&
      typeof participant.deaths === "number" &&
      typeof participant.assists === "number",
  );
}

function isDiagnostics(value: unknown): value is ScouterDraftDiagnostics {
  return (
    isRecord(value) &&
    typeof value.participantCount === "number" &&
    Array.isArray(value.duplicateIgns) &&
    Array.isArray(value.unlinkedIgns) &&
    Array.isArray(value.ambiguousIgns) &&
    Array.isArray(value.participants)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
