import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ isolated: true, hostAllowed: true, authorized: true, rpcCalls: 0, source: '', rpcError: false }));
vi.mock('@/lib/isolated-test-environment.mjs', () => ({ isolatedTestRequestAllowed: () => state.hostAllowed }));
vi.mock('@/lib/native-push-server', () => ({ nativePushTarget: () => state.isolated ? 'isolated' : 'production', validNativePushAuthorization: () => state.authorized }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: async (name: string, args: { p_sql: string }) => {
  state.rpcCalls++; state.source = args.p_sql;
  if (name !== 'stage_native_qa_0027_f4f04e902c' || state.rpcError) return { data: null, error: { message: 'private' } };
  return { data: true, error: null };
} }) }));
import { POST } from './route';
const request = () => new Request('https://printly-native-test.vercel.app/api/native/v1/qa-migration-source', { method: 'POST', headers: { host: 'printly-native-test.vercel.app' } });
beforeEach(() => { state.isolated = true; state.hostAllowed = true; state.authorized = true; state.rpcCalls = 0; state.source = ''; state.rpcError = false; });
afterEach(() => vi.unstubAllEnvs());

describe('temporary isolated source transport', () => {
  it('rejects the wrong environment, host and authorization before staging anything', async () => {
    state.isolated = false; expect((await POST(request())).status).toBe(404);
    state.isolated = true; state.hostAllowed = false; expect((await POST(request())).status).toBe(404);
    state.hostAllowed = true; state.authorized = false; expect((await POST(request())).status).toBe(401);
    expect(state.rpcCalls).toBe(0);
  });
  it('stores only the exact reviewed source and exposes no SQL or backend error to the caller', async () => {
    const ok = await POST(request());
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ staged: true });
    expect(state.source).toContain('create table public.native_notification_campaigns');
    expect(state.rpcCalls).toBe(1);
    state.rpcError = true;
    const failure = await POST(request());
    expect(failure.status).toBe(503);
    expect(JSON.stringify(await failure.json())).not.toContain('private');
  });
});
