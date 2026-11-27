import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: true, admin: false, membershipError: false, subscriptionError: false, linked: true, owner: true, fail: '', active: false }));
vi.mock('@/lib/api', () => ({
  getStaffContext: async () => state.auth ? {
    user: { id: 'owner' }, isAdmin: state.admin, shopIds: state.linked ? ['shop'] : [], activeShopIds: state.active ? ['shop'] : [],
    membershipError: state.membershipError, subscriptionError: state.subscriptionError,
    admin: { from: (table: string) => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ error: state.fail === table ? {} : null,
      data: table === 'shops' ? { id: 'shop', owner_id: state.owner ? 'owner' : 'other', kyc_status: 'pending', status: 'paused' } : { review_note: 'Review note' } }) }; return query; } },
  } : null,
  jsonOk: (value: unknown, init?: ResponseInit) => Response.json(value, init),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
import { GET } from './native-application-status';
beforeEach(() => Object.assign(state, { auth: true, admin: false, membershipError: false, subscriptionError: false, linked: true, owner: true, fail: '', active: false }));
describe('native application status', () => {
  it('allows a linked owner without a subscription to read their own review', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await response.json()).application).toEqual({ shop_id: 'shop', status: 'pending', shop_status: 'paused', review_note: 'Review note', can_access_dashboard: false });
  });
  it('does not return review notes to staff or unlinked users', async () => {
    state.owner = false; expect((await (await GET()).json()).application).toBeNull();
    state.linked = false; expect((await (await GET()).json()).application).toBeNull();
  });
  it('rejects anonymous or admin sessions and fails closed on read errors', async () => {
    state.auth = false; expect((await GET()).status).toBe(403);
    state.auth = true; state.admin = true; expect((await GET()).status).toBe(403);
    state.admin = false; state.membershipError = true; expect((await GET()).status).toBe(503);
    state.membershipError = false; state.subscriptionError = true; expect((await GET()).status).toBe(503);
    state.subscriptionError = false;
    for (const table of ['shops', 'shop_onboarding']) { state.fail = table; expect((await GET()).status).toBe(503); }
  });
});
