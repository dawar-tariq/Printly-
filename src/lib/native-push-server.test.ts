import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_ANDROID_PACKAGE, NATIVE_FCM_PROJECT, QA_ANDROID_PACKAGE, QA_FCM_PROJECT,
  nativePushAccessToken, nativePushConfig, nativePushMessage, nativePushTarget, sendNativePush,
  validNativePushAuthorization, type NativePushDelivery, type NativePushTarget,
} from './native-push-server';
import { ISOLATED_TEST_PROJECT, ISOLATED_TEST_SITE, ISOLATED_TEST_SUPABASE } from './isolated-test-environment.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  type: 'service_account', project_id: NATIVE_FCM_PROJECT, client_email: 'notifications@printly-5c247.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), token_uri: 'https://oauth2.googleapis.com/token',
};
const qaAccount = { ...account, project_id: QA_FCM_PROJECT, client_email: `notifications@${QA_FCM_PROJECT}.iam.gserviceaccount.com` };
const secret = 's'.repeat(48);
const delivery: NativePushDelivery = {
  delivery_id: '11111111-1111-4111-8111-111111111111', lease_token: '22222222-2222-4222-8222-222222222222',
  event_id: '33333333-3333-4333-8333-333333333333', binding_id: '44444444-4444-4444-8444-444444444444',
  fid: 'A'.repeat(22), kind: 'payment', expires_at: new Date(Date.now() + 120_000).toISOString(),
};
// These are non-working placeholders; the guard verifies types, not key ownership.
const isolatedEnv = {
  PRINTLY_ISOLATED_TEST: '1', NEXT_PUBLIC_PRINTLY_ISOLATED_TEST: '1',
  VERCEL_PROJECT_ID: ISOLATED_TEST_PROJECT, VERCEL_ENV: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'printly-native-test.vercel.app',
  NEXT_PUBLIC_SITE_URL: ISOLATED_TEST_SITE, NEXT_PUBLIC_SUPABASE_URL: ISOLATED_TEST_SUPABASE,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: `sb_publishable_${'a'.repeat(32)}`,
  SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'b'.repeat(32)}`,
};
function stubEnvironment(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}
function configure(value: unknown = account) {
  vi.stubEnv('PRINTLY_NATIVE_PUSH_ENABLED', '1');
  vi.stubEnv('PRINTLY_NATIVE_PUSH_CRON_SECRET', secret);
  vi.stubEnv('PRINTLY_FCM_SERVICE_ACCOUNT_JSON', JSON.stringify(value));
}
beforeEach(() => {
  // Do not let a developer's ambient staging settings change these fixtures.
  stubEnvironment(Object.fromEntries(Object.keys(isolatedEnv).map((key) => [key, ''])));
  stubEnvironment({ PRINTLY_REDIS_REST_URL: '', PRINTLY_REDIS_REST_TOKEN: '', NEXT_PUBLIC_DROPBOX_APP_KEY: '', PRINTLY_ANDROID_APK_URL: '' });
});
afterEach(() => vi.unstubAllEnvs());

describe('native FCM sender', () => {
  it('fails closed without an enabled and correctly scoped service account and worker secret', () => {
    configure(); expect(nativePushConfig()).toMatchObject({ target: 'production', cronSecret: secret, credentials: { clientEmail: account.client_email } });
    vi.stubEnv('PRINTLY_NATIVE_PUSH_ENABLED', '0'); expect(nativePushConfig()).toBeNull();
    configure({ ...account, project_id: 'other-project' }); expect(nativePushConfig()).toBeNull();
    configure({ ...account, client_email: qaAccount.client_email }); expect(nativePushConfig()).toBeNull();
    configure({ ...account, token_uri: 'https://attacker.invalid/token' }); expect(nativePushConfig()).toBeNull();
    configure({ ...account, private_key: 'not a key' }); expect(nativePushConfig()).toBeNull();
    configure(); vi.stubEnv('PRINTLY_NATIVE_PUSH_CRON_SECRET', 'short'); expect(nativePushConfig()).toBeNull();
  });
  it('selects QA only when the entire isolated website and backend guard passes', () => {
    expect(nativePushTarget({})).toBe('production');
    expect(nativePushTarget(isolatedEnv)).toBe('isolated');
    for (const [name, value] of Object.entries({
      PRINTLY_ISOLATED_TEST: '0', NEXT_PUBLIC_PRINTLY_ISOLATED_TEST: '0', VERCEL_PROJECT_ID: 'other-project',
      VERCEL_ENV: 'preview', NEXT_PUBLIC_SITE_URL: 'https://printly0.vercel.app',
      NEXT_PUBLIC_SUPABASE_URL: 'https://lgfqetnfazawglwllymb.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'wrong', SUPABASE_SERVICE_ROLE_KEY: 'wrong',
      PRINTLY_REDIS_REST_URL: 'https://redis.example.test', PRINTLY_ANDROID_APK_URL: 'https://example.test/app.apk',
    })) expect(nativePushTarget({ ...isolatedEnv, [name]: value }), name).toBeNull();
    for (const partial of [
      { PRINTLY_ISOLATED_TEST: '1' }, { NEXT_PUBLIC_PRINTLY_ISOLATED_TEST: '1' },
      { VERCEL_PROJECT_ID: ISOLATED_TEST_PROJECT }, { VERCEL_PROJECT_PRODUCTION_URL: 'PRINTLY-NATIVE-TEST.VERCEL.APP.:443' },
      { NEXT_PUBLIC_SITE_URL: `${ISOLATED_TEST_SITE}/wrong` }, { NEXT_PUBLIC_SUPABASE_URL: ISOLATED_TEST_SUPABASE },
    ]) expect(nativePushTarget(partial)).toBeNull();
  });
  it('rejects cross-project credentials and does not fall back to production in broken QA', () => {
    configure(qaAccount); expect(nativePushConfig()).toBeNull();
    stubEnvironment(isolatedEnv);
    expect(nativePushConfig()).toMatchObject({ target: 'isolated', credentials: { clientEmail: qaAccount.client_email } });
    configure(account); expect(nativePushConfig()).toBeNull();
    configure({ ...qaAccount, client_email: account.client_email }); expect(nativePushConfig()).toBeNull();
    configure(qaAccount); vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly0.vercel.app'); expect(nativePushConfig()).toBeNull();
    configure(account); expect(nativePushConfig()).toBeNull();
  });
  it('compares worker authorization safely and exactly', () => {
    expect(validNativePushAuthorization(`Bearer ${secret}`, secret)).toBe(true);
    for (const header of [null, secret, `bearer ${secret}`, `Bearer ${'x'.repeat(48)}`, 'Bearer short']) {
      expect(validNativePushAuthorization(header, secret)).toBe(false);
    }
  });
  it('signs an OAuth assertion for the fixed Google endpoint and never follows redirects', async () => {
    configure();
    let assertion = '';
    const fetcher = vi.fn(async (address: string | URL | Request, init?: RequestInit) => {
      expect(address).toBe('https://oauth2.googleapis.com/token');
      expect(init?.redirect).toBe('error');
      assertion = (init?.body as URLSearchParams).get('assertion') ?? '';
      return Response.json({ access_token: 'synthetic-access-token-1234', expires_in: 3600, token_type: 'Bearer' });
    }) as unknown as typeof fetch;
    const credentials = nativePushConfig()!.credentials;
    expect(await nativePushAccessToken(credentials, fetcher)).toBe('synthetic-access-token-1234');
    const [head, payload, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ iss: account.client_email, aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/firebase.messaging' });
    expect(createVerify('RSA-SHA256').update(`${head}.${payload}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });
  it.each([
    ['production', NATIVE_FCM_PROJECT, NATIVE_ANDROID_PACKAGE],
    ['isolated', QA_FCM_PROJECT, QA_ANDROID_PACKAGE],
  ] as const)('sends a generic %s message only to its fixed project and package', async (target, project, androidPackage) => {
    const message = nativePushMessage(delivery, target)! as { message: Record<string, unknown> };
    expect(message.message).toMatchObject({ fid: delivery.fid, data: { version: '1', kind: 'payment', event: delivery.event_id, binding: delivery.binding_id },
      android: { priority: 'HIGH', restricted_package_name: androidPackage } });
    expect(message.message).not.toHaveProperty('notification');
    expect(nativePushMessage({ ...delivery, expires_at: new Date(0).toISOString() }, target)).toBeNull();
    expect(nativePushMessage({ ...delivery, fid: 'invalid' }, target)).toBeNull();
    const fetcher = vi.fn(async (address: string | URL | Request, init?: RequestInit) => {
      expect(address).toBe(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`);
      expect(init?.redirect).toBe('error');
      const sent = JSON.parse(String(init?.body)).message;
      expect(sent).toMatchObject({ fid: delivery.fid, data: message.message.data, android: { priority: 'HIGH', restricted_package_name: androidPackage } });
      expect(sent.android.ttl).toMatch(/^\d+s$/);
      return Response.json({ name: 'accepted' });
    }) as unknown as typeof fetch;
    expect(await sendNativePush(delivery, 'private-access-token', target, fetcher)).toBe('sent');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects an unknown target rather than sending to either project', async () => {
    const target = 'unexpected' as NativePushTarget;
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(nativePushMessage(delivery, target)).toBeNull();
    expect(await sendNativePush(delivery, 'token', target, fetcher)).toBe('drop');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('removes only explicitly unregistered installations; retries ambiguous errors', async () => {
    const result = (status: number, value: unknown) => vi.fn(async () => Response.json(value, { status })) as unknown as typeof fetch;
    expect(await sendNativePush(delivery, 'token', 'production', result(404, { error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }))).toBe('gone');
    for (const status of [400, 401, 403, 404, 429, 503]) expect(await sendNativePush(delivery, 'token', 'production', result(status, {}))).toBe('retry');
    expect(await sendNativePush({ ...delivery, kind: 'other' as 'order' }, 'token', 'production', result(200, {}))).toBe('drop');
  });
});
