import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  signedIn: true, authorized: true,
  rpcError: null as null | { code?: string; message: string },
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  getStaffContext: async () => state.signedIn ? { shopIds: ['shop-1'] } : null,
  assertStaffOfShop: async (shop: string) => state.authorized && shop === 'shop-1' ? {} : null,
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    return { data: state.rpcError ? null : 1, error: state.rpcError };
  },
}) }));
import { PUT } from './route';

const row = { service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: 200 };
const request = (rows: unknown = [row], query = '') => new Request(`https://printly.test/api/shop/rate-card${query}`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows }),
});

beforeEach(() => { state.signedIn = true; state.authorized = true; state.rpcError = null; state.calls = []; });
describe('rate-card replacement', () => {
  it('checks sign-in, validation and membership before invoking the transaction', async () => {
    state.signedIn = false;
    expect((await PUT(request())).status).toBe(401);
    state.signedIn = true;
    expect((await PUT(request([]))).status).toBe(422);
    state.authorized = false;
    expect((await PUT(request())).status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });
  it('submits one atomic database replacement for the authorized shop', async () => {
    const response = await PUT(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, count: 1 });
    expect(state.calls).toEqual([{ name: 'replace_shop_rate_card', args: { p_shop_id: 'shop-1', p_rows: [row] } }]);
  });
  it('accepts explicit physical-sheet duplex rates for print and photocopy only', async () => {
    const duplex = { ...row, sides: 'duplex', unit: 'duplex_sheet', price_paise: 300 };
    const photocopy = { ...duplex, service: 'photocopy' };
    expect((await PUT(request([row, duplex, photocopy]))).status).toBe(200);
    expect(state.calls[0].args.p_rows).toEqual([row, duplex, photocopy]);
    state.calls = [];
    for (const bad of [
      { ...duplex, sides: 'single' }, { ...duplex, sides: null },
      { ...duplex, service: 'scan' }, { ...duplex, service: 'laminate' },
    ]) {
      const response = await PUT(request([bad]));
      expect(response.status).toBe(422);
      expect((await response.json()).error.message).toMatch(/double-sided print or photocopy/i);
    }
    expect(state.calls).toHaveLength(0);
  });
  it('rejects ambiguous new sheet rates but accepts a more specific duplex rate', async () => {
    const wildcard = { ...row, sides: null, unit: 'page' };
    const overlapping = { ...row, sides: 'duplex', paper_gsm: null, unit: 'duplex_sheet' };
    const rejected = await PUT(request([wildcard, overlapping]));
    expect(rejected.status).toBe(422);
    expect((await rejected.json()).error.message).toMatch(/overlaps another equally specific rate/i);
    expect(state.calls).toHaveLength(0);
    expect((await PUT(request([wildcard, { ...overlapping, paper_gsm: 80 }]))).status).toBe(200);
    expect(state.calls).toHaveLength(1);
  });
  it('continues to accept existing legacy sheet rates without rewriting them', async () => {
    const legacy = { ...row, sides: 'duplex', unit: 'sheet', price_paise: 300 };
    expect((await PUT(request([legacy]))).status).toBe(200);
    expect(state.calls[0].args.p_rows).toEqual([legacy]);
  });
  it('explains duplicate options and reports a database failure without claiming success', async () => {
    state.rpcError = { code: '23505', message: 'duplicate key' };
    const duplicate = await PUT(request());
    expect(duplicate.status).toBe(422);
    expect((await duplicate.json()).error.code).toBe('duplicate_rate');
    state.rpcError = { message: 'database unavailable' };
    expect((await PUT(request()).catch(() => null))?.status).toBe(503);
  });
});
