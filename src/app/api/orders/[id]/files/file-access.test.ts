import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { makeDraftToken } from '@/lib/draft-access';

const state = vi.hoisted(() => ({
  orders: [] as Array<Record<string, unknown>>,
  files: [] as Array<Record<string, unknown>>,
  items: [] as Array<Record<string, unknown>>,
  tombstones: [] as Array<Record<string, unknown>>,
  objects: new Map<string, Uint8Array>(),
  signed: [] as string[], removed: [] as string[], staffShop: '', failStorageRemoval: false,
}));

type Table = 'orders' | 'order_files' | 'order_items' | 'order_file_tombstones';
class Query {
  filters: Array<(row: Record<string, unknown>) => boolean> = [];
  op: 'select' | 'update' | 'delete' = 'select';
  patch: Record<string, unknown> = {};
  constructor(public table: Table) {}
  select() { return this; }
  eq(key: string, value: unknown) { this.filters.push((row) => row[key] === value); return this; }
  is(key: string, value: unknown) { return this.eq(key, value); }
  in(key: string, values: unknown[]) { this.filters.push((row) => values.includes(row[key])); return this; }
  update(value: Record<string, unknown>) { this.op = 'update'; this.patch = value; return this; }
  delete() { this.op = 'delete'; return this; }
  async result(single = false) {
    const rows = this.table === 'orders' ? state.orders : this.table === 'order_files' ? state.files : this.table === 'order_items' ? state.items : state.tombstones;
    const matches = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.op === 'update') matches.forEach((row) => Object.assign(row, this.patch));
    if (this.op === 'delete') for (const row of matches) rows.splice(rows.indexOf(row), 1);
    return { data: single ? matches[0] ?? null : matches, error: null };
  }
  maybeSingle() { return this.result(true); }
  then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) { return this.result().then(resolve, reject); }
}
function tombstone(orderId: unknown, fileId: unknown, path: unknown) {
  if (!state.tombstones.some((row) => row.storage_path === path)) state.tombstones.push({ order_id: orderId, file_id: fileId, storage_path: path, cleaned_at: null });
}
const admin = () => ({
  from: (table: Table) => new Query(table),
  rpc: async (name: string, args: Record<string, unknown>) => {
    const order = state.orders.find((row) => row.id === args.p_order_id);
    const file = state.files.find((row) => row.id === args.p_file_id && row.order_id === args.p_order_id);
    const fail = (message: string) => ({ data: null, error: { message } });
    if (!order) return fail('ORDER_NOT_FOUND');
    const path = args.p_path ?? args.p_new_path;
    if (path && (typeof path !== 'string' || !path.startsWith(`${order.shop_id}/${order.id}/${args.p_file_id}-`))) return fail('INVALID_PATH');
    if (name === 'remove_draft_file') {
      if (file && (order.status !== 'draft' || order.payment_method)) return fail('ORDER_LOCKED');
      if (file) {
        tombstone(order.id, file.id, file.storage_path);
        state.files.splice(state.files.indexOf(file), 1);
        state.items = state.items.filter((row) => !(row.order_id === order.id && row.file_id === file.id));
      }
      if (path) {
        if (state.files.some((row) => row.storage_path === path)) return fail('FILE_IN_USE');
        tombstone(order.id, args.p_file_id, path);
      }
      if (!file && !state.tombstones.some((row) => row.order_id === order.id && row.file_id === args.p_file_id)) return fail('FILE_NOT_FOUND');
      return { data: null, error: null };
    }
    if (name === 'discard_order_file_object') {
      if (state.files.some((row) => row.storage_path === path)) return fail('FILE_IN_USE');
      tombstone(order.id, args.p_file_id, path);
      return { data: null, error: null };
    }
    if (name === 'replace_draft_file') {
      if (order.status !== 'draft' || order.payment_method) return fail('ORDER_LOCKED');
      if (!file) return fail('FILE_NOT_FOUND');
      if (file.storage_path !== args.p_previous_path) return fail('STALE_EDIT');
      if (state.tombstones.some((row) => row.storage_path === path)) return fail('FILE_REMOVED');
      tombstone(order.id, file.id, file.storage_path);
      Object.assign(file, { storage_path: path, size_bytes: args.p_size, page_count: args.p_pages });
      return { data: {}, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  },
  storage: { from: () => ({
    createSignedUrl: async (path: string) => { state.signed.push(path); return { data: { signedUrl: `https://storage.example/${encodeURIComponent(path)}` }, error: null }; },
    createSignedUploadUrl: async (_path: string) => ({ data: { token: 'upload-token' }, error: null }),
    download: async (path: string) => state.objects.has(path) ? { data: new Blob([new Uint8Array(state.objects.get(path)!)]), error: null } : { data: null, error: { message: 'missing' } },
    remove: async (paths: string[]) => {
      if (state.failStorageRemoval) return { error: { message: 'temporary storage failure' } };
      paths.forEach((path) => { state.removed.push(path); state.objects.delete(path); }); return { error: null };
    },
  }) },
});
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => admin(), createServerSupabase: vi.fn() }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), assertStaffOfShop: async (shopId: string) => shopId === state.staffShop ? { shopIds: [shopId] } : null }));

import { GET as customerPreview, DELETE as deleteFile } from './[fileId]/route';
import { POST as beginEdit, PUT as finishEdit, DELETE as discardEdit } from './[fileId]/edit/route';
import { GET as ownerPreview } from '@/app/api/shop/orders/[id]/files/[fileId]/preview/route';

const SECRET = 'integration-test-secret';
const order1 = '11111111-1111-4111-8111-111111111111';
const order2 = '22222222-2222-4222-8222-222222222222';
const shop1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const shop2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const file1 = '33333333-3333-4333-8333-333333333333';
const file2 = '44444444-4444-4444-8444-444444444444';
const path1 = `${shop1}/${order1}/${file1}-one.pdf`;
const path2 = `${shop2}/${order2}/${file2}-two.pdf`;
const params = (id: string, fileId: string) => ({ params: Promise.resolve({ id, fileId }) });
function request(method: string, id: string | null, body?: unknown) {
  return new Request('https://printly.test/api', { method, headers: { ...(id ? { cookie: `printly-draft=${makeDraftToken(id, SECRET)}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

beforeEach(async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SECRET);
  state.orders = [{ id: order1, shop_id: shop1, status: 'draft', payment_method: null }, { id: order2, shop_id: shop2, status: 'draft', payment_method: null }];
  state.files = [
    { id: file1, order_id: order1, shop_id: shop1, storage_path: path1, mime: 'application/pdf', page_count: 1 },
    { id: file2, order_id: order2, shop_id: shop2, storage_path: path2, mime: 'application/pdf', page_count: 1 },
  ];
  state.items = [{ id: 'item1', order_id: order1, file_id: file1 }, { id: 'item2', order_id: order2, file_id: file2 }];
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
  state.objects = new Map([[path1, bytes], [path2, bytes]]); state.signed = []; state.removed = []; state.staffShop = shop1; state.tombstones = []; state.failStorageRemoval = false;
});

describe('draft and shop file isolation', () => {
  it('does not expose a file to a tracking URL, another draft, or another shop', async () => {
    expect((await customerPreview(request('GET', null), params(order1, file1))).status).toBe(403);
    expect((await customerPreview(request('GET', order2), params(order1, file1))).status).toBe(403);
    expect((await customerPreview(request('GET', order1), params(order1, file2))).status).toBe(404);
    const allowed = await customerPreview(request('GET', order1), params(order1, file1));
    expect(allowed.status).toBe(302);
    expect(allowed.headers.get('cache-control')).toContain('no-store');
    expect(state.signed).toEqual([path1]);
    expect((await ownerPreview(request('GET', null), params(order2, file2))).status).toBe(403);
    const ownerAllowed = await ownerPreview(request('GET', null), params(order1, file1));
    expect(ownerAllowed.status).toBe(302);
    expect(ownerAllowed.headers.get('cache-control')).toContain('no-store');
  });
  it('removes the object, row and linked items only for that draft', async () => {
    expect((await deleteFile(request('DELETE', order2), params(order1, file1))).status).toBe(403);
    expect((await deleteFile(request('DELETE', order1, {}), params(order1, file1))).status).toBe(200);
    expect(state.objects.has(path1)).toBe(false);
    expect(state.files.map((file) => file.id)).toEqual([file2]);
    expect(state.items.map((item) => item.id)).toEqual(['item2']);
    expect(state.objects.has(path2)).toBe(true);
  });
  it('keeps a cleanup record and retries when storage removal fails', async () => {
    state.failStorageRemoval = true;
    expect((await deleteFile(request('DELETE', order1, {}), params(order1, file1))).status).toBe(503);
    expect(state.objects.has(path1)).toBe(true);
    expect(state.files.some((f) => f.id === file1)).toBe(false);
    expect(state.tombstones.find((row) => row.storage_path === path1)?.cleaned_at).toBeNull();
    state.failStorageRemoval = false;
    expect((await deleteFile(request('DELETE', order1, {}), params(order1, file1))).status).toBe(200);
    expect(state.objects.has(path1)).toBe(false);
    expect(state.tombstones.find((row) => row.storage_path === path1)?.cleaned_at).toBeTruthy();
  });
  it('validates and replaces an edited file, protects against stale saves, and locks after checkout', async () => {
    const begin = await beginEdit(request('POST', order1, { size: 1000 }), params(order1, file1));
    expect(begin.status).toBe(200);
    const signed = await begin.json();
    expect(signed.path).toMatch(new RegExp(`^${shop1}/${order1}/${file1}-edit-`));
    const pdf = await PDFDocument.create(); pdf.addPage([200, 300]);
    state.objects.set(signed.path, await pdf.save());
    const finish = await finishEdit(request('PUT', order1, { path: signed.path, revision: signed.revision }), params(order1, file1));
    expect(finish.status).toBe(200);
    expect(state.files[0].storage_path).toBe(signed.path);
    expect(state.objects.has(path1)).toBe(false);
    expect(state.objects.has(path2)).toBe(true);
    expect((await discardEdit(request('DELETE', order1, { path: signed.path }), params(order1, file1))).status).toBe(409);
    const idempotent = await finishEdit(request('PUT', order1, { path: signed.path, revision: signed.revision }), params(order1, file1));
    expect(idempotent.status).toBe(200);
    const stale = await beginEdit(request('POST', order1, { size: 1000 }), params(order1, file1));
    const second = await stale.json();
    state.objects.set(second.path, await pdf.save());
    expect((await finishEdit(request('PUT', order1, { path: second.path, revision: signed.revision }), params(order1, file1))).status).toBe(409);
    expect((await discardEdit(request('DELETE', order1, { path: second.path }), params(order1, file1))).status).toBe(200);
    state.orders[0].payment_method = 'upi';
    expect((await beginEdit(request('POST', order1, { size: 1000 }), params(order1, file1))).status).toBe(409);
    expect((await deleteFile(request('DELETE', order1), params(order1, file1))).status).toBe(409);
  });
  it('rejects altered page counts and unsupported or invalid content without losing the original', async () => {
    const start = await beginEdit(request('POST', order1, { size: 100 }), params(order1, file1));
    const signed = await start.json();
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
    state.objects.set(signed.path, await pdf.save());
    expect((await finishEdit(request('PUT', order1, { path: signed.path, revision: signed.revision }), params(order1, file1))).status).toBe(422);
    expect(state.files[0].storage_path).toBe(path1);
    expect(state.objects.has(path1)).toBe(true);
    state.files[0].mime = 'application/msword';
    expect((await customerPreview(request('GET', order1), params(order1, file1))).status).toBe(415);
    expect((await ownerPreview(request('GET', null), params(order1, file1))).status).toBe(415);
  });
});
