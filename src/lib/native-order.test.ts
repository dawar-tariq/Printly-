import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ failed: '', authorized: true }));
vi.mock('@/lib/api', () => ({
  assertStaffOfShop: async () => state.authorized ? {} : null,
  jsonOk: (value: unknown, init: ResponseInit = {}) => Response.json(value, init),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ from: (table: string) => {
  const result = () => ({ data: table === 'orders' ? { id: 'order', shop_id: 'shop' } : table === 'payments' ? null : [], error: state.failed === table ? { code: 'DB' } : null });
  const query = { select: () => query, eq: () => query, order: () => query, maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject) };
  return query;
} }) }));
import { GET } from './native-order';
const context = { params: Promise.resolve({ id: 'order' }) };
const req = () => new Request('https://printly.test/order');
beforeEach(() => { state.failed = ''; state.authorized = true; });
describe('native order detail', () => {
  it('returns a complete authorized detail', async () => {
    const response = await GET(req(), context);
    expect(response.status).toBe(200); expect((await response.json()).files).toEqual([]);
  });
  it('never treats failed file, item, event or payment reads as empty data', async () => {
    for (const table of ['orders', 'order_files', 'order_items', 'order_status_events', 'payments']) {
      state.failed = table; expect((await GET(req(), context)).status, table).toBe(503);
    }
  });
  it('does not expose details to nonmembers', async () => {
    state.authorized = false; expect((await GET(req(), context)).status).toBe(403);
  });
});
