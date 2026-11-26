import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const shop = '11111111-1111-4111-8111-111111111111';
const otherShop = '22222222-2222-4222-8222-222222222222';
const old = '33333333-3333-4333-8333-333333333333';
const current = '44444444-4444-4444-8444-444444444444';
const order = '55555555-5555-4555-8555-555555555555';
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles (id uuid primary key, role text not null);
    create table public.shops (id uuid primary key, name text not null);
    create table public.shop_staff (user_id uuid references public.profiles(id), shop_id uuid references public.shops(id), role text, primary key (user_id,shop_id));
    create table public.orders (id uuid primary key, shop_id uuid references public.shops(id), status text, payment_method text, payment_status text, token text);
    create table public.platform_settings (key text primary key, value jsonb not null);
    create table public.subscription_promos (id uuid primary key, enabled boolean not null, starts_at timestamptz, ends_at timestamptz, max_uses integer);
    create table public.subscription_purchases (promo_id uuid references public.subscription_promos(id), status text not null);
    create table public.subscription_announcements (id uuid primary key, title text, message text, enabled boolean, starts_at timestamptz, ends_at timestamptz, updated_by uuid references public.profiles(id), promo_id uuid references public.subscription_promos(id));
  `);
  await db.exec(readFileSync('supabase/migrations/0026_native_order_push.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0027_native_notification_management.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0028_native_order_token_notifications.sql', 'utf8'));
  await query("insert into public.profiles values ($1,'admin'),($2,'shop_staff'),($3,'shop_staff')", [admin, owner, other]);
  await query("insert into public.shops values ($1,'First'),($2,'Second')", [shop, otherShop]);
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('truncate public.native_push_delivery_log, public.native_notification_audit, public.native_notification_templates, public.native_notification_campaigns, public.native_app_releases, public.native_push_worker_quota, public.native_push_events, public.native_push_devices, public.native_push_revocations, public.subscription_announcements, public.subscription_promos, public.subscription_purchases, public.platform_settings, public.orders, public.shop_staff cascade');
  await query("insert into public.shop_staff values ($1,$2,'owner'),($3,$4,'owner')", [owner, shop, other, otherShop]);
});


describe('native order-token migration', () => {
  it('limits token lookup to a valid lease and sends generic content to older versions', async () => {
    await query('select public.register_native_push_device_v2($1,$2,$3,$4,5,$5)',[owner,shop,old,'A'.repeat(22),'2.1.0']);
    await query('select public.register_native_push_device_v2($1,$2,$3,$4,6,$5)',[owner,shop,current,'B'.repeat(22),'2.1.1']);
    await query("insert into public.orders(id,shop_id,status,token) values($1,$2,'queued','A-123')",[order,shop]);
    const rows = (await query('select * from public.claim_native_push_deliveries_budgeted(30)')).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const result = await query('select public.native_push_order_token($1,$2) as value',[row.delivery_id,row.lease_token]);
      expect(result.rows[0].value).toEqual({token: row.binding_id===current ? 'A-123' : null});
      expect((await query('select public.native_push_order_token($1,$2) as value',[row.delivery_id,'99999999-9999-4999-8999-999999999999'])).rows[0].value).toBeNull();
    }
    await query('delete from public.shop_staff where user_id=$1 and shop_id=$2',[owner,shop]);
    expect((await query('select public.native_push_order_token($1,$2) as value',[rows[0].delivery_id,rows[0].lease_token])).rows[0].value).toBeNull();
    expect((await query("select has_function_privilege('anon','public.native_push_order_token(uuid,uuid)','execute') as anon, has_function_privilege('authenticated','public.native_push_order_token(uuid,uuid)','execute') as authenticated, has_function_privilege('service_role','public.native_push_order_token(uuid,uuid)','execute') as service")).rows[0]).toEqual({anon:false,authenticated:false,service:true});
  });
  it('does not put malformed tokens or names into events and leaves order creation working', async () => {
    await query('select public.register_native_push_device_v2($1,$2,$3,$4,6,$5)',[owner,shop,current,'B'.repeat(22),'2.1.1']);
    await query("insert into public.orders(id,shop_id,status,token) values($1,$2,'queued','PRIVATE NAME')",[order,shop]);
    expect((await query('select kind,order_token from public.native_push_events')).rows).toEqual([{kind:'order',order_token:null}]);
    expect((await query('select count(*)::int as n from public.orders')).rows[0].n).toBe(1);
  });
});
