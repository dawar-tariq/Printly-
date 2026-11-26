import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Disposable synthetic database only: no Supabase, actual FIDs or sends.
const db = new PGlite();
const owner = '14013050-0d77-4a6a-966b-46671008afe1';
const shop = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4';
const order = '00a80dd5-0c74-49ab-961f-7a12577ba75d';

const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherShop = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const binding = '11111111-1111-4111-8111-111111111111';
const oldBinding = '22222222-2222-4222-8222-222222222222';
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);
const v2 = (user = owner, shopId = shop, device = binding, fid = 'A'.repeat(22), code = 5, name = '2.1.0-isolated-test') =>
  query('select public.register_native_push_device_v2($1,$2,$3,$4,$5,$6)', [user, shopId, device, fid, code, name]);
const v1 = () => query('select public.register_native_push_device($1,$2,$3,$4)', [owner, shop, oldBinding, 'B'.repeat(22)]);
const claim = () => query('select * from public.claim_printly_qa_order_00a80dd5_once()');
const pause = `revoke execute on function public.claim_native_push_deliveries(integer), public.claim_native_push_deliveries_budgeted(integer),
  public.claim_native_push_deliveries_unbudgeted(integer) from public, anon, authenticated, service_role`;

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles (id uuid primary key, role text not null);
    create table public.shops (id uuid primary key, name text not null, owner_id uuid, is_open boolean default true);
    create table public.shop_staff (user_id uuid references public.profiles(id), shop_id uuid references public.shops(id), role text, primary key (user_id,shop_id));
    create table public.orders (id uuid primary key, shop_id uuid references public.shops(id), status text, payment_method text, payment_status text, customer_name text, notes text);
    create table public.platform_settings (key text primary key, value jsonb not null);
    create table public.subscription_promos (id uuid primary key, enabled boolean not null, starts_at timestamptz, ends_at timestamptz, max_uses integer);
    create table public.subscription_purchases (promo_id uuid references public.subscription_promos(id), status text not null);
    create table public.subscription_announcements (id uuid primary key, title text, message text, enabled boolean, starts_at timestamptz, ends_at timestamptz, updated_by uuid references public.profiles(id), promo_id uuid references public.subscription_promos(id));
  `);
  await db.exec(readFileSync('supabase/migrations/0026_native_order_push.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0027_native_notification_management.sql', 'utf8'));
  await db.exec(pause);
  await db.exec(readFileSync('scripts/qa-order-notification-one-shot.sql', 'utf8'));
  await query("insert into public.profiles values ($1,'shop_staff'),($2,'shop_staff')", [owner, other]);
  await query("insert into public.shops(id,name,owner_id) values ($1,'QA Test Shop c47d26a6','14013050-0d77-4a6a-966b-46671008afe1'),($2,'Other',null)", [shop, otherShop]);
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(pause);
  await db.exec('truncate public.native_push_delivery_log, public.native_notification_audit, public.native_notification_campaigns, public.native_push_worker_quota, public.native_push_events, public.native_push_devices, public.native_push_revocations, public.orders, public.shop_staff cascade');
  await query("insert into public.shop_staff values ($1,$2,'owner'),($3,$4,'owner')", [owner, shop, other, otherShop]);
});

describe('isolated order one-shot', () => {
  it('is service-only and fails closed on device count, missing membership, pending work and restored grants', async () => {
    await db.exec('set role anon');
    try { await expect(claim()).rejects.toThrow(/permission denied/i); } finally { await db.exec('reset role'); }
    expect((await claim()).rows).toEqual([]);
    await v2(); expect((await claim()).rows).toEqual([]);
    await v1();
    await db.exec("update public.shop_staff set role='staff' where user_id='14013050-0d77-4a6a-966b-46671008afe1'");
    expect((await claim()).rows).toEqual([]);
    await db.exec("update public.shop_staff set role='owner' where user_id='14013050-0d77-4a6a-966b-46671008afe1'");
    await db.exec('grant execute on function public.claim_native_push_deliveries(integer) to service_role');
    expect((await claim()).rows).toEqual([]); await db.exec(pause);
    await query("select public.enqueue_native_order_push($1,'order')", [shop]);
    expect((await claim()).rows).toEqual([]);
    expect((await query('select count(*)::int as n from public.orders')).rows[0].n).toBe(0);
  });
  it('atomically creates one actual order event, discards non-target, and prevents duplicates and retries', async () => {
    await v1(); await v2();
    const [a,b] = await Promise.all([claim(),claim()]);
    const rows = [...a.rows,...b.rows]; expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({binding_id: binding, kind:'order'});
    expect((await query('select id,customer_name,status from public.orders')).rows).toEqual([{id:order,customer_name:'SYNTHETIC QA - Notification test',status:'queued'}]);
    expect((await query('select binding_id,state,attempts from public.native_push_deliveries order by binding_id')).rows).toEqual([
      {binding_id:binding,state:'pending',attempts:8},{binding_id:oldBinding,state:'discarded',attempts:8}]);
    await db.exec("update public.native_push_deliveries set lease_until=clock_timestamp()-interval '1 second' where state='pending'");
    expect((await query('select * from public.claim_native_push_deliveries_unbudgeted(30)')).rows).toEqual([]);
    expect((await claim()).rows).toEqual([]);
    await query('select public.sweep_native_push()');
    expect((await query("select count(*)::int as n from public.native_push_deliveries where state='pending'")).rows[0].n).toBe(0);
  });
  it('fails closed if the target opts out before claiming', async () => {
    await v1(); await v2();
    await query('select public.unregister_native_push_device($1,$2)', [owner,binding]);
    expect((await claim()).rows).toEqual([]);
    expect((await query('select count(*)::int as n from public.orders')).rows[0].n).toBe(0);
  });
  it('rolls back order when the order trigger fails to enqueue', async () => {
    await v1(); await v2(); await db.exec('alter table public.orders disable trigger native_push_order_event');
    try { await expect(claim()).rejects.toThrow(/QA_ORDER_SNAPSHOT_MISMATCH/); }
    finally { await db.exec('alter table public.orders enable trigger native_push_order_event'); }
    expect((await query('select count(*)::int as n from public.orders')).rows[0].n).toBe(0);
  });
  it('records a sent target while leaving the other discarded', async () => {
    await v1(); await v2(); const row = (await claim()).rows[0];
    expect((await query("select public.finish_native_push_delivery_logged($1,$2,'sent') as result",[row.delivery_id,row.lease_token])).rows[0].result).toBe('sent');
    expect((await query('select state from public.native_push_deliveries order by binding_id')).rows).toEqual([{state:'sent'},{state:'discarded'}]);
    expect((await claim()).rows).toEqual([]);
    await query('delete from public.orders where id=$1', [order]);
    expect((await claim()).rows).toEqual([]); // durable audit marker survives order deletion
  });
});
