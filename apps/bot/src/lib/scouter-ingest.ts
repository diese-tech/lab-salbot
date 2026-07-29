export type ScouterParticipantSummary = {
  id: string;
  side: "order" | "chaos";
  rawIgn: string;
  playerId: string | null;
  godId?: string | null;
  role?: string | null;
  kills?: number;
  deaths?: number;
  assists?: number;
  playerDamage?: number | null;
  wardsPlaced?: number | null;
};

export type ScouterIngestInput = {
  scoreboardImagePath: string;
  detailsImagePath: string;
  gameOrdinal: number;
  hostedByDiscordId: string;
  seasonId: string;
  scouterMatchId?: string;
  expectedSmiteMatchId?: string;
};

export type ScouterIngestResult =
  | {
      code: "inserted";
      scouterMatchId: string;
      scouterGameId: string;
      receiptUrl: string;
      participantsSummary: ScouterParticipantSummary[];
    }
  | {
      code: "existing";
      existingScouterGameId: string;
      receiptUrl: string;
    };

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type FetchImplementation = (
  input: URL,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<FetchResponse>;

type ScouterIngestDependencies = {
  siteUrl?: string;
  token?: string;
  fetchImpl?: FetchImplementation;
};

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

const REQUEST_TIMEOUT_MS = 90_000;

export async function submitScouterGame(
  input: ScouterIngestInput,
  dependencies: ScouterIngestDependencies = {},
): Promise<ScouterIngestResult> {
  const siteUrl = dependencies.siteUrl ?? process.env.SAL_SITE_URL;
  const token = dependencies.token ?? process.env.SAL_SITE_INTERNAL_TOKEN;
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  if (!siteUrl || !token) {
    throw new ScouterIngestError(
      "Scouter ingestion is not configured. Ask an admin to set SAL_SITE_URL and SAL_SITE_INTERNAL_TOKEN.",
      503,
    );
  }

  let response: FetchResponse;
  try {
    response = await fetchImpl(new URL("/api/scouters/ingest", siteUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ScouterIngestError(
      `Could not reach sal-site for OCR: ${error instanceof Error ? error.message : String(error)}`,
      503,
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Scouter ingestion failed with HTTP ${response.status}.`;
    const rawResponse =
      isRecord(body) && typeof body.raw_response === "string"
        ? body.raw_response
        : undefined;
    throw new ScouterIngestError(error, response.status, rawResponse);
  }

  if (
    isRecord(body) &&
    typeof body.existing_scouter_game_id === "string" &&
    typeof body.receipt_url === "string"
  ) {
    return {
      code: "existing",
      existingScouterGameId: body.existing_scouter_game_id,
      receiptUrl: body.receipt_url,
    };
  }

  if (
    !isRecord(body) ||
    typeof body.scouter_match_id !== "string" ||
    typeof body.scouter_game_id !== "string" ||
    typeof body.receipt_url !== "string" ||
    !Array.isArray(body.participants_summary)
  ) {
    throw new ScouterIngestError(
      "sal-site returned an invalid scouter response.",
      502,
    );
  }

  return {
    code: "inserted",
    scouterMatchId: body.scouter_match_id,
    scouterGameId: body.scouter_game_id,
    receiptUrl: body.receipt_url,
    participantsSummary:
      body.participants_summary as ScouterParticipantSummary[],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
