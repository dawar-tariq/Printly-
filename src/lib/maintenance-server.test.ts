import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maintenancePageResponse, readMaintenanceState } from './maintenance-server';
import { PRINTLY_MARK_PATH, PRINTLY_WORDMARK_PATH } from './brand';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-test-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('maintenance notice branding', () => {
  it('renders the selected logo inline even when external assets are unavailable', async () => {
    const response = maintenancePageResponse('on');
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(html).toContain('role="img" aria-label="Printly"');
    expect(html).toContain(PRINTLY_MARK_PATH);
    expect(html).toContain(PRINTLY_WORDMARK_PATH);
    expect(html).not.toContain('<img');
  });
});

describe('maintenance setting lookup', () => {
  it.each([
    [true, 'on'], [false, 'off'], ['true', 'on'], ['false', 'off'],
  ])('reads the uncached boolean flag %s as %s', async (value, expected) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ value }]));
    vi.stubGlobal('fetch', fetcher);
    expect(await readMaintenanceState()).toBe(expected);
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe('https://supabase.example.test');
    expect(url.pathname).toBe('/rest/v1/platform_settings');
    expect(url.searchParams.get('select')).toBe('value');
    expect(url.searchParams.get('key')).toBe('eq.maintenance');
    expect(options.cache).toBe('no-store');
    expect(options.headers).toMatchObject({ apikey: 'private-test-key', Authorization: 'Bearer private-test-key' });
  });

  it('fails closed for missing credentials, failed requests and malformed values', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(await readMaintenanceState()).toBe('unknown');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-test-key');
    for (const body of [[], [{ value: null }], [{ value: 'yes' }], [{ value: 0 }], [{ value: false }, { value: true }], {}]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
      expect(await readMaintenanceState()).toBe('unknown');
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
    expect(await readMaintenanceState()).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')));
    expect(await readMaintenanceState()).toBe('unknown');
  });

  it('times out an unresponsive settings service', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const result = readMaintenanceState();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await result).toBe('unknown');
  });
});
