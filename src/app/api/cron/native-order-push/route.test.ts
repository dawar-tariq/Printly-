import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: true, authorize: true, tokenFails: false, sweepFails: false, staleGone: false, payloadFails: false, payloadMissing: false,
  target: 'production' as 'production' | 'isolated', tokenCalls: 0,
  calls: [] as Array<{ name: string; args?: Record<string, unknown> }>,
  sentTargets: [] as string[],
}));
vi.mock('@/lib/native-push-server', () => ({
  nativePushConfig: () => state.config ? { credentials: {}, cronSecret: 'secret', target: state.target } : null,
  validNativePushAuthorization: () => state.authorize,
  nativePushAccessToken: async () => { state.tokenCalls++; if (state.tokenFails) throw new Error('never log this'); return 'test-token'; },
  sendNativePush: async (delivery: { kind: string }, _token: string, target: string) => {
    state.sentTargets.push(target);
    return delivery.kind === 'payment' ? 'gone' : 'sent';
  },
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: async (name: string, args?: Record<string, unknown>) => {
  state.calls.push({ name, args });
  if (name === 'enqueue_due_native_notification_campaigns') return { data: 1, error: null };
  if (name === 'claim_native_push_deliveries_budgeted') return { data: [
    { delivery_id: 'delivery-a', lease_token: 'lease-a', kind: 'order' },
    { delivery_id: 'delivery-b', lease_token: 'lease-b', kind: 'payment' },
    { delivery_id: 'delivery-c', lease_token: 'lease-c', kind: 'general' },
  ], error: null };
  if (name === 'native_push_campaign_payload') return { data: state.payloadMissing ? null : { title: 'Notice' }, error: state.payloadFails ? { message: 'failed' } : null };
  if (name === 'finish_native_push_delivery_logged') return { data: state.staleGone && args?.p_outcome === 'gone' ? 'retry' : args?.p_outcome, error: null };
  return { data: null, error: state.sweepFails ? { message: 'failed' } : null };
} }) }));
import { GET, POST } from './route';
const request = () => new Request('https://printly.test/api/cron/native-order-push', { headers: { authorization: 'Bearer test' } });
beforeEach(() => { state.config = true; state.authorize = true; state.tokenFails = false; state.sweepFails = false; state.staleGone = false; state.payloadFails = false; state.payloadMissing = false; state.target = 'production'; state.tokenCalls = 0; state.calls = []; state.sentTargets = []; vi.stubEnv('PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED', ''); });
afterEach(() => vi.unstubAllEnvs());

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
  it('blocks isolated GET and POST before OAuth or database access without the separate delivery opt-in', async () => {
    state.target = 'isolated';
    for (const value of ['', '0', 'true', ' 1']) {
      vi.stubEnv('PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED', value);
      expect((await GET(request())).status).toBe(503);
      expect((await POST(request())).status).toBe(503);
    }
    expect(state.tokenCalls).toBe(0);
    expect(state.calls).toEqual([]);
    expect(state.sentTargets).toEqual([]);
  });
  it('passes the guarded isolated target to every QA delivery only with an explicit delivery opt-in', async () => {
    state.target = 'isolated';
    vi.stubEnv('PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED', '1');
    expect((await POST(request())).status).toBe(200);
    expect(state.sentTargets).toEqual(['isolated', 'isolated', 'isolated']);
  });
  it('does not send managed content without a valid leased payload', async () => {
    state.payloadFails = true;
    expect(await (await GET(request())).json()).toMatchObject({ retried: 1, accepted: 1 });
    expect(state.sentTargets).toHaveLength(2);
    expect(state.calls).toContainEqual({ name: 'finish_native_push_delivery_logged', args: { p_id: 'delivery-c', p_lease: 'lease-c', p_outcome: 'retry' } });
    state.payloadFails = false; state.payloadMissing = true; state.sentTargets = [];
    expect(await (await GET(request())).json()).toMatchObject({ discarded: 1 });
    expect(state.sentTargets).toHaveLength(2);
  });
  it('acknowledges each lease and returns counts rather than device data', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.sentTargets).toEqual(['production', 'production', 'production']);
    expect(await response.json()).toEqual({ campaigns_queued: 1, claimed: 3, accepted: 2, retried: 0, unregistered: 1, discarded: 0, unconfirmed: 0, cleanup_ok: true });
    expect(state.calls).toContainEqual({ name: 'finish_native_push_delivery_logged', args: { p_id: 'delivery-a', p_lease: 'lease-a', p_outcome: 'sent' } });
    expect(state.calls).toContainEqual({ name: 'finish_native_push_delivery_logged', args: { p_id: 'delivery-b', p_lease: 'lease-b', p_outcome: 'gone' } });
    state.staleGone = true;
    expect(await (await GET(request())).json()).toMatchObject({ retried: 1, unregistered: 0 });
    state.sweepFails = true;
    expect((await GET(request())).status).toBe(503);
  });
});
