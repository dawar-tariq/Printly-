import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Execute the actual migration and its transactional RPCs in PostgreSQL.
const schema = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
create table storage.objects (name text, bucket_id text); alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select on storage.objects to authenticated;
create type public.order_status as enum ('draft','queued','printing','ready','collected','cancelled','failed');
create type public.payment_status as enum ('pending','submitted','confirmed','rejected','cod_pending','cod_collected');
create type public.payment_method as enum ('upi','cod');
create type public.paper_size as enum ('A4','A3','A5','Legal');
create type public.color_mode as enum ('bw','color');
create type public.sides_mode as enum ('single','duplex');
create type public.binding_type as enum ('none','staple','spiral','hard');
create table public.profiles (id uuid primary key, role text not null);
create table public.shops (id uuid primary key, owner_id uuid not null references public.profiles(id), name text not null, upi_id text,
 eta_minutes int not null default 20, commission_bps int not null default 800, rush_surcharge_bps int not null default 1000, status text not null default 'active');
create table public.shop_staff (shop_id uuid, user_id uuid);
create function public.is_admin() returns boolean language sql stable security definer as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $$;
create function public.my_shop_ids() returns setof uuid language sql stable security definer as $$ select shop_id from public.shop_staff where user_id=auth.uid() $$;
create table public.shop_services (shop_id uuid);
create table public.inventory_items (shop_id uuid);
alter table public.inventory_items enable row level security;
create table public.disputes (id uuid);
create table public.payouts (shop_id uuid);
create table public.orders (id uuid primary key, shop_id uuid not null references public.shops(id), customer_id uuid,
 status public.order_status not null default 'draft', payment_status public.payment_status not null default 'pending', payment_method public.payment_method,
 customer_name text not null default '', customer_phone text not null default '', customer_email text not null default '', notes text not null default '',
 rush boolean not null default false, subtotal_paise int not null default 0, discount_paise int not null default 0, tax_paise int not null default 0,
 total_paise int not null default 0, commission_paise int not null default 0, eta_minutes int, token text,
 token_date date not null default current_date, utr text, updated_at timestamptz default now());
alter table public.orders enable row level security;
create table public.order_files (id uuid primary key, order_id uuid not null references public.orders(id) on delete cascade,
 shop_id uuid not null references public.shops(id), storage_path text not null unique, original_name text not null, mime text not null,
 size_bytes int not null default 0, page_count int, source text not null default 'upload');
create table public.order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 file_id uuid references public.order_files(id) on delete set null, service text not null, paper_size public.paper_size not null default 'A4',
 color public.color_mode not null default 'bw', sides public.sides_mode not null default 'single', paper_gsm int not null default 80,
 option text, copies int not null default 1, pages int not null default 1, binding public.binding_type not null default 'none',
 lamination boolean not null default false, unit_price_paise int not null default 0, line_total_paise int not null default 0);
create table public.rate_card (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), service text not null,
 paper_size public.paper_size, color public.color_mode, sides public.sides_mode, paper_gsm int, option text, unit text not null, price_paise int not null);
create table public.platform_settings (key text primary key, value jsonb not null);
create table public.payments (order_id uuid primary key references public.orders(id) on delete cascade, provider text not null, amount_paise int not null,
 status text not null, utr text, confirmed_by uuid, confirmed_at timestamptz, raw jsonb not null default '{}'::jsonb, updated_at timestamptz default now());
create table public.order_status_events (order_id uuid not null references public.orders(id) on delete cascade, from_status text, to_status text, by uuid, note text);
create table public.shop_counters (shop_id uuid not null references public.shops(id), day date not null, last_seq int not null default 0, primary key(shop_id, day));
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage on schema auth to authenticated, anon;
`;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const existingShop = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const newShop = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const testOrder = '11111111-1111-4111-8111-111111111111';
let db: PGlite;
let actualBackfill: Record<string, unknown>[];
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);
const rpc = async (name: string, args: unknown[]) => (await query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args)).rows[0].result as Record<string, unknown>;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(schema);
  await query('insert into public.profiles(id,role) values ($1,$2),($3,$4),($5,$6)', [admin, 'admin', owner, 'shop_staff', other, 'shop_staff']);
  await query('insert into public.shops(id,owner_id,name,upi_id) values ($1,$2,$3,$4)', [existingShop, owner, 'Existing', 'shop@upi']);
  await db.exec(readFileSync('supabase/migrations/0010_order_draft_safeguards.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0011_subscriptions.sql', 'utf8'));
  actualBackfill = (await query("select shop_id, term, extract(epoch from expires_at-started_at)::int as seconds from public.shop_subscriptions")).rows;
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("truncate storage.objects, public.subscription_events, public.subscription_purchases, public.shop_subscriptions, public.order_file_tombstones, public.order_status_events, public.payments, public.order_items, public.order_files, public.orders, public.rate_card, public.shop_counters, public.shop_staff cascade");
  await query('delete from public.shops where id <> $1', [existingShop]);
  await query("insert into public.shop_subscriptions(shop_id,term,started_at,expires_at) values ($1,'grace',now(),now()+interval '30 days')", [existingShop]);
  await query('insert into public.shops(id,owner_id,name) values ($1,$2,$3)', [newShop, other, 'New']);
  await query('insert into public.shop_staff(shop_id,user_id) values ($1,$2),($3,$4)', [existingShop, owner, newShop, other]);
  await db.exec("update public.subscription_plan set monthly_paise=10000, six_months_paise=50000, yearly_paise=90000, upi_id='printly@upi', payee_name='Printly', warning_days=7, version=0");
});

async function start(shop = newShop, actor = other, term = 'monthly') {
  const data = await rpc('start_subscription_purchase', [shop, actor, term]);
  return data.purchase as Record<string, unknown>;
}
async function submit(id: unknown, shop = newShop, actor = other, utr = '123456789012') {
  return rpc('submit_subscription_purchase', [shop, id, actor, utr]);
}
async function review(id: unknown, action = 'approve', note = '') {
  return rpc('review_subscription_purchase', [id, admin, action, note]);
}

describe('subscription migration and payment transactions', () => {
  it('backfills only existing shops with the one-time 30-day transition', async () => {
    const rows = (await query('select shop_id, term, extract(epoch from expires_at-started_at)::int as seconds from public.shop_subscriptions order by shop_id')).rows;
    expect(actualBackfill).toEqual([{ shop_id: existingShop, term: 'grace', seconds: 30 * 24 * 60 * 60 }]);
    expect(rows).toEqual(actualBackfill);
    // A new shop does not inherit a trial and cannot start a customer draft.
    await expect(query('insert into public.orders(id,shop_id) values ($1,$2)', [testOrder, newShop])).rejects.toThrow('SHOP_UNAVAILABLE');
  });

  it('rejects stale plan edits and requires an authenticated admin for configuration', async () => {
    const changes = JSON.stringify({ monthly_paise: 12345, upi_id: 'new@upi' });
    await expect(rpc('update_subscription_plan', [0, changes, owner])).rejects.toThrow('ADMIN_REQUIRED');
    const saved = await rpc('update_subscription_plan', [0, changes, admin]);
    expect(saved).toMatchObject({ monthly_paise: 12345, upi_id: 'new@upi', version: 1, updated_by: admin });
    await expect(rpc('update_subscription_plan', [0, JSON.stringify({ monthly_paise: 1 }), admin])).rejects.toThrow('SETTINGS_CHANGED');
    expect((await query('select monthly_paise, upi_id, version from public.subscription_plan')).rows[0]).toEqual({ monthly_paise: 12345, upi_id: 'new@upi', version: 1 });
    await expect(rpc('update_subscription_plan', [1, JSON.stringify({ commission_bps: 800 }), admin])).rejects.toThrow('INVALID_PLAN');
    await expect(rpc('update_subscription_plan', [1, JSON.stringify({ monthly_paise: 0 }), admin])).rejects.toThrow(/check constraint/i);
  });

  it('requires owner, configured pricing, and one unresolved purchase while keeping price snapshots', async () => {
    await expect(start(newShop, owner)).rejects.toThrow('OWNER_REQUIRED');
    await db.exec("update public.subscription_plan set monthly_paise=null");
    await expect(start()).rejects.toThrow('SUBSCRIPTION_NOT_CONFIGURED');
    await db.exec("update public.subscription_plan set monthly_paise=10000");
    const purchase = await start();
    await db.exec("update public.subscription_plan set monthly_paise=99900, upi_id='new@upi'");
    const retry = await start(newShop, other, 'yearly');
    expect(retry.id).toBe(purchase.id);
    expect(retry.amount_paise).toBe(10000);
    expect(retry.upi_id).toBe('printly@upi');
    expect(retry.term).toBe('monthly');
  });

  it('never activates on a payment claim and prevents reference reuse and self-approval', async () => {
    const purchase = await start();
    const submitted = await submit(purchase.id, newShop, other, ' 123456789012 ');
    expect(submitted.status).toBe('submitted');
    expect((await submit(purchase.id)).id).toBe(purchase.id);
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(false);
    await expect(rpc('review_subscription_purchase', [purchase.id, other, 'approve', ''])).rejects.toThrow('ADMIN_REQUIRED');
    const existing = await start(existingShop, owner);
    await expect(submit(existing.id, existingShop, owner)).rejects.toThrow('DUPLICATE_REFERENCE');
    await expect(query('insert into public.orders(id,shop_id) values ($1,$2)', [testOrder, newShop])).rejects.toThrow('SHOP_UNAVAILABLE');
  });

  it('approves once, preserves remaining grace, and extends by calendar months', async () => {
    // End-of-month example: adding a calendar month clamps to leap-day.
    await query("update public.shop_subscriptions set started_at='2031-12-01 12:00Z', expires_at='2032-01-31 12:00Z' where shop_id=$1", [existingShop]);
    const purchase = await start(existingShop, owner);
    await submit(purchase.id, existingShop, owner);
    const approved = await review(purchase.id);
    expect(new Date(String(approved.period_start)).toISOString()).toBe('2032-01-31T12:00:00.000Z');
    expect(new Date(String(approved.period_end)).toISOString()).toBe('2032-02-29T12:00:00.000Z');
    expect((await review(purchase.id)).period_end).toEqual(approved.period_end);
    const eventCount = await query("select count(*)::int as n from public.subscription_events where event='payment_approved' and purchase_id=$1", [purchase.id]);
    expect(eventCount.rows[0].n).toBe(1);
    expect((await query('select term from public.shop_subscriptions where shop_id=$1', [existingShop])).rows[0].term).toBe('monthly');
  });

  it('adds calendar months in India time even when the UTC date differs', async () => {
    await query("update public.shop_subscriptions set started_at='2032-01-01 12:00Z', expires_at='2032-02-29 20:00Z' where shop_id=$1", [existingShop]);
    const purchase = await start(existingShop, owner); await submit(purchase.id, existingShop, owner);
    const approved = await review(purchase.id);
    // 1 March 01:30 IST + one calendar month = 1 April 01:30 IST.
    expect(new Date(String(approved.period_start)).toISOString()).toBe('2032-02-29T20:00:00.000Z');
    expect(new Date(String(approved.period_end)).toISOString()).toBe('2032-03-31T20:00:00.000Z');
  });

  it.each([['six_months', 6], ['yearly', 12]])('activates the %s term for %i calendar months', async (term, months) => {
    const purchase = await start(newShop, other, term);
    await submit(purchase.id);
    const approved = await review(purchase.id);
    const end = (await query("select (($1::timestamptz at time zone 'Asia/Kolkata') + make_interval(months => $2::int)) at time zone 'Asia/Kolkata' as result", [approved.period_start, months])).rows[0].result;
    expect(new Date(String(approved.period_end)).toISOString()).toBe(end instanceof Date ? end.toISOString() : new Date(String(end)).toISOString());
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(true);
  });

  it('requires a rejection reason, does not activate rejected payments, and permits a fresh request', async () => {
    const purchase = await start(); await submit(purchase.id);
    await expect(review(purchase.id, 'reject', '')).rejects.toThrow('REASON_REQUIRED');
    expect((await review(purchase.id, 'reject', 'Transfer not found')).status).toBe('rejected');
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(false);
    expect((await start()).id).not.toBe(purchase.id);
  });

  it('allows an admin to grant and revoke permanent access without erasing a paid period', async () => {
    const purchase = await start(); await submit(purchase.id); const paid = await review(purchase.id);
    await expect(rpc('set_shop_permanent_subscription', [newShop, other, true, 'test'])).rejects.toThrow('ADMIN_REQUIRED');
    expect((await rpc('set_shop_permanent_subscription', [newShop, admin, true, 'family'])).is_permanent).toBe(true);
    await expect(start()).rejects.toThrow('PERMANENT_ACCESS');
    const restored = await rpc('set_shop_permanent_subscription', [newShop, admin, false, 'end gift']);
    expect(restored.is_permanent).toBe(false);
    expect(new Date(String(restored.expires_at)).toISOString()).toBe(new Date(String(paid.period_end)).toISOString());
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(true);
  });

  it('can grant and revoke permanent access to a new shop without any purchase', async () => {
    expect((await rpc('set_shop_permanent_subscription', [newShop, admin, true, 'family'])).is_permanent).toBe(true);
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(true);
    expect((await query('select count(*)::int as n from public.subscription_purchases where shop_id=$1', [newShop])).rows[0].n).toBe(0);
    await rpc('set_shop_permanent_subscription', [newShop, admin, false, 'end gift']);
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(false);
  });

  it('blocks a new checkout after expiry but does not alter an already-started UPI payment', async () => {
    await query('insert into public.orders(id,shop_id) values ($1,$2)', [testOrder, existingShop]);
    await query("update public.shop_subscriptions set started_at=now()-interval '31 days', expires_at=now()-interval '1 day' where shop_id=$1", [existingShop]);
    await expect(query('insert into public.orders(id,shop_id) values ($1,$2)', ['22222222-2222-4222-8222-222222222222', existingShop])).rejects.toThrow('SHOP_UNAVAILABLE');
    await expect(rpc('commit_draft_checkout', [testOrder, 0, '[]', 1800, '{}', '[]', '{"method":"upi"}'])).rejects.toThrow('SHOP_UNAVAILABLE');
    expect((await query('select status, payment_method from public.orders where id=$1', [testOrder])).rows[0]).toEqual({ status: 'draft', payment_method: null });
  });

  it('commits new orders with zero commission and can recover an initiated UPI payment after expiry', async () => {
    const itemId = '33333333-3333-4333-8333-333333333333';
    await query('insert into public.orders(id,shop_id) values ($1,$2)', [testOrder, existingShop]);
    await query("insert into public.order_items(id,order_id,service,pages,copies) values ($1,$2,'print',1,1)", [itemId, testOrder]);
    const version = (await query('select draft_version from public.orders where id=$1', [testOrder])).rows[0].draft_version;
    const snapshot = (await query("select jsonb_build_object('name',name,'upi_id',upi_id,'eta_minutes',eta_minutes,'rush_surcharge_bps',rush_surcharge_bps,'status',status) as shop from public.shops where id=$1", [existingShop])).rows[0].shop;
    const checkout = { method: 'upi', customer_name: 'Customer', customer_phone: '9797000000', subtotal_paise: 200, tax_paise: 36, total_paise: 236, commission_paise: 999, quote_token: 'a'.repeat(64) };
    await rpc('commit_draft_checkout', [testOrder, version, '[]', 1800, JSON.stringify(snapshot), JSON.stringify([{ id: itemId, unit_price_paise: 200, line_total_paise: 200 }]), JSON.stringify(checkout)]);
    expect((await query('select commission_paise, status, payment_method from public.orders where id=$1', [testOrder])).rows[0]).toEqual({ commission_paise: 0, status: 'draft', payment_method: 'upi' });
    await query("update public.shop_subscriptions set started_at=now()-interval '31 days', expires_at=now()-interval '1 day' where shop_id=$1", [existingShop]);
    await rpc('submit_upi_payment', [testOrder, 'CUSTOMER-REF']);
    await rpc('decide_shop_upi_payment', [testOrder, existingShop, 'confirm', owner, null]);
    expect((await query('select status, payment_status from public.orders where id=$1', [testOrder])).rows[0]).toEqual({ status: 'queued', payment_status: 'confirmed' });
  });

  it('restricts expired staff RLS reads to open or started-UPI orders and hides inventory', async () => {
    const draft = '22222222-2222-4222-8222-222222222222';
    const upi = '33333333-3333-4333-8333-333333333333';
    const closed = '44444444-4444-4444-8444-444444444444';
    for (const id of [testOrder, draft, upi, closed]) await query('insert into public.orders(id,shop_id) values ($1,$2)', [id, existingShop]);
    await query("update public.orders set status='queued' where id=$1", [testOrder]);
    await query("update public.orders set payment_method='upi' where id=$1", [upi]);
    await query("update public.orders set status='collected' where id=$1", [closed]);
    await query('insert into public.inventory_items(shop_id) values ($1)', [existingShop]);
    for (const id of [testOrder, draft, upi, closed]) await query("insert into storage.objects(name,bucket_id) values ($1,'order-files')", [`${existingShop}/${id}/file.pdf`]);
    await db.exec('set role authenticated');
    try {
      await query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      expect((await query('select id from public.orders order by id')).rows).toHaveLength(4);
      expect((await query('select * from public.inventory_items')).rows).toHaveLength(1);
      expect((await query('select * from storage.objects')).rows).toHaveLength(4);
    } finally { await db.exec('reset role'); }
    await query("update public.shop_subscriptions set started_at=now()-interval '31 days', expires_at=now()-interval '1 day' where shop_id=$1", [existingShop]);
    await db.exec('set role authenticated');
    try {
      await query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      expect((await query('select id from public.orders order by id')).rows).toEqual([{ id: testOrder }, { id: upi }]);
      expect((await query('select * from public.inventory_items')).rows).toEqual([]);
      expect((await query('select name from storage.objects order by name')).rows).toEqual([
        { name: `${existingShop}/${testOrder}/file.pdf` }, { name: `${existingShop}/${upi}/file.pdf` },
      ]);
    } finally { await db.exec('reset role'); }
  });

  it('prevents direct browser writes to subscriptions, order management, and legacy payouts', async () => {
    const row = (await query(`select has_table_privilege('authenticated','public.shop_subscriptions','update') as subscription_write,
      has_table_privilege('authenticated','public.orders','update') as order_write,
      has_table_privilege('authenticated','public.inventory_items','insert') as inventory_write,
      has_table_privilege('authenticated','public.disputes','update') as dispute_write,
      has_table_privilege('authenticated','public.payouts','select') as payouts_read,
      has_function_privilege('authenticated','public.review_subscription_purchase(uuid,uuid,text,text)','execute') as review_execute,
      has_function_privilege('authenticated','public.update_subscription_plan(bigint,jsonb,uuid)','execute') as plan_execute`)).rows[0];
    expect(row).toEqual({ subscription_write: false, order_write: false, inventory_write: false, dispute_write: false, payouts_read: false, review_execute: false, plan_execute: false });
  });
});
