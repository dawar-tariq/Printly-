import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_FCM_PROJECT, nativePushAccessToken, nativePushConfig, nativePushMessage, sendNativePush, validNativePushAuthorization, type NativePushDelivery } from './native-push-server';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  type: 'service_account', project_id: NATIVE_FCM_PROJECT, client_email: 'notifications@printly-5c247.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), token_uri: 'https://oauth2.googleapis.com/token',
};
const secret = 's'.repeat(48);
const delivery: NativePushDelivery = {
  delivery_id: '11111111-1111-4111-8111-111111111111', lease_token: '22222222-2222-4222-8222-222222222222',
  event_id: '33333333-3333-4333-8333-333333333333', binding_id: '44444444-4444-4444-8444-444444444444',
  fid: 'A'.repeat(22), kind: 'payment', expires_at: new Date(Date.now() + 120_000).toISOString(),
};
function configure(value: unknown = account) {
  vi.stubEnv('PRINTLY_NATIVE_PUSH_ENABLED', '1');
  vi.stubEnv('PRINTLY_NATIVE_PUSH_CRON_SECRET', secret);
  vi.stubEnv('PRINTLY_FCM_SERVICE_ACCOUNT_JSON', JSON.stringify(value));
}
afterEach(() => vi.unstubAllEnvs());

describe('native FCM sender', () => {
  it('fails closed without an enabled and correctly scoped service account and worker secret', () => {
    configure(); expect(nativePushConfig()).toMatchObject({ cronSecret: secret, credentials: { clientEmail: account.client_email } });
    vi.stubEnv('PRINTLY_NATIVE_PUSH_ENABLED', '0'); expect(nativePushConfig()).toBeNull();
    configure({ ...account, project_id: 'other-project' }); expect(nativePushConfig()).toBeNull();
    configure({ ...account, token_uri: 'https://attacker.invalid/token' }); expect(nativePushConfig()).toBeNull();
    configure({ ...account, private_key: 'not a key' }); expect(nativePushConfig()).toBeNull();
    configure(); vi.stubEnv('PRINTLY_NATIVE_PUSH_CRON_SECRET', 'short'); expect(nativePushConfig()).toBeNull();
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
  it('sends only a bounded generic data message, never order or customer information', async () => {
    const message = nativePushMessage(delivery)! as { message: Record<string, unknown> };
    expect(message.message).toMatchObject({ fid: delivery.fid, data: { version: '1', kind: 'payment', event: delivery.event_id, binding: delivery.binding_id },
      android: { priority: 'HIGH', restricted_package_name: 'io.github.dawartariq.printly.owner' } });
    expect(message.message).not.toHaveProperty('notification');
    expect(nativePushMessage({ ...delivery, expires_at: new Date(0).toISOString() })).toBeNull();
    expect(nativePushMessage({ ...delivery, fid: 'invalid' })).toBeNull();
    const fetcher = vi.fn(async (_address: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      expect(JSON.parse(String(init?.body)).message.data).toEqual(message.message.data);
      return Response.json({ name: 'accepted' });
    }) as unknown as typeof fetch;
    expect(await sendNativePush(delivery, 'private-access-token', fetcher)).toBe('sent');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('removes only explicitly unregistered installations; retries ambiguous errors', async () => {
    const result = (status: number, value: unknown) => vi.fn(async () => Response.json(value, { status })) as unknown as typeof fetch;
    expect(await sendNativePush(delivery, 'token', result(404, { error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }))).toBe('gone');
    for (const status of [400, 401, 403, 404, 429, 503]) expect(await sendNativePush(delivery, 'token', result(status, {}))).toBe('retry');
    expect(await sendNativePush({ ...delivery, kind: 'other' as 'order' }, 'token', result(200, {}))).toBe('drop');
  });
});
