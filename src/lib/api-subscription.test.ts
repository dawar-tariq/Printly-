import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: 'owner', role: 'shop_staff', memberships: ['shop-a'], membershipError: false, subscriptionError: false,
  subscriptions: [] as Array<Record<string, unknown>>,
  order: { shop_id: 'shop-a', status: 'queued', payment_method: 'cod' } as Record<string, unknown> | null,
}));
vi.mock('@/lib/supabase', () => ({
  createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: { id: state.user } }, error: null }) } }),
  createAdminSupabase: () => ({ from: (table: string) => {
    if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: state.role }, error: null }) }) }) };
    if (table === 'shop_staff') return { select: () => ({ eq: async () => ({ data: state.memberships.map((shop_id) => ({ shop_id })), error: state.membershipError ? { message: 'offline' } : null }) }) };
    if (table === 'shop_subscriptions') return { select: () => ({ in: async () => ({ data: state.subscriptions, error: state.subscriptionError ? { message: 'offline' } : null }) }) };
    if (table === 'orders') return { select: () => ({ eq: (_key: string, _id: string) => ({ eq: (_shop: string, shopId: string) => ({ maybeSingle: async () => ({ data: state.order?.shop_id === shopId ? state.order : null, error: null }) }) }) }) };
    throw new Error(`Unexpected table: ${table}`);
  } }),
}));
import { assertStaffOfShop, getStaffContext } from './api';

beforeEach(() => {
  state.user = 'owner'; state.role = 'shop_staff'; state.memberships = ['shop-a']; state.membershipError = false; state.subscriptionError = false;
  state.subscriptions = [{ shop_id: 'shop-a', term: 'monthly', is_permanent: false, expires_at: '2000-01-01T00:00:00Z' }];
  state.order = { shop_id: 'shop-a', status: 'queued', payment_method: 'cod' };
});

describe('subscription-aware staff authorization', () => {
  it('locks normal staff access on expiry while retaining membership for billing', async () => {
    expect((await getStaffContext())?.shopIds).toEqual([]);
    expect((await getStaffContext({ allowExpired: true }))?.shopIds).toEqual(['shop-a']);
    expect(await assertStaffOfShop('shop-a')).toBeNull();
    expect(await assertStaffOfShop('shop-a', { recoveryOrderId: 'order' })).not.toBeNull();
  });
  it('allows recovery only for the same shop and a started checkout or placed order', async () => {
    expect(await assertStaffOfShop('other-shop', { recoveryOrderId: 'order' })).toBeNull();
    state.order = { shop_id: 'shop-a', status: 'draft', payment_method: null };
    expect(await assertStaffOfShop('shop-a', { recoveryOrderId: 'order' })).toBeNull();
    state.order.payment_method = 'upi';
    expect(await assertStaffOfShop('shop-a', { recoveryOrderId: 'order' })).not.toBeNull();
    state.order.status = 'collected';
    expect(await assertStaffOfShop('shop-a', { recoveryOrderId: 'order' })).not.toBeNull();
  });
  it('permits a paid or permanent entitlement, and fails closed on lookup errors', async () => {
    state.subscriptions = [{ shop_id: 'shop-a', term: 'monthly', is_permanent: false, expires_at: '2999-01-01T00:00:00Z' }];
    expect((await getStaffContext())?.shopIds).toEqual(['shop-a']);
    expect(await assertStaffOfShop('shop-a')).not.toBeNull();
    state.subscriptions = [{ shop_id: 'shop-a', is_permanent: true, expires_at: null, term: null }];
    expect((await getStaffContext())?.shopIds).toEqual(['shop-a']);
    state.subscriptionError = true;
    expect((await getStaffContext())?.shopIds).toEqual([]);
    expect(await assertStaffOfShop('shop-a')).toBeNull();
    state.membershipError = true;
    expect((await getStaffContext({ allowExpired: true }))?.membershipError).toBe(true);
    expect((await getStaffContext({ allowExpired: true }))?.shopIds).toEqual([]);
  });
  it('does not treat an admin account as a shop member', async () => {
    state.role = 'admin';
    expect(await assertStaffOfShop('shop-a', { recoveryOrderId: 'order' })).toBeNull();
  });
});
