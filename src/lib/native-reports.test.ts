import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  allowed: true, data: [] as Array<Record<string, unknown>>, count: 0 as number | null, error: null as unknown,
  filters: {} as Record<string, unknown>,
}));
vi.mock('@/lib/api', () => ({
  getStaffContext: async () => state.allowed ? { isAdmin: false, shopIds: ['shop'] } : null,
  jsonOk: (value: unknown, init: ResponseInit = {}) => Response.json(value, init),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ from: () => {
  const query = {
    select: () => query, eq: (k: string, v: unknown) => { state.filters[k] = v; return query; },
    gte: (k: string, v: unknown) => { state.filters[`gte_${k}`] = v; return query; },
    lte: (k: string, v: unknown) => { state.filters[`lte_${k}`] = v; return query; },
    order: () => query, range: () => Promise.resolve({ data: state.data, count: state.count, error: state.error }),
  };
  return query;
} }) }));
import { GET } from './native-reports';
const req = (path = 'reports?range=day') => new Request(`https://printly.test/api/native/v1/shop/${path}`);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-19T20:00:00Z'));
  state.allowed = true; state.error = null; state.filters = {};
  state.data = [
    { total_paise: 1250, payment_status: 'confirmed', created_at: '2026-11-19T18:45:00Z', order_items: [{ service: 'print' }] },
    { total_paise: 500, payment_status: 'pending', created_at: '2026-11-19T19:00:00Z', order_items: [{ service: 'print' }, { service: 'bind' }] },
  ]; state.count = state.data.length;
});
afterEach(() => vi.useRealTimers());

describe('bounded native reports', () => {
  it('uses India calendar boundaries and reports paid orders by creation date', async () => {
    const response = await GET(req()); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.filters).toMatchObject({ shop_id: 'shop', gte_created_at: '2026-11-19T18:30:00.000Z', lte_created_at: '2026-11-19T20:00:00.000Z' });
    expect(body).toMatchObject({ orders_count: 2, paid_orders_count: 1, revenue_paise: 1250, avg_order_paise: 1250, service_counts: { print: 2, bind: 1 } });
    expect(body.series).toEqual([{ day: '20 Nov', orders: 2, revenue_paise: 1250 }]);
  });
  it('rejects truncation, oversized periods and malformed financial data', async () => {
    state.count = 1001; let response = await GET(req());
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('report_too_large');
    state.count = 3; response = await GET(req());
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('report_incomplete');
    state.count = 2; state.data[0].total_paise = -1; response = await GET(req());
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('report_invalid');
  });
  it('rejects cross-shop and invalid period requests', async () => {
    expect((await GET(req('reports?shop_id=other'))).status).toBe(403);
    expect((await GET(req('reports?range=all'))).status).toBe(422);
    state.allowed = false; expect((await GET(req())).status).toBe(403);
  });
});
