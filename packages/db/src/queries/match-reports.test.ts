import { describe, expect, it, vi } from 'vitest';
import {
  createMatchResultActionWithReport,
  ensureMatchReportForPendingAction,
} from './match-reports';

describe('match report workflow queries', () => {
  it('atomically creates the match-result action and canonical report', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        code: 'created',
        created: true,
        actionId: 'action-1',
        pendingActionId: 'action-1',
        reportId: 'report-1',
        matchId: 'match-1',
        hostDiscordId: 'host-1',
        status: 'pending',
        revision: 0,
      },
      error: null,
    });
    const payload = {
      winnerOrgId: 'org-home',
      score: '2-1',
      parsed: {
        winnerGames: 2,
        loserGames: 1,
        gamesPlayed: 3,
        expectedScreenshots: 3,
      },
    };

    await expect(
      createMatchResultActionWithReport(
        { rpc } as never,
        'match-1',
        'host-1',
        payload,
      ),
    ).resolves.toMatchObject({
      code: 'created',
      actionId: 'action-1',
      reportId: 'report-1',
    });

    expect(rpc).toHaveBeenCalledWith('create_match_result_action_with_report', {
      p_match_id: 'match-1',
      p_host_discord_id: 'host-1',
      p_payload: payload,
    });
  });

  it('creates or retrieves the canonical report linked to a pending action', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        code: 'created',
        created: true,
        reportId: 'report-1',
        pendingActionId: 'action-1',
        matchId: 'match-1',
        hostDiscordId: 'host-1',
        status: 'pending',
        revision: 0,
      },
      error: null,
    });

    await expect(
      ensureMatchReportForPendingAction({ rpc } as never, 'action-1', 'host-1'),
    ).resolves.toEqual({
      code: 'created',
      created: true,
      reportId: 'report-1',
      pendingActionId: 'action-1',
      matchId: 'match-1',
      hostDiscordId: 'host-1',
      status: 'pending',
      revision: 0,
    });

    expect(rpc).toHaveBeenCalledWith('ensure_match_report_for_pending_action', {
      p_pending_action_id: 'action-1',
      p_host_discord_id: 'host-1',
    });
  });

  it('rejects malformed results instead of inventing a report identity', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { code: 'created' }, error: null });

    await expect(
      ensureMatchReportForPendingAction({ rpc } as never, 'action-1', 'host-1'),
    ).rejects.toThrow('invalid match report result');
  });

  it('rejects an inconsistent atomic action/report identity', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        code: 'existing',
        created: false,
        actionId: 'action-1',
        pendingActionId: 'different-action',
        reportId: 'report-1',
        matchId: 'match-1',
        hostDiscordId: 'host-1',
        status: 'pending',
        revision: 0,
      },
      error: null,
    });

    await expect(createMatchResultActionWithReport(
      { rpc } as never,
      'match-1',
      'host-1',
      { winnerOrgId: 'org-home', score: '2-1', parsed: { winnerGames: 2, loserGames: 1, gamesPlayed: 3, expectedScreenshots: 3 } },
    )).rejects.toThrow('invalid atomic match-result action');
  });
});
