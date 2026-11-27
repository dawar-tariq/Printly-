import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('claims only one synthetic token notification, never retries and fails closed', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.profiles(id uuid primary key,role text not null);
      create table public.shops(id uuid primary key,name text not null);
      create table public.shop_staff(user_id uuid references public.profiles(id),shop_id uuid references public.shops(id),role text,primary key(user_id,shop_id));
      create table public.orders(id uuid primary key,shop_id uuid references public.shops(id),status text,payment_method text,payment_status text,token text);
      create table public.platform_settings(key text primary key,value jsonb not null);
      create table public.subscription_promos(id uuid primary key,enabled boolean not null,starts_at timestamptz,ends_at timestamptz,max_uses integer);
      create table public.subscription_purchases(promo_id uuid references public.subscription_promos(id),status text not null);
      create table public.subscription_announcements(id uuid primary key,title text,message text,enabled boolean,starts_at timestamptz,ends_at timestamptz,updated_by uuid references public.profiles(id),promo_id uuid references public.subscription_promos(id));`);
    for (const file of ['0026_native_order_push.sql','0027_native_notification_management.sql','0028_native_order_token_notifications.sql']) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
    await db.exec(`revoke execute on function public.claim_native_push_deliveries(integer), public.claim_native_push_deliveries_budgeted(integer), public.claim_native_push_deliveries_unbudgeted(integer) from service_role;`);
    await db.exec(readFileSync('scripts/native-production-once.sql','utf8'));
    const empty = await db.query('select * from public.claim_printly_prod_token_test_once()');
    expect(empty.rows).toHaveLength(0);
    await db.exec(`insert into public.profiles values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','shop_staff');
      insert into public.shops values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Synthetic');
      insert into public.shop_staff values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','owner');
      select public.register_native_push_device_v2('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','AAAAAAAAAAAAAAAAAAAAAA',6,'2.1.1');`);
    const first = await db.query('select * from public.claim_printly_prod_token_test_once()');
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({kind:'order',order_token:'A-1234567890'});
    expect((await db.query('select * from public.claim_printly_prod_token_test_once()')).rows).toHaveLength(0);
    expect((await db.query('select attempts from public.native_push_deliveries')).rows).toEqual([{attempts:8}]);
    expect((await db.query('select count(*)::int as n from public.orders')).rows).toEqual([{n:0}]);
    expect((await db.query("select has_function_privilege('anon','public.claim_printly_prod_token_test_once()','execute') as anon,has_function_privilege('authenticated','public.claim_printly_prod_token_test_once()','execute') as authenticated")).rows).toEqual([{anon:false,authenticated:false}]);
  } finally { await db.close(); }
},30000);
