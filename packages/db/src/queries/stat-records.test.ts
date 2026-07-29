import { describe, expect, it } from "vitest";
import { approvePendingStatRecord } from "./stat-records";

type PendingRecord = {
  id: string;
  match_id: string;
  player_id: string;
  stats_json: Record<string, unknown> | null;
  extracted_json: Record<string, unknown>;
  status: string;
};

type FakeState = {
  pending: Map<string, PendingRecord>;
  matches: Map<string, { winner_org_id: string | null }>;
  players: Map<string, { org_id: string | null; stats?: unknown }>;
  playerStats: Map<string, Record<string, unknown>>;
};

class FakeQuery {
  private columnFilters = new Map<string, unknown>();
  private updatePayload: Record<string, unknown> | null = null;

  constructor(private readonly table: string, private readonly state: FakeState) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.columnFilters.set(column, value);
    return this;
  }

  single() {
    if (this.table === "pending_stat_records") {
      const id = this.columnFilters.get("id") as string;
      return Promise.resolve({ data: this.state.pending.get(id) ?? null, error: null });
    }
    if (this.table === "matches") {
      const id = this.columnFilters.get("id") as string;
      return Promise.resolve({ data: this.state.matches.get(id) ?? null, error: null });
    }
    if (this.table === "players") {
      const id = this.columnFilters.get("id") as string;
      return Promise.resolve({ data: this.state.players.get(id) ?? null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  upsert(payload: Record<string, unknown>) {
    if (this.table === "player_stats") {
      const key = `${payload.match_id}|${payload.player_id}|${payload.game_number}`;
      this.state.playerStats.set(key, payload);
    }
    return Promise.resolve({ error: null });
  }

  update(payload: Record<string, unknown>) {
    this.updatePayload = payload;
    return this;
  }

  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    if (this.table === "player_stats") {
      const playerId = this.columnFilters.get("player_id");
      const data = Array.from(this.state.playerStats.values()).filter((row) => row.player_id === playerId);
      return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
    }

    if (this.table === "players" && this.updatePayload) {
      const id = this.columnFilters.get("id") as string;
      const current = this.state.players.get(id) ?? { org_id: null };
      this.state.players.set(id, { ...current, ...this.updatePayload });
      return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
    }

    if (this.table === "pending_stat_records" && this.updatePayload) {
      const id = this.columnFilters.get("id") as string;
      const current = this.state.pending.get(id);
      if (current) {
        this.state.pending.set(id, { ...current, ...this.updatePayload });
      }
      return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
    }

    return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
  }
}

function makeDb(state: FakeState) {
  return {
    from: (table: string) => new FakeQuery(table, state),
  };
}

function makeState(recordOverrides: Partial<PendingRecord> = {}): FakeState {
  return {
    pending: new Map([
      [
        "pending-1",
        {
          id: "pending-1",
          match_id: "match-1",
          player_id: "player-1",
          status: "pending",
          extracted_json: {},
          stats_json: {
            game_number: 1,
            kills: 5,
            deaths: 1,
            assists: 8,
            damage_dealt: 21000,
            damage_mitigated: null,
            god_played: "Athena",
            role: "Support",
            org_id: "org-at-match-time",
          },
          ...recordOverrides,
        },
      ],
    ]),
    matches: new Map([["match-1", { winner_org_id: "org-at-match-time" }]]),
    players: new Map([["player-1", { org_id: "current-org-after-transfer" }]]),
    playerStats: new Map(),
  };
}

describe("approvePendingStatRecord", () => {
  it("computes won from the match winner and org_id captured at stat time", async () => {
    const state = makeState();

    await approvePendingStatRecord(makeDb(state) as never, "pending-1", "admin-1");

    const [row] = Array.from(state.playerStats.values());
    expect(row).toMatchObject({
      match_id: "match-1",
      player_id: "player-1",
      game_number: 1,
      won: true,
      god_played: "Athena",
    });
  });

  it("upserts concurrent approvals without duplicating the same match/player/game row", async () => {
    const state = makeState();

    await Promise.all([
      approvePendingStatRecord(makeDb(state) as never, "pending-1", "admin-1"),
      approvePendingStatRecord(makeDb(state) as never, "pending-1", "admin-2"),
    ]);

    expect(state.playerStats).toHaveLength(1);
    expect(Array.from(state.playerStats.keys())).toEqual(["match-1|player-1|1"]);
  });

  it("rejects a non-object stats JSON payload before writing player stats", async () => {
    const state = makeState({ stats_json: [] as never });

    await expect(
      approvePendingStatRecord(makeDb(state) as never, "pending-1", "admin-1"),
    ).rejects.toThrow("stats_json must be a JSON object");
    expect(state.playerStats).toHaveLength(0);
  });
});
