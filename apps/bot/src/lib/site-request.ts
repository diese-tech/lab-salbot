export type SiteFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type SiteFetchImplementation = (
  input: URL,
  init: {
    method: 'GET' | 'POST' | 'PATCH';
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<SiteFetchResponse>;

export type SiteRequestDependencies = {
  siteUrl?: string;
  token?: string;
  fetchImpl?: SiteFetchImplementation;
};

export type SiteRequestErrorFactory = (
  message: string,
  status: number,
  rawResponse?: string,
) => Error;

const REQUEST_TIMEOUT_MS = 90_000;

export async function siteRequest(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body: Record<string, unknown> | undefined,
  dependencies: SiteRequestDependencies,
  errors: {
    unconfigured: string;
    fallback: (status: number) => string;
    create: SiteRequestErrorFactory;
  },
): Promise<unknown> {
  const siteUrl = dependencies.siteUrl ?? process.env.SAL_SITE_URL;
  const token = dependencies.token ?? process.env.SAL_SITE_INTERNAL_TOKEN;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  if (!siteUrl || !token) {
    throw errors.create(errors.unconfigured, 503);
  }

  let response: SiteFetchResponse;
  try {
    response = await fetchImpl(new URL(path, siteUrl), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw errors.create(
      `Could not reach sal-site: ${error instanceof Error ? error.message : String(error)}`,
      503,
    );
  }

  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(responseBody) && typeof responseBody.error === 'string'
      ? responseBody.error
      : errors.fallback(response.status);
    const rawResponse = isRecord(responseBody)
      && typeof responseBody.raw_response === 'string'
      ? responseBody.raw_response
      : undefined;
    throw errors.create(message, response.status, rawResponse);
  }
  return responseBody;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
