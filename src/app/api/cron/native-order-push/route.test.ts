import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: true, authorize: true, tokenFails: false, sweepFails: false, staleGone: false,
  target: 'production' as 'production' | 'isolated',
  calls: [] as Array<{ name: string; args?: Record<string, unknown> }>,
  sentTargets: [] as string[],
}));
vi.mock('@/lib/native-push-server', () => ({
  nativePushConfig: () => state.config ? { credentials: {}, cronSecret: 'secret', target: state.target } : null,
  validNativePushAuthorization: () => state.authorize,
  nativePushAccessToken: async () => { if (state.tokenFails) throw new Error('never log this'); return 'test-token'; },
  sendNativePush: async (delivery: { kind: string }, _token: string, target: string) => {
    state.sentTargets.push(target);
    return delivery.kind === 'order' ? 'sent' : 'gone';
  },
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: async (name: string, args?: Record<string, unknown>) => {
  state.calls.push({ name, args });
  if (name === 'claim_native_push_deliveries') return { data: [
    { delivery_id: 'delivery-a', lease_token: 'lease-a', kind: 'order' },
    { delivery_id: 'delivery-b', lease_token: 'lease-b', kind: 'payment' },
  ], error: null };
  if (name === 'finish_native_push_delivery') return { data: state.staleGone && args?.p_outcome === 'gone' ? 'retry' : args?.p_outcome, error: null };
  return { data: null, error: state.sweepFails ? { message: 'failed' } : null };
} }) }));
import { GET, POST } from './route';
const request = () => new Request('https://printly.test/api/cron/native-order-push', { headers: { authorization: 'Bearer test' } });
beforeEach(() => { state.config = true; state.authorize = true; state.tokenFails = false; state.sweepFails = false; state.staleGone = false; state.target = 'production'; state.calls = []; state.sentTargets = []; });

describe('private native notification worker', () => {
  it('does not access credentials or queue for unauthorized callers', async () => {
    state.authorize = false;
    expect((await GET(request())).status).toBe(401); expect(state.calls).toEqual([]);
    state.authorize = true; state.config = false;
    expect((await GET(request())).status).toBe(503); expect(state.calls).toEqual([]);
  });
  it('does not claim deliveries if OAuth is unavailable', async () => {
    state.tokenFails = true;
    expect((await GET(request())).status).toBe(503); expect(state.calls).toEqual([]);
  });
  it('passes the guarded isolated target to every QA delivery', async () => {
    state.target = 'isolated';
    expect((await POST(request())).status).toBe(200);
    expect(state.sentTargets).toEqual(['isolated', 'isolated']);
  });
  it('acknowledges each lease and returns counts rather than device data', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.sentTargets).toEqual(['production', 'production']);
    expect(await response.json()).toEqual({ claimed: 2, accepted: 1, retried: 0, unregistered: 1, discarded: 0, unconfirmed: 0, cleanup_ok: true });
    expect(state.calls).toContainEqual({ name: 'finish_native_push_delivery', args: { p_id: 'delivery-a', p_lease: 'lease-a', p_outcome: 'sent' } });
    expect(state.calls).toContainEqual({ name: 'finish_native_push_delivery', args: { p_id: 'delivery-b', p_lease: 'lease-b', p_outcome: 'gone' } });
    state.staleGone = true;
    expect(await (await GET(request())).json()).toMatchObject({ retried: 1, unregistered: 0 });
    state.sweepFails = true;
    expect((await GET(request())).status).toBe(503);
  });
});
