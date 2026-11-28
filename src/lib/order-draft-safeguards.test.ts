import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Exercise the real migration in PostgreSQL, not a mock of the SQL functions.
// The minimal fixture schema mirrors the relevant production columns/enums.
const schema = `
create role anon; create role authenticated; create role service_role;
create type public.order_status as enum ('draft','queued','printing','ready','collected','cancelled','failed');
create type public.payment_status as enum ('pending','submitted','confirmed','rejected','cod_pending','cod_collected');
create type public.payment_method as enum ('upi','cod');
create type public.paper_size as enum ('A4','A3','A5','Legal');
create type public.color_mode as enum ('bw','color');
create type public.sides_mode as enum ('single','duplex');
create type public.binding_type as enum ('none','staple','spiral','hard');
create table public.shops (id uuid primary key, name text not null, upi_id text, eta_minutes int not null default 20,
 commission_bps int not null default 800, rush_surcharge_bps int not null default 1000, status text not null default 'active');
create table public.orders (id uuid primary key, shop_id uuid not null references public.shops(id), status public.order_status not null default 'draft',
 payment_status public.payment_status not null default 'pending', payment_method public.payment_method,
 customer_name text not null default '', customer_phone text not null default '', customer_email text not null default '', notes text not null default '',
 rush boolean not null default false, subtotal_paise int not null default 0, discount_paise int not null default 0, tax_paise int not null default 0,
 total_paise int not null default 0, commission_paise int not null default 0, eta_minutes int, token text,
 token_date date not null default current_date, utr text, updated_at timestamptz default now());
create table public.order_files (id uuid primary key, order_id uuid not null references public.orders(id) on delete cascade,
 shop_id uuid not null references public.shops(id), storage_path text not null unique, original_name text not null, mime text not null,
 size_bytes int not null default 0, page_count int, source text not null default 'upload');
create table public.order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 file_id uuid references public.order_files(id) on delete set null, service text not null, paper_size public.paper_size not null default 'A4',
 color public.color_mode not null default 'bw', sides public.sides_mode not null default 'single', paper_gsm int not null default 80,
 option text, copies int not null default 1, pages int not null default 1, binding public.binding_type not null default 'none',
 lamination boolean not null default false, unit_price_paise int not null default 0, line_total_paise int not null default 0);
create table public.rate_card (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), service text not null,
 paper_size public.paper_size, color public.color_mode, sides public.sides_mode, paper_gsm int, option text, unit text not null, price_paise int not null check (price_paise >= 0));
create unique index rate_card_unique on public.rate_card (shop_id, service, coalesce(paper_size, 'A4'), coalesce(color, 'bw'),
 coalesce(sides, 'single'), coalesce(paper_gsm, -1), coalesce(option, '-'));
create table public.platform_settings (key text primary key, value jsonb not null);
create table public.payments (order_id uuid primary key references public.orders(id) on delete cascade, provider text not null, amount_paise int not null,
 status text not null, utr text, confirmed_by uuid, confirmed_at timestamptz, raw jsonb not null default '{}'::jsonb, updated_at timestamptz default now());
create table public.order_status_events (order_id uuid not null references public.orders(id) on delete cascade, from_status text, to_status text, by uuid, note text);
create table public.shop_counters (shop_id uuid not null references public.shops(id), day date not null, last_seq int not null default 0, primary key(shop_id, day));
grant select, insert, update, delete on public.order_items, public.order_files to public, anon, authenticated;
`;

const shop = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const order = '11111111-1111-4111-8111-111111111111';
const file = '33333333-3333-4333-8333-333333333333';
const otherFile = '44444444-4444-4444-8444-444444444444';
const rate = '55555555-5555-4555-8555-555555555555';
const path = `${shop}/${order}/${file}-document.pdf`;
const editedPath = `${shop}/${order}/${file}-edit-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`;
const item = (fileId = file, pages = 2) => ({ file_id: fileId, service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, binding: 'none', lamination: false, copies: 1, pages });
let db: PGlite;

const query = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);
async function addFile(id = file, objectPath = path, mime = 'application/pdf', pages: number | null = 2) {
  await query(`insert into public.order_files(id, order_id, shop_id, storage_path, original_name, mime, size_bytes, page_count)
    values ($1, $2, $3, $4, 'document', $5, 123, $6)`, [id, order, shop, objectPath, mime, pages]);
}
async function replaceItems(rows: unknown[]) {
  return query('select public.replace_draft_items($1::uuid, $2::jsonb)', [order, JSON.stringify(rows)]);
}
async function snapshot() {
  const version = Number((await query('select draft_version from public.orders where id=$1', [order])).rows[0].draft_version);
  const rates = (await query(`select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) as rates from
    (select id, service, paper_size, color, sides, paper_gsm, option, unit, price_paise from public.rate_card where shop_id=$1) r`, [shop])).rows[0].rates;
  const shopData = (await query(`select jsonb_build_object('name', name, 'upi_id', upi_id, 'eta_minutes', eta_minutes, 'commission_bps', commission_bps,
    'rush_surcharge_bps', rush_surcharge_bps, 'status', status) as shop from public.shops where id=$1`, [shop])).rows[0].shop;
  const lines = (await query('select id, 200 as unit_price_paise, 400 as line_total_paise from public.order_items where order_id=$1 order by id', [order])).rows;
  const checkout = { method: 'cod', customer_name: 'Customer', customer_phone: '9797000000', customer_email: '', notes: '', rush: false, subtotal_paise: 400, tax_paise: 72, total_paise: 472, commission_paise: 38, quote_token: 'a'.repeat(64) };
  return { version, rates, shopData, lines, checkout };
}
async function checkout(data: Awaited<ReturnType<typeof snapshot>>) {
  return query('select public.commit_draft_checkout($1::uuid,$2::bigint,$3::jsonb,$4::int,$5::jsonb,$6::jsonb,$7::jsonb) as result',
    [order, data.version, JSON.stringify(data.rates), 1800, JSON.stringify(data.shopData), JSON.stringify(data.lines), JSON.stringify(data.checkout)]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(schema);
  await db.exec(readFileSync('supabase/migrations/0010_order_draft_safeguards.sql', 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate public.order_file_tombstones, public.order_status_events, public.payments, public.order_items, public.order_files, public.orders, public.rate_card, public.shop_counters, public.shops, public.platform_settings cascade');
  await query('insert into public.shops(id,name,upi_id) values ($1,$2,$3)', [shop, 'Demo', 'demo@upi']);
  await query('insert into public.orders(id,shop_id) values ($1,$2)', [order, shop]);
  await query(`insert into public.rate_card(id,shop_id,service,paper_size,color,sides,paper_gsm,unit,price_paise)
    values ($1,$2,'print','A4','bw','single',80,'page',200)`, [rate, shop]);
  await db.exec("insert into public.platform_settings(key,value) values ('gst_bps','1800'::jsonb)");
});

describe('database safeguards for draft orders', () => {
  it('atomically checks file ownership/page count and retains the old lines if validation fails', async () => {
    await addFile();
    await replaceItems([item()]);
    await expect(replaceItems([item(file, 1)])).rejects.toThrow('INVALID_PAGES');
    await expect(replaceItems([item(otherFile, 2)])).rejects.toThrow('INVALID_FILE');
    await expect(replaceItems([{ ...item(), file_id: null }])).rejects.toThrow('FILE_REQUIRED');
    const existing = await query('select file_id, pages from public.order_items where order_id=$1', [order]);
    expect(existing.rows).toEqual([{ file_id: file, pages: 2 }]);
    await addFile(otherFile, `${shop}/${order}/${otherFile}-word.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', null);
    await replaceItems([item(file), item(otherFile, 7)]);
    expect((await query('select pages from public.order_items where order_id=$1 order by pages', [order])).rows.map((r) => r.pages)).toEqual([2, 7]);
  });

  it('removes linked lines and tombstones the path so a delayed finalize cannot reattach it', async () => {
    await addFile(); await replaceItems([item()]);
    const removed = await query('select public.remove_draft_file($1::uuid,$2::uuid,null) as paths', [order, file]);
    expect(removed.rows[0].paths).toEqual([path]);
    expect((await query('select count(*)::int as n from public.order_items where order_id=$1', [order])).rows[0].n).toBe(0);
    await expect(addFile()).rejects.toThrow('FILE_REMOVED');
    expect((await query('select public.remove_draft_file($1::uuid,$2::uuid,null) as paths', [order, file])).rows[0].paths).toEqual([path]);
    await query('update public.order_file_tombstones set cleaned_at=now() where storage_path=$1', [path]);
    expect((await query('select public.remove_draft_file($1::uuid,$2::uuid,null) as paths', [order, file])).rows[0].paths).toEqual([]);
    await expect(addFile()).rejects.toThrow('FILE_REMOVED');
  });

  it('guards edits and discard against active files, stale revisions, and changed page counts', async () => {
    await addFile();
    await expect(query('select public.discard_order_file_object($1::uuid,$2::uuid,$3)', [order, file, path])).rejects.toThrow('FILE_IN_USE');
    await expect(query('select public.replace_draft_file($1::uuid,$2::uuid,$3,$4,100,3)', [order, file, path, editedPath])).rejects.toThrow('INVALID_PAGES');
    await query('select public.replace_draft_file($1::uuid,$2::uuid,$3,$4,100,2)', [order, file, path, editedPath]);
    expect((await query('select storage_path from public.order_files where id=$1', [file])).rows[0].storage_path).toBe(editedPath);
    expect((await query('select storage_path from public.order_file_tombstones where file_id=$1', [file])).rows[0].storage_path).toBe(path);
    await expect(query('select public.discard_order_file_object($1::uuid,$2::uuid,$3)', [order, file, editedPath])).rejects.toThrow('FILE_IN_USE');
    const secondPath = `${shop}/${order}/${file}-edit-cccccccc-cccc-4ccc-8ccc-cccccccccccc.pdf`;
    await expect(query('select public.replace_draft_file($1::uuid,$2::uuid,$3,$4,100,2)', [order, file, path, secondPath])).rejects.toThrow('STALE_EDIT');
    await query('select public.discard_order_file_object($1::uuid,$2::uuid,$3)', [order, file, secondPath]);
    await expect(query('select public.replace_draft_file($1::uuid,$2::uuid,$3,$4,100,2)', [order, file, editedPath, secondPath])).rejects.toThrow('FILE_REMOVED');
  });

  it('limits concurrent finalizations at the database boundary', async () => {
    for (let i = 0; i < 10; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await addFile(id, `${shop}/${order}/${id}-file.pdf`);
    }
    await expect(addFile()).rejects.toThrow('TOO_MANY_FILES');
    expect((await query('select count(*)::int as n from public.order_files where order_id=$1', [order])).rows[0].n).toBe(10);
  });

  it('rejects stale order or rate snapshots without changing prices or creating payments', async () => {
    await addFile(); await replaceItems([item()]);
    const original = await snapshot();
    await replaceItems([item()]);
    await expect(checkout(original)).rejects.toThrow('ORDER_CHANGED');
    const afterChange = await snapshot();
    await query('update public.rate_card set price_paise=250 where id=$1', [rate]);
    await expect(checkout(afterChange)).rejects.toThrow('PRICING_CHANGED');
    expect((await query('select line_total_paise from public.order_items where order_id=$1', [order])).rows[0].line_total_paise).toBe(0);
    expect((await query('select count(*)::int as n from public.payments where order_id=$1', [order])).rows[0].n).toBe(0);
  });

  it('replaces the rate card atomically and rolls back invalid or duplicate rows', async () => {
    const replacement = { service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: 250 };
    const save = (rows: unknown[]) => query('select public.replace_shop_rate_card($1::uuid,$2::jsonb)', [shop, JSON.stringify(rows)]);
    await expect(save([replacement, replacement])).rejects.toThrow(/duplicate key/i);
    expect((await query('select id, price_paise from public.rate_card where shop_id=$1', [shop])).rows).toEqual([{ id: rate, price_paise: 200 }]);
    await expect(save([{ ...replacement, price_paise: -1 }])).rejects.toThrow(/check constraint/i);
    expect((await query('select id, price_paise from public.rate_card where shop_id=$1', [shop])).rows).toEqual([{ id: rate, price_paise: 200 }]);
    await save([replacement]);
    expect((await query('select price_paise from public.rate_card where shop_id=$1', [shop])).rows).toEqual([{ price_paise: 250 }]);
  });

  it('catches up with existing tokens and preserves four-digit sequence numbers', async () => {
    const existing = '77777777-7777-4777-8777-777777777777';
    await query("insert into public.orders(id,shop_id,status,token) values ($1,$2,'queued','A-999')", [existing, shop]);
    expect((await query('select public.next_token($1::uuid) as token', [shop])).rows[0].token).toBe('A-1000');
    expect((await query('select public.next_token($1::uuid) as token', [shop])).rows[0].token).toBe('A-1001');
  });

  it('uses the token assignment day rather than the draft creation day', async () => {
    await addFile(); await replaceItems([item()]);
    await query('update public.orders set token_date = current_date - 1 where id=$1', [order]);
    await checkout(await snapshot());
    expect((await query('select token_date = current_date as today from public.orders where id=$1', [order])).rows[0].today).toBe(true);
  });

  it('rolls back a partially updated checkout, commits COD once, and locks later edits', async () => {
    await addFile(); await replaceItems([item(), { ...item(), service: 'bind', option: 'spiral', binding: 'spiral', pages: 1 }]);
    const data = await snapshot();
    const invalid = { ...data, lines: [data.lines[0], { ...data.lines[1], id: otherFile }] };
    await expect(checkout(invalid)).rejects.toThrow('ORDER_CHANGED');
    expect((await query('select line_total_paise from public.order_items where order_id=$1 order by id', [order])).rows.map((r) => r.line_total_paise)).toEqual([0, 0]);
    await replaceItems([item()]);
    const valid = await snapshot();
    const result = await checkout(valid);
    expect(result.rows[0].result).toEqual({ token: 'A-001' });
    expect((await query('select status, payment_status, payment_method, total_paise from public.orders where id=$1', [order])).rows[0]).toEqual({ status: 'queued', payment_status: 'cod_pending', payment_method: 'cod', total_paise: 472 });
    expect((await query('select provider, amount_paise, status from public.payments where order_id=$1', [order])).rows[0]).toEqual({ provider: 'cod', amount_paise: 472, status: 'cod_pending' });
    expect((await query('select count(*)::int as n from public.order_status_events where order_id=$1', [order])).rows[0].n).toBe(1);
    await expect(checkout(valid)).rejects.toThrow('ORDER_LOCKED');
    await expect(replaceItems([item()])).rejects.toThrow('ORDER_LOCKED');
    await expect(query('select public.remove_draft_file($1::uuid,$2::uuid,null)', [order, file])).rejects.toThrow('ORDER_LOCKED');
    await expect(query('update public.order_files set storage_path=$2 where id=$1', [file, editedPath])).rejects.toThrow('ORDER_LOCKED');
  });

  it('serializes UPI submission, retry, rejection and shop confirmation', async () => {
    await addFile(); await replaceItems([item()]);
    const data = await snapshot(); data.checkout.method = 'upi';
    await checkout(data);
    await expect(query('select public.decide_shop_upi_payment($1,$2,$3,$4,$5)', [order, shop, 'confirm', null, null])).rejects.toThrow('BAD_PAYMENT_STATE');
    await query('select public.submit_upi_payment($1,$2)', [order, 'UTR-123']);
    await query('select public.submit_upi_payment($1,$2)', [order, 'UTR-123']);
    expect((await query('select count(*)::int as n from public.order_status_events where order_id=$1', [order])).rows[0].n).toBe(1);
    await query('select public.decide_shop_upi_payment($1,$2,$3,$4,$5)', [order, shop, 'reject', null, null]);
    await query('select public.submit_upi_payment($1,$2)', [order, 'UTR-456']);
    await query('update public.orders set token_date = current_date - 1 where id=$1', [order]);
    await query('select public.decide_shop_upi_payment($1,$2,$3,$4,$5)', [order, shop, 'confirm', null, 'UTR-456']);
    expect((await query('select status, payment_status, token, utr, token_date = current_date as today from public.orders where id=$1', [order])).rows[0]).toEqual({ status: 'queued', payment_status: 'confirmed', token: 'A-001', utr: 'UTR-456', today: true });
    expect((await query('select status, utr from public.payments where order_id=$1', [order])).rows[0]).toEqual({ status: 'confirmed', utr: 'UTR-456' });
    await expect(query('select public.submit_upi_payment($1,$2)', [order, 'UTR-456'])).rejects.toThrow('ORDER_LOCKED');
    await expect(query('select public.decide_shop_upi_payment($1,$2,$3,$4,$5)', [order, shop, 'reject', null, null])).rejects.toThrow('BAD_PAYMENT_STATE');
  });

  it('lets shop staff record an unverified customer report without confirming payment', async () => {
    await addFile(); await replaceItems([item()]);
    const data = await snapshot(); data.checkout.method = 'upi';
    await checkout(data);
    const actor = '88888888-8888-4888-8888-888888888888';
    const decide = (shopId: string, action: string, utr: string | null = null) => query('select public.decide_shop_upi_payment($1,$2,$3,$4,$5) as result', [order, shopId, action, actor, utr]);
    await expect(decide(otherFile, 'report')).rejects.toThrow('WRONG_SHOP');
    await expect(decide(shop, 'confirm')).rejects.toThrow('BAD_PAYMENT_STATE');
    expect((await decide(shop, 'report', 'CUSTOMER-REF')).rows[0].result).toEqual({ outcome: 'submitted' });
    expect((await query('select status, payment_status, token, utr from public.orders where id=$1', [order])).rows[0]).toEqual({ status: 'draft', payment_status: 'submitted', token: null, utr: 'CUSTOMER-REF' });
    expect((await query('select status, utr from public.payments where order_id=$1', [order])).rows[0]).toEqual({ status: 'submitted', utr: 'CUSTOMER-REF' });
    await decide(shop, 'report', 'SHOULD-NOT-OVERWRITE');
    const events = (await query('select "by", note from public.order_status_events where order_id=$1', [order])).rows;
    expect(events).toEqual([{ by: actor, note: 'Shop recorded a customer payment report; payment not yet verified' }]);
    await decide(shop, 'reject');
    expect((await decide(shop, 'report')).rows[0].result).toEqual({ outcome: 'submitted' });
    expect((await query('select utr from public.payments where order_id=$1', [order])).rows[0].utr).toBe('CUSTOMER-REF');
    await decide(shop, 'confirm');
    expect((await query('select status, payment_status, token from public.orders where id=$1', [order])).rows[0]).toEqual({ status: 'queued', payment_status: 'confirmed', token: 'A-001' });
    await expect(decide(shop, 'report')).rejects.toThrow('BAD_PAYMENT_STATE');
  });

  it('persists a UPI payment snapshot and permits parent-order cascade cleanup', async () => {
    await addFile(); await replaceItems([item()]);
    const data = await snapshot(); data.checkout.method = 'upi';
    await checkout(data);
    const payment = (await query('select provider, status, raw from public.payments where order_id=$1', [order])).rows[0];
    expect(payment).toEqual({ provider: 'upi', status: 'created', raw: { checkout_upi_id: 'demo@upi', checkout_shop_name: 'Demo' } });
    expect((await query('select checkout_quote_token from public.orders where id=$1', [order])).rows[0].checkout_quote_token).toBe('a'.repeat(64));
    await query('delete from public.orders where id=$1', [order]);
    expect((await query('select count(*)::int as n from public.order_files where order_id=$1', [order])).rows[0].n).toBe(0);
  });

  it('prevents direct anonymous mutation and execution of privileged RPCs', async () => {
    await db.exec('set role anon');
    try {
      await expect(query('select public.remove_draft_file($1::uuid,$2::uuid,null)', [order, file])).rejects.toThrow(/permission denied/i);
      await expect(query('select public.next_token($1::uuid)', [shop])).rejects.toThrow(/permission denied/i);
      await expect(query('select public.replace_shop_rate_card($1::uuid,$2::jsonb)', [shop, '[]'])).rejects.toThrow(/permission denied/i);
      await expect(query('delete from public.order_items where order_id=$1', [order])).rejects.toThrow(/permission denied/i);
      await expect(query('select * from public.order_file_tombstones')).rejects.toThrow(/permission denied/i);
    } finally { await db.exec('reset role'); }
  });
});
