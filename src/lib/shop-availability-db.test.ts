import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Execute the actual migration chain in isolated PostgreSQL-compatible PGlite.
// Run through 0021 only so the shop-only release does not depend on account support.
// Separate multi-connection tests are needed to prove lock scheduling.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const shop = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const order = '11111111-1111-4111-8111-111111111111';
const item = '22222222-2222-4222-8222-222222222222';
const ticket = '33333333-3333-4333-8333-333333333333';
const message = '44444444-4444-4444-8444-444444444444';
let db: PGlite;
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);

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
  const migrations = readdirSync('supabase/migrations').filter((file) => /^\d{4}_.*\.sql$/.test(file) && !file.startsWith('0003_') && file.slice(0, 4) <= '0021').sort();
  for (const name of migrations) await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8').replace('create extension if not exists pgcrypto;', ''));
  await query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'owner@example.test','{}'),($2,'one@example.test','{}'),($3,'two@example.test','{}')", [owner, customer, other]);
  await query("select set_config('printly.checked_shop_name',$1,false)", [shop]);
  await query("insert into public.shops(id,owner_id,slug,short_code,name,status,upi_id) values ($1,$2,'availability','AVAIL234','Availability','active','test@upi')", [shop, owner]);
  await query("insert into public.shop_staff(shop_id,user_id,role) values ($1,$2,'owner'),($1,$3,'staff')", [shop, owner, other]);
  await query("insert into public.shop_subscriptions(shop_id,term,started_at,expires_at,is_permanent) values ($1,'grace',now(),now()+interval '1 year',false)", [shop]);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate public.orders, public.support_tickets, public.support_messages, public.shop_counters cascade');
  await query('update public.shops set is_open=true where id=$1', [shop]);
});

async function prepareDraft() {
  await query('insert into public.orders(id,shop_id) values ($1,$2)', [order, shop]);
  await query("insert into public.order_items(id,order_id,service) values ($1,$2,'print')", [item, order]);
  const version = (await query('select draft_version from public.orders where id=$1', [order])).rows[0].draft_version;
  const shopSnapshot = (await query("select jsonb_build_object('name',name,'upi_id',upi_id,'eta_minutes',eta_minutes,'rush_surcharge_bps',rush_surcharge_bps,'status',status) as value from public.shops where id=$1", [shop])).rows[0].value;
  return { version, shopSnapshot };
}
async function checkout(snapshot: Awaited<ReturnType<typeof prepareDraft>>, method: 'upi' | 'cod') {
  const checkoutData = { method, customer_name: 'Customer', customer_phone: '9797000000', subtotal_paise: 200, tax_paise: 36, total_paise: 236, quote_token: 'a'.repeat(64), pricing_engine: 'duplex-v1' };
  return query('select public.commit_draft_checkout($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7::jsonb)', [order, snapshot.version, '[]', 1800, JSON.stringify(snapshot.shopSnapshot), JSON.stringify([{ id: item, unit_price_paise: 200, line_total_paise: 200 }]), JSON.stringify(checkoutData)]);
}

describe('shop availability migration without account support', () => {
  it('defaults shops to open, exposes only the public flag, and requires the real owner', async () => {
    expect((await query('select is_open from public.shops where id=$1', [shop])).rows[0].is_open).toBe(true);
    await expect(query('select public.set_shop_open($1,$2,false)', [shop, other])).rejects.toThrow('SHOP_OWNER_REQUIRED');
    expect((await query('select public.set_shop_open($1,$2,false) as value', [shop, owner])).rows[0].value).toBe(false);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        expect((await query('select is_open from public.shops where id=$1', [shop])).rows[0].is_open).toBe(false);
        await expect(query('select owner_id from public.shops where id=$1', [shop])).rejects.toThrow(/permission denied/i);
        await expect(query('select public.set_shop_open($1,$2,true)', [shop, owner])).rejects.toThrow(/permission denied/i);
        await expect(query('update public.shops set is_open=true where id=$1', [shop])).rejects.toThrow(/permission denied/i);
      } finally { await db.exec('reset role'); }
    }
  });
  it('blocks inserts and first checkout while closed, then allows the same draft after reopening', async () => {
    const snapshot = await prepareDraft();
    await query('select public.set_shop_open($1,$2,false)', [shop, owner]);
    await expect(query('insert into public.orders(shop_id) values ($1)', [shop])).rejects.toThrow('SHOP_CLOSED');
    await expect(query("update public.orders set payment_method='cod' where id=$1", [order])).rejects.toThrow('SHOP_CLOSED');
    await expect(checkout(snapshot, 'cod')).rejects.toThrow('SHOP_CLOSED');
    expect((await query('select status,payment_method from public.orders where id=$1', [order])).rows[0]).toEqual({ status: 'draft', payment_method: null });
    await query('select public.set_shop_open($1,$2,true)', [shop, owner]);
    await checkout(snapshot, 'cod');
    expect((await query('select status,payment_method from public.orders where id=$1', [order])).rows[0]).toEqual({ status: 'queued', payment_method: 'cod' });
    await query('select public.set_shop_open($1,$2,false)', [shop, owner]);
    await query("update public.orders set status='printing' where id=$1", [order]);
    expect((await query('select status from public.orders where id=$1', [order])).rows[0].status).toBe('printing');
  });
  it('still permits submission and management of an already-started UPI payment when closed', async () => {
    const snapshot = await prepareDraft();
    await checkout(snapshot, 'upi');
    await query('select public.set_shop_open($1,$2,false)', [shop, owner]);
    await query("select public.submit_upi_payment($1,'UTR123')", [order]);
    expect((await query('select payment_status,payment_method from public.orders where id=$1', [order])).rows[0]).toEqual({ payment_status: 'submitted', payment_method: 'upi' });
  });
  it('preserves anonymous code-protected support creation and replies', async () => {
    const hash = 'a'.repeat(64);
    const reply = '55555555-5555-4555-8555-555555555555';
    expect((await query('select public.create_support_ticket($1,$2,$3,$4,$5) as value', [ticket, hash, 'Help', message, 'Hello'])).rows[0].value).toBe('created');
    expect((await query("select public.append_support_message($1,$2,'customer',null,$3) as value", [ticket, reply, 'A follow-up'])).rows[0].value).toBe('created');
    expect((await query('select secret_hash,message_count,status from public.support_tickets where id=$1', [ticket])).rows[0]).toEqual({ secret_hash: hash, message_count: 2, status: 'open' });
  });
});
