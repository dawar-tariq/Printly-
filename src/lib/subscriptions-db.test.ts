import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { computeQuote, type ItemSpec, type RateRow } from './pricing';

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
 paper_size public.paper_size, color public.color_mode, sides public.sides_mode, paper_gsm int, option text,
 unit text not null check (unit in ('page','job','sheet')), price_paise int not null);
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
let legacyBefore: Record<string, unknown>[];
let legacyAfter: Record<string, unknown>[];
let entitlementBefore: Record<string, unknown>[];
let entitlementAfter: Record<string, unknown>[];
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);
const rpc = async (name: string, args: unknown[]) => (await query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args)).rows[0].result as Record<string, unknown>;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(schema);
  await query('insert into public.profiles(id,role) values ($1,$2),($3,$4),($5,$6)', [admin, 'admin', owner, 'shop_staff', other, 'shop_staff']);
  await query('insert into public.shops(id,owner_id,name,upi_id) values ($1,$2,$3,$4)', [existingShop, owner, 'Existing', 'shop@upi']);
  await db.exec(readFileSync('supabase/migrations/0010_order_draft_safeguards.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0011_subscriptions.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0016_duplex_sheet_rates.sql', 'utf8'));
  actualBackfill = (await query("select shop_id, term, extract(epoch from expires_at-started_at)::int as seconds from public.shop_subscriptions")).rows;
  // Build real pre-migration purchases, including a paid entitlement and an
  // open payment, so migration preservation is checked on actual rows.
  await db.exec("update public.subscription_plan set monthly_paise=10000, six_months_paise=50000, yearly_paise=90000, upi_id='printly@upi', payee_name='Printly'");
  const paid = (await rpc('start_subscription_purchase', [existingShop, owner, 'monthly'])).purchase as Record<string, unknown>;
  await rpc('submit_subscription_purchase', [existingShop, paid.id, owner, 'LEGACY-12345']);
  await rpc('review_subscription_purchase', [paid.id, admin, 'approve', '']);
  await rpc('start_subscription_purchase', [existingShop, owner, 'yearly']);
  const legacySql = 'select id,shop_id,term,amount_paise,upi_id,payee_name,status,utr,submitted_at,reviewed_by,reviewed_at,period_start,period_end,created_at,updated_at from public.subscription_purchases order by id';
  legacyBefore = (await query(legacySql)).rows;
  entitlementBefore = (await query('select * from public.shop_subscriptions order by shop_id')).rows;
  await db.exec(readFileSync('supabase/migrations/0017_subscription_offers.sql', 'utf8'));
  legacyAfter = (await query(legacySql)).rows;
  entitlementAfter = (await query('select * from public.shop_subscriptions order by shop_id')).rows;
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("truncate storage.objects, public.subscription_events, public.subscription_purchases, public.subscription_announcements, public.subscription_promos, public.shop_subscriptions, public.order_file_tombstones, public.order_status_events, public.payments, public.order_items, public.order_files, public.orders, public.rate_card, public.shop_counters, public.shop_staff cascade");
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

  it('commits a reviewed physical-sheet quote through the current checkout transaction', async () => {
    const firstId = '33333333-3333-4333-8333-333333333333';
    const secondId = '44444444-4444-4444-8444-444444444444';
    const rateId = '55555555-5555-4555-8555-555555555555';
    await query('insert into public.orders(id,shop_id) values ($1,$2)', [testOrder, existingShop]);
    await query("insert into public.order_items(id,order_id,service,sides,pages,copies) values ($1,$2,'print','duplex',5,2),($3,$2,'print','duplex',1,2)", [firstId, testOrder, secondId]);
    await query("insert into public.rate_card(id,shop_id,service,paper_size,color,sides,paper_gsm,unit,price_paise) values ($1,$2,'print','A4','bw','duplex',80,'duplex_sheet',300)", [rateId, existingShop]);
    const items: ItemSpec[] = [
      { file_id: 'file-a', service: 'print', paper_size: 'A4', color: 'bw', sides: 'duplex', paper_gsm: 80, pages: 5, copies: 2 },
      { file_id: 'file-b', service: 'print', paper_size: 'A4', color: 'bw', sides: 'duplex', paper_gsm: 80, pages: 1, copies: 2 },
    ];
    const rate: RateRow = { service: 'print', paper_size: 'A4', color: 'bw', sides: 'duplex', paper_gsm: 80, option: null, unit: 'duplex_sheet', price_paise: 300 };
    const quote = computeQuote(items, [rate], { gstBps: 1800 });
    const version = (await query('select draft_version from public.orders where id=$1', [testOrder])).rows[0].draft_version;
    const snapshot = (await query("select jsonb_build_object('name',name,'upi_id',upi_id,'eta_minutes',eta_minutes,'rush_surcharge_bps',rush_surcharge_bps,'status',status) as shop from public.shops where id=$1", [existingShop])).rows[0].shop;
    const rates = (await query(`select jsonb_agg(to_jsonb(r) order by r.id) as rates from
      (select id,service,paper_size,color,sides,paper_gsm,option,unit,price_paise from public.rate_card where shop_id=$1) r`, [existingShop])).rows[0].rates;
    const lines = [firstId, secondId].map((id, index) => ({ id, unit_price_paise: quote.lines[index].unitPricePaise, line_total_paise: quote.lines[index].lineTotalPaise }));
    const checkout = { method: 'cod', customer_name: 'Customer', customer_phone: '9797000000', subtotal_paise: quote.subtotalPaise, tax_paise: quote.taxPaise, total_paise: quote.totalPaise, pricing_engine: 'duplex-v1', quote_token: 'a'.repeat(64) };
    const args = [testOrder, version, JSON.stringify(rates), 1800, JSON.stringify(snapshot), JSON.stringify(lines), JSON.stringify(checkout)];
    const oldCheckout = { ...checkout, pricing_engine: undefined };
    const oldArgs = [...args.slice(0, 6), JSON.stringify(oldCheckout)];
    // An old server cannot commit its incorrect pages × copies calculation,
    // even if the physical-sheet row was added after its snapshot was read.
    await expect(rpc('commit_draft_checkout', oldArgs)).rejects.toThrow('PRICING_CHANGED');
    await expect(rpc('commit_draft_checkout', [testOrder, version, '[]', 1800, JSON.stringify(snapshot), JSON.stringify(lines), JSON.stringify(oldCheckout)])).rejects.toThrow('PRICING_CHANGED');
    expect((await query('select total_paise,payment_method from public.orders where id=$1', [testOrder])).rows[0]).toEqual({ total_paise: 0, payment_method: null });

    await query('update public.rate_card set price_paise=350 where id=$1', [rateId]);
    await expect(rpc('commit_draft_checkout', args)).rejects.toThrow('PRICING_CHANGED');
    expect((await query('select total_paise,payment_method from public.orders where id=$1', [testOrder])).rows[0]).toEqual({ total_paise: 0, payment_method: null });
    await query('update public.rate_card set price_paise=300 where id=$1', [rateId]);
    await rpc('commit_draft_checkout', args);
    await query('update public.rate_card set price_paise=900 where id=$1', [rateId]);
    expect((await query('select subtotal_paise,tax_paise,total_paise,commission_paise,status from public.orders where id=$1', [testOrder])).rows[0]).toEqual({ subtotal_paise: 2400, tax_paise: 432, total_paise: 2832, commission_paise: 0, status: 'queued' });
    expect((await query('select id,line_total_paise from public.order_items where order_id=$1 order by id', [testOrder])).rows).toEqual([{ id: firstId, line_total_paise: 1800 }, { id: secondId, line_total_paise: 600 }]);
    expect((await query('select amount_paise from public.payments where order_id=$1', [testOrder])).rows[0]).toEqual({ amount_paise: 2832 });
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

const key1 = '11111111-1111-4111-8111-111111111111';
const key2 = '22222222-2222-4222-8222-222222222222';
const key3 = '33333333-3333-4333-8333-333333333333';
const defaultPromo = {
  code: 'THANKS25', discount_type: 'percent', discount_value: 25,
  terms: ['monthly', 'six_months', 'yearly'], starts_at: null, ends_at: null,
  max_uses: null, max_uses_per_shop: 1, enabled: true,
};
const savePromo = (value: Record<string, unknown> = {}, id: unknown = null, version: unknown = null, actor = admin) =>
  rpc('save_subscription_promo', [actor, id, version, JSON.stringify({ ...defaultPromo, ...value })]);
const saveAnnouncement = (value: Record<string, unknown> = {}, id: unknown = null, version: unknown = null, actor = admin) =>
  rpc('save_subscription_announcement', [actor, id, version, JSON.stringify({ title: 'A shop update', message: 'Something new for you.', promo_code: null, starts_at: null, ends_at: null, enabled: true, public_visible: true, ...value })]);
const offerQuote = (shop: string, actor: string, term = 'monthly', code: string | null = null) =>
  rpc('quote_subscription_offer', [shop, actor, term, code]);
const startOffer = (shop: string, actor: string, term: string, code: string | null, key: string, quote: Record<string, unknown>) =>
  rpc('start_subscription_purchase_with_offer', [shop, actor, term, code, key, JSON.stringify(quote)]);

describe('subscription offers migration and transactions', () => {
  it('preserves all old purchase amounts, recipients, states and entitlements at migration', async () => {
    expect(legacyBefore).toHaveLength(2);
    expect(legacyAfter).toEqual(legacyBefore);
    expect(entitlementAfter).toEqual(entitlementBefore);
    expect(legacyAfter.map((row) => row.status).sort()).toEqual(['approved', 'initiated']);
    expect(legacyAfter.map((row) => row.amount_paise).sort()).toEqual([10000, 90000]);
  });

  it('requires an admin, validates configuration and rejects stale updates or renaming', async () => {
    await expect(savePromo({}, null, null, owner)).rejects.toThrow('ADMIN_REQUIRED');
    const saved = await savePromo({ code: ' thanks25 ' });
    expect(saved).toMatchObject({ code: 'THANKS25', discount_type: 'percent', discount_value: 25, version: 0 });
    await expect(savePromo({ code: 'OTHER25' }, saved.id, 0)).rejects.toThrow('PROMO_CODE_IMMUTABLE');
    const updated = await savePromo({ discount_value: 50 }, saved.id, 0);
    expect(updated).toMatchObject({ discount_value: 50, version: 1 });
    await expect(savePromo({}, saved.id, 0)).rejects.toThrow('OFFER_CHANGED');
    await expect(savePromo({ discount_value: 101, code: 'BADPERCENT' })).rejects.toThrow(/check constraint/i);
    await expect(savePromo({ code: 'DUPETEST', terms: [] })).rejects.toThrow(/constraint/i);
    await expect(savePromo({ code: 'THANKS25' })).rejects.toThrow(/unique constraint/i);
    await expect(saveAnnouncement({}, null, null, owner)).rejects.toThrow('ADMIN_REQUIRED');
    const ann = await saveAnnouncement();
    await saveAnnouncement({ title: 'Changed' }, ann.id, 0);
    await expect(saveAnnouncement({}, ann.id, 0)).rejects.toThrow('OFFER_CHANGED');
  });

  it('quotes only for the owner, checks code windows and terms, and rounds discounts down to paise', async () => {
    await savePromo({ terms: ['yearly'], starts_at: '2000-01-01T00:00:00Z', ends_at: '2100-01-01T00:00:00Z' });
    await expect(offerQuote(newShop, owner, 'yearly', 'thanks25')).rejects.toThrow('OWNER_REQUIRED');
    await expect(offerQuote(newShop, other, 'monthly', 'THANKS25')).rejects.toThrow('PROMO_TERM_INELIGIBLE');
    await expect(offerQuote(newShop, other, 'yearly', 'NOTREAL')).rejects.toThrow('PROMO_UNAVAILABLE');
    const quote = await offerQuote(newShop, other, 'yearly', ' thanks25 ');
    expect(quote).toMatchObject({ term: 'yearly', base_paise: 90000, monthly_reference_paise: 120000, discount_paise: 22500, amount_paise: 67500, promo_code: 'THANKS25' });
    await db.exec("update public.subscription_plan set monthly_paise=3");
    await savePromo({ code: 'ROUNDING', discount_value: 50, terms: ['monthly'] });
    expect(await offerQuote(newShop, other, 'monthly', 'rounding')).toMatchObject({ base_paise: 3, discount_paise: 1, amount_paise: 2 });
    await db.exec("update public.subscription_plan set monthly_paise=1");
    await expect(offerQuote(newShop, other, 'monthly', 'rounding')).rejects.toThrow('PROMO_TOO_SMALL');
    await savePromo({ code: 'FUTURE', starts_at: '2100-01-01T00:00:00Z' });
    await expect(offerQuote(newShop, other, 'monthly', 'FUTURE')).rejects.toThrow('PROMO_UNAVAILABLE');
    await savePromo({ code: 'EXPIRED', ends_at: '2000-01-01T00:00:00Z' });
    await expect(offerQuote(newShop, other, 'monthly', 'EXPIRED')).rejects.toThrow('PROMO_UNAVAILABLE');
  });

  it('snapshots a discounted paid request and still requires independent verification', async () => {
    const promo = await savePromo();
    const quote = await offerQuote(newShop, other, 'monthly', 'thanks25');
    const result = await startOffer(newShop, other, 'monthly', 'thanks25', key1, quote);
    const purchase = result.purchase as Record<string, unknown>;
    expect(purchase).toMatchObject({ amount_paise: 7500, base_amount_paise: 10000, monthly_reference_paise: 10000,
      discount_paise: 2500, promo_code: 'THANKS25', upi_id: 'printly@upi', status: 'initiated', request_key: key1 });
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(false);
    await savePromo({ discount_value: 50, enabled: false }, promo.id, 0);
    await rpc('update_subscription_plan', [0, JSON.stringify({ monthly_paise: 99999, upi_id: 'changed@upi' }), admin]);
    const old = (await query('select amount_paise,base_amount_paise,discount_paise,promo_code,upi_id,status from public.subscription_purchases where id=$1', [purchase.id])).rows[0];
    expect(old).toEqual({ amount_paise: 7500, base_amount_paise: 10000, discount_paise: 2500, promo_code: 'THANKS25', upi_id: 'printly@upi', status: 'initiated' });
    await submit(purchase.id);
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(false);
    await expect(rpc('review_subscription_purchase', [purchase.id, other, 'approve', ''])).rejects.toThrow('ADMIN_REQUIRED');
    await review(purchase.id);
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(true);
  });

  it('rejects forged or stale prices without creating a request, even when a code changes during review', async () => {
    const promo = await savePromo();
    const quote = await offerQuote(newShop, other, 'yearly', 'THANKS25');
    await expect(startOffer(newShop, other, 'yearly', 'THANKS25', key1, { ...quote, amount_paise: 0 })).rejects.toThrow('SUBSCRIPTION_QUOTE_CHANGED');
    await expect(startOffer(newShop, owner, 'yearly', 'THANKS25', key1, quote)).rejects.toThrow('OWNER_REQUIRED');
    await savePromo({ discount_value: 40 }, promo.id, 0);
    await expect(startOffer(newShop, other, 'yearly', 'THANKS25', key1, quote)).rejects.toThrow('SUBSCRIPTION_QUOTE_CHANGED');
    const next = await offerQuote(newShop, other, 'yearly', 'THANKS25');
    await rpc('update_subscription_plan', [0, JSON.stringify({ upi_id: 'new@upi' }), admin]);
    await expect(startOffer(newShop, other, 'yearly', 'THANKS25', key1, next)).rejects.toThrow('SUBSCRIPTION_QUOTE_CHANGED');
    expect((await query('select count(*)::int as n from public.subscription_purchases where shop_id=$1', [newShop])).rows[0].n).toBe(0);
  });

  it('activates a fully discounted term once, extends the current period in IST and makes retries idempotent', async () => {
    const promo = await savePromo({ code: 'ALLFREE', discount_value: 100 });
    await query("update public.shop_subscriptions set started_at='2031-12-01 12:00Z', expires_at='2032-02-29 20:00Z' where shop_id=$1", [existingShop]);
    const quote = await offerQuote(existingShop, owner, 'monthly', 'ALLFREE');
    const result = await startOffer(existingShop, owner, 'monthly', 'ALLFREE', key1, quote);
    const purchase = result.purchase as Record<string, unknown>;
    expect(purchase).toMatchObject({ status: 'approved', amount_paise: 0, base_amount_paise: 10000, discount_paise: 10000,
      promo_code: 'ALLFREE', upi_id: null, payee_name: null, utr: null, submitted_at: null, reviewed_by: null });
    expect(new Date(String(purchase.period_start)).toISOString()).toBe('2032-02-29T20:00:00.000Z');
    expect(new Date(String(purchase.period_end)).toISOString()).toBe('2032-03-31T20:00:00.000Z');
    await savePromo({ code: 'ALLFREE', discount_value: 100, enabled: false }, promo.id, 0);
    const retry = await startOffer(existingShop, owner, 'monthly', 'ALLFREE', key1, quote);
    expect(retry.existing).toBe(true);
    expect((retry.purchase as Record<string, unknown>).id).toBe(purchase.id);
    const different = await startOffer(existingShop, owner, 'yearly', null, key1, { ...quote, term: 'yearly' });
    expect(different.different_selection).toBe(true);
    expect((different.purchase as Record<string, unknown>).id).toBe(purchase.id);
    await expect(submit(purchase.id, existingShop, owner)).rejects.toThrow('BAD_PURCHASE_STATE');
    expect((await query("select count(*)::int as n from public.subscription_events where event='promo_free_activated' and purchase_id=$1", [purchase.id])).rows[0].n).toBe(1);
    expect(new Date(String((await query('select expires_at from public.shop_subscriptions where shop_id=$1', [existingShop])).rows[0].expires_at)).toISOString()).toBe('2032-03-31T20:00:00.000Z');
  });

  it('rejects a stale free quote from another tab or device even with a different request key', async () => {
    await savePromo({ code: 'FREEUNLIMITED', discount_value: 100, max_uses_per_shop: null });
    const firstQuote = await offerQuote(newShop, other, 'monthly', 'FREEUNLIMITED');
    const secondQuote = await offerQuote(newShop, other, 'monthly', 'FREEUNLIMITED');
    expect(firstQuote.access_expires_at).toBeNull();
    const first = await startOffer(newShop, other, 'monthly', 'FREEUNLIMITED', key1, firstQuote);
    await expect(startOffer(newShop, other, 'monthly', 'FREEUNLIMITED', key2, secondQuote)).rejects.toThrow('SUBSCRIPTION_QUOTE_CHANGED');
    expect((await query("select count(*)::int as n from public.subscription_purchases where shop_id=$1", [newShop])).rows[0].n).toBe(1);
    expect((await startOffer(newShop, other, 'monthly', 'FREEUNLIMITED', key1, firstQuote)).purchase).toMatchObject({ id: (first.purchase as Record<string, unknown>).id });
    const refreshed = await offerQuote(newShop, other, 'monthly', 'FREEUNLIMITED');
    expect(refreshed.access_expires_at).not.toBeNull();
    await startOffer(newShop, other, 'monthly', 'FREEUNLIMITED', key3, refreshed);
    expect((await query("select count(*)::int as n from public.subscription_purchases where shop_id=$1", [newShop])).rows[0].n).toBe(2);
  });

  it('requires a fresh quote if an earlier paid request is approved during review', async () => {
    await savePromo({ code: 'FREEAFTER', discount_value: 100, max_uses_per_shop: null });
    const pending = await start(newShop, other);
    await submit(pending.id);
    const oldQuote = await offerQuote(newShop, other, 'monthly', 'FREEAFTER');
    await review(pending.id);
    await expect(startOffer(newShop, other, 'monthly', 'FREEAFTER', key1, oldQuote)).rejects.toThrow('SUBSCRIPTION_QUOTE_CHANGED');
    expect((await query('select count(*)::int as n from public.subscription_purchases where shop_id=$1', [newShop])).rows[0].n).toBe(1);
  });

  it('allows fixed discounts to cover the whole term without a UPI recipient, but does not make partial percentages free by rounding', async () => {
    await db.exec('update public.subscription_plan set upi_id=null,payee_name=null,monthly_paise=1');
    await savePromo({ code: 'NINETY', discount_value: 99 });
    await expect(offerQuote(newShop, other, 'monthly', 'NINETY')).rejects.toThrow('PROMO_TOO_SMALL');
    await savePromo({ code: 'FIXED', discount_type: 'fixed', discount_value: 100 });
    const quote = await offerQuote(newShop, other, 'monthly', 'FIXED');
    expect(quote).toMatchObject({ base_paise: 1, discount_paise: 1, amount_paise: 0 });
    expect((await startOffer(newShop, other, 'monthly', 'FIXED', key1, quote)).purchase).toMatchObject({ amount_paise: 0, status: 'approved' });
    await expect(query("insert into public.subscription_purchases(shop_id,requested_by,term,amount_paise,status) values ($1,$2,'monthly',0,'approved')", [newShop, other])).rejects.toThrow(/check constraint/i);
    await expect(query("insert into public.subscription_purchases(shop_id,requested_by,term,amount_paise,status,base_amount_paise,discount_paise,promo_id,promo_code) select $1,$2,'monthly',0,'initiated',1,1,id,code from public.subscription_promos where code='FIXED'", [newShop, other])).rejects.toThrow(/check constraint/i);
  });

  it('reserves limited uses, releases cancellations and rejections, and prevents competing shops oversubscribing', async () => {
    await savePromo({ max_uses: 1, max_uses_per_shop: 1 });
    const qa = await offerQuote(existingShop, owner, 'monthly', 'THANKS25');
    const qb = await offerQuote(newShop, other, 'monthly', 'THANKS25');
    // PGlite executes these queued calls serially; the migration also locks the
    // shared promo row before counting, which is tested with real backends in
    // the optional PostgreSQL integration run when available.
    const results = await Promise.allSettled([
      startOffer(existingShop, owner, 'monthly', 'THANKS25', key1, qa),
      startOffer(newShop, other, 'monthly', 'THANKS25', key2, qb),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toContain('PROMO_LIMIT_REACHED');
    const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Record<string, unknown>>).value.purchase as Record<string, unknown>;
    expect((await query("select count(*)::int as n from public.subscription_purchases where promo_code='THANKS25' and status in ('initiated','submitted','approved')")).rows[0].n).toBe(1);
    await rpc('cancel_subscription_purchase', [winner.shop_id, winner.id, winner.requested_by]);
    const replacementQuote = await offerQuote(newShop, other, 'monthly', 'THANKS25');
    const replacement = (await startOffer(newShop, other, 'monthly', 'THANKS25', key3, replacementQuote)).purchase as Record<string, unknown>;
    await submit(replacement.id);
    await review(replacement.id, 'reject', 'Transfer not found');
    expect((await offerQuote(existingShop, owner, 'monthly', 'THANKS25')).amount_paise).toBe(7500);
  });

  it('enforces per-shop limits after approval and does not replace an existing paid request with a free one', async () => {
    await savePromo({ code: 'FREEONCE', discount_value: 100, max_uses_per_shop: 1 });
    const paid = await start(newShop, other);
    const quote = await offerQuote(newShop, other, 'monthly', 'FREEONCE');
    const result = await startOffer(newShop, other, 'monthly', 'FREEONCE', key1, quote);
    expect((result.purchase as Record<string, unknown>).id).toBe(paid.id);
    expect((await query('select public.shop_subscription_active($1) as active', [newShop])).rows[0].active).toBe(false);
    await rpc('cancel_subscription_purchase', [newShop, paid.id, other]);
    const grant = await startOffer(newShop, other, 'monthly', 'FREEONCE', key1, quote);
    expect((grant.purchase as Record<string, unknown>).amount_paise).toBe(0);
    await expect(offerQuote(newShop, other, 'monthly', 'FREEONCE')).rejects.toThrow('PROMO_LIMIT_REACHED');
  });

  it('publishes only in-window, enabled, available linked offers and respects public visibility', async () => {
    const promo = await savePromo({ code: 'PUBLIC25', max_uses: 1 });
    await saveAnnouncement({ title: 'Public offer', promo_code: 'PUBLIC25' });
    await saveAnnouncement({ title: 'Shop only', public_visible: false });
    await saveAnnouncement({ title: 'Not started', starts_at: '2100-01-01T00:00:00Z' });
    await saveAnnouncement({ title: 'Expired', ends_at: '2000-01-01T00:00:00Z' });
    const publicItems = await rpc('visible_subscription_announcements', [true]) as unknown as Array<Record<string, unknown>>;
    expect(publicItems.map((item) => item.title)).toEqual(['Public offer']);
    expect(publicItems[0].promo).toMatchObject({ code: 'PUBLIC25', discount_type: 'percent', discount_value: 25 });
    expect(JSON.stringify(publicItems)).not.toContain('max_uses_per_shop');
    const shopItems = await rpc('visible_subscription_announcements', [false]) as unknown as Array<Record<string, unknown>>;
    expect(shopItems.map((item) => item.title).sort()).toEqual(['Public offer', 'Shop only']);
    const quote = await offerQuote(newShop, other, 'monthly', 'PUBLIC25');
    const reserved = (await startOffer(newShop, other, 'monthly', 'PUBLIC25', key1, quote)).purchase as Record<string, unknown>;
    expect(await rpc('visible_subscription_announcements', [true])).toEqual([]);
    const dashboard = await rpc('admin_subscription_offers', [admin]);
    expect((dashboard.promos as Array<Record<string, unknown>>)[0]).toMatchObject({ code: 'PUBLIC25', approved_uses: 0, reserved_uses: 1 });
    await rpc('cancel_subscription_purchase', [newShop, reserved.id, other]);
    expect(await rpc('visible_subscription_announcements', [true])).toHaveLength(1);
    await savePromo({ code: 'PUBLIC25', max_uses: 1, enabled: false }, promo.id, 0);
    expect(await rpc('visible_subscription_announcements', [true])).toEqual([]);
  });

  it('preserves announcement links to older codes outside the recent admin list', async () => {
    const old = await savePromo({ code: 'OLDSALE' });
    await query("update public.subscription_promos set created_at='2000-01-01' where id=$1", [old.id]);
    await query(`insert into public.subscription_promos(code,discount_type,discount_value,created_by,updated_by)
      select 'NEW' || n,'percent',10,$1,$1 from generate_series(1,105) n`, [admin]);
    const announcement = await saveAnnouncement({ title: 'Older offer', promo_code: ' oldsale ' });
    const dashboard = await rpc('admin_subscription_offers', [admin]);
    expect(dashboard.promos).toHaveLength(100);
    expect(dashboard.promos_has_more).toBe(true);
    expect((dashboard.promos as Array<Record<string, unknown>>).some((row) => row.code === 'OLDSALE')).toBe(false);
    expect(dashboard.announcements).toContainEqual(expect.objectContaining({ id: announcement.id, promo_id: old.id, promo_code: 'OLDSALE' }));
    await query("update public.subscription_announcements set created_at='2000-01-01' where id=$1", [announcement.id]);
    await query(`insert into public.subscription_announcements(title,message,created_by,updated_by)
      select 'NEW ' || n,'Update',$1,$1 from generate_series(1,105) n`, [admin]);
    const olderPage = await rpc('admin_subscription_offers', [admin, 1, 1]);
    expect(olderPage.promos).toContainEqual(expect.objectContaining({ id: old.id, code: 'OLDSALE' }));
    expect(olderPage.announcements).toContainEqual(expect.objectContaining({ id: announcement.id, promo_id: old.id, promo_code: 'OLDSALE' }));
    expect(olderPage.promos_has_more).toBe(false);
    expect(olderPage.announcements_has_more).toBe(false);
    await expect(rpc('admin_subscription_offers', [admin, -1, 0])).rejects.toThrow('INVALID_OFFER_PAGE');
    await saveAnnouncement({ title: 'Older offer', promo_code: 'OLDSALE', enabled: false }, announcement.id, 0);
    await expect(saveAnnouncement({ title: 'Older offer', promo_code: 'NOTFOUND' }, announcement.id, 1)).rejects.toThrow('PROMO_NOT_FOUND');
    await expect(rpc('save_subscription_announcement', [admin, announcement.id, 1, JSON.stringify({ title: 'Oops', message: 'Oops', promo_id: old.id })])).rejects.toThrow('INVALID_ANNOUNCEMENT');
    expect((await query('select promo_id, enabled, version from public.subscription_announcements where id=$1', [announcement.id])).rows[0]).toEqual({ promo_id: old.id, enabled: false, version: 1 });
  });

  it('does not let many unavailable linked promos crowd a valid announcement out of the visible list', async () => {
    const paused = await savePromo({ code: 'PAUSED', enabled: false });
    await query(`insert into public.subscription_announcements(title,message,enabled,public_visible,created_by,updated_by,created_at)
      values ('Still available','An older update',true,true,$1,$1,'2000-01-01')`, [admin]);
    await query(`insert into public.subscription_announcements(title,message,promo_id,enabled,public_visible,created_by,updated_by,created_at)
      select 'Hidden ' || n,'Unavailable promo',$1,true,true,$2,$2,now() from generate_series(1,105) n`, [paused.id, admin]);
    const visible = await rpc('visible_subscription_announcements', [true]) as unknown as Array<Record<string, unknown>>;
    expect(visible.map((item) => item.title)).toEqual(['Still available']);
  });

  it('fails closed if the purchase transaction does not use read-committed isolation', async () => {
    await savePromo({ code: 'FREEISO', discount_value: 100 });
    const quote = await offerQuote(newShop, other, 'monthly', 'FREEISO');
    await db.exec('begin isolation level repeatable read');
    try {
      await expect(startOffer(newShop, other, 'monthly', 'FREEISO', key1, quote)).rejects.toThrow('SUBSCRIPTION_ISOLATION_UNSUPPORTED');
    } finally { await db.exec('rollback'); }
    expect((await query('select count(*)::int as n from public.subscription_purchases where shop_id=$1', [newShop])).rows[0].n).toBe(0);
  });

  it('denies direct browser access to offer tables, quote, administration and activation RPCs', async () => {
    const row = (await query(`select has_table_privilege('authenticated','public.subscription_promos','select') as promo_read,
      has_table_privilege('anon','public.subscription_announcements','select') as announcement_read,
      has_function_privilege('authenticated','public.quote_subscription_offer(uuid,uuid,text,text)','execute') as quote_execute,
      has_function_privilege('anon','public.visible_subscription_announcements(boolean)','execute') as visible_execute,
      has_function_privilege('authenticated','public.start_subscription_purchase_with_offer(uuid,uuid,text,text,uuid,jsonb)','execute') as start_execute,
      has_function_privilege('authenticated','public.save_subscription_promo(uuid,uuid,bigint,jsonb)','execute') as save_execute,
      has_function_privilege('authenticated','public.admin_subscription_offers(uuid,integer,integer)','execute') as admin_list_execute,
      has_function_privilege('service_role','public.subscription_offer_quote_internal(uuid,text,text)','execute') as internal_execute`)).rows[0];
    expect(row).toEqual({ promo_read: false, announcement_read: false, quote_execute: false, visible_execute: false, start_execute: false, save_execute: false, admin_list_execute: false, internal_execute: false });
  });
});
