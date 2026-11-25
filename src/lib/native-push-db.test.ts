import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = new PGlite();
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const shop = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherShop = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const order = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const binding = '11111111-1111-4111-8111-111111111111';
const secondBinding = '22222222-2222-4222-8222-222222222222';
const fid = 'A'.repeat(22);
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);
const register = (user = owner, shopId = shop, device = binding, id = fid) =>
  query('select public.register_native_push_device($1,$2,$3,$4)', [user, shopId, device, id]);

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles (id uuid primary key);
    create table public.shops (id uuid primary key);
    create table public.shop_staff (user_id uuid references public.profiles(id), shop_id uuid references public.shops(id), primary key (user_id,shop_id));
    create table public.orders (id uuid primary key, shop_id uuid references public.shops(id), status text, payment_method text, payment_status text, customer_name text);
  `);
  await db.exec(readFileSync('supabase/migrations/0026_native_order_push.sql', 'utf8'));
  await query('insert into public.profiles values ($1),($2)', [owner, other]);
  await query('insert into public.shops values ($1),($2)', [shop, otherShop]);
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('truncate public.native_push_events, public.native_push_devices, public.orders, public.shop_staff cascade');
  await query('insert into public.shop_staff values ($1,$2),($3,$4)', [owner, shop, other, otherShop]);
});

describe('native push registration and outbox', () => {
  it('limits privileged operations to the service role and verifies shop membership', async () => {
    await expect(register(other, shop)).rejects.toThrow('SHOP_MEMBERSHIP_REQUIRED');
    await expect(register(owner, shop, binding, 'not-a-valid-fid')).rejects.toThrow('INVALID_NATIVE_PUSH_DEVICE');
    await register();
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await expect(query('select * from public.native_push_devices')).rejects.toThrow(/permission denied/i);
        await expect(query('select * from public.native_push_deliveries')).rejects.toThrow(/permission denied/i);
        await expect(query('select * from public.claim_native_push_deliveries(1)')).rejects.toThrow(/permission denied/i);
        await expect(register()).rejects.toThrow(/permission denied/i);
      } finally { await db.exec('reset role'); }
    }
  });
  it('queues only actionable transitions with no customer or tracking data', async () => {
    await register(); await register(other, otherShop, secondBinding, 'B'.repeat(22));
    await query("insert into public.orders values ($1,$2,'draft','upi','pending','Private customer')", [order, shop]);
    expect((await query('select * from public.native_push_events')).rows).toHaveLength(0);
    await query("update public.orders set payment_status='submitted' where id=$1", [order]);
    expect((await query('select kind from public.native_push_events')).rows).toEqual([{ kind: 'payment' }]);
    expect((await query('select binding_id from public.native_push_deliveries')).rows).toEqual([{ binding_id: binding }]);
    await query("update public.orders set customer_name='Changed' where id=$1", [order]);
    await query("update public.orders set status='queued',payment_status='confirmed' where id=$1", [order]);
    expect((await query('select kind from public.native_push_events')).rows).toHaveLength(1);
    const rows = (await query('select * from public.native_push_events')).rows;
    expect(JSON.stringify(rows)).not.toMatch(/Private customer|Changed|eeeeeeee/);
    await query("insert into public.orders values ('33333333-3333-4333-8333-333333333333',$1,'queued','cod','cod_pending','Someone')", [shop]);
    expect((await query('select kind from public.native_push_events order by kind')).rows).toEqual([{ kind: 'order' }, { kind: 'payment' }]);
  });
  it('leases deliveries, rejects stale acknowledgements and retries safely', async () => {
    await register();
    await query("insert into public.orders values ($1,$2,'queued','cod','cod_pending','Private')", [order, shop]);
    const claim = (await query('select * from public.claim_native_push_deliveries(10)')).rows[0];
    expect(claim).toMatchObject({ binding_id: binding, fid, kind: 'order' });
    expect((await query('select * from public.claim_native_push_deliveries(10)')).rows).toHaveLength(0);
    expect((await query('select public.finish_native_push_delivery($1,$2,$3) as ok', [claim.delivery_id, secondBinding, 'sent'])).rows[0].ok).toBe(false);
    expect((await query('select public.finish_native_push_delivery($1,$2,$3) as ok', [claim.delivery_id, claim.lease_token, 'retry'])).rows[0].ok).toBe(true);
    await query("update public.native_push_deliveries set next_attempt_at=clock_timestamp()-interval '1 second' where id=$1", [claim.delivery_id]);
    const retry = (await query('select * from public.claim_native_push_deliveries(10)')).rows[0];
    expect(retry.lease_token).not.toBe(claim.lease_token);
    expect((await query('select public.finish_native_push_delivery($1,$2,$3) as ok', [retry.delivery_id, retry.lease_token, 'sent'])).rows[0].ok).toBe(true);
    expect((await query('select state,attempts from public.native_push_deliveries')).rows).toEqual([{ state: 'sent', attempts: 2 }]);
  });
  it('does not transfer queued alerts when a device changes account or loses membership', async () => {
    await register();
    await query("insert into public.orders values ($1,$2,'queued','cod','cod_pending','Private')", [order, shop]);
    await register(); // idempotent reconnect keeps the queue
    expect((await query('select * from public.native_push_deliveries')).rows).toHaveLength(1);
    await query('select public.unregister_native_push_device($1,$2)', [other, binding]);
    expect((await query('select * from public.native_push_devices')).rows).toHaveLength(1);
    await register(other, otherShop, secondBinding, fid); // same phone, different account
    expect((await query('select * from public.native_push_deliveries')).rows).toHaveLength(0);
    expect((await query('select user_id,shop_id from public.native_push_devices')).rows).toEqual([{ user_id: other, shop_id: otherShop }]);
    await query('delete from public.shop_staff where user_id=$1 and shop_id=$2', [other, otherShop]);
    expect((await query('select * from public.native_push_devices')).rows).toHaveLength(0);
  });
  it('bounds devices, and cancels old work on FID rotation without breaking idempotent sync', async () => {
    await register();
    await query("insert into public.orders values ($1,$2,'queued','cod','cod_pending','Private')", [order, shop]);
    await register();
    expect((await query('select * from public.native_push_deliveries')).rows).toHaveLength(1);
    await register(owner, shop, binding, 'C'.repeat(22));
    expect((await query('select * from public.native_push_deliveries')).rows).toHaveLength(0);
    for (let i = 0; i < 9; i++) await register(owner, shop, randomUUID(), String.fromCharCode(68 + i).repeat(22));
    await expect(register(owner, shop, randomUUID(), 'Z'.repeat(22))).rejects.toThrow('NATIVE_PUSH_DEVICE_LIMIT');
    expect((await query('select * from public.native_push_devices')).rows).toHaveLength(10);
  });
  it('does not sweep an active lease, but discards expired work when the lease ends', async () => {
    await register();
    await query("insert into public.orders values ($1,$2,'queued','cod','cod_pending','Private')", [order, shop]);
    const claim = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    await query("update public.native_push_events set expires_at=clock_timestamp()-interval '1 second' where id=$1", [claim.event_id]);
    await query('select public.sweep_native_push()');
    expect((await query('select state from public.native_push_deliveries')).rows[0].state).toBe('pending');
    await query("update public.native_push_deliveries set lease_until=clock_timestamp()-interval '1 second' where id=$1", [claim.delivery_id]);
    await query('select public.sweep_native_push()');
    expect((await query('select state from public.native_push_deliveries')).rows[0].state).toBe('discarded');
  });
  it('also revokes registrations when an existing membership changes shops', async () => {
    await register();
    await query('update public.shop_staff set shop_id=$1 where user_id=$2 and shop_id=$3', [otherShop, owner, shop]);
    expect((await query('select * from public.native_push_devices')).rows).toHaveLength(0);
  });
  it('never prevents order writes if enqueueing fails', async () => {
    await db.exec("create or replace function public.enqueue_native_order_push(p_shop uuid, p_kind text) returns void language plpgsql as $$ begin raise exception 'simulated outage'; end $$;");
    await query("insert into public.orders values ($1,$2,'queued','cod','cod_pending','Private')", [order, shop]);
    expect((await query('select status from public.orders where id=$1', [order])).rows[0].status).toBe('queued');
  });
});
