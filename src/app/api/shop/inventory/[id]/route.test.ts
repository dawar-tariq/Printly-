import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authorized: true, readError: false, writeError: false, conflict: false,
  item: { id: 'item', shop_id: 'shop', qty: 100, unit: 'sheets' }, updates: [] as unknown[], filters: [] as Array<[string, unknown]> }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), assertStaffOfShop: async () => state.authorized ? {} : null }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ from: () => {
  let writing = false;
  const chain = {
    select: (_columns: string) => chain,
    update: (value: unknown) => { writing = true; state.updates.push(value); return chain; },
    delete: () => { writing = true; return chain; },
    eq: (key: string, value: unknown) => { if (writing) state.filters.push([key, value]); return chain; },
    maybeSingle: async () => writing ? { data: state.conflict ? null : { id: 'item' }, error: state.writeError ? { code: 'db' } : null }
      : { data: state.item, error: state.readError ? { code: 'db' } : null },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: state.writeError ? { code: 'db' } : null }).then(resolve),
  };
  return chain;
} }) }));
import { PATCH } from './route';
const params = { params: Promise.resolve({ id: 'item' }) };
const patch = (body: unknown) => new Request('https://printly.test/api/shop/inventory/item', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { state.authorized = true; state.readError = false; state.writeError = false; state.conflict = false; state.updates = []; state.filters = []; });

describe('inventory adjustments', () => {
  it('compares the old quantity before writing an adjustment', async () => {
    expect((await PATCH(patch({ adjust: 10 }), params)).status).toBe(200);
    expect(state.updates).toEqual([{ qty: 110 }]);
    expect(state.filters).toContainEqual(['shop_id', 'shop']);
    expect(state.filters).toContainEqual(['qty', 100]);
  });
  it('reports a competing write rather than silently overwriting it', async () => {
    state.conflict = true;
    const response = await PATCH(patch({ adjust: -10 }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('stock_changed');
  });
  it('rejects ambiguous or excessive quantity updates', async () => {
    expect((await PATCH(patch({ set_qty: 10, adjust: 1 }), params)).status).toBe(422);
    expect((await PATCH(patch({ adjust: 1_000_000 }), params)).status).toBe(422);
    expect(state.updates).toHaveLength(0);
  });
  it('fails closed on unavailable records or unauthorized shop members', async () => {
    state.readError = true; expect((await PATCH(patch({ adjust: 1 }), params)).status).toBe(503);
    state.readError = false; state.authorized = false; expect((await PATCH(patch({ adjust: 1 }), params)).status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });
});
