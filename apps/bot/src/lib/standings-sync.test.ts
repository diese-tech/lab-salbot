import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerStandingsRecalculation } from './standings-sync';

describe('triggerStandingsRecalculation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('warns and skips when SAL_SITE_URL/SAL_SITE_INTERNAL_TOKEN are not configured', async () => {
    delete process.env.SAL_SITE_URL;
    delete process.env.SAL_SITE_INTERNAL_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await triggerStandingsRecalculation();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('calls the site endpoint with a bearer token when configured', async () => {
    process.env.SAL_SITE_URL = 'https://sal.example.com';
    process.env.SAL_SITE_INTERNAL_TOKEN = 'test-token';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchSpy);

    await triggerStandingsRecalculation();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://sal.example.com/api/admin/recalculate-standings');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('logs but does not throw when the site request fails', async () => {
    process.env.SAL_SITE_URL = 'https://sal.example.com';
    process.env.SAL_SITE_INTERNAL_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(triggerStandingsRecalculation()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs but does not throw when fetch itself rejects (site unreachable)', async () => {
    process.env.SAL_SITE_URL = 'https://sal.example.com';
    process.env.SAL_SITE_INTERNAL_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(triggerStandingsRecalculation()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
