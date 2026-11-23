import { beforeEach, describe, expect, it, vi } from 'vitest';

const shopId = '11111111-1111-4111-8111-111111111111';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const purchaseId = '22222222-2222-4222-8222-222222222222';
const requestKey = '33333333-3333-4333-8333-333333333333';
const promoId = '44444444-4444-4444-8444-444444444444';
const quote = { term: 'six_months', base_paise: 50000, monthly_reference_paise: 60000, discount_paise: 12500, amount_paise: 37500,
  promo_code: 'THANKS25', promo_id: promoId, promo_version: 0, plan_version: 2, access_expires_at: null };
const state = vi.hoisted(() => ({
  signedIn: true, isAdmin: false, userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', shopIds: ['11111111-1111-4111-8111-111111111111'], subscriptionError: false,
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>, error: null as null | { message: string },
  announcementError: false, limited: false, limits: [] as string[],
}));
vi.mock('@/lib/rate-limit', () => ({ enforceSubscriptionPromoRateLimit: async (shop: string, actor: string) => {
  state.limits.push(`${shop}:${actor}`); return state.limited ? Response.json({ error: { code: 'rate_limited' } }, { status: 429 }) : null;
} }));
const admin = () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.rpcs.push({ name, args });
    if (name === 'visible_subscription_announcements') return { data: state.announcementError ? null : [], error: state.announcementError ? { message: 'unavailable' } : null };
    return { data: name === 'quote_subscription_offer' ? quote : { purchase: { id: purchaseId, status: 'initiated' } }, error: state.error };
  },
  from: (table: string) => ({ select: () => ({
    eq: () => ({
      maybeSingle: async () => table === 'shops' ? { data: { id: shopId, name: 'Demo', short_code: 'DEMO', owner_id: owner }, error: null }
        : { data: { monthly_paise: 10000, upi_id: 'printly@upi', payee_name: 'Printly', warning_days: 7 }, error: null },
      order: () => ({ limit: async () => ({ data: [], error: null }) }),
    }),
  }) }),
});
vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  getStaffContext: async () => state.signedIn ? ({ user: { id: state.userId }, isAdmin: state.isAdmin, shopIds: state.shopIds, subscriptions: [], subscriptionError: state.subscriptionError, admin: admin() }) : null,
}));
import { GET, POST } from './route';
const request = (body?: unknown, query = '') => new Request(`https://printly.test/api/shop/subscription${query}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const startBody = () => ({ action: 'start', term: 'six_months', code: 'THANKS25', request_key: requestKey, expected_quote: quote });
beforeEach(() => { state.signedIn = true; state.isAdmin = false; state.userId = owner; state.shopIds = [shopId]; state.subscriptionError = false; state.rpcs = []; state.error = null; state.announcementError = false; state.limited = false; state.limits = []; });

describe('shop subscription API', () => {
  it('permits an expired member to see status, announcements, and whether they own the shop', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ is_owner: true, shop: { id: shopId }, subscription: null, announcements: [], offers_unavailable: false });
    expect(state.rpcs[0]).toEqual({ name: 'visible_subscription_announcements', args: { p_public_only: false } });
    state.userId = other;
    expect(await (await GET(request())).json()).toMatchObject({ is_owner: false });
    state.announcementError = true;
    expect(await (await GET(request())).json()).toMatchObject({ offers_unavailable: true, purchases: [] });
  });
  it('rejects unauthenticated users, admin accounts, and other shop IDs', async () => {
    state.signedIn = false; expect((await GET(request())).status).toBe(403);
    state.signedIn = true; state.isAdmin = true; expect((await GET(request())).status).toBe(403);
    state.isAdmin = false; expect((await POST(request(startBody(), '?shop_id=99999999-9999-4999-8999-999999999999'))).status).toBe(403);
    expect(state.rpcs).toEqual([]);
  });
  it('rejects client-supplied actor, shop, top-level prices and legacy starts, and rechecks the quote in the database', async () => {
    expect((await POST(request({ ...startBody(), actor: other, shop_id: 'forged', amount_paise: 1 }))).status).toBe(422);
    expect((await POST(request({ action: 'start', term: 'monthly' }))).status).toBe(422);
    const res = await POST(request(startBody()));
    expect(res.status).toBe(200);
    expect(state.rpcs[0]).toEqual({ name: 'start_subscription_purchase_with_offer', args: { p_shop_id: shopId, p_actor: owner, p_term: 'six_months',
      p_code: 'THANKS25', p_request_key: requestKey, p_expected_quote: quote } });
    state.error = { message: 'SUBSCRIPTION_QUOTE_CHANGED' };
    const forged = { ...quote, amount_paise: 0, discount_paise: 50000 };
    const denied = await POST(request({ ...startBody(), expected_quote: forged }));
    expect(denied.status).toBe(409);
    expect((await denied.json()).error.code).toBe('quote_changed');
    expect(state.rpcs[1].args.p_expected_quote).toEqual(forged); // The locked database comparison is authoritative.
  });
  it('normalizes codes, requires the owner, and limits promo guesses per actor and shop', async () => {
    const res = await POST(request({ action: 'quote', term: 'six_months', code: ' thanks25 ' }));
    expect(res.status).toBe(200);
    expect(state.rpcs[0]).toEqual({ name: 'quote_subscription_offer', args: { p_shop_id: shopId, p_actor: owner, p_term: 'six_months', p_code: 'THANKS25' } });
    expect(state.limits).toEqual([`${shopId}:${owner}`]);
    state.userId = other; state.error = { message: 'OWNER_REQUIRED' };
    expect((await POST(request({ action: 'quote', term: 'six_months', code: 'thanks25' }))).status).toBe(403);
    state.userId = owner; state.error = null; state.limited = true;
    expect((await POST(request({ action: 'quote', term: 'six_months', code: 'thanks25' }))).status).toBe(429);
    expect(state.rpcs).toHaveLength(2);
    expect((await POST(request({ action: 'quote', term: 'six_months', code: 'bad code' }))).status).toBe(422);
    expect((await POST(request({ ...startBody(), request_key: 'bad-key' }))).status).toBe(422);
  });
  it('submits a reference without approving and fails closed on entitlement lookup errors', async () => {
    expect((await POST(request({ action: 'submit', purchase_id: purchaseId, utr: 'UPI-123456' }))).status).toBe(200);
    expect(state.rpcs[0]).toEqual({ name: 'submit_subscription_purchase', args: { p_shop_id: shopId, p_purchase_id: purchaseId, p_actor: owner, p_utr: 'UPI-123456' } });
    state.subscriptionError = true;
    expect((await GET(request())).status).toBe(503);
    expect((await POST(request(startBody()))).status).toBe(503);
    expect(state.rpcs).toHaveLength(1);
  });
});
