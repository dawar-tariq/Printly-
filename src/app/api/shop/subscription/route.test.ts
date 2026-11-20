import { beforeEach, describe, expect, it, vi } from 'vitest';

const shopId = '11111111-1111-4111-8111-111111111111';
const purchaseId = '22222222-2222-4222-8222-222222222222';
const state = vi.hoisted(() => ({
  signedIn: true, isAdmin: false, userId: 'owner', shopIds: ['11111111-1111-4111-8111-111111111111'], subscriptionError: false,
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>, error: null as null | { message: string },
}));
const admin = () => ({
  rpc: async (name: string, args: Record<string, unknown>) => { state.rpcs.push({ name, args }); return { data: { status: 'submitted' }, error: state.error }; },
  from: (table: string) => ({ select: () => ({
    eq: () => ({
      maybeSingle: async () => table === 'shops' ? { data: { id: shopId, name: 'Demo', short_code: 'DEMO', owner_id: 'owner' }, error: null }
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
beforeEach(() => { state.signedIn = true; state.isAdmin = false; state.userId = 'owner'; state.shopIds = [shopId]; state.subscriptionError = false; state.rpcs = []; state.error = null; });

describe('shop subscription API', () => {
  it('permits an expired member to see status and discloses whether they own the shop', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ is_owner: true, shop: { id: shopId }, subscription: null });
    state.userId = 'staff';
    expect(await (await GET(request())).json()).toMatchObject({ is_owner: false });
  });
  it('rejects unauthenticated users, admin accounts, and other shop IDs', async () => {
    state.signedIn = false; expect((await GET(request())).status).toBe(403);
    state.signedIn = true; state.isAdmin = true; expect((await GET(request())).status).toBe(403);
    state.isAdmin = false; expect((await POST(request({ action: 'start', term: 'monthly' }, '?shop_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))).status).toBe(403);
    expect(state.rpcs).toEqual([]);
  });
  it('uses the signed-in actor and membership rather than client-supplied owner or price', async () => {
    const res = await POST(request({ action: 'start', term: 'six_months', shop_id: 'forged', actor: 'forged', amount_paise: 1 }));
    expect(res.status).toBe(200);
    expect(state.rpcs[0]).toEqual({ name: 'start_subscription_purchase', args: { p_shop_id: shopId, p_actor: 'owner', p_term: 'six_months' } });
    state.userId = 'staff'; state.error = { message: 'OWNER_REQUIRED' };
    const denied = await POST(request({ action: 'submit', purchase_id: purchaseId, utr: '123456789012' }));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('owner_required');
    expect(state.rpcs[1].args.p_actor).toBe('staff');
  });
  it('submits a reference without approving and fails closed on entitlement lookup errors', async () => {
    expect((await POST(request({ action: 'submit', purchase_id: purchaseId, utr: 'UPI-123456' }))).status).toBe(200);
    expect(state.rpcs[0]).toEqual({ name: 'submit_subscription_purchase', args: { p_shop_id: shopId, p_purchase_id: purchaseId, p_actor: 'owner', p_utr: 'UPI-123456' } });
    state.subscriptionError = true;
    expect((await GET(request())).status).toBe(503);
    expect((await POST(request({ action: 'start', term: 'yearly' }))).status).toBe(503);
    expect(state.rpcs).toHaveLength(1);
  });
});
