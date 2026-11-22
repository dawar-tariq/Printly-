import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDraftToken } from '@/lib/draft-access';

const state = vi.hoisted(() => ({
  order: { id: '11111111-1111-4111-8111-111111111111', status: 'draft', payment_method: null as string | null },
  files: [] as Array<{ id: string; mime: string; page_count: number | null }>,
  inserted: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  rpc: async (name: string, args: { p_rows: Array<Record<string, unknown>> }) => {
    if (name !== 'replace_draft_items') throw new Error(`Unexpected RPC ${name}`);
    state.inserted = args.p_rows;
    return { data: args.p_rows.length, error: null };
  },
  from: (table: string) => {
    if (table === 'orders') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.order, error: null }) }) }) };
    if (table === 'order_files') return { select: () => ({ eq: () => ({ in: async (_key: string, ids: string[]) => ({ data: state.files.filter((file) => ids.includes(file.id)), error: null }) }) }) };
    if (table === 'order_items') return {
      delete: () => ({ eq: async () => { state.inserted = []; return { error: null }; } }),
      insert: async (rows: Array<Record<string, unknown>>) => { state.inserted = rows; return { error: null }; },
    };
    throw new Error(`Unexpected table ${table}`);
  },
}), createServerSupabase: vi.fn() }));
vi.mock('@/lib/subscription-server', () => ({ shopHasSubscription: async () => true }));
vi.mock('@/lib/rate-limit', () => ({ enforcePublicRateLimit: async () => null }));
vi.mock('@/lib/order-quote', () => ({ loadOrderWithRates: async () => ({
  order: { rush: false, status: 'draft', payment_method: null, draft_version: 1, shops: { rush_surcharge_bps: 1500 } },
  items: [{ service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, copies: 2, pages: 2 }],
  card: [{ service: 'print', paper_size: null, color: null, sides: null, paper_gsm: null, option: null, unit: 'page', price_paise: 200 }],
  gstBps: 1800, rushBps: 1000,
}) }));
import { PUT } from './items/route';
import { GET } from './quote/route';

const order = '11111111-1111-4111-8111-111111111111';
const pdfId = '33333333-3333-4333-8333-333333333333';
const wordId = '44444444-4444-4444-8444-444444444444';
const missingId = '55555555-5555-4555-8555-555555555555';
const secret = 'items-test-secret';
const params = { params: Promise.resolve({ id: order }) };
const cookie = () => `printly-draft=${makeDraftToken(order, secret)}`;
const put = (items: unknown[], withCookie = true) => PUT(new Request('https://example.test', { method: 'PUT', headers: { 'content-type': 'application/json', ...(withCookie ? { cookie: cookie() } : {}) }, body: JSON.stringify({ items }) }), params);
const item = (file_id: string, pages: number, service = 'print') => ({ file_id, service, copies: 2, pages, paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80 });

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', secret);
  state.order = { id: order, status: 'draft', payment_method: null };
  state.files = [{ id: pdfId, mime: 'application/pdf', page_count: 2 }, { id: wordId, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', page_count: null }];
  state.inserted = [];
});

describe('pricing uses the selected files', () => {
  it('rejects missing sessions, missing/other-order files and incorrect PDF counts', async () => {
    expect((await put([item(pdfId, 2)], false)).status).toBe(403);
    expect((await put([item(missingId, 2)])).status).toBe(422);
    expect((await put([item(pdfId, 1)])).status).toBe(422);
    expect(state.inserted).toEqual([]);
  });
  it('accepts the real PDF count, the customer-supplied Word count, and per-set binding', async () => {
    expect((await put([item(pdfId, 2), item(wordId, 6)])).status).toBe(200);
    expect(state.inserted.map((i) => i.pages)).toEqual([2, 6]);
    expect((await put([{ ...item(pdfId, 1, 'bind'), option: 'spiral' }])).status).toBe(200);
    expect((await put([{ ...item(pdfId, 2, 'bind'), option: 'spiral' }])).status).toBe(422);
  });
  it('does not let a draft change after checkout starts', async () => {
    state.order.payment_method = 'upi';
    expect((await put([item(pdfId, 2)])).status).toBe(409);
  });
  it('quotes the selected rush setting at the shop’s own rate', async () => {
    const request = (rush: string) => GET(new Request(`https://example.test?rush=${rush}`, { headers: { cookie: cookie() } }), params);
    const regular = await (await request('0')).json();
    const rush = await (await request('1')).json();
    expect(regular.quote.subtotalPaise).toBe(800);
    expect(regular.quote.rushFeePaise).toBe(0);
    expect(regular.quote.totalPaise).toBe(944);
    expect(rush.quote.rushFeePaise).toBe(120);
    expect(rush.quote.totalPaise).toBe(1086);
    expect(rush.rush).toBe(true);
    expect(regular.quote_token).toMatch(/^[0-9a-f]{64}$/);
    expect(rush.quote_token).not.toBe(regular.quote_token);
  });
});
