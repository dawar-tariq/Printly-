import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { DRAFT_LIFETIME_SECONDS, makeDraftToken, requestHasDraftAccess, setDraftCookie, validDraftToken } from './draft-access';

const order = '48f0e30a-cd56-444a-b211-a74a79f7de01';
const other = '48f0e30a-cd56-444a-b211-a74a79f7de02';
const secret = 'test-only-server-secret';
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('draft capability', () => {
  it('is bound to the order, authenticated and time limited', () => {
    const now = 1_800_000_000_000;
    const token = makeDraftToken(order, secret, now);
    expect(validDraftToken(order, token, secret, now)).toBe(true);
    expect(validDraftToken(other, token, secret, now)).toBe(false);
    expect(validDraftToken(order, token, 'wrong', now)).toBe(false);
    expect(validDraftToken(order, `${token.slice(0, -1)}x`, secret, now)).toBe(false);
    expect(validDraftToken(order, token, secret, now + DRAFT_LIFETIME_SECONDS * 1000)).toBe(false);
    expect(validDraftToken('../shop', token, secret, now)).toBe(false);
    expect(validDraftToken(order, '', secret, now)).toBe(false);
  });
  it('sets an HttpOnly, order-scoped persistent cookie and verifies it on requests', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', secret);
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const response = NextResponse.json({ ok: true });
    setDraftCookie(response, order);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain(`Path=/api/orders/${order}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain(`Max-Age=${DRAFT_LIFETIME_SECONDS}`);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const request = new Request('https://example.test/api', { headers: { cookie: cookie.split(';')[0] } });
    expect(requestHasDraftAccess(request, order)).toBe(true);
    expect(requestHasDraftAccess(request, other)).toBe(false);
    expect(requestHasDraftAccess(new Request('https://example.test'), order)).toBe(false);
  });
});
