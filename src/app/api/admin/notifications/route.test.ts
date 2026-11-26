import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'admin', signedIn: true, allowed: true, calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  verify: 'ok' as 'ok' | 'fingerprint' | 'asset' | 'unavailable', verifyCalls: 0, revision: 2,
  pushTarget: null as null | 'production' | 'isolated',
  replays: [] as Array<Record<string, unknown> | null>, replayError: null as { message: string } | null }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), getSessionProfile: async () => state.signedIn ? ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, profile: { role: state.role } }) : null }));
vi.mock('@/lib/native-push-server', () => ({ nativePushConfig: () => state.pushTarget ? { target: state.pushTarget } : null }));
vi.mock('@/lib/native-app-update-server', () => ({ verifyGithubReleaseAsset: async () => { state.verifyCalls++; return state.verify; } }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    if (name === 'consume_public_rate_limit') return { data: { allowed: state.allowed, retry_after: 60 }, error: null };
    if (name === 'admin_native_notification_overview') return { data: { registered_devices: 2 }, error: null };
    if (name === 'queue_native_notification_campaign' && args.p_scheduled_at === '2000-01-01T00:00:00Z') return { data: null, error: { message: 'INVALID_SCHEDULE' } };
    if (name === 'native_app_release_request_result') return { data: state.replays.shift() ?? null, error: state.replayError };
    return { data: { id: '11111111-1111-4111-8111-111111111111', revision: 0 }, error: null };
  },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { revision: state.revision, apk_url: 'https://github.com/dawar-tariq/Printly-/releases/download/v1/app.apk', apk_sha256: 'a'.repeat(64), certificate_sha256: 'b'.repeat(64) }, error: null }) }) }) }),
}) }));
import { GET, POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const campaign = { title: 'Notice', message: 'Hello shops', notification_type: 'general', tap_action: 'home', image_url: null,
  audience_kind: 'all', shop_ids: [], device_ids: [], target_version: null };
const request = (body: unknown) => new Request('https://printly.test/api/admin/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = () => new Request('https://printly.test/api/admin/notifications?view=overview');
beforeEach(() => { state.role = 'admin'; state.signedIn = true; state.allowed = true; state.calls = []; state.verify = 'ok'; state.verifyCalls = 0; state.revision = 2; state.pushTarget = null; state.replays = []; state.replayError = null; vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only-test-key'); vi.stubEnv('PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED', '1'); vi.stubEnv('PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED', ''); });
afterEach(() => vi.unstubAllEnvs());

describe('native notification admin API', () => {
  it('requires a verified admin before reading or writing', async () => {
    state.signedIn = false; expect((await GET(get())).status).toBe(403);
    state.signedIn = true; state.role = 'shop_staff';
    expect((await GET(get())).status).toBe(403);
    expect((await POST(request({ action: 'preview', campaign }))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it('returns actual overview RPC results with private no-store headers', async () => {
    const response = await GET(get());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ registered_devices: 2, worker_configured: false, release_manager_enabled: true });
    expect(state.calls[0]).toEqual({ name: 'admin_native_notification_overview', args: { p_actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  });
  it('reports the isolated worker disabled even when its registration credentials exist', async () => {
    state.pushTarget = 'isolated';
    expect(await (await GET(get())).json()).toMatchObject({ worker_configured: false });
    vi.stubEnv('PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED', '1');
    expect(await (await GET(get())).json()).toMatchObject({ worker_configured: true });
    state.pushTarget = 'production'; vi.stubEnv('PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED', '');
    expect(await (await GET(get())).json()).toMatchObject({ worker_configured: true });
  });
  it('validates recipients, actions, content and extra fields before a write', async () => {
    for (const value of [
      { ...campaign, title: '' }, { ...campaign, tap_action: 'https://evil.example' },
      { ...campaign, image_url: 'http://127.0.0.1/image.png' }, { ...campaign, audience_kind: 'shops', shop_ids: [] },
      { ...campaign, audience_kind: 'all', shop_ids: [id] }, { ...campaign, target_version: 2 },
      { ...campaign, user_id: id },
    ]) expect((await POST(request({ action: 'save_campaign', id, revision: null, campaign: value }))).status).toBe(422);
    expect(state.calls).toEqual([]);
  });
  it('uses the authenticated actor, bounded rate limit and valid schedules', async () => {
    const response = await POST(request({ action: 'save_campaign', id, revision: null, campaign }));
    expect(response.status).toBe(200);
    expect(state.calls.find((call) => call.name === 'save_native_notification_campaign')).toMatchObject({ args: { p_actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_id: id, p_input: campaign } });
    state.allowed = false;
    expect((await POST(request({ action: 'queue', id, revision: 0, request_id: requestId, scheduled_at: null }))).status).toBe(429);
    expect(state.calls.some((call) => call.name === 'queue_native_notification_campaign')).toBe(false);
    state.allowed = true;
    expect((await POST(request({ action: 'queue', id, revision: 0, request_id: requestId, scheduled_at: '2000-01-01T00:00:00Z' }))).status).toBe(422);
  });
  it('acknowledges a previously committed release action without publishing it again', async () => {
    const action = { action: 'activate_release', id, revision: 2, request_id: requestId, notify: true, verification_confirmed: true };
    state.revision = 3; state.verify = 'unavailable';
    state.replays = [{ ok: true, replayed: true, campaign_id: id }];
    const response = await POST(request(action));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { replayed: true, campaign_id: id } });
    expect(state.verifyCalls).toBe(0);
    expect(state.calls.some((call) => call.name === 'change_native_app_release')).toBe(false);

    // Also catch a commit occurring between the initial replay and version reads.
    state.replays = [null, { ok: true, replayed: true, campaign_id: id }]; state.calls = [];
    expect((await POST(request(action))).status).toBe(200);
    expect(state.calls.filter((call) => call.name === 'native_app_release_request_result')).toHaveLength(2);
    expect(state.verifyCalls).toBe(0);
    state.replayError = { message: 'NOTIFICATION_REQUEST_CONFLICT' };
    expect((await POST(request({ ...action, notify: false }))).status).toBe(409);
  });
  it('requires explicit APK review, the enabled feed, a matched signer and GitHub asset before publishing', async () => {
    const action = { action: 'publish_release', id, revision: 2, request_id: requestId, notify: false, verification_confirmed: false };
    expect((await POST(request(action))).status).toBe(422);
    state.verify = 'fingerprint'; expect((await POST(request({ ...action, verification_confirmed: true }))).status).toBe(422);
    state.verify = 'asset'; expect((await POST(request({ ...action, verification_confirmed: true }))).status).toBe(422);
    state.verify = 'unavailable'; expect((await POST(request({ ...action, verification_confirmed: true }))).status).toBe(503);
    state.verify = 'ok'; vi.stubEnv('PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED', '0');
    expect((await POST(request({ ...action, verification_confirmed: true }))).status).toBe(503);
    vi.stubEnv('PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED', '1');
    expect((await POST(request({ ...action, verification_confirmed: true }))).status).toBe(200);
    expect(state.calls.find((call) => call.name === 'change_native_app_release')).toMatchObject({ args: { p_action: 'publish', p_notify: false, p_actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    expect((await POST(request({ ...action, verification_confirmed: true, notify: true }))).status).toBe(422);
  });
});
