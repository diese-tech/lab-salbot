import {
  siteRequest,
  type SiteRequestDependencies,
} from './site-request';

export type MatchReportSiteDependencies = SiteRequestDependencies;

export class MatchReportSiteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rawResponse?: string,
  ) {
    super(message);
    this.name = 'MatchReportSiteError';
  }
}

export async function issueMatchReportHostReviewLink(
  reportId: string,
  hostDiscordId: string,
  dependencies: MatchReportSiteDependencies = {},
): Promise<{ reviewUrl: string; expiresAt: string }> {
  const configuredSiteUrl = dependencies.siteUrl ?? process.env.SAL_SITE_URL;
  const body = await siteRequest(
    `/api/internal/match-reports/${encodeURIComponent(reportId)}/host-token`,
    'POST',
    { host_discord_id: hostDiscordId },
    dependencies,
    {
      unconfigured: 'Match report review links are not configured. Ask an admin to set SAL_SITE_URL and SAL_SITE_INTERNAL_TOKEN.',
      fallback: (status) => `Match report link request failed with HTTP ${status}.`,
      create: (message, status, rawResponse) =>
        new MatchReportSiteError(message, status, rawResponse),
    },
  );

  if (!isRecord(body)
    || !isSafeReviewUrl(body.review_url, configuredSiteUrl)
    || typeof body.expires_at !== 'string'
    || !Number.isFinite(Date.parse(body.expires_at))) {
    throw new MatchReportSiteError(
      'sal-site returned an invalid match report review link.',
      502,
    );
  }
  return { reviewUrl: body.review_url, expiresAt: body.expires_at };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeReviewUrl(value: unknown, configuredSiteUrl: string | undefined): value is string {
  if (typeof value !== 'string' || !configuredSiteUrl) return false;
  try {
    const reviewUrl = new URL(value);
    const siteUrl = new URL(configuredSiteUrl);
    return (reviewUrl.protocol === 'https:' || reviewUrl.protocol === 'http:')
      && reviewUrl.origin === siteUrl.origin
      && (siteUrl.protocol !== 'https:' || reviewUrl.protocol === 'https:');
  } catch {
    return false;
  }
}
