import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The production migration and the temporary QA-only helper run in a local,
// disposable PostgreSQL-compatible database. No network or real devices.
const db = new PGlite();
const owner = '14013050-0d77-4a6a-966b-46671008afe1';
const shop = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4';
const event = '3b1c6a49-f9f9-447b-ac45-6f399ea5d974';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherShop = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const binding = '11111111-1111-4111-8111-111111111111';
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);
const register = (user = owner, shopId = shop, device = binding, fid = 'A'.repeat(22)) =>
  query('select public.register_native_push_device($1,$2,$3,$4)', [user, shopId, device, fid]);
const claim = () => query('select * from public.claim_printly_qa_c47d26a6_once()');

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles (id uuid primary key);
    create table public.shops (id uuid primary key);
    create table public.shop_staff (user_id uuid references public.profiles(id), shop_id uuid references public.shops(id), role text, primary key (user_id,shop_id));
    create table public.orders (id uuid primary key, shop_id uuid references public.shops(id), status text, payment_method text, payment_status text);
  `);
  await db.exec(readFileSync('supabase/migrations/0026_native_order_push.sql', 'utf8'));
  await db.exec(readFileSync('scripts/qa-notification-one-shot.sql', 'utf8'));
  await query('insert into public.profiles values ($1),($2)', [owner, other]);
  await query('insert into public.shops values ($1),($2)', [shop, otherShop]);
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('truncate public.native_push_events, public.native_push_devices, public.native_push_revocations, public.orders, public.shop_staff cascade');
  await query("insert into public.shop_staff values ($1,$2,'owner'),($3,$4,'owner')", [owner, shop, other, otherShop]);
});

describe('temporary isolated QA one-shot SQL', () => {
  it('allows only the service role to invoke it', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try { await expect(claim()).rejects.toThrow(/permission denied/i); }
      finally { await db.exec('reset role'); }
    }
    await db.exec('set role service_role');
    try { expect((await claim()).rows).toEqual([]); }
    finally { await db.exec('reset role'); }
  });
  it('fails closed for zero, wrong, multiple, or no-longer-owner devices', async () => {
    expect((await claim()).rows).toEqual([]);
    await register(other, otherShop);
    expect((await claim()).rows).toEqual([]);
    await register(owner, shop, '22222222-2222-4222-8222-222222222222', 'B'.repeat(22));
    expect((await claim()).rows).toEqual([]);
    await db.exec('delete from public.native_push_devices');
    await register();
    await query("update public.shop_staff set role='staff' where user_id=$1 and shop_id=$2", [owner, shop]);
    expect((await claim()).rows).toEqual([]);
    expect((await query('select count(*)::integer as n from public.native_push_events')).rows[0].n).toBe(0);
  });
  it('does not interfere with an existing pending delivery', async () => {
    await register(); await query("select public.enqueue_native_order_push($1,'payment')", [shop]);
    expect((await claim()).rows).toEqual([]);
    expect((await query('select kind from public.native_push_events')).rows).toEqual([{ kind: 'payment' }]);
  });
  it('creates the fixed event once and normal workers cannot retry it even after lease expiry', async () => {
    await register();
    const [first, second] = await Promise.all([claim(), claim()]);
    const all = [...first.rows, ...second.rows];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ event_id: event, binding_id: binding, fid: 'A'.repeat(22), kind: 'order' });
    expect((await query('select state,attempts from public.native_push_deliveries')).rows).toEqual([{ state: 'pending', attempts: 8 }]);
    await db.exec("update public.native_push_deliveries set lease_until=clock_timestamp()-interval '1 second'");
    expect((await query('select * from public.claim_native_push_deliveries(30)')).rows).toEqual([]);
    expect((await claim()).rows).toEqual([]);
    await query('select public.sweep_native_push()');
    expect((await query('select state,attempts from public.native_push_deliveries')).rows).toEqual([{ state: 'discarded', attempts: 8 }]);
    expect((await claim()).rows).toEqual([]);
  });
  it('records a successful one-shot send without making it retryable', async () => {
    await register(); const row = (await claim()).rows[0];
    const finish = await query("select public.finish_native_push_delivery($1,$2,'sent') as outcome", [row.delivery_id, row.lease_token]);
    expect(finish.rows[0].outcome).toBe('sent');
    expect((await claim()).rows).toEqual([]);
    expect((await query('select state,attempts from public.native_push_deliveries')).rows).toEqual([{ state: 'sent', attempts: 8 }]);
  });
});
