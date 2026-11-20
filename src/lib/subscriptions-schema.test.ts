import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Apply the real application schema and policies in order, with small local
// substitutes for Supabase Auth/Storage. The demo seed is intentionally not
// applied and PGlite uses PostgreSQL's built-in gen_random_uuid, so pgcrypto's
// extension declaration is omitted. This is not a live Supabase test.
const shop = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const queued = '11111111-1111-4111-8111-111111111111';
const upi = '22222222-2222-4222-8222-222222222222';
const closed = '33333333-3333-4333-8333-333333333333';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant usage, select on sequences to service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb,
      confirmation_token text, recovery_token text, email_change text, email_change_token_new text,
      email_change_token_current text, phone_change text, phone_change_token text, reauthentication_token text);
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (name text, bucket_id text);
    alter table storage.objects enable row level security;
    grant select on storage.objects to authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
  `);
  const migrations = [
    '0001_printly_schema.sql', '0002_printly_rls.sql', '0004_items_file_link.sql',
    '0005_fix_seeded_auth_token_nulls.sql', '0006_shop_onboarding.sql',
    '0007_shop_identity_and_name_proof.sql', '0008_resubmit_name_proof.sql',
    '0009_limit_public_shop_columns.sql', '0010_order_draft_safeguards.sql',
  ];
  for (const name of migrations) {
    const sql = readFileSync(`supabase/migrations/${name}`, 'utf8').replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
  }
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'owner@example.test','{}'::jsonb)", [owner]);
  await db.query("update public.profiles set role='shop_staff' where id=$1", [owner]);
  await db.query("select set_config('printly.checked_shop_name',$1,false)", [shop]);
  await db.query("insert into public.shops(id,owner_id,slug,short_code,name,status) values ($1,$2,'existing','EXIST','Existing shop','active')", [shop, owner]);
  await db.query("insert into public.shop_staff(shop_id,user_id,role) values ($1,$2,'owner')", [shop, owner]);
  await db.query("insert into public.inventory_items(shop_id,name) values ($1,'Paper')", [shop]);
  await db.query("insert into public.orders(id,shop_id,status,payment_method) values ($1,$4,'queued','cod'),($2,$4,'draft','upi'),($3,$4,'collected','cod')", [queued, upi, closed, shop]);
  await db.query("insert into storage.objects(name,bucket_id) values ($1,'order-files'),($2,'order-files'),($3,'order-files')", [`${shop}/${queued}/file.pdf`, `${shop}/${upi}/file.pdf`, `${shop}/${closed}/file.pdf`]);
  await db.exec("insert into public.platform_settings(key,value) values ('commission_bps','800'::jsonb)");
  await db.exec(readFileSync('supabase/migrations/0011_subscriptions.sql', 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });

describe('subscription migration with the real preceding schema and policies', () => {
  it('backfills existing shops and removes the operational commission setting', async () => {
    expect((await db.query('select term, extract(epoch from expires_at-started_at)::int as seconds from public.shop_subscriptions where shop_id=$1', [shop])).rows)
      .toEqual([{ term: 'grace', seconds: 30 * 24 * 60 * 60 }]);
    expect((await db.query("select key from public.platform_settings where key='commission_bps'")).rows).toEqual([]);
  });
  it('retains only recovery reads after expiration through the actual RLS policies', async () => {
    await db.query("update public.shop_subscriptions set started_at=now()-interval '31 days', expires_at=now()-interval '1 day' where shop_id=$1", [shop]);
    await db.exec('set role authenticated');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      expect((await db.query('select id from public.orders order by id')).rows).toEqual([{ id: queued }, { id: upi }]);
      expect((await db.query('select * from public.inventory_items')).rows).toEqual([]);
      expect((await db.query('select name from storage.objects order by name')).rows).toEqual([
        { name: `${shop}/${queued}/file.pdf` }, { name: `${shop}/${upi}/file.pdf` },
      ]);
      await expect(db.query('select * from public.subscription_plan')).rejects.toThrow(/permission denied/i);
      await expect(db.query("update public.profiles set role='admin' where id=$1", [owner])).rejects.toThrow(/permission denied/i);
    } finally { await db.exec('reset role'); }
  });
  it('keeps permanent access and zero-commission checkout compatible with the full schema', async () => {
    const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const draft = '44444444-4444-4444-8444-444444444444';
    const item = '55555555-5555-4555-8555-555555555555';
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'admin@example.test','{}'::jsonb)", [admin]);
    await db.query("update public.profiles set role='admin' where id=$1", [admin]);
    await db.query("select public.set_shop_permanent_subscription($1,$2,true,'test')", [shop, admin]);
    await db.query('insert into public.orders(id,shop_id) values ($1,$2)', [draft, shop]);
    await db.query("insert into public.order_items(id,order_id,service) values ($1,$2,'print')", [item, draft]);
    const version = (await db.query<{ draft_version: number }>('select draft_version from public.orders where id=$1', [draft])).rows[0].draft_version;
    const snapshot = (await db.query<{ data: unknown }>("select jsonb_build_object('name',name,'upi_id',upi_id,'eta_minutes',eta_minutes,'rush_surcharge_bps',rush_surcharge_bps,'status',status) as data from public.shops where id=$1", [shop])).rows[0].data;
    const checkout = { method: 'cod', customer_name: 'Customer', customer_phone: '9797000000', subtotal_paise: 200, tax_paise: 36, total_paise: 236, quote_token: 'a'.repeat(64) };
    await db.query('select public.commit_draft_checkout($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7::jsonb)', [draft, version, '[]', 1800, JSON.stringify(snapshot), JSON.stringify([{ id: item, unit_price_paise: 200, line_total_paise: 200 }]), JSON.stringify(checkout)]);
    expect((await db.query('select status, payment_status, commission_paise from public.orders where id=$1', [draft])).rows)
      .toEqual([{ status: 'queued', payment_status: 'cod_pending', commission_paise: 0 }]);
  });
});
