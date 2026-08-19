import { describe, expect, it, vi } from 'vitest';
import {
  issueMatchReportHostReviewLink,
  MatchReportSiteError,
  type MatchReportSiteDependencies,
} from './match-report-site';

function dependencies(fetchImpl: ReturnType<typeof vi.fn>): MatchReportSiteDependencies {
  return {
    siteUrl: 'https://sal.example',
    token: 'internal-token',
    fetchImpl: fetchImpl as MatchReportSiteDependencies['fetchImpl'],
  };
}

describe('match report host-link transport', () => {
  it('issues a host-bound review link through the internal sal-site boundary', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({
      review_url: 'https://sal.example/match-reports/report-1/review#token=secret',
      expires_at: '2026-08-19T01:02:03.000Z',
    }));

    await expect(
      issueMatchReportHostReviewLink('report/unsafe', 'discord-host', dependencies(fetchImpl)),
    ).resolves.toEqual({
      reviewUrl: 'https://sal.example/match-reports/report-1/review#token=secret',
      expiresAt: '2026-08-19T01:02:03.000Z',
    });

    const [url, request] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      'https://sal.example/api/internal/match-reports/report%2Funsafe/host-token',
    );
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer internal-token',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(String(request.body))).toEqual({
      host_discord_id: 'discord-host',
    });
  });

  it('rejects malformed responses instead of sending an unusable link', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ review_url: '/relative' }));

    await expect(
      issueMatchReportHostReviewLink('report-1', 'discord-host', dependencies(fetchImpl)),
    ).rejects.toBeInstanceOf(MatchReportSiteError);
  });

  it('rejects a review link that escapes the configured sal-site origin', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({
      review_url: 'https://phishing.example/match-reports/report-1/review#token=secret',
      expires_at: '2026-08-19T01:02:03.000Z',
    }));

    await expect(
      issueMatchReportHostReviewLink('report-1', 'discord-host', dependencies(fetchImpl)),
    ).rejects.toMatchObject({
      name: 'MatchReportSiteError',
      status: 502,
    });
  });

  it('rejects an HTTP downgrade when sal-site is configured with HTTPS', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({
      review_url: 'http://sal.example/match-reports/report-1/review#token=secret',
      expires_at: '2026-08-19T01:02:03.000Z',
    }));

    await expect(
      issueMatchReportHostReviewLink('report-1', 'discord-host', dependencies(fetchImpl)),
    ).rejects.toBeInstanceOf(MatchReportSiteError);
  });
});

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
