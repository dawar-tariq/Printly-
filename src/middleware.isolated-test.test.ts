import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ISOLATED_TEST_PROJECT, ISOLATED_TEST_SITE, ISOLATED_TEST_SUPABASE } from '@/lib/isolated-test-environment.mjs';

const readMaintenance = vi.hoisted(() => vi.fn(async () => 'off'));
vi.mock('@/lib/maintenance-server', () => ({
  readMaintenanceState: readMaintenance,
  maintenanceApiResponse: vi.fn(), maintenancePageResponse: vi.fn(), maintenanceStatusResponse: vi.fn(),
}));
import { middleware } from './middleware';

const jwt = (role: string) => `e30.${Buffer.from(JSON.stringify({ iss: 'supabase', ref: 'rahfmpsdbwbktlobntkm', role })).toString('base64url')}.test`;
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function configureTest() {
  vi.stubEnv('PRINTLY_ISOLATED_TEST', '1');
  vi.stubEnv('NEXT_PUBLIC_PRINTLY_ISOLATED_TEST', '1');
  vi.stubEnv('VERCEL_PROJECT_ID', ISOLATED_TEST_PROJECT);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', ISOLATED_TEST_SITE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ISOLATED_TEST_SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', jwt('anon'));
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', jwt('service_role'));
}
const request = (origin: string, path = '/api/native/v1/config') => new NextRequest(`${origin}${path}`);

describe('isolated test middleware boundary', () => {
  it('blocks a mismatched database before any maintenance or auth query', async () => {
    configureTest();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://lgfqetnfazawglwllymb.supabase.co');
    const response = await middleware(request(ISOLATED_TEST_SITE));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect((await response.json()).error.code).toBe('test_environment_unavailable');
    expect(readMaintenance).not.toHaveBeenCalled();
  });

  it('fails closed for missing marker or mismatched private key, including admin paths', async () => {
    configureTest(); vi.stubEnv('PRINTLY_ISOLATED_TEST', '');
    expect((await middleware(request(ISOLATED_TEST_SITE))).status).toBe(503);
    configureTest(); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', jwt('anon'));
    const response = await middleware(request(ISOLATED_TEST_SITE, '/api/admin/settings'));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(jwt('anon'));
    expect(readMaintenance).not.toHaveBeenCalled();
  });

  it('blocks a configured Dropbox integration before backend access', async () => {
    configureTest(); vi.stubEnv('NEXT_PUBLIC_DROPBOX_APP_KEY', 'not-a-real-key');
    expect((await middleware(request(ISOLATED_TEST_SITE))).status).toBe(503);
    expect(readMaintenance).not.toHaveBeenCalled();
  });

  it('permits a correctly configured test host and ordinary production host', async () => {
    configureTest();
    expect((await middleware(request(ISOLATED_TEST_SITE))).headers.get('x-middleware-next')).toBe('1');
    expect(readMaintenance).toHaveBeenCalledTimes(1);
    vi.stubEnv('PRINTLY_ISOLATED_TEST', ''); vi.stubEnv('NEXT_PUBLIC_PRINTLY_ISOLATED_TEST', ''); vi.stubEnv('VERCEL_PROJECT_ID', 'production-project');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly-steel-three.vercel.app');
    expect((await middleware(request('https://printly-steel-three.vercel.app'))).headers.get('x-middleware-next')).toBe('1');
  });
});
