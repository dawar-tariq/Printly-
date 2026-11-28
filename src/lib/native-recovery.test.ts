import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  authorized: true, fail: false, count: 1 as number | null,
  rows: [{ id: 'order' }] as Array<{ id: string }>, filters: {} as Record<string, unknown>,
}));
vi.mock('@/lib/api', () => {
  const admin = { from: () => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { state.filters[key] = value; return query; },
      or: (value: string) => { state.filters.or = value; return query; },
      order: () => query,
      range: async (first: number, last: number) => { state.filters.range = [first, last]; return { data: state.rows, count: state.count, error: state.fail ? { code: 'DB' } : null }; },
    };
    return query;
  } };
  return {
    getStaffContext: async (options: { allowExpired?: boolean }) => state.authorized && options.allowExpired
      ? { isAdmin: false, shopIds: ['shop'], admin } : null,
    jsonOk: (value: unknown, init: ResponseInit = {}) => Response.json(value, init),
    jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
  };
});
import { GET } from './native-recovery';
const req = (query = '') => new Request(`https://printly.test/api/native/v1/shop/recovery${query}`);
beforeEach(() => { state.authorized = true; state.fail = false; state.count = 1; state.rows = [{ id: 'order' }]; state.filters = {}; });
describe('native open-order recovery', () => {
  it('permits an expired member to load a complete, shop-scoped page', async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orders: [{ id: 'order' }], pagination: { page: 1, pages: 1, count: 1 } });
    expect(state.filters.shop_id).toBe('shop');
    expect(state.filters.or).toContain('payment_method.eq.upi');
    expect(state.filters.range).toEqual([0, 29]);
  });
  it('does not masquerade missing counts, truncated results, or database errors as empty pages', async () => {
    state.count = null; expect((await GET(req())).status).toBe(503);
    state.count = 2; expect((await GET(req())).status).toBe(503);
    state.count = 1; state.fail = true; expect((await GET(req())).status).toBe(503);
  });
  it('paginates consistently and rejects other shops or missing membership', async () => {
    state.count = 31; state.rows = [{ id: 'last' }];
    const page = await GET(req('?page=2'));
    expect((await page.json()).pagination).toEqual({ page: 2, pages: 2, count: 31 });
    expect(state.filters.range).toEqual([30, 59]);
    expect((await GET(req('?shop_id=another'))).status).toBe(403);
    state.authorized = false; expect((await GET(req())).status).toBe(403);
  });
});
