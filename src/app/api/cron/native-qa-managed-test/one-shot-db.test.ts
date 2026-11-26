import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Disposable synthetic database only: no Supabase, actual FIDs or sends.
const db = new PGlite();
const owner = '14013050-0d77-4a6a-966b-46671008afe1';
const shop = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4';
const event = '997a24b9-9460-4565-833c-f0cfbe580f11';
const campaign = '90e80914-b861-4f31-94b1-523d20191e35';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherShop = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const binding = '11111111-1111-4111-8111-111111111111';
const oldBinding = '22222222-2222-4222-8222-222222222222';
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);
const v2 = (user = owner, shopId = shop, device = binding, fid = 'A'.repeat(22), code = 5, name = '2.1.0-isolated-test') =>
  query('select public.register_native_push_device_v2($1,$2,$3,$4,$5,$6)', [user, shopId, device, fid, code, name]);
const v1 = () => query('select public.register_native_push_device($1,$2,$3,$4)', [owner, shop, oldBinding, 'B'.repeat(22)]);
const claim = () => query('select * from public.claim_printly_qa_v2_e320520dd717_once()');
const pause = `revoke execute on function public.claim_native_push_deliveries(integer), public.claim_native_push_deliveries_budgeted(integer),
  public.claim_native_push_deliveries_unbudgeted(integer) from public, anon, authenticated, service_role`;

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles (id uuid primary key, role text not null);
    create table public.shops (id uuid primary key, name text not null);
    create table public.shop_staff (user_id uuid references public.profiles(id), shop_id uuid references public.shops(id), role text, primary key (user_id,shop_id));
    create table public.orders (id uuid primary key, shop_id uuid references public.shops(id), status text, payment_method text, payment_status text);
    create table public.platform_settings (key text primary key, value jsonb not null);
    create table public.subscription_promos (id uuid primary key, enabled boolean not null, starts_at timestamptz, ends_at timestamptz, max_uses integer);
    create table public.subscription_purchases (promo_id uuid references public.subscription_promos(id), status text not null);
    create table public.subscription_announcements (id uuid primary key, title text, message text, enabled boolean, starts_at timestamptz, ends_at timestamptz, updated_by uuid references public.profiles(id), promo_id uuid references public.subscription_promos(id));
  `);
  await db.exec(readFileSync('supabase/migrations/0026_native_order_push.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0027_native_notification_management.sql', 'utf8'));
  await db.exec(pause);
  await db.exec(readFileSync('scripts/qa-managed-one-shot.sql', 'utf8'));
  await query("insert into public.profiles values ($1,'shop_staff'),($2,'shop_staff')", [owner, other]);
  await query("insert into public.shops values ($1,'QA'),($2,'Other')", [shop, otherShop]);
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(pause);
  await db.exec('truncate public.native_push_delivery_log, public.native_notification_audit, public.native_notification_campaigns, public.native_push_worker_quota, public.native_push_events, public.native_push_devices, public.native_push_revocations, public.orders, public.shop_staff cascade');
  await query("insert into public.shop_staff values ($1,$2,'owner'),($3,$4,'owner')", [owner, shop, other, otherShop]);
});

describe('temporary isolated v2 QA one-shot SQL', () => {
  it('allows only the service role to invoke the helper and leaves standard claims disabled', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try { await expect(claim()).rejects.toThrow(/permission denied/i); }
      finally { await db.exec('reset role'); }
    }
    await db.exec('set role service_role');
    try {
      expect((await claim()).rows).toEqual([]);
      await expect(query('select * from public.claim_native_push_deliveries_budgeted(1)')).rejects.toThrow(/permission denied/i);
    } finally { await db.exec('reset role'); }
  });
  it('fails closed for zero, wrong, duplicate or no-longer-owner v2 devices', async () => {
    expect((await claim()).rows).toEqual([]);
    await v1(); expect((await claim()).rows).toEqual([]);
    await v2(other, otherShop); expect((await claim()).rows).toEqual([]);
    await db.exec('delete from public.native_push_devices');
    await v2(owner, shop, binding, 'A'.repeat(22), 4); expect((await claim()).rows).toEqual([]);
    await db.exec('delete from public.native_push_devices');
    await v2(); await v2(owner, shop, oldBinding, 'B'.repeat(22)); expect((await claim()).rows).toEqual([]);
    await db.exec('delete from public.native_push_devices');
    await v2(); await query("update public.shop_staff set role='staff' where user_id=$1 and shop_id=$2", [owner, shop]);
    expect((await claim()).rows).toEqual([]);
    expect((await query('select count(*)::integer as n from public.native_push_events')).rows[0].n).toBe(0);
  });
  it('refuses any pending delivery, active campaign or restored general-worker claim grant', async () => {
    await v2(); await query("select public.enqueue_native_order_push($1,'payment')", [shop]);
    expect((await claim()).rows).toEqual([]);
    await db.exec('delete from public.native_push_events');
    await db.exec("insert into public.native_notification_campaigns(id,title,message,notification_type,tap_action,audience_kind,status,scheduled_at) values(gen_random_uuid(),'Other','Other','general','home','all','scheduled',clock_timestamp())");
    expect((await claim()).rows).toEqual([]);
    await db.exec('delete from public.native_notification_campaigns');
    for (const fn of ['claim_native_push_deliveries', 'claim_native_push_deliveries_budgeted', 'claim_native_push_deliveries_unbudgeted']) {
      await db.exec(`grant execute on function public.${fn}(integer) to service_role`);
      expect((await claim()).rows).toEqual([]);
      await db.exec(pause);
    }
    expect((await query('select count(*)::integer as n from public.native_push_events')).rows[0].n).toBe(0);
  });
  it('selects only the v2 device, creates one managed event and cannot be repeated or retried after lease expiry', async () => {
    await v1(); await v2();
    const [first, second] = await Promise.all([claim(), claim()]);
    const all = [...first.rows, ...second.rows];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ event_id: event, binding_id: binding, fid: 'A'.repeat(22), kind: 'general' });
    expect((await query('select state,attempts from public.native_push_deliveries')).rows).toEqual([{ state: 'pending', attempts: 8 }]);
    expect((await query('select campaign_id,outcome,attempts from public.native_push_delivery_log')).rows).toEqual([{ campaign_id: campaign, outcome: 'pending', attempts: 8 }]);
    const payload = await query('select public.native_push_campaign_payload($1,$2) as value', [all[0].delivery_id, all[0].lease_token]);
    expect(payload.rows[0].value).toEqual({ title: 'Printly QA test', message: 'This is a test notification. No action is needed.', notification_type: 'general', tap_action: 'home', image_url: null });
    await db.exec("update public.native_push_deliveries set lease_until=clock_timestamp()-interval '1 second'");
    expect((await query('select * from public.claim_native_push_deliveries_unbudgeted(30)')).rows).toEqual([]);
    expect((await claim()).rows).toEqual([]);
    await query('select public.sweep_native_push()');
    expect((await query('select state,attempts from public.native_push_deliveries')).rows).toEqual([{ state: 'discarded', attempts: 8 }]);
  });
  it('records acceptance and a separate display receipt without requeueing', async () => {
    await v2(); const row = (await claim()).rows[0];
    const finish = await query("select public.finish_native_push_delivery_logged($1,$2,'sent') as outcome", [row.delivery_id, row.lease_token]);
    expect(finish.rows[0].outcome).toBe('sent');
    expect((await query('select public.record_native_push_display($1,$2,$3) as displayed', [owner, binding, event])).rows[0].displayed).toBe(true);
    expect((await query('select outcome,displayed_at is not null as displayed from public.native_push_delivery_log')).rows).toEqual([{ outcome: 'sent', displayed: true }]);
    expect((await claim()).rows).toEqual([]);
  });
});
