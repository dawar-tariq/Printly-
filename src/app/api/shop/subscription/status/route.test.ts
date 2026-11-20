import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ available: true, membershipError: false, subscriptionError: false, admin: false }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), getStaffContext: async () => state.available ? ({ isAdmin: state.admin, membershipError: state.membershipError, subscriptionError: state.subscriptionError, shopIds: ['shop-1'], subscriptions: [{ shop_id: 'shop-1', is_permanent: true }], admin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { warning_days: 7 }, error: null }) }) }) }) } }) : null }));
import { GET } from './route';
beforeEach(() => { state.available = true; state.membershipError = false; state.subscriptionError = false; state.admin = false; });
describe('shop subscription live status', () => {
  it('returns only a member shop status without caching', async () => {
    const res = await GET(new Request('https://printly.test/api?shop_id=shop-1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ subscription: { shop_id: 'shop-1', is_permanent: true }, warning_days: 7 });
    expect((await GET(new Request('https://printly.test/api?shop_id=another'))).status).toBe(403);
  });
  it('fails closed when identity, membership, or subscription lookup fails', async () => {
    state.available = false; expect((await GET(new Request('https://printly.test/api'))).status).toBe(403);
    state.available = true; state.membershipError = true; expect((await GET(new Request('https://printly.test/api'))).status).toBe(403);
    state.membershipError = false; state.subscriptionError = true; expect((await GET(new Request('https://printly.test/api'))).status).toBe(503);
  });
});
