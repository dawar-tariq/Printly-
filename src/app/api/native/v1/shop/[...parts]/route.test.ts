import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  userA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  shopA: '11111111-1111-4111-8111-111111111111', shopB: '22222222-2222-4222-8222-222222222222',
  orderA: '33333333-3333-4333-8333-333333333333', orderB: '44444444-4444-4444-8444-444444444444',
  draftB: '55555555-5555-4555-8555-555555555555', fileA: '66666666-6666-4666-8666-666666666666',
  cookieCalls: 0, tokenCalls: [] as string[], rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  pushConfigured: true, pushRateAllowed: true,
}));

vi.mock('@/lib/supabase-client', () => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON: 'public-anon' }));
vi.mock('@/lib/native-push-server', () => ({ nativePushConfig: () => fixture.pushConfigured ? { cronSecret: 'configured' } : null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: async (token: string) => {
  fixture.tokenCalls.push(token);
  // Force overlap so request-local identity must survive asynchronous work.
  await new Promise((resolve) => setTimeout(resolve, token === 'tokenA' ? 12 : 1));
  if (token === 'auth-down') return { data: { user: null }, error: { status: 503 } };
  const id = token === 'tokenA' ? fixture.userA : token === 'tokenB' ? fixture.userB : null;
  return { data: { user: id ? { id } : null }, error: id ? null : { status: 401 } };
} } }) }));

vi.mock('@/lib/supabase', () => {
  const orders = [
    { id: fixture.orderA, shop_id: fixture.shopA, status: 'draft', payment_method: 'upi', payment_status: 'submitted', customer_name: 'A' },
    { id: fixture.orderB, shop_id: fixture.shopB, status: 'queued', payment_method: 'cod', payment_status: 'cod_pending', customer_name: 'B' },
    { id: fixture.draftB, shop_id: fixture.shopB, status: 'draft', payment_method: 'cod', payment_status: 'pending', customer_name: 'B' },
  ];
  class Query {
    table: string; filters: Record<string, unknown> = {}; selection = ''; operation = 'read'; payload: unknown; orFilter = '';
    constructor(table: string) { this.table = table; }
    select(selection: string) { this.selection = selection; return this; }
    eq(key: string, value: unknown) { this.filters[key] = value; return this; }
    in(key: string, values: unknown[]) { this.filters[key] = values; return this; }
    order() { return this; } range() { return this; } limit() { return this; }
    or(filter: string) { this.orFilter = filter; return this; }
    update(payload: unknown) { this.operation = 'update'; this.payload = payload; return this; }
    insert(payload: unknown) { this.operation = 'insert'; this.payload = payload; return this; }
    result(single: boolean) {
      let rows: Array<Record<string, unknown>> = [];
      if (this.table === 'profiles') rows = [{ id: this.filters.id, role: 'shop' }];
      if (this.table === 'shop_staff') rows = [{ user_id: fixture.userA, shop_id: fixture.shopA }, { user_id: fixture.userB, shop_id: fixture.shopB }];
      if (this.table === 'shop_subscriptions') rows = [
        { shop_id: fixture.shopA, is_permanent: true, expires_at: null },
        { shop_id: fixture.shopB, is_permanent: false, expires_at: '2000-01-01T00:00:00Z' },
      ];
      if (this.table === 'shops') rows = [
        { id: fixture.shopA, owner_id: fixture.userA, name: 'Shop A' }, { id: fixture.shopB, owner_id: fixture.userB, name: 'Shop B' },
      ];
      if (this.table === 'orders') rows = orders;
      if (this.table === 'order_files') rows = [{ id: fixture.fileA, order_id: fixture.orderA, shop_id: fixture.shopA, storage_path: 'x/file.pdf', original_name: 'file.pdf' }];
      for (const [key, value] of Object.entries(this.filters)) {
        rows = rows.filter((row) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
      }
      if (this.table === 'orders' && this.orFilter === 'status.in.(queued,printing,ready),and(status.eq.draft,payment_method.eq.upi)') {
        rows = rows.filter((row) => ['queued', 'printing', 'ready'].includes(String(row.status)) || (row.status === 'draft' && row.payment_method === 'upi'));
      }
      if (this.table === 'shop_services' || this.table === 'shop_onboarding' || this.table === 'order_items' || this.table === 'order_status_events' || this.table === 'payments') rows = [];
      if (this.operation === 'update' && rows[0]) rows = [{ ...rows[0], ...(this.payload as object) }];
      return { data: single ? rows[0] ?? null : rows, error: null, count: rows.length };
    }
    single() { return Promise.resolve(this.result(true)); }
    maybeSingle() { return Promise.resolve(this.result(true)); }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(this.result(false)).then(resolve, reject); }
  }
  const admin = {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      fixture.rpcCalls.push({ name, args });
      if (name === 'decide_shop_upi_payment_checked') return { data: args.p_acknowledge_duplicate ? { outcome: 'confirmed' } : { outcome: 'possible_duplicate', duplicate_count: 1, duplicates: [] }, error: null };
      if (name === 'consume_public_rate_limit') return { data: { allowed: fixture.pushRateAllowed, retry_after: 60 }, error: null };
      return { data: null, error: null };
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.supabase.co/storage/v1/object/sign/order-files/x/file.pdf?token=short' }, error: null }) }) },
  };
  return {
    createServerSupabase: async () => { fixture.cookieCalls += 1; throw new Error('Native request used browser cookies'); },
    createAdminSupabase: () => admin,
  };
});

import { DELETE, GET, POST } from './route';

function request(path: string, token: string | null, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { cookie: 'untrusted-browser-cookie=present' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://printly.test/api/native/v1/shop/${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
// Construct params explicitly; the HTTP router normally supplies decoded path segments.
function context(path: string) { return { params: Promise.resolve({ parts: path.split('?')[0].split('/') }) }; }

beforeEach(() => { fixture.cookieCalls = 0; fixture.tokenCalls = []; fixture.rpcCalls = []; fixture.pushConfigured = true; fixture.pushRateAllowed = true; });

describe('native bearer gateway', () => {
  it('rejects missing, malformed and invalid tokens without falling back to cookies', async () => {
    for (const token of [null, 'bad.token', 'bad token']) {
      const response = await GET(request('me', token), context('me'));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    expect(fixture.cookieCalls).toBe(0);
    expect(fixture.tokenCalls).toEqual(['bad.token']);
  });
  it('returns service unavailable rather than accepting a token when auth is unreachable', async () => {
    const response = await GET(request('me', 'auth-down'), context('me'));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('auth_unavailable');
  });
  it('verifies every request, isolates simultaneous identities, and keeps browser auth unused', async () => {
    const calls = Array.from({ length: 6 }, (_, index) => GET(request('me', index % 2 ? 'tokenB' : 'tokenA'), context('me')));
    const responses = await Promise.all(calls);
    for (let i = 0; i < responses.length; i++) {
      if (i % 2) expect(responses[i].status).toBe(403); // expired shop cannot use normal me
      else { expect(responses[i].status).toBe(200); expect((await responses[i].json()).shop.id).toBe(fixture.shopA); }
      expect(responses[i].headers.get('vary')).toContain('Authorization');
    }
    expect(fixture.tokenCalls).toHaveLength(6);
    expect(fixture.cookieCalls).toBe(0);
  });
  it('allows only eligible recovery for an expired member and rejects cross-shop access', async () => {
    const list = await GET(request('recovery', 'tokenB'), context('recovery'));
    expect(list.status).toBe(200);
    expect((await list.json()).orders.map((entry: { id: string }) => entry.id)).toEqual([fixture.orderB]);
    const own = `orders/${fixture.orderB}`;
    expect((await GET(request(own, 'tokenB'), context(own))).status).toBe(200);
    const unpaidDraft = `orders/${fixture.draftB}`;
    expect((await GET(request(unpaidDraft, 'tokenB'), context(unpaidDraft))).status).toBe(403);
    const other = `orders/${fixture.orderA}`;
    expect((await GET(request(other, 'tokenB'), context(other))).status).toBe(403);
    expect((await GET(request(`recovery?shop_id=${fixture.shopA}`, 'tokenB'), context('recovery'))).status).toBe(403);
  });
  it('enforces payment verification and duplicate acknowledgement through the real handler', async () => {
    const path = `orders/${fixture.orderA}/confirm-payment`;
    const noCheck = await POST(request(path, 'tokenA', 'POST', { action: 'confirm' }), context(path));
    expect(noCheck.status).toBe(422); expect(fixture.rpcCalls).toHaveLength(0);
    const duplicate = await POST(request(path, 'tokenA', 'POST', { action: 'confirm', verification_confirmed: true, utr: 'REF123456' }), context(path));
    expect(duplicate.status).toBe(409); expect((await duplicate.json()).error.code).toBe('possible_duplicate');
    expect(fixture.rpcCalls[0].args).toMatchObject({ p_order_id: fixture.orderA, p_shop_id: fixture.shopA, p_actor: fixture.userA, p_acknowledge_duplicate: false });
    const approved = await POST(request(path, 'tokenA', 'POST', { action: 'confirm', verification_confirmed: true, duplicate_acknowledged: true, utr: 'REF123456' }), context(path));
    expect(approved.status).toBe(200); expect(fixture.rpcCalls[1].args.p_acknowledge_duplicate).toBe(true);
  });
  it('only redirects authorized file access to the signed URL with private headers', async () => {
    const path = `orders/${fixture.orderA}/files/${fixture.fileA}/download`;
    const ok = await GET(request(path, 'tokenA'), context(path));
    expect(ok.status).toBe(302); expect(ok.headers.get('location')).toContain('/storage/v1/object/sign/order-files/');
    expect(ok.headers.get('cache-control')).toContain('no-store');
    expect((await GET(request(path, 'tokenB'), context(path))).status).toBe(403);
  });
  it('registers notifications only for the verified member and lets that account disable them', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only-test-key');
    try {
      const path = 'push-device';
      const binding = '77777777-7777-4777-8777-777777777777';
      const body = { shop_id: fixture.shopA, binding_id: binding, fid: 'A'.repeat(22) };
      expect((await POST(request(path, null, 'POST', body), context(path))).status).toBe(401);
      expect((await POST(request(path, 'tokenA', 'POST', { ...body, user_id: fixture.userB }), context(path))).status).toBe(422);
      expect((await POST(request(path, 'tokenB', 'POST', body), context(path))).status).toBe(403);
      expect(fixture.rpcCalls.some((call) => call.name === 'register_native_push_device')).toBe(false);
      fixture.pushRateAllowed = false;
      expect((await POST(request(path, 'tokenA', 'POST', body), context(path))).status).toBe(429);
      fixture.pushRateAllowed = true;
      expect((await POST(request(path, 'tokenA', 'POST', body), context(path))).status).toBe(200);
      expect(fixture.rpcCalls.find((call) => call.name === 'register_native_push_device')?.args).toEqual({
        p_user: fixture.userA, p_shop: fixture.shopA, p_binding: binding, p_fid: 'A'.repeat(22),
      });
      const v2 = { ...body, version_code: 5, version_name: '2.1.0' };
      expect((await POST(request(path, 'tokenA', 'POST', v2), context(path))).status).toBe(200);
      expect(fixture.rpcCalls.find((call) => call.name === 'register_native_push_device_v2')?.args).toEqual({
        p_user: fixture.userA, p_shop: fixture.shopA, p_binding: binding, p_fid: 'A'.repeat(22), p_version_code: 5, p_version_name: '2.1.0',
      });
      expect((await POST(request(path, 'tokenA', 'POST', { ...v2, version_code: -1 }), context(path))).status).toBe(422);
      const receipt = { binding_id: binding, event_id: fixture.orderA };
      expect((await POST(request('push-display', null, 'POST', receipt), context('push-display'))).status).toBe(401);
      expect((await DELETE(request(path, null, 'DELETE', { binding_id: binding }), context(path))).status).toBe(401);
      expect((await POST(request('push-display', 'tokenA', 'POST', receipt), context('push-display'))).status).toBe(200);
      expect(fixture.rpcCalls.find((call) => call.name === 'record_native_push_display')?.args).toEqual({ p_user: fixture.userA, p_binding: binding, p_event: fixture.orderA });
      fixture.pushConfigured = false;
      expect((await POST(request(path, 'tokenA', 'POST', body), context(path))).status).toBe(503);
      fixture.pushRateAllowed = false;
      expect((await DELETE(request(path, 'tokenA', 'DELETE', { binding_id: binding }), context(path))).status).toBe(429);
      expect(fixture.rpcCalls.some((call) => call.name === 'unregister_native_push_device')).toBe(false);
      fixture.pushRateAllowed = true;
      const removed = await DELETE(request(path, 'tokenA', 'DELETE', { binding_id: binding }), context(path));
      expect(removed.status).toBe(200);
      expect(fixture.rpcCalls.find((call) => call.name === 'unregister_native_push_device')?.args).toEqual({ p_user: fixture.userA, p_binding: binding });
      const hashes = fixture.rpcCalls.filter((call) => call.name === 'consume_public_rate_limit').map((call) => call.args.p_client_hash);
      expect(new Set(hashes).size).toBeGreaterThan(1); // enrollment cannot exhaust cleanup's window
      expect(removed.headers.get('cache-control')).toContain('no-store');
    } finally { vi.unstubAllEnvs(); }
  });
  it('does not dispatch arbitrary paths or methods', async () => {
    expect((await GET(request('admin', 'tokenA'), context('admin'))).status).toBe(404);
    expect((await POST(request('rate-card', 'tokenA', 'POST', {}), context('rate-card'))).status).toBe(404);
    expect(fixture.tokenCalls).toHaveLength(0);
  });
});
