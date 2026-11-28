import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authorized: true,
  exists: true,
  rpcError: null as null | { message: string },
  rpcData: { outcome: 'submitted' } as Record<string, unknown>,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  assertStaffOfShop: async (shop: string) => state.authorized && shop === 'shop-1' ? { user: { id: 'staff-1' } } : null,
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.exists ? { id: 'order-1', shop_id: 'shop-1' } : null }) }) }) }),
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    return { data: state.rpcError ? null : state.rpcData, error: state.rpcError };
  },
}) }));
import { POST } from './route';

const params = { params: Promise.resolve({ id: 'order-1' }) };
const request = (body: unknown) => new Request('https://printly.test/api/shop/orders/order-1/confirm-payment', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => { state.authorized = true; state.exists = true; state.rpcError = null; state.rpcData = { outcome: 'submitted' }; state.calls = []; });
describe('staff payment recovery', () => {
  it('requires a valid action and staff membership before recording a report', async () => {
    expect((await POST(request({ action: 'unknown' }), params)).status).toBe(422);
    state.exists = false;
    expect((await POST(request({ action: 'report' }), params)).status).toBe(404);
    state.exists = true; state.authorized = false;
    expect((await POST(request({ action: 'report' }), params)).status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });
  it('records the claim with the staff actor and does not confirm the payment', async () => {
    const response = await POST(request({ action: 'report', utr: '  REF-123  ' }), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: 'submitted' });
    expect(state.calls).toEqual([{ name: 'decide_shop_upi_payment_checked', args: {
      p_order_id: 'order-1', p_shop_id: 'shop-1', p_action: 'report', p_actor: 'staff-1', p_utr: 'REF-123', p_acknowledge_duplicate: false,
    } }]);
  });
  it('requires an explicit independent-verification acknowledgement and surfaces a duplicate without confirming', async () => {
    expect((await POST(request({ action: 'confirm' }), params)).status).toBe(422);
    expect(state.calls).toHaveLength(0);
    state.rpcData = { outcome: 'possible_duplicate', duplicate_count: 1, duplicates: [{ id: 'other-order', payment_status: 'confirmed' }] };
    const warning = await POST(request({ action: 'confirm', verification_confirmed: true }), params);
    expect(warning.status).toBe(409);
    expect(await warning.json()).toMatchObject({ error: { code: 'possible_duplicate' }, duplicate_count: 1 });
    expect(state.calls[0].args.p_acknowledge_duplicate).toBe(false);
    state.rpcData = { outcome: 'confirmed', token: 'A-001' };
    const confirmed = await POST(request({ action: 'confirm', verification_confirmed: true, duplicate_acknowledged: true }), params);
    expect(confirmed.status).toBe(200);
    expect(state.calls[1].args.p_acknowledge_duplicate).toBe(true);
  });
  it('reports an invalid payment state without claiming success', async () => {
    state.rpcError = { message: 'BAD_PAYMENT_STATE' };
    const response = await POST(request({ action: 'report' }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('bad_state');
  });
});
