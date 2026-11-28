import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ISOLATED_TEST_PROJECT, ISOLATED_TEST_SITE, ISOLATED_TEST_SUPABASE } from '@/lib/isolated-test-environment.mjs';

const state = vi.hoisted(() => ({
  url: 'https://rahfmpsdbwbktlobntkm.supabase.co',
  result: { data: { key: 'maintenance' } as { key: string } | null, error: null as unknown },
  read: vi.fn(),
}));
vi.mock('@/lib/supabase-client', () => ({ get SUPABASE_URL() { return state.url; } }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: (table: string) => ({ select: (column: string) => ({ eq: (key: string, value: string) => ({
    maybeSingle: async () => { state.read(table, column, key, value); return state.result; },
  }) }) }),
}) }));
import { GET } from './route';

const jwt = (role: string) => `e30.${Buffer.from(JSON.stringify({ iss: 'supabase', ref: 'rahfmpsdbwbktlobntkm', role })).toString('base64url')}.test`;
function configure() {
  vi.stubEnv('PRINTLY_ISOLATED_TEST', '1'); vi.stubEnv('NEXT_PUBLIC_PRINTLY_ISOLATED_TEST', '1'); vi.stubEnv('VERCEL_PROJECT_ID', ISOLATED_TEST_PROJECT);
  vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('NEXT_PUBLIC_SITE_URL', ISOLATED_TEST_SITE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ISOLATED_TEST_SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', jwt('anon')); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', jwt('service_role'));
}
beforeEach(() => {
  state.url = ISOLATED_TEST_SUPABASE; state.result = { data: { key: 'maintenance' }, error: null }; state.read.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('test-only server database check', () => {
  it('does not exist on the production website', async () => {
    vi.stubEnv('PRINTLY_ISOLATED_TEST', ''); vi.stubEnv('VERCEL_PROJECT_ID', 'production-project');
    const result = await GET();
    expect(result.status).toBe(404);
    expect(state.read).not.toHaveBeenCalled();
  });
  it('reads only the expected staging flag with the Node server client', async () => {
    configure();
    const result = await GET();
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(await result.json()).toEqual({ isolated_test: true, supabase_url: ISOLATED_TEST_SUPABASE, public_auth_check: 'ok', server_database_read: 'ok' });
    expect(fetch).toHaveBeenCalledWith(`${ISOLATED_TEST_SUPABASE}/auth/v1/settings`, expect.objectContaining({
      headers: { apikey: jwt('anon') }, redirect: 'error', cache: 'no-store',
    }));
    expect(state.read).toHaveBeenCalledWith('platform_settings', 'key', 'key', 'maintenance');
  });
  it('fails closed without reading when the actual server client or key disagrees', async () => {
    configure(); state.url = 'https://lgfqetnfazawglwllymb.supabase.co';
    expect((await GET()).status).toBe(503);
    state.url = ISOLATED_TEST_SUPABASE; vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', jwt('anon'));
    expect((await GET()).status).toBe(503);
    expect(state.read).not.toHaveBeenCalled();
  });
  it('refuses to claim isolation when staging rejects the public key', async () => {
    configure(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    expect((await GET()).status).toBe(503);
    expect(state.read).not.toHaveBeenCalled();
  });
  it('does not expose an upstream error or secret if the read fails', async () => {
    configure(); state.result = { data: null, error: { message: `private ${jwt('service_role')}` } };
    const result = await GET();
    expect(result.status).toBe(503);
    const text = await result.text();
    expect(text).not.toContain(jwt('service_role'));
    expect(text).not.toContain('private');
  });
});
