import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ staff: null as null | Record<string, unknown>, result: true as boolean, error: '', calls: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), getStaffContext: async () => state.staff }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: async (_name: string, args: Record<string, unknown>) => {
  state.calls.push(args); return { data: state.result, error: state.error ? { message: state.error } : null };
} }) }));
import { PUT } from './route';
const req = (body: unknown) => new Request('https://printly.test/api/shop/availability', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { state.staff = { user: { id: 'owner' }, shopIds: ['shop'], isAdmin: false, membershipError: false }; state.result = false; state.error = ''; state.calls = []; });

describe('owner shop availability API', () => {
  it('uses the authenticated membership and database ownership check, not client-supplied shop or actor', async () => {
    expect((await PUT(req({ is_open: false, shop_id: 'another-shop' }))).status).toBe(422);
    const response = await PUT(req({ is_open: false }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ is_open: false });
    expect(state.calls).toEqual([{ p_shop_id: 'shop', p_actor_id: 'owner', p_is_open: false }]);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('denies nonmembers and admins and relies on the locked owner check for staff', async () => {
    state.staff = null; expect((await PUT(req({ is_open: false }))).status).toBe(403);
    state.staff = { user: { id: 'admin' }, shopIds: ['shop'], isAdmin: true }; expect((await PUT(req({ is_open: false }))).status).toBe(403);
    state.staff = { user: { id: 'staff' }, shopIds: ['shop'], isAdmin: false };
    state.error = 'SHOP_OWNER_REQUIRED'; expect((await PUT(req({ is_open: true }))).status).toBe(403);
  });
  it('does not claim success when a database response is unconfirmed', async () => {
    state.error = 'timeout'; const response = await PUT(req({ is_open: false }));
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('update_unconfirmed');
  });
});
