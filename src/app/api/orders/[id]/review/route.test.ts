import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ calls: [] as string[], error: null as null | { code: string } }));
vi.mock('@/lib/rate-limit', () => ({ enforcePublicRateLimit: async () => null }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ from: (table: string) => {
  state.calls.push(table);
  if (table === 'orders') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'order', shop_id: 'shop', status: 'collected' } }) }) }) };
  if (table === 'reviews') return { insert: async () => ({ error: state.error }) };
  throw new Error(`Unexpected table ${table}`);
} }) }));
import { POST } from './route';
const request = () => new Request('https://printly.test/api/orders/order/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating: 5 }) });
const params = { params: Promise.resolve({ id: 'order' }) };
beforeEach(() => { state.calls = []; state.error = null; });
it('leaves aggregate calculation to the database and handles duplicate ratings', async () => {
  expect((await POST(request(), params)).status).toBe(200);
  expect(state.calls).toEqual(['orders', 'reviews']);
  state.error = { code: '23505' };
  const duplicate = await POST(request(), params);
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.code).toBe('already_reviewed');
});
