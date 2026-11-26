import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  target: 'isolated' as 'isolated' | 'production' | null,
  configured: true, authorized: true, tokenFails: false, claimError: false, finishError: false,
  validPayload: true, payloadError: false, payload: null as Record<string, unknown> | null,
  claims: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ name: string; args?: Record<string, unknown> }>,
  fetches: [] as Array<{ url: string; body: Record<string, unknown> }>,
  fetchStatus: 200, fetchFails: false,
  sendOutcome: 'sent' as 'sent' | 'gone' | 'retry' | 'drop',
  sent: [] as Array<{ target: string; event: unknown; campaign: unknown }>,
}));
vi.mock('@/lib/native-push-server', () => ({
  QA_FCM_PROJECT: 'printly-notifications-qa', QA_ANDROID_PACKAGE: 'io.github.dawartariq.printly.owner.native.qa',
  nativePushTarget: () => state.target,
  nativePushConfig: () => state.configured ? { credentials: {}, target: state.target, cronSecret: 'test' } : null,
  validNativePushAuthorization: () => state.authorized,
  nativePushAccessToken: async () => { state.calls.push({ name: 'token' }); if (state.tokenFails) throw new Error('not logged'); return 'not-logged-token'; },
  nativePushMessage: (delivery: { fid: string }, target: string) => state.validPayload && target === 'isolated' ? { message: { fid: delivery.fid } } : null,
  sendNativePush: async (delivery: { event_id: string; campaign: unknown }, _token: string, target: string) => {
    state.calls.push({ name: 'send' }); state.sent.push({ target, event: delivery.event_id, campaign: delivery.campaign }); return state.sendOutcome;
  },
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: async (name: string, args?: Record<string, unknown>) => {
  state.calls.push({ name, args });
  if (name === 'claim_printly_qa_v2_e320520dd717_once') return { data: state.claims, error: state.claimError ? { code: 'db' } : null };
  if (name === 'native_push_campaign_payload') return { data: state.payload, error: state.payloadError ? { code: 'db' } : null };
  if (name === 'finish_native_push_delivery_logged') return { data: args?.p_outcome, error: state.finishError ? { code: 'db' } : null };
  throw new Error('Unexpected RPC');
} }) }));
import { GET, POST } from './route';
const event = '997a24b9-9460-4565-833c-f0cfbe580f11';
const content = () => ({ title: 'Printly QA test', message: 'This is a test notification. No action is needed.', notification_type: 'general', tap_action: 'home', image_url: null });
const request = (method = 'POST', tag = 'e320520dd717') => new Request('https://printly-native-test.vercel.app/api/cron/native-qa-managed-test', {
  method, headers: { authorization: 'Bearer synthetic-test-only', 'x-printly-qa-test': tag },
});
const delivery = () => ({ event_id: event, kind: 'general', delivery_id: 'delivery', lease_token: 'lease', binding_id: 'private-binding', fid: 'private-installation', expires_at: '2099-01-01T00:00:00Z' });
beforeEach(() => {
  vi.stubEnv('PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED', '0');
  state.target = 'isolated'; state.configured = true; state.authorized = true; state.tokenFails = false;
  state.claimError = false; state.finishError = false; state.validPayload = true; state.payloadError = false; state.payload = content();
  state.claims = [delivery()]; state.calls = []; state.fetches = []; state.fetchStatus = 200; state.fetchFails = false;
  state.sendOutcome = 'sent'; state.sent = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (state.fetchFails) throw new Error('not logged');
    state.fetches.push({ url, body: JSON.parse(init.body as string) });
    return new Response(null, { status: state.fetchStatus });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('temporary single-phone managed QA dispatcher', () => {
  it('fails closed outside isolated QA, on a wrong secret, disabled config or an enabled normal worker', async () => {
    for (const run of [GET, POST]) {
      state.target = 'production'; expect((await run(request())).status).toBe(404);
      state.target = 'isolated'; state.authorized = false; expect((await run(request())).status).toBe(401);
      state.authorized = true; state.configured = false; expect((await run(request())).status).toBe(503);
      state.configured = true;
      for (const gate of ['', '1', 'true']) { vi.stubEnv('PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED', gate); expect((await run(request())).status).toBe(503); }
      vi.stubEnv('PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED', '0');
    }
    expect((await POST(request('POST', 'wrong-run'))).status).toBe(403);
    expect(state.calls).toEqual([]); expect(state.fetches).toEqual([]);
  });
  it('checks OAuth and FCM without delivering or reading the queue', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ oauth: 'ok', validation: 'ok', fcm_http_status: 200 });
    expect(state.calls.map((call) => call.name)).toEqual(['token']); expect(state.sent).toEqual([]);
    expect(state.fetches).toEqual([{ url: 'https://fcm.googleapis.com/v1/projects/printly-notifications-qa/messages:send', body: {
      validate_only: true, message: { topic: 'qa-managed-validation-e320520dd717', data: { purpose: 'isolated_qa_validate_only' },
        android: { restricted_package_name: 'io.github.dawartariq.printly.owner.native.qa' } },
    } }]);
  });
  it('does not claim when Google authorization fails', async () => {
    state.tokenFails = true; expect((await POST(request())).status).toBe(503);
    expect(state.calls.map((call) => call.name)).toEqual(['token']);
  });
  it('does not send for no delivery, multiple deliveries, wrong event, wrong kind, or a database error', async () => {
    for (const claims of [[], [delivery(), delivery()], [{ ...delivery(), event_id: 'other-event' }], [{ ...delivery(), kind: 'order' }]]) {
      state.claims = claims; expect((await POST(request())).status).toBeGreaterThanOrEqual(400); expect(state.sent).toEqual([]);
    }
    state.claims = [delivery()]; state.claimError = true; expect((await POST(request())).status).toBe(503);
    expect(state.sent).toEqual([]); expect(state.fetches).toEqual([]);
  });
  it('sends at most one fixed managed event to isolated Firebase without returning device data', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ attempted: true, fcm_result: 'sent', recorded: true });
    expect(state.fetches[0].body).toEqual({ validate_only: true, message: { fid: 'private-installation' } });
    expect(state.sent).toEqual([{ target: 'isolated', event, campaign: content() }]);
    expect(state.calls).toEqual([{ name: 'token' }, { name: 'claim_printly_qa_v2_e320520dd717_once', args: undefined },
      { name: 'native_push_campaign_payload', args: { p_delivery: 'delivery', p_lease: 'lease' } }, { name: 'send' },
      { name: 'finish_native_push_delivery_logged', args: { p_id: 'delivery', p_lease: 'lease', p_outcome: 'sent' } }]);
  });
  it('discards missing, changed, invalid, or unvalidated content without a live send', async () => {
    for (const scenario of ['missing', 'changed', 'extra', 'database', 'invalid', 'fcm']) {
      state.payload = content(); state.payloadError = false; state.validPayload = true; state.fetchStatus = 200;
      if (scenario === 'missing') state.payload = null;
      if (scenario === 'changed') state.payload = { ...content(), message: 'Different' };
      if (scenario === 'extra') state.payload = { ...content(), extra: 'unexpected' };
      if (scenario === 'database') state.payloadError = true;
      if (scenario === 'invalid') state.validPayload = false;
      if (scenario === 'fcm') state.fetchStatus = 403;
      const response = await POST(request()); expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ attempted: false, validation: 'failed', recorded: true });
      expect(state.sent).toEqual([]);
    }
    expect(state.calls.filter((call) => call.name === 'finish_native_push_delivery_logged').every((call) => call.args?.p_outcome === 'drop')).toBe(true);
  });
  it('never requeues an ambiguous send or retries when confirmation fails', async () => {
    state.sendOutcome = 'retry'; const retry = await POST(request());
    expect(retry.status).toBe(503); expect(await retry.json()).toEqual({ attempted: true, fcm_result: 'retry', recorded: true });
    expect(state.calls.at(-1)?.args?.p_outcome).toBe('drop'); expect(state.sent).toHaveLength(1);
    state.sendOutcome = 'sent'; state.finishError = true; const unconfirmed = await POST(request());
    expect(unconfirmed.status).toBe(503); expect(await unconfirmed.json()).toEqual({ attempted: true, fcm_result: 'sent', recorded: false });
    expect(state.sent).toHaveLength(2); // only because the test explicitly called POST twice
  });
});
