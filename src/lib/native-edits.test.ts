import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authorized: true, failWrite: false,
  stock: { id: '11111111-1111-4111-8111-111111111111', shop_id: 'shop', name: 'Paper', category: 'paper', qty: 10, unit: 'sheets', low_stock_threshold: 3 } as Record<string, unknown> | null,
  rate: { id: '22222222-2222-4222-8222-222222222222', shop_id: 'shop', service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: 200 } as Record<string, unknown> | null,
}));
vi.mock('@/lib/api', () => ({
  getStaffContext: async () => state.authorized ? { isAdmin: false, shopIds: ['shop'] } : null,
  assertStaffOfShop: async (shop: string) => state.authorized && shop === 'shop' ? { user: { id: 'member' } } : null,
  jsonOk: (value: unknown, init: ResponseInit = {}) => Response.json(value, init),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => {
  class Query {
    filters: Record<string, unknown> = {}; operation = 'read'; patch: Record<string, unknown> = {};
    constructor(private table: string) {}
    select() { return this; }
    eq(k: string, v: unknown) { this.filters[k] = v; return this; }
    is(k: string, v: unknown) { this.filters[k] = v; return this; }
    order() { return this; } limit() { return this; }
    update(data: Record<string, unknown>) { this.operation = 'update'; this.patch = data; return this; }
    delete() { this.operation = 'delete'; return this; }
    result(single: boolean) {
      const row = this.table === 'inventory_items' ? state.stock : state.rate;
      const matches = !!row && Object.entries(this.filters).every(([k, v]) => row[k] === v);
      if (this.operation !== 'read' && state.failWrite) return { data: null, error: { code: 'TIMEOUT' }, count: null };
      if (matches && this.operation === 'update' && row) Object.assign(row, this.patch);
      if (matches && this.operation === 'delete') { if (this.table === 'inventory_items') state.stock = null; else state.rate = null; }
      return { data: single ? (matches ? { ...row } : null) : (matches ? [{ ...row }] : []), error: null, count: matches ? 1 : 0 };
    }
    maybeSingle() { return Promise.resolve(this.result(true)); }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(this.result(false)).then(resolve, reject); }
  }
  return { createAdminSupabase: () => ({ from: (table: string) => new Query(table) }) };
});
import * as inventory from './native-inventory';
import * as rates from './native-rate-card';

const itemId = '11111111-1111-4111-8111-111111111111';
const rateId = '22222222-2222-4222-8222-222222222222';
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown, method = 'PATCH') => new Request('https://printly.test/api/native/v1/shop/test', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const expectedItem = () => ({ name: 'Paper', category: 'paper', qty: 10, unit: 'sheets', low_stock_threshold: 3 });
const expectedRate = () => ({ service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: 200 });
beforeEach(() => {
  state.authorized = true; state.failWrite = false;
  state.stock = { id: itemId, shop_id: 'shop', ...expectedItem() };
  state.rate = { id: rateId, shop_id: 'shop', ...expectedRate() };
});

describe('native safe edits', () => {
  it('only permits one concurrent stock edit from the same snapshot', async () => {
    const results = await Promise.all([
      inventory.PATCH(req({ expected: expectedItem(), set_qty: 11 }), context(itemId)),
      inventory.PATCH(req({ expected: expectedItem(), set_qty: 12 }), context(itemId)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect([11, 12]).toContain(state.stock?.qty);
  });
  it('detects metadata changes as well as quantity changes before editing or deleting', async () => {
    if (state.stock) state.stock.name = 'New name';
    expect((await inventory.PATCH(req({ expected: expectedItem(), set_qty: 11 }), context(itemId))).status).toBe(409);
    expect((await inventory.DELETE(req({ expected: expectedItem() }, 'DELETE'), context(itemId))).status).toBe(409);
    expect(state.stock?.qty).toBe(10);
  });
  it('does not allow another shop to mutate stock or prices', async () => {
    state.authorized = false;
    expect((await inventory.PATCH(req({ expected: expectedItem(), set_qty: 11 }), context(itemId))).status).toBe(403);
    expect((await rates.PATCH(req({ expected: expectedRate(), price_paise: 300 }), context(rateId))).status).toBe(403);
    expect(state.stock?.qty).toBe(10); expect(state.rate?.price_paise).toBe(200);
  });
  it('compares all old rate dimensions and price in the atomic update', async () => {
    const results = await Promise.all([
      rates.PATCH(req({ expected: expectedRate(), price_paise: 300 }), context(rateId)),
      rates.PATCH(req({ expected: expectedRate(), price_paise: 400 }), context(rateId)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    state.rate = { id: rateId, shop_id: 'shop', ...expectedRate(), sides: 'duplex' };
    expect((await rates.PATCH(req({ expected: expectedRate(), price_paise: 500 }), context(rateId))).status).toBe(409);
    expect(state.rate.price_paise).toBe(200);
  });
  it('fails closed on invalid payloads and unconfirmed database writes', async () => {
    expect((await inventory.PATCH(req({ expected: expectedItem(), adjust: 1 }), context(itemId))).status).toBe(422);
    expect((await rates.PATCH(req({ expected: expectedRate(), price_paise: 2.5 }), context(rateId))).status).toBe(422);
    state.failWrite = true;
    const response = await inventory.PATCH(req({ expected: expectedItem(), set_qty: 11 }), context(itemId));
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('update_unconfirmed');
  });
});
