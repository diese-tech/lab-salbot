import type { SupabaseClient } from '../client';

export type GodDraftSessionRow = {
  id: string;
  match_id: string;
  game_number: number;
  status: string;
  draft_state?: unknown;
  matches?: {
    id: string;
    week: number;
    division_id: string;
    home_org_id: string;
    away_org_id: string;
    home_org?: { id: string; name: string; tag: string } | null;
    away_org?: { id: string; name: string; tag: string } | null;
  } | null;
};

export type GodDraftPickRow = {
  session_id: string;
  match_id: string;
  game_number: number;
  org_id: string;
  god_id: string;
  god_name: string;
  slot: number;
};

export type GodDraftBanRow = {
  session_id: string;
  match_id: string;
  game_number: number;
  org_id: string;
  god_id: string;
  god_name: string;
  slot: number;
};

export type GodDraftRecapData = {
  session: GodDraftSessionRow;
  picks: GodDraftPickRow[];
  bans: GodDraftBanRow[];
  vaultedGodNames: string[];
  seriesContinues: boolean;
};

const SESSION_FIELDS = `
  id, match_id, game_number, status, draft_state,
  matches(
    id, week, division_id, home_org_id, away_org_id,
    home_org:orgs!home_org_id(id, name, tag),
    away_org:orgs!away_org_id(id, name, tag)
  )
`;

export async function getGodDraftRecapData(
  db: SupabaseClient,
  sessionId: string,
  seriesLength = 3
): Promise<GodDraftRecapData | null> {
  const { data: session, error: sessionError } = await db
    .from('god_draft_sessions')
    .select(SESSION_FIELDS)
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) return null;

  const [pickRes, banRes] = await Promise.all([
    db
      .from('god_picks')
      .select('session_id, match_id, game_number, org_id, god_id, god_name, slot')
      .eq('session_id', sessionId)
      .order('slot'),
    db
      .from('god_bans')
      .select('session_id, match_id, game_number, org_id, god_id, god_name, slot')
      .eq('session_id', sessionId)
      .order('slot'),
  ]);

  if (pickRes.error || banRes.error) return null;

  const typedSession = session as unknown as GodDraftSessionRow;
  const picks = (pickRes.data ?? []) as GodDraftPickRow[];
  const bans = (banRes.data ?? []) as GodDraftBanRow[];

  return {
    session: typedSession,
    picks,
    bans,
    vaultedGodNames: [...new Set(picks.map((pick) => pick.god_name))],
    seriesContinues: typedSession.game_number < seriesLength,
  };
}
