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

export async function getCurrentScouterSeason(
  db: SupabaseClient,
): Promise<ScouterSeason | null> {
  const { data, error } = await db
    .from("seasons")
    .select("id, name, status, start_date")
    .in("status", ["active", "pre-season"])
    .order("start_date", { ascending: false })
    .limit(1)
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
