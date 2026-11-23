import 'server-only';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';

export type PublicRateBucket = 'signup' | 'name_check' | 'order_start' | 'dropbox_import' | 'order_feedback'
  | 'login_attempt' | 'upload_issue' | 'file_processing' | 'draft_changes' | 'checkout' | 'tracking';
type DraftRateBucket = 'draft_upload_issue' | 'draft_dropbox_import';

function canonicalIp(address: string): string | null {
  const value = address.trim();
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6 || value.includes('%')) return null;
  try {
    // Normalise alternative IPv6 spellings so one client cannot receive several
    // limits merely by changing case or compression. Treat mapped IPv4 alike.
    const normal = new URL(`http://[${value}]`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(normal);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    return normal;
  } catch { return null; }
}

/**
 * Vercel supplies an edge-controlled x-vercel-forwarded-for. Other production
 * hosts must opt in only after a trusted proxy overwrites x-printly-client-ip
 * with one client IP and prevents direct access. Next.js can synthesize
 * x-forwarded-for from a peer address, so it is not a safe fallback here.
 */
export async function enforcePublicRateLimit(req: Request, bucket: PublicRateBucket): Promise<Response | null> {
  const vercel = process.env.VERCEL === '1';
  const trustedProxy = vercel || process.env.PRINTLY_TRUST_PROXY_IP === '1';
  const forwarded = vercel
    ? req.headers.get('x-vercel-forwarded-for') ?? ''
    : trustedProxy ? req.headers.get('x-printly-client-ip') ?? '' : '';
  const ip = trustedProxy ? canonicalIp(forwarded) : process.env.NODE_ENV !== 'production' ? 'local-development' : null;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ip || !secret) return unavailable();
  const clientHash = createHmac('sha256', secret).update(`printly-public-rate-v1:${ip}`).digest('hex');
  return consume(bucket, clientHash);
}

/**
 * Bound signed-upload and import attempts for the whole draft, even if the
 * client changes IP or never finalizes any file. Call only after verifying the
 * order-scoped draft cookie. The database never sees the order ID itself.
 */
export async function enforceDraftRateLimit(orderId: string, bucket: DraftRateBucket): Promise<Response | null> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) return unavailable();
  const subjectHash = createHmac('sha256', secret).update(`printly-draft-rate-v1:${orderId.toLowerCase()}`).digest('hex');
  return consume(bucket, subjectHash);
}

export async function enforceUploadIssueLimit(req: Request, orderId: string): Promise<Response | null> {
  return await enforcePublicRateLimit(req, 'upload_issue') ?? await enforceDraftRateLimit(orderId, 'draft_upload_issue');
}

/**
 * Bound promo-code guesses per signed-in actor and shop, independent of IP.
 * Reuse the existing checkout window (30 / 15 minutes), with a separate HMAC
 * namespace so promo attempts cannot consume a customer's checkout quota.
 * This is an additional abuse control, not an authorization check.
 */
export async function enforceSubscriptionPromoRateLimit(shopId: string, actorId: string): Promise<Response | null> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!secret || !uuid.test(shopId) || !uuid.test(actorId)) return unavailable();
  const subjectHash = createHmac('sha256', secret).update(`printly-subscription-offer-v1:${shopId.toLowerCase()}:${actorId.toLowerCase()}`).digest('hex');
  return consume('checkout', subjectHash);
}

async function consume(bucket: PublicRateBucket | DraftRateBucket, clientHash: string): Promise<Response | null> {
  try {
    const { data, error } = await createAdminSupabase().rpc('consume_public_rate_limit', { p_bucket: bucket, p_client_hash: clientHash });
    if (error || !data || typeof data.allowed !== 'boolean') return unavailable();
    if (data.allowed) return null;
    const retry = Number.isFinite(data.retry_after) ? Math.max(1, Math.min(86400, Math.ceil(data.retry_after))) : 60;
    const message = bucket === 'draft_upload_issue'
      ? 'This order has reached its upload-attempt limit. Please start a new order.'
      : bucket === 'draft_dropbox_import'
        ? 'This order has reached its import-attempt limit. Please start a new order.'
        : 'Too many requests. Please wait and try again.';
    return NextResponse.json({ error: { code: 'rate_limited', message } }, {
      status: 429, headers: { 'Retry-After': String(retry), 'Cache-Control': 'no-store' },
    });
  } catch { return unavailable(); }
}

function unavailable() {
  return NextResponse.json({ error: { code: 'rate_limit_unavailable', message: 'This service is temporarily unavailable. Please try again.' } }, {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
}
