import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDraftToken } from '@/lib/draft-access';

const state = vi.hoisted(() => ({ order: {} as Record<string, unknown> | null, payment: {} as Record<string, unknown> | null, error: false, tables: [] as string[] }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: (table: string) => {
    state.tables.push(table);
    if (table !== 'orders' && table !== 'payments') throw new Error(`Unexpected table ${table}`);
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'orders' ? state.order : state.payment, error: state.error ? new Error('unavailable') : null }) }) }) };
  },
}) }));
import { POST } from './route';

const id = '11111111-1111-4111-8111-111111111111';
const secret = 'recovery-test-secret';
const quote = 'a'.repeat(64);
const params = { params: Promise.resolve({ id }) };
const check = (body: Record<string, unknown> = {}, authorized = true) => POST(new Request('https://printly.test/api', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { cookie: `printly-draft=${makeDraftToken(id, secret)}` } : {}) },
  body: JSON.stringify({ method: 'upi', quote_token: quote, ...body }),
}), params);

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', secret);
  state.order = { status: 'draft', payment_method: null, payment_status: 'pending', checkout_quote_token: null, total_paise: 0 };
  state.payment = { status: 'created', raw: { checkout_upi_id: 'original@upi', checkout_shop_name: 'Original Shop' } };
  state.error = false; state.tables = [];
});

describe('read-only checkout recovery', () => {
  it('requires the order-scoped capability and never starts an unconfirmed checkout', async () => {
    expect((await check({}, false)).status).toBe(403);
    const response = await check();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('checkout_unconfirmed');
    expect(state.tables).toEqual(['orders']);
  });
  it('recovers the original UPI details without consulting current shop availability or rates', async () => {
    state.order = { status: 'draft', payment_method: 'upi', payment_status: 'pending', checkout_quote_token: quote, total_paise: 1234 };
    const response = await check();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ mode: 'upi', pa: 'original@upi', shop_name: 'Original Shop', total_paise: 1234 });
    expect(state.tables).toEqual(['orders', 'payments']);
    expect((await check({ quote_token: 'b'.repeat(64) })).status).toBe(409);
    expect((await check({ method: 'cod' })).status).toBe(409);
  });
  it('returns tracking for a placed cash order or reported UPI payment', async () => {
    state.order = { status: 'queued', payment_method: 'cod', payment_status: 'cod_pending', checkout_quote_token: quote, total_paise: 100 };
    expect(await (await check({ method: 'cod' })).json()).toEqual({ mode: 'placed', total_paise: 100 });
    state.order = { status: 'draft', payment_method: 'upi', payment_status: 'submitted', checkout_quote_token: quote, total_paise: 100 };
    expect(await (await check()).json()).toEqual({ mode: 'placed', total_paise: 100 });
  });
});
