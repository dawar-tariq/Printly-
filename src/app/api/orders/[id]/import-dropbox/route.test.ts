import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDraftToken } from '@/lib/draft-access';

const state = vi.hoisted(() => ({
  outcome: 'ok' as 'ok' | 'lost' | 'failed' | 'upload_failed',
  saved: null as null | Record<string, unknown>,
  lookupFails: false, discardOk: true, discardInUse: false,
  discardCalls: [] as Array<{ order: string; file: string; path: string }>,
}));
vi.mock('@/lib/upload-files', () => ({
  ALLOWED_FILE_MIMES: new Set(['application/pdf']), MAX_FILE_BYTES: 25 * 1024 * 1024, MAX_ORDER_FILES: 10,
  inspectUploadedFile: async (buffer: Buffer) => ({ size: buffer.length, pages: 1 }),
}));
vi.mock('@/lib/draft-mutation', () => ({
  discardFileObject: async (_admin: unknown, order: string, file: string, path: string) => {
    state.discardCalls.push({ order, file, path });
    return { error: state.discardInUse ? { message: 'FILE_IN_USE' } : null, cleaned: state.discardOk };
  },
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: (table: string) => {
    if (table === 'orders') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: order, shop_id: shop, status: 'draft', payment_method: null } }) }) }) };
    if (table === 'order_files') return {
      select: (_columns: string, options?: unknown) => options
        ? { eq: async () => ({ count: 0, error: null }) }
        : { eq: () => ({ eq: () => ({ maybeSingle: async () => {
          if (state.lookupFails) throw new Error('lookup unavailable');
          return { data: state.saved, error: null };
        } }) }) },
      insert: async (row: Record<string, unknown>) => {
        if (state.outcome === 'ok' || state.outcome === 'lost') state.saved = row;
        return { error: state.outcome === 'ok' ? null : { message: 'simulated lost response' } };
      },
    };
    throw new Error(`Unexpected table ${table}`);
  },
  storage: { from: () => ({ upload: async () => ({ error: state.outcome === 'upload_failed' ? { message: 'upload failed' } : null }) }) },
}) }));
import { POST } from './route';

const order = '11111111-1111-4111-8111-111111111111';
const shop = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secret = 'dropbox-test-secret';
const params = { params: Promise.resolve({ id: order }) };
const request = (authorized = true) => new Request('https://printly.test/api', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { cookie: `printly-draft=${makeDraftToken(order, secret)}` } : {}) },
  body: JSON.stringify({ links: ['https://www.dropbox.com/s/example/document.pdf'] }),
});

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', secret);
  state.outcome = 'ok'; state.saved = null; state.lookupFails = false; state.discardOk = true; state.discardInUse = false; state.discardCalls = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="document.pdf"' } })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Dropbox import cleanup', () => {
  it('requires the draft session', async () => {
    expect((await POST(request(false), params)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('recovers an insert that committed despite a lost response without deleting its file', async () => {
    state.outcome = 'lost';
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results[0]).toMatchObject({ ok: true, name: 'document.pdf', mime: 'application/pdf', page_count: 1 });
    expect(results[0].file_id).toBe(state.saved?.id);
    expect(state.discardCalls).toHaveLength(0);
  });
  it('tombstones and cleans up an uncommitted object after an insert failure', async () => {
    state.outcome = 'failed';
    const { results } = await (await POST(request(), params)).json();
    expect(results[0].ok).toBe(false);
    expect(state.discardCalls).toHaveLength(1);
    expect(state.discardCalls[0].path).toMatch(new RegExp(`^${shop}/${order}/`));
  });
  it('also cleans up an upload whose response was lost and reports cleanup failure', async () => {
    state.outcome = 'upload_failed'; state.discardOk = false;
    const { results } = await (await POST(request(), params)).json();
    expect(results[0].error).toMatch(/contact the shop/i);
    expect(state.discardCalls).toHaveLength(1);
  });
  it('does not delete a referenced file when a lost response and lookup failure leave its status unknown', async () => {
    state.outcome = 'lost'; state.lookupFails = true; state.discardInUse = true;
    const { results } = await (await POST(request(), params)).json();
    expect(results[0].error).toMatch(/contact the shop/i);
    expect(state.saved).not.toBeNull();
    expect(state.discardCalls).toHaveLength(1);
  });
  it('rejects redirects to non-Dropbox hosts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/private' } })));
    const { results } = await (await POST(request(), params)).json();
    expect(results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/unsupported site/i) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.discardCalls).toHaveLength(0);
  });
});
