import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDraftToken } from '@/lib/draft-access';
import { computeQuote } from '@/lib/pricing';
import { quoteToken } from '@/lib/quote-token';

const state = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  items: [] as Array<Record<string, unknown>>,
  card: [] as Array<Record<string, unknown>>,
  payment: null as null | { status: string; raw: Record<string, unknown> },
  rpcCalls: [] as Array<Record<string, unknown>>,
  rpcError: '' as string,
}));

function admin() {
  return {
    from: (table: string) => {
      if (table !== 'payments') throw new Error(`Unexpected table ${table}`);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.payment, error: null }) }) }) };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'commit_draft_checkout') throw new Error(`Unexpected RPC ${name}`);
      state.rpcCalls.push(args);
      if (state.rpcError) return { data: null, error: { message: state.rpcError } };
      const checkout = args.p_checkout as Record<string, unknown>;
      const shop = args.p_shop as Record<string, unknown>;
      Object.assign(state.order, {
        payment_method: checkout.method, payment_status: checkout.method === 'cod' ? 'cod_pending' : 'pending',
        status: checkout.method === 'cod' ? 'queued' : 'draft', checkout_quote_token: checkout.quote_token, total_paise: checkout.total_paise,
      });
      state.payment = { status: 'created', raw: { checkout_upi_id: shop.upi_id, checkout_shop_name: shop.name } };
      return { data: { token: 'A-001' }, error: null };
    },
  };
}
vi.mock('@/lib/order-quote', () => ({ loadOrderWithRates: async () => ({
  admin: admin(), order: state.order, items: state.items, card: state.card, gstBps: 1800, rushBps: 1000,
}) }));

import { POST } from './route';

const orderId = '11111111-1111-4111-8111-111111111111';
const itemId = '33333333-3333-4333-8333-333333333333';
const secret = 'pay-test-secret';
const params = { params: Promise.resolve({ id: orderId }) };
const token = () => quoteToken(orderId, Number(state.order.draft_version), false, computeQuote(state.items as never[], state.card as never[], { rush: false, rushBps: 1500, gstBps: 1800 }));
const pay = (overrides: Record<string, unknown> = {}, authenticated = true) => POST(new Request('https://printly.test/api', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { cookie: `printly-draft=${makeDraftToken(orderId, secret)}` } : {}) },
  body: JSON.stringify({ method: 'cod', quote_token: token(), customer_name: 'Customer', customer_phone: '9797000000', customer_email: '', rush: false, ...overrides }),
}), params);

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', secret);
  state.order = { id: orderId, shop_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', draft_version: 3, status: 'draft', payment_method: null, payment_status: 'pending',
    shops: { name: 'Demo Prints', upi_id: 'demo@upi', eta_minutes: 20, commission_bps: 800, rush_surcharge_bps: 1500, status: 'active' } };
  state.items = [{ id: itemId, service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, copies: 2, pages: 2 }];
  state.card = [{ id: '55555555-5555-4555-8555-555555555555', service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: 200 }];
  state.payment = null; state.rpcCalls = []; state.rpcError = '';
});

describe('checkout uses the quote the customer reviewed', () => {
  it('requires the draft capability and a current quote', async () => {
    expect((await pay({}, false)).status).toBe(403);
    expect((await pay({ quote_token: undefined })).status).toBe(422);
    const stale = await pay({ quote_token: 'a'.repeat(64) });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe('quote_changed');
    expect(state.rpcCalls).toHaveLength(0);
  });
  it('rejects a race detected by the database and creates nothing', async () => {
    state.rpcError = 'PRICING_CHANGED';
    const result = await pay();
    expect(result.status).toBe(409);
    expect((await result.json()).error.code).toBe('quote_changed');
    expect(state.order.payment_method).toBeNull();
  });
  it('commits COD once and safely handles a lost response', async () => {
    const quoted = token();
    const result = await pay({ quote_token: quoted });
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(await result.json()).toEqual({ mode: 'cod', token: 'A-001', total_paise: 944 });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].p_lines).toEqual([{ id: itemId, unit_price_paise: 200, line_total_paise: 800 }]);
    expect(state.rpcCalls[0].p_rates).toEqual(state.card);
    expect(state.rpcCalls[0].p_checkout).toMatchObject({ quote_token: quoted, subtotal_paise: 800, tax_paise: 144, total_paise: 944 });
    const retry = await pay({ quote_token: quoted });
    expect(await retry.json()).toMatchObject({ mode: 'placed', total_paise: 944 });
    expect(state.rpcCalls).toHaveLength(1);
    expect((await pay({ quote_token: 'b'.repeat(64) })).status).toBe(409);
  });
  it('reopens the original UPI recipient and amount on retry, not a later shop setting', async () => {
    const quoted = token();
    const first = await pay({ method: 'upi', quote_token: quoted });
    expect(await first.json()).toMatchObject({ mode: 'upi', pa: 'demo@upi', total_paise: 944 });
    (state.order.shops as Record<string, unknown>).upi_id = 'changed@upi';
    const retry = await pay({ method: 'upi', quote_token: quoted });
    expect(await retry.json()).toMatchObject({ mode: 'upi', pa: 'demo@upi', total_paise: 944 });
    expect(state.rpcCalls).toHaveLength(1);
    state.order.payment_status = 'submitted';
    expect(await (await pay({ method: 'upi', quote_token: quoted })).json()).toMatchObject({ mode: 'placed' });
  });
  it('does not start UPI if the shop has no UPI ID', async () => {
    (state.order.shops as Record<string, unknown>).upi_id = null;
    expect((await pay({ method: 'upi' })).status).toBe(409);
    expect(state.rpcCalls).toHaveLength(0);
  });
});
