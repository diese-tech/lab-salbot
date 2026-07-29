import type { SupabaseClient } from "../client";

export type ScouterSeason = {
  id: string;
  name: string;
  status: string;
  startDate: string;
};

export type ScouterReceipt = {
  id: string;
  seasonId: string;
  hostedAt: string;
  games: Array<{
    id: string;
    gameOrdinal: number;
    smiteMatchId: string | null;
    winningSide: string | null;
    scoreboardImagePath: string;
    detailsImagePath: string;
    participants: Array<{
      rawIgn: string;
      playerId: string | null;
    }>;
  }>;
};

export type PlayerScouterProfile = {
  selectedSeason: ScouterSeason | null;
  availableSeasons: ScouterSeason[];
  summary: {
    gamesPlayed: number;
    wins: number;
    losses: number;
    averageKda: number;
    averageDamage: number;
  };
};

export async function getCurrentScouterSeason(
  db: SupabaseClient,
): Promise<ScouterSeason | null> {
  const { data, error } = await db
    .from("seasons")
    .select("id, name, status, start_date")
    .in("status", ["active", "pre-season"])
    .eq("is_current", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    startDate: data.start_date,
  };
}

export async function getPlayerScouterProfile(
  db: SupabaseClient,
  playerId: string,
  requestedSeasonId?: string,
): Promise<PlayerScouterProfile> {
  const [currentSeason, participantsResult] = await Promise.all([
    getCurrentScouterSeason(db),
    db
      .from("scouter_game_participants")
      .select(
        `
        id, side, kills, deaths, assists, player_damage,
        game:scouter_games!inner(
          winning_side,
          match:scouter_matches!inner(
            season_id,
            season:seasons!inner(id, name, status, start_date)
          )
        )
      `,
      )
      .eq("player_id", playerId),
  ]);

  if (participantsResult.error) throw participantsResult.error;
  const rows = (participantsResult.data ?? []) as unknown as Array<{
    side: string;
    kills: number;
    deaths: number;
    assists: number;
    player_damage: number | null;
    game: {
      winning_side: string | null;
      match: {
        season_id: string;
        season: {
          id: string;
          name: string;
          status: string;
          start_date: string;
        };
      };
    };
  }>;

  const seasonsById = new Map<string, ScouterSeason>();
  for (const row of rows) {
    const season = row.game.match.season;
    seasonsById.set(season.id, {
      id: season.id,
      name: season.name,
      status: season.status,
      startDate: season.start_date,
    });
  }

  const availableSeasons = [...seasonsById.values()].sort((left, right) =>
    right.startDate.localeCompare(left.startDate),
  );
  const selectedSeason = requestedSeasonId
    ? (seasonsById.get(requestedSeasonId) ??
      currentSeason ??
      availableSeasons[0] ??
      null)
    : (currentSeason ?? availableSeasons[0] ?? null);
  const selectedRows = selectedSeason
    ? rows.filter((row) => row.game.match.season_id === selectedSeason.id)
    : [];

  if (selectedRows.length === 0) {
    return {
      selectedSeason,
      availableSeasons,
      summary: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        averageKda: 0,
        averageDamage: 0,
      },
    };
  }

  const wins = selectedRows.filter(
    (row) =>
      row.game.winning_side !== null && row.game.winning_side === row.side,
  ).length;
  const losses = selectedRows.filter(
    (row) =>
      row.game.winning_side !== null && row.game.winning_side !== row.side,
  ).length;
  const averageKda =
    selectedRows.reduce(
      (total, row) =>
        total + (row.kills + row.assists) / Math.max(row.deaths, 1),
      0,
    ) / selectedRows.length;
  const damageRows = selectedRows.filter((row) => row.player_damage !== null);
  const averageDamage =
    damageRows.length > 0
      ? damageRows.reduce((total, row) => total + (row.player_damage ?? 0), 0) /
        damageRows.length
      : 0;

  return {
    selectedSeason,
    availableSeasons,
    summary: {
      gamesPlayed: selectedRows.length,
      wins,
      losses,
      averageKda: Number(averageKda.toFixed(2)),
      averageDamage: Math.round(averageDamage),
    },
  };
}

export async function getScouterMatchReceipt(
  db: SupabaseClient,
  scouterMatchId: string,
): Promise<ScouterReceipt> {
  const { data, error } = await db
    .from("scouter_matches")
    .select(
      `
      id, season_id, hosted_at,
      games:scouter_games(
        id, game_ordinal, smite_match_id, winning_side,
        scoreboard_image_path, details_image_path,
        participants:scouter_game_participants(raw_ign, player_id)
      )
    `,
    )
    .eq("id", scouterMatchId)
    .single();

  if (error) throw error;
  const row = data as unknown as {
    id: string;
    season_id: string;
    hosted_at: string;
    games: Array<{
      id: string;
      game_ordinal: number;
      smite_match_id: string | null;
      winning_side: string | null;
      scoreboard_image_path: string;
      details_image_path: string;
      participants: Array<{ raw_ign: string; player_id: string | null }>;
    }>;
  };

  return {
    id: row.id,
    seasonId: row.season_id,
    hostedAt: row.hosted_at,
    games: row.games
      .map((game) => ({
        id: game.id,
        gameOrdinal: game.game_ordinal,
        smiteMatchId: game.smite_match_id,
        winningSide: game.winning_side,
        scoreboardImagePath: game.scoreboard_image_path,
        detailsImagePath: game.details_image_path,
        participants: game.participants.map((participant) => ({
          rawIgn: participant.raw_ign,
          playerId: participant.player_id,
        })),
      }))
      .sort((left, right) => left.gameOrdinal - right.gameOrdinal),
  };
}
