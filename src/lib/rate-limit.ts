import 'server-only';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';

export type PublicRateBucket = 'signup' | 'name_check' | 'order_start' | 'dropbox_import' | 'order_feedback';

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
  try {
    const { data, error } = await createAdminSupabase().rpc('consume_public_rate_limit', { p_bucket: bucket, p_client_hash: clientHash });
    if (error || !data || typeof data.allowed !== 'boolean') return unavailable();
    if (data.allowed) return null;
    const retry = Number.isFinite(data.retry_after) ? Math.max(1, Math.min(3600, Math.ceil(data.retry_after))) : 60;
    return NextResponse.json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait and try again.' } }, {
      status: 429, headers: { 'Retry-After': String(retry), 'Cache-Control': 'no-store' },
    });
  } catch { return unavailable(); }
}

function unavailable() {
  return NextResponse.json({ error: { code: 'rate_limit_unavailable', message: 'This service is temporarily unavailable. Please try again.' } }, {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
}
