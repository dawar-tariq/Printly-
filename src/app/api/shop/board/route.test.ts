import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ session: true, admin: false, shops: ['shop-1'] as string[], fail: -1, queries: [] as Array<Array<unknown[]>> }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  getStaffContext: async () => state.session ? {
    isAdmin: state.admin, shopIds: state.shops, admin: { from: () => {
      const index = state.queries.length;
      const ops: Array<unknown[]> = []; state.queries.push(ops);
      const result = () => ({ data: [], count: 0, error: state.fail === index ? { code: 'bad' } : null });
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'in', 'or', 'order', 'gte']) chain[name] = (...args: unknown[]) => { ops.push([name, ...args]); return chain; };
      chain.range = (...args: unknown[]) => { ops.push(['range', ...args]); return Promise.resolve(result()); };
      chain.limit = (...args: unknown[]) => { ops.push(['limit', ...args]); return Promise.resolve(result()); };
      chain.then = (resolve: (v: unknown) => void) => resolve(result());
      return chain;
    } },
  } : null,
}));
import { POST } from './route';
import { boardOrderId, boardSearch, startOfIndiaDay } from '@/lib/shop-board';
const req = (body: unknown) => new Request('https://printly.test/api/shop/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { state.session = true; state.admin = false; state.shops = ['shop-1']; state.fail = -1; state.queries = []; });

describe('authenticated paginated board', () => {
  it('requires active shop membership and rejects cross-shop selection', async () => {
    state.session = false; expect((await POST(req({}))).status).toBe(401);
    state.session = true; state.admin = true; expect((await POST(req({}))).status).toBe(403);
    state.admin = false; state.shops = []; expect((await POST(req({}))).status).toBe(403);
    state.shops = ['shop-1']; expect((await POST(req({ shop_id: 'shop-2' }))).status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });
  it('scopes every query to the authorized shop and sanitizes search syntax', async () => {
    const response = await POST(req({ search: ' A-12),status.eq.confirmed%_ ', pages: { queued: 5, printing: -1, ready: 2, confirm: 'bad' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    expect(state.queries).toHaveLength(6);
    expect(state.queries.every((ops) => ops.some((op) => op[0] === 'eq' && op[1] === 'shop_id' && op[2] === 'shop-1'))).toBe(true);
    expect(state.queries[1]).toContainEqual(['range', 120, 149]);
    expect(state.queries[2]).toContainEqual(['range', 0, 29]);
    expect(state.queries[3]).toContainEqual(['range', 30, 59]);
    const search = String(state.queries[0].find((op) => op[0] === 'or')?.[1]);
    expect(search).not.toContain('),');
    expect(boardSearch(' A-12),status.eq.confirmed%_ ')).toBe('A-12 status eq confirmed');
    expect(search).toContain('customer_phone.ilike.');
    expect(boardSearch('नमस्ते، اردو')).toBe('नमस्ते اردو');
  });
  it('finds an exact full order ID without weakening shop scoping or interpreting filter syntax', async () => {
    const id = 'abcdefab-1234-4234-8234-abcdefabcdef';
    const response = await POST(req({ search: `  ${id.toUpperCase()}  ` }));
    expect(response.status).toBe(200);
    for (const ops of state.queries.slice(0, 4)) {
      expect(ops).toContainEqual(['eq', 'shop_id', 'shop-1']);
      expect(ops).toContainEqual(['eq', 'id', id]);
      expect(ops.some((op) => op[0] === 'or')).toBe(false);
    }
    expect(boardOrderId(`${id},status.eq.queued`)).toBeNull();
    expect(boardOrderId(id.slice(0, 8))).toBeNull();
  });
  it('fails the entire snapshot when any lane or count is unavailable', async () => {
    state.fail = 2;
    const response = await POST(req({}));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('db');
  });
  it('calculates today in India time regardless of the server timezone', () => {
    expect(startOfIndiaDay(new Date('2026-11-19T18:40:00Z'))).toBe('2026-11-19T18:30:00.000Z');
    expect(startOfIndiaDay(new Date('2026-11-19T05:00:00Z'))).toBe('2026-11-18T18:30:00.000Z');
  });
});
