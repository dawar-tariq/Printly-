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
  await db.exec(readFileSync('supabase/migrations/0012_security_hardening.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0013_public_abuse_limits.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0014_more_abuse_limits.sql', 'utf8'));
  // A previous display total with no corresponding rows must be preserved for
  // operators before migration 0015 recalculates it from the stored reviews.
  await db.query('update public.shops set rating_avg=4.5, rating_count=3 where id=$1', [shop]);
  await db.exec(readFileSync('supabase/migrations/0015_feedback_integrity.sql', 'utf8'));
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
  it('keeps tracking IDs in reviews and privileged writes behind the server role', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query('select order_id from public.reviews')).rejects.toThrow(/permission denied/i);
        await expect(db.query("insert into public.reviews(order_id, shop_id, rating) values ($1,$2,5)", [closed, shop])).rejects.toThrow(/permission denied/i);
        await expect(db.query("insert into public.disputes(order_id, type, description, status) values ($1,'other','fake resolution','resolved_refund')", [closed])).rejects.toThrow(/permission denied/i);
        await expect(db.query("update public.platform_settings set value='false'::jsonb")).rejects.toThrow(/permission denied/i);
        await expect(db.query('select * from public.shop_counters')).rejects.toThrow(/permission denied/i);
        await expect(db.query('select * from public.pre_0015_shop_ratings')).rejects.toThrow(/permission denied/i);
        await expect(db.query('select * from public.get_order_track($1)', [closed])).rejects.toThrow(/permission denied/i);
      } finally { await db.exec('reset role'); }
    }
    await db.exec('set role service_role');
    try {
      expect((await db.query('select order_id from public.get_order_track($1)', [closed])).rows).toEqual([{ order_id: closed }]);
      expect((await db.query('select order_id from public.reviews')).rows).toEqual([]);
      expect((await db.query('select rating_avg::float as avg, rating_count as count from public.pre_0015_shop_ratings where shop_id=$1', [shop])).rows).toEqual([{ avg: 4.5, count: 3 }]);
      expect((await db.query('select rating_avg::float as avg, rating_count as count from public.shops where id=$1', [shop])).rows).toEqual([{ avg: 0, count: 0 }]);
    } finally { await db.exec('reset role'); }
  });
  it('enforces distributed public limits atomically and denies clients direct access', async () => {
    const key = 'a'.repeat(64);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query('select * from public.security_rate_limits')).rejects.toThrow(/permission denied/i);
        await expect(db.query("select public.consume_public_rate_limit('signup',$1)", [key])).rejects.toThrow(/permission denied/i);
      } finally { await db.exec('reset role'); }
    }
    await db.exec('set role service_role');
    try {
      for (let i = 0; i < 10; i++) {
        const { rows } = await db.query<{ result: { allowed: boolean } }>("select public.consume_public_rate_limit('signup',$1) as result", [key]);
        expect(rows[0].result.allowed).toBe(true);
      }
      const blocked = await db.query<{ result: { allowed: boolean; retry_after: number } }>("select public.consume_public_rate_limit('signup',$1) as result", [key]);
      expect(blocked.rows[0].result.allowed).toBe(false);
      expect(blocked.rows[0].result.retry_after).toBeGreaterThan(0);
      expect((await db.query<{ result: { allowed: boolean } }>("select public.consume_public_rate_limit('order_start',$1) as result", [key])).rows[0].result.allowed).toBe(true);
      await db.query("update public.security_rate_limits set window_ends_at=now()-interval '1 second' where bucket='signup' and client_hash=$1", [key]);
      expect((await db.query<{ result: { allowed: boolean } }>("select public.consume_public_rate_limit('signup',$1) as result", [key])).rows[0].result.allowed).toBe(true);
    } finally { await db.exec('reset role'); }
  });
  it('shares the login and draft issuance limits, including concurrent attempts', async () => {
    const loginKey = 'b'.repeat(64), draftKey = 'c'.repeat(64);
    await db.exec('set role service_role');
    try {
      const login = await Promise.all(Array.from({ length: 15 }, () => db.query<{ result: { allowed: boolean } }>(
        "select public.consume_public_rate_limit('login_attempt',$1) as result", [loginKey])));
      expect(login.filter(({ rows }) => rows[0].result.allowed)).toHaveLength(12);
      const uploads = await Promise.all(Array.from({ length: 40 }, () => db.query<{ result: { allowed: boolean; retry_after: number } }>(
        "select public.consume_public_rate_limit('draft_upload_issue',$1) as result", [draftKey])));
      expect(uploads.filter(({ rows }) => rows[0].result.allowed)).toHaveLength(30);
      expect(uploads.find(({ rows }) => !rows[0].result.allowed)?.rows[0].result.retry_after).toBeGreaterThan(3600);
    } finally { await db.exec('reset role'); }
  });
  it('allows only one open report per order, but permits a new report after resolution', async () => {
    const insert = () => db.query("insert into public.disputes(order_id,type,description) values ($1,'other','A real issue')", [closed]);
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/i);
    await db.query("update public.disputes set status='resolved_reject' where order_id=$1", [closed]);
    await insert();
    expect((await db.query('select count(*)::int as n from public.disputes where order_id=$1', [closed])).rows).toEqual([{ n: 2 }]);
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
  it('calculates rating aggregates from more than a PostgREST page and rejects stale totals', async () => {
    // Seed a large existing history efficiently, then exercise the real triggers.
    await db.exec('alter table public.reviews disable trigger refresh_review_shop_rating');
    try {
      await db.query(`with inserted as (
        insert into public.orders(shop_id,status,payment_method)
        select $1, 'collected', 'cod' from generate_series(1,1001) returning id
      ) insert into public.reviews(order_id,shop_id,rating)
        select id,$1,5 from inserted`, [shop]);
    } finally { await db.exec('alter table public.reviews enable trigger refresh_review_shop_rating'); }
    await db.query('insert into public.reviews(order_id,shop_id,rating) values ($1,$2,1)', [closed, shop]);
    const rating = () => db.query('select rating_count, rating_avg::float as rating_avg from public.shops where id=$1', [shop]);
    expect((await rating()).rows).toEqual([{ rating_count: 1002, rating_avg: 5 }]);
    // Older deployments attempted to overwrite the aggregate using a 1,000-row page.
    await db.query('update public.shops set rating_count=1000,rating_avg=1 where id=$1', [shop]);
    expect((await rating()).rows).toEqual([{ rating_count: 1002, rating_avg: 5 }]);
    await db.query('delete from public.reviews where order_id=$1', [closed]);
    expect((await rating()).rows).toEqual([{ rating_count: 1001, rating_avg: 5 }]);
  }, 30000);
});
