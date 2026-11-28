import { beforeEach, describe, expect, it, vi } from 'vitest';
import { indiaDateKey } from '@/lib/shop-report-period';

const state = vi.hoisted(() => ({ authorized: true, orders: [] as Array<Record<string, unknown>>, count: 0, ranges: [] as Array<[number, number]>, filters: [] as Array<[string, unknown]>, error: false, rpcError: 'PGRST202', snapshot: null as unknown, rpcArgs: null as unknown }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), getStaffContext: async () => state.authorized ? { shopIds: ['shop'] } : null }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  rpc: async (_name: string, args: unknown) => { state.rpcArgs = args; return { data: state.snapshot, error: state.rpcError ? { code: state.rpcError } : null }; },
  from: () => {
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { state.filters.push([key, value]); return chain; },
      gte: (key: string, value: unknown) => { state.filters.push([`gte:${key}`, value]); return chain; },
      lte: (key: string, value: unknown) => { state.filters.push([`lte:${key}`, value]); return chain; },
      order: () => chain,
      range: async (start: number, end: number) => { state.ranges.push([start, end]); return { data: state.orders.slice(start, end + 1), count: state.count, error: state.error ? { code: 'db' } : null }; },
    };
    return chain;
  },
}) }));
import { GET } from './route';
const request = (query = '') => new Request(`https://printly.test/api/shop/reports${query}`);
beforeEach(() => { state.authorized = true; state.orders = []; state.count = 0; state.ranges = []; state.filters = []; state.error = false; state.rpcError = 'PGRST202'; state.snapshot = null; state.rpcArgs = null; });

describe('shop reports', () => {
  it('returns the single database snapshot for reports larger than a PostgREST page', async () => {
    const day = indiaDateKey(new Date());
    state.rpcError = '';
    state.snapshot = { orders_count: 1201, paid_orders_count: 1201, revenue_paise: 1201 * 123, service_counts: { print: 1201 }, daily: { [day]: { orders: 1201, revenue_paise: 1201 * 123 } } };
    const result = await GET(request('?range=day'));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ orders_count: 1201, paid_orders_count: 1201, revenue_paise: 1201 * 123, service_counts: { print: 1201 } });
    expect(state.rpcArgs).toMatchObject({ p_shop: 'shop' });
    expect(state.ranges).toEqual([]);
  });
  it('uses one complete bounded query when the snapshot migration is not installed', async () => {
    state.orders = Array.from({ length: 3 }, (_, index) => ({ id: String(index), total_paise: 123, payment_status: 'confirmed', created_at: new Date().toISOString(), order_items: [{ service: 'print' }] }));
    state.count = state.orders.length;
    const result = await GET(request('?range=day'));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ orders_count: 3, paid_orders_count: 3, revenue_paise: 369, service_counts: { print: 3 } });
    expect(state.ranges).toEqual([[0, 999]]);
    expect(state.filters).toContainEqual(['shop_id', 'shop']);
    expect(state.filters.some(([key]) => key === 'lte:created_at')).toBe(true);
  });
  it('fails closed for another shop, an inconsistent snapshot or a database failure', async () => {
    state.authorized = false; expect((await GET(request())).status).toBe(403);
    state.authorized = true; expect((await GET(request('?shop_id=other'))).status).toBe(403);
    state.error = true; expect((await GET(request())).status).toBe(503);
    state.rpcError = ''; state.snapshot = { orders_count: 1, paid_orders_count: 1, revenue_paise: 10, service_counts: {}, daily: {} };
    expect((await GET(request())).status).toBe(503);
    state.rpcError = '42501'; state.error = false; state.ranges = [];
    expect((await GET(request())).status).toBe(503); expect(state.ranges).toEqual([]);
  });
  it('refuses incomplete or multi-page fallback reports instead of showing partial totals', async () => {
    state.count = 1001;
    const tooLarge = await GET(request('?range=month'));
    expect(tooLarge.status).toBe(503); expect((await tooLarge.json()).error.code).toBe('report_too_large');
    state.count = 1;
    const incomplete = await GET(request());
    expect(incomplete.status).toBe(503); expect((await incomplete.json()).error.code).toBe('report_incomplete');
  });
});
