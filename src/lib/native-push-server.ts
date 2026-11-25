import 'server-only';
import { createHash, createPrivateKey, createSign, timingSafeEqual } from 'node:crypto';
import { ISOLATED_TEST_PROJECT, ISOLATED_TEST_SITE, ISOLATED_TEST_SUPABASE, isolatedTestDeploymentAllowed } from './isolated-test-environment.mjs';

// Fixed, separate identities: a QA installation must never register with or
// receive messages from the production Firebase project.
export const NATIVE_FCM_PROJECT = 'printly-5c247';
export const NATIVE_ANDROID_PACKAGE = 'io.github.dawartariq.printly.owner';
export const QA_FCM_PROJECT = 'printly-notifications-qa';
export const QA_ANDROID_PACKAGE = 'io.github.dawartariq.printly.owner.native.qa';
export type NativePushTarget = 'production' | 'isolated';
const targets = {
  production: { project: NATIVE_FCM_PROJECT, androidPackage: NATIVE_ANDROID_PACKAGE },
  isolated: { project: QA_FCM_PROJECT, androidPackage: QA_ANDROID_PACKAGE },
} as const;
const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fidPattern = /^[A-Za-z0-9_-]{22}$/;

type Credentials = { clientEmail: string; privateKey: string };
export type NativePushConfig = { credentials: Credentials; cronSecret: string; target: NativePushTarget };
export type NativePushDelivery = {
  delivery_id: string; lease_token: string; event_id: string; binding_id: string;
  fid: string; kind: 'order' | 'payment'; expires_at: string;
};
export type PushOutcome = 'sent' | 'gone' | 'retry' | 'drop';

function hostname(value: string | undefined): string | null {
  try { return value ? new URL(value).hostname.toLowerCase().replace(/\.$/, '') : null; } catch { return null; }
}

/** A test-looking environment must pass every isolation guard; it must never
 * fall back to the production FCM identity when a staging variable is wrong. */
export function nativePushTarget(env: Record<string, string | undefined> = process.env): NativePushTarget | null {
  const looksIsolated = [env.PRINTLY_ISOLATED_TEST, env.NEXT_PUBLIC_PRINTLY_ISOLATED_TEST]
    .some((value) => value !== undefined && value !== '' && value !== '0') ||
    env.VERCEL_PROJECT_ID === ISOLATED_TEST_PROJECT ||
    hostname(env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined) === hostname(ISOLATED_TEST_SITE) ||
    hostname(env.NEXT_PUBLIC_SITE_URL) === hostname(ISOLATED_TEST_SITE) ||
    hostname(env.NEXT_PUBLIC_SUPABASE_URL) === hostname(ISOLATED_TEST_SUPABASE);
  if (!looksIsolated) return 'production';
  // The shared guard intentionally allows ordinary non-test deployments.
  // Require the explicit marker here before invoking it, so a staging
  // Supabase URL alone cannot be mistaken for an approved QA environment.
  return env.PRINTLY_ISOLATED_TEST === '1' && isolatedTestDeploymentAllowed(env) ? 'isolated' : null;
}

/** Fail closed: the public google-services.json does not authorize sends. */
export function nativePushConfig(): NativePushConfig | null {
  if (process.env.PRINTLY_NATIVE_PUSH_ENABLED !== '1') return null;
  const target = nativePushTarget();
  const raw = process.env.PRINTLY_FCM_SERVICE_ACCOUNT_JSON ?? '';
  const cronSecret = process.env.PRINTLY_NATIVE_PUSH_CRON_SECRET ?? '';
  if (!target || !raw || raw.length > 12_000 || !/^[A-Za-z0-9_-]{32,128}$/.test(cronSecret)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const account = value as Record<string, unknown>;
    if (account.type !== 'service_account' || account.project_id !== targets[target].project ||
        typeof account.client_email !== 'string' || typeof account.private_key !== 'string' || account.private_key.length > 8_000 ||
        (account.token_uri !== undefined && account.token_uri !== OAUTH_URL)) return null;
    const address = account.client_email.toLowerCase().split('@');
    if (address.length !== 2 || !/^[a-z0-9._-]+$/.test(address[0]) || address[1] !== `${targets[target].project}.iam.gserviceaccount.com`) return null;
    const key = createPrivateKey(account.private_key);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return null;
    return { credentials: { clientEmail: account.client_email, privateKey: account.private_key }, cronSecret, target };
  } catch { return null; }
}

export function validNativePushAuthorization(header: string | null, secret: string): boolean {
  if (!header || !/^Bearer [A-Za-z0-9_-]{32,128}$/.test(header)) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const b64url = (value: string) => Buffer.from(value).toString('base64url');
let cachedToken: { fingerprint: string; token: string; validUntil: number } | undefined;

/** OAuth service-account JWT is exchanged server-side only; never log it or its result. */
export async function nativePushAccessToken(credentials: Credentials, fetcher: typeof fetch = fetch): Promise<string> {
  const fingerprint = createHash('sha256').update(credentials.clientEmail).update(credentials.privateKey).digest('hex');
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken?.fingerprint === fingerprint && cachedToken.validUntil > now + 60) return cachedToken.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: credentials.clientEmail, scope: FCM_SCOPE, aud: OAUTH_URL, iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(credentials.privateKey).toString('base64url');
  const response = await fetcher(OAUTH_URL, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!response.ok) throw new Error('FCM authorization unavailable');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('FCM authorization unavailable');
  const result = data as Record<string, unknown>;
  if (typeof result.access_token !== 'string' || result.access_token.length < 16 || result.access_token.length > 8192 ||
      typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in < 120 || result.expires_in > 3600 ||
      typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer') throw new Error('FCM authorization unavailable');
  cachedToken = { fingerprint, token: result.access_token, validUntil: now + Math.floor(result.expires_in) };
  return result.access_token;
}

/** Generic data-only notifications let the app reject messages after sign-out. */
export function nativePushMessage(delivery: NativePushDelivery, target: NativePushTarget, now = Date.now()): Record<string, unknown> | null {
  if (target !== 'production' && target !== 'isolated') return null;
  const seconds = Math.min(86_400, Math.floor((Date.parse(delivery.expires_at) - now) / 1000));
  if (!uuid.test(delivery.delivery_id) || !uuid.test(delivery.lease_token) || !uuid.test(delivery.event_id) ||
      !uuid.test(delivery.binding_id) || !fidPattern.test(delivery.fid) || !['order', 'payment'].includes(delivery.kind) ||
      !Number.isFinite(seconds) || seconds <= 0) return null;
  return { message: {
    fid: delivery.fid,
    data: { version: '1', kind: delivery.kind, event: delivery.event_id, binding: delivery.binding_id },
    android: { priority: 'HIGH', ttl: `${seconds}s`, restricted_package_name: targets[target].androidPackage },
  } };
}

/** Only a documented UNREGISTERED FCM error removes a device. Other 4xx errors
 * can mean a bad payload or sender configuration, not a stale installation. */
export async function sendNativePush(delivery: NativePushDelivery, accessToken: string, target: NativePushTarget, fetcher: typeof fetch = fetch): Promise<PushOutcome> {
  const body = nativePushMessage(delivery, target);
  if (!body) return 'drop';
  try {
    const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${targets[target].project}/messages:send`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (response.ok) return 'sent';
    if (response.status === 401) cachedToken = undefined;
    if (response.status === 404) {
      const value: unknown = await response.json().catch(() => null);
      const error = value && typeof value === 'object' && 'error' in value ? (value as { error?: { details?: unknown } }).error : null;
      if (Array.isArray(error?.details) && error.details.some((detail: unknown) =>
        !!detail && typeof detail === 'object' && (detail as Record<string, unknown>)['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' &&
        (detail as Record<string, unknown>).errorCode === 'UNREGISTERED')) return 'gone';
    }
    return 'retry';
  } catch { return 'retry'; }
}
