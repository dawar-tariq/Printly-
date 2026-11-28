import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';

const COOKIE_NAME = 'printly-draft';
export const DRAFT_LIFETIME_SECONDS = 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signature(orderId: string, expires: number, secret: string) {
  return createHmac('sha256', secret).update(`printly-draft-v1:${orderId}:${expires}`).digest('base64url');
}

export function makeDraftToken(orderId: string, secret: string, now = Date.now()) {
  if (!UUID.test(orderId) || !secret) throw new Error('Cannot create a draft session');
  const expires = Math.floor(now / 1000) + DRAFT_LIFETIME_SECONDS;
  return `${expires}.${signature(orderId, expires, secret)}`;
}

export function validDraftToken(orderId: string, token: string, secret: string, now = Date.now()) {
  if (!UUID.test(orderId) || !secret) return false;
  const match = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + DRAFT_LIFETIME_SECONDS) return false;
  const expected = Buffer.from(signature(orderId, expires, secret));
  const actual = Buffer.from(match[2]);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A scoped, HttpOnly capability; an order/tracking URL alone cannot read its files. */
export function requestHasDraftAccess(request: Request, orderId: string) {
  const rawCookie = request.headers.get('cookie') ?? '';
  const token = rawCookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) ?? '';
  return validDraftToken(orderId, token, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
}

export function setDraftCookie(response: NextResponse, orderId: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  response.cookies.set(COOKIE_NAME, makeDraftToken(orderId, secret), {
    path: `/api/orders/${orderId}`,
    maxAge: DRAFT_LIFETIME_SECONDS,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  response.headers.set('Cache-Control', 'private, no-store');
}
