import 'server-only';
import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getStaffContext, jsonError, jsonOk } from '@/lib/api';
import { currentNativeSession } from '@/lib/native-session';
import { nativePushConfig } from '@/lib/native-push-server';
import { readBodyBytes } from '@/lib/request-body';
import { createAdminSupabase } from '@/lib/supabase';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fid = /^[A-Za-z0-9_-]{22}$/;

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBodyBytes(request, 4096)));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
const keysAre = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Bound each write type per verified user even when the client changes networks.
 * Separate HMAC namespaces keep registration attempts from consuming cleanup's
 * allowance; revocation creates a short-lived tombstone even for a late POST. */
async function deviceWriteLimit(userId: string, operation: 'registration' | 'revocation'): Promise<Response | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !uuid.test(userId)) return jsonError(503, 'unavailable', 'Notification setup is unavailable.');
  try {
    const hash = createHmac('sha256', key).update(`printly-native-push-${operation}-v1:${userId.toLowerCase()}`).digest('hex');
    const result = await createAdminSupabase().rpc('consume_public_rate_limit', { p_bucket: 'checkout', p_client_hash: hash });
    if (result.error || !result.data || typeof result.data.allowed !== 'boolean') return jsonError(503, 'unavailable', 'Notification setup is unavailable.');
    if (result.data.allowed) return null;
    const retry = Number.isFinite(result.data.retry_after) ? Math.max(1, Math.min(86400, Math.ceil(result.data.retry_after))) : 60;
    return NextResponse.json({ error: { code: 'rate_limited', message: 'Too many attempts. Please try again later.' } }, {
      status: 429, headers: { 'Retry-After': String(retry), 'Cache-Control': 'no-store' },
    });
  } catch { return jsonError(503, 'unavailable', 'Notification setup is unavailable.'); }
}

/** Callable only through the verified bearer gateway, never a browser cookie. */
export async function POST(request: Request): Promise<Response> {
  const session = currentNativeSession();
  if (!session) return jsonError(401, 'unauthorized', 'Sign in required.');
  const data = await body(request);
  if (!data || !keysAre(data, ['shop_id', 'binding_id', 'fid']) || typeof data.shop_id !== 'string' || !uuid.test(data.shop_id) ||
      typeof data.binding_id !== 'string' || !uuid.test(data.binding_id) || typeof data.fid !== 'string' || !fid.test(data.fid)) {
    return jsonError(422, 'validation', 'Invalid notification registration.');
  }
  if (!nativePushConfig()) return jsonError(503, 'unavailable', 'Notifications are not set up on the server yet.');
  const limited = await deviceWriteLimit(session.user.id, 'registration');
  if (limited) return limited;
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff || staff.membershipError || staff.subscriptionError) return jsonError(503, 'unavailable', 'Could not verify your shop.');
  if (staff.isAdmin || !staff.allShopIds.includes(data.shop_id)) return jsonError(403, 'forbidden', 'Not your shop.');
  const result = await staff.admin.rpc('register_native_push_device', {
    p_user: session.user.id, p_shop: data.shop_id, p_binding: data.binding_id, p_fid: data.fid,
  });
  if (result.error) {
    if (result.error.message?.includes('SHOP_MEMBERSHIP_REQUIRED')) return jsonError(403, 'forbidden', 'Not your shop.');
    if (result.error.message?.includes('PUSH_BINDING_IN_USE') || result.error.message?.includes('NATIVE_PUSH_BINDING_REVOKED') ||
        result.error.message?.includes('NATIVE_PUSH_DEVICE_LIMIT')) {
      return jsonError(409, 'device_limit', 'Could not connect this device. Please contact support.');
    }
    return jsonError(503, 'unavailable', 'Could not connect notifications. Please try again.');
  }
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Cleanup is allowed even when delivery is disabled or shop access expires. */
export async function DELETE(request: Request): Promise<Response> {
  const session = currentNativeSession();
  if (!session) return jsonError(401, 'unauthorized', 'Sign in required.');
  const data = await body(request);
  if (!data || !keysAre(data, ['binding_id']) || typeof data.binding_id !== 'string' || !uuid.test(data.binding_id)) {
    return jsonError(422, 'validation', 'Invalid notification registration.');
  }
  // Bound tombstone creation independently from enrollment. This endpoint is
  // still available when delivery is disabled or shop access has expired.
  const limited = await deviceWriteLimit(session.user.id, 'revocation');
  if (limited) return limited;
  const result = await createAdminSupabase().rpc('unregister_native_push_device', { p_user: session.user.id, p_binding: data.binding_id });
  if (result.error) return jsonError(503, 'unavailable', 'Could not disconnect notifications. Please try again.');
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
