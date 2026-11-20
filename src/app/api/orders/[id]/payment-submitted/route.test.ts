import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  allowed: true,
  error: null as null | { message: string },
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));
vi.mock('@/lib/draft-access', () => ({ requestHasDraftAccess: () => state.allowed }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    return { error: state.error };
  },
}) }));
import { POST } from './route';

const params = { params: Promise.resolve({ id: 'order-1' }) };
const request = (body: unknown) => new Request('https://printly.test/api/orders/order-1/payment-submitted', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => { state.allowed = true; state.error = null; state.calls = []; });
describe('customer payment reporting', () => {
  it('does not accept a report without the draft session', async () => {
    state.allowed = false;
    expect((await POST(request({ utr: 'REF-123' }), params)).status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });
  it('accepts an empty optional body but rejects malformed or oversized reports', async () => {
    expect((await POST(new Request('https://printly.test/api', { method: 'POST' }), params)).status).toBe(200);
    expect(state.calls[0].args.p_utr).toBeNull();
    for (const body of ['{', JSON.stringify({ utr: 'x'.repeat(128 * 1024) })]) {
      expect((await POST(new Request('https://printly.test/api', { method: 'POST', body }), params)).status).toBe(422);
    }
    expect(state.calls).toHaveLength(1);
  });
  it('records a report transactionally and leaves confirmation to the shop', async () => {
    const response = await POST(request({ utr: ' REF-123 ' }), params);
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([{ name: 'submit_upi_payment', args: { p_order_id: 'order-1', p_utr: 'REF-123' } }]);
    state.error = { message: 'BAD_PAYMENT_STATE' };
    expect((await POST(request({}), params)).status).toBe(409);
  });
});
