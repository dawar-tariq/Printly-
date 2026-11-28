import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseNativeUpdateRelease } from './native-app-update-server';

const db = new PGlite();
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const shop = '11111111-1111-4111-8111-111111111111';
const otherShop = '22222222-2222-4222-8222-222222222222';
const binding = '33333333-3333-4333-8333-333333333333';
const secondBinding = '44444444-4444-4444-8444-444444444444';
const campaign = '55555555-5555-4555-8555-555555555555';
const requestId = '66666666-6666-4666-8666-666666666666';
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);
const input = (extra: Record<string, unknown> = {}) => ({ title: 'Notice', message: 'A synthetic message', notification_type: 'important',
  image_url: null, tap_action: 'announcement', audience_kind: 'shops', shop_ids: [shop], device_ids: [], target_version: null, ...extra });
const save = (who = admin, data = input()) => query('select public.save_native_notification_campaign($1,$2,null,$3::jsonb) as result', [who, campaign, JSON.stringify(data)]);
const queue = (who = admin) => query('select public.queue_native_notification_campaign($1,$2,0,$3,null) as result', [who, campaign, requestId]);
const v2 = (user = owner, shopId = shop, id = binding, fid = 'A'.repeat(22), version = 5) =>
  query('select public.register_native_push_device_v2($1,$2,$3,$4,$5,$6)', [user, shopId, id, fid, version, '2.0.2']);

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
  await query("insert into public.profiles values ($1,'admin'),($2,'shop_staff'),($3,'shop_staff')", [admin, owner, other]);
  await query("insert into public.shops values ($1,'First'),($2,'Second')", [shop, otherShop]);
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('truncate public.native_push_delivery_log, public.native_notification_audit, public.native_notification_templates, public.native_notification_campaigns, public.native_app_releases, public.native_push_worker_quota, public.native_push_events, public.native_push_devices, public.native_push_revocations, public.subscription_announcements, public.subscription_promos, public.subscription_purchases, public.platform_settings, public.orders, public.shop_staff cascade');
  await query("insert into public.shop_staff values ($1,$2,'owner'),($3,$4,'owner')", [owner, shop, other, otherShop]);
});

describe('managed native notifications on the existing outbox', () => {
  it('denies direct client access and rechecks the database admin role', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await expect(query('select * from public.native_notification_admin_devices')).rejects.toThrow(/permission denied/i);
        await expect(save()).rejects.toThrow(/permission denied/i);
      } finally { await db.exec('reset role'); }
    }
    await expect(save(owner)).rejects.toThrow('ADMIN_REQUIRED');
    expect((await query('select * from public.native_notification_campaigns')).rows).toEqual([]);
  });
  it('keeps every notification RPC service-only or internal and denies direct client table access', async () => {
    const serviceFunctions = [
      'register_native_push_device', 'register_native_push_device_v2', 'unregister_native_push_device',
      'claim_native_push_deliveries', 'claim_native_push_deliveries_budgeted', 'finish_native_push_delivery', 'sweep_native_push',
      'save_native_notification_campaign', 'queue_native_notification_campaign', 'change_native_notification_campaign',
      'save_native_notification_template', 'enqueue_due_native_notification_campaigns', 'native_push_campaign_payload',
      'finish_native_push_delivery_logged', 'complete_native_notification_campaigns', 'record_native_push_display',
      'retry_native_notification_campaign', 'save_native_app_release', 'change_native_app_release',
      'native_app_release_request_result', 'current_native_app_release', 'admin_native_notification_overview',
      'preview_native_notification_audience',
    ];
    const internalFunctions = [
      'register_native_push_device_base', 'claim_native_push_deliveries_unbudgeted', 'enqueue_native_order_push',
      'native_push_order_event', 'native_push_membership_removed', 'log_native_push_delivery_created',
      'log_native_push_delivery_terminal', 'require_native_notification_admin', 'discard_native_campaign_pending',
      'native_notification_source_available', 'native_push_subscription_announcement', 'native_push_maintenance_change',
    ];
    const functions = (await query(`select p.proname as name, p.prosecdef as definer, p.proconfig as config,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=any($1::text[])`, [[...serviceFunctions, ...internalFunctions]])).rows;
    expect(functions).toHaveLength(serviceFunctions.length + internalFunctions.length);
    for (const fn of functions) {
      expect(fn, String(fn.name)).toMatchObject({ definer: true, anon: false, authenticated: false,
        service: serviceFunctions.includes(String(fn.name)) });
      expect(fn.config, String(fn.name)).toContain('search_path=public, pg_temp');
    }
    const readable = ['native_notification_campaigns', 'native_notification_templates', 'native_notification_audit',
      'native_push_delivery_log', 'native_app_releases', 'native_notification_admin_devices', 'native_notification_campaign_summary'];
    const privateTables = ['native_push_devices', 'native_push_revocations', 'native_push_events', 'native_push_deliveries', 'native_push_worker_quota'];
    const objects = (await query(`select c.relname as name, c.relkind as kind, c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_any,
      has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as auth_any,
      has_table_privilege('service_role',c.oid,'SELECT') as service_read,
      has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as service_write
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1::text[])`, [[...readable, ...privateTables]])).rows;
    expect(objects).toHaveLength(readable.length + privateTables.length);
    for (const object of objects) {
      expect(object, String(object.name)).toMatchObject({ anon_any: false, auth_any: false, service_write: false,
        service_read: readable.includes(String(object.name)) });
      if (object.kind === 'r') expect(object.rls, String(object.name)).toBe(true);
    }
  });
  it('retains v1 registrations and keeps FIDs out of administrative device metadata', async () => {
    await query('select public.register_native_push_device($1,$2,$3,$4)', [owner, shop, binding, 'A'.repeat(22)]);
    const old = (await query('select * from public.native_notification_admin_devices')).rows[0];
    expect(old).toMatchObject({ push_protocol: 1, app_version_code: null, shop_id: shop });
    expect(old).not.toHaveProperty('fid');
    await v2();
    const updated = (await query('select * from public.native_notification_admin_devices')).rows[0];
    expect(updated).toMatchObject({ push_protocol: 2, app_version_code: 5, app_version_name: '2.0.2' });
    expect(updated).not.toHaveProperty('fid');
    await expect(v2(owner, otherShop)).rejects.toThrow('SHOP_MEMBERSHIP_REQUIRED');
  });
  it('downgrades an old client capability and hides the internal registration and claim implementations', async () => {
    await v2();
    await query('select public.register_native_push_device($1,$2,$3,$4)', [owner, shop, binding, 'A'.repeat(22)]);
    expect((await query('select push_protocol,app_version_code,app_version_name from public.native_notification_admin_devices')).rows[0])
      .toEqual({ push_protocol: 1, app_version_code: null, app_version_name: null });
    const privileges = (await query(`select
      has_function_privilege('service_role','public.register_native_push_device_base(uuid,uuid,uuid,text)','execute') as base,
      has_function_privilege('service_role','public.claim_native_push_deliveries_unbudgeted(integer)','execute') as unbudgeted,
      has_function_privilege('service_role','public.register_native_push_device(uuid,uuid,uuid,text)','execute') as legacy,
      has_function_privilege('service_role','public.claim_native_push_deliveries(integer)','execute') as claim`)).rows[0];
    expect(privileges).toEqual({ base: false, unbudgeted: false, legacy: true, claim: true });
    await save(); await queue(); await query('select public.enqueue_due_native_notification_campaigns(5)');
    expect((await query('select * from public.native_push_deliveries')).rows).toHaveLength(0);
  });
  it('uses the same consent and targeting rules in previews and dispatch', async () => {
    const third = '77777777-7777-4777-8777-777777777777';
    await v2(); await v2(other, otherShop, secondBinding, 'B'.repeat(22), 4); await v2(owner, shop, third, 'C'.repeat(22), 3);
    await query("update public.native_push_devices set updated_at=clock_timestamp()-interval '31 days' where shop_id=$1", [shop]);
    const targets = [
      { value: input({ audience_kind: 'all', shop_ids: [] }), devices: 3, shops: 2 },
      { value: input({ audience_kind: 'devices', shop_ids: [], device_ids: [secondBinding] }), devices: 1, shops: 1 },
      { value: input({ audience_kind: 'version', shop_ids: [], target_version: 5 }), devices: 1, shops: 1 },
      { value: input({ audience_kind: 'inactive', shop_ids: [] }), devices: 2, shops: 1 },
    ];
    for (const target of targets) {
      const preview = (await query('select public.preview_native_notification_audience($1,$2::jsonb) as result', [admin, JSON.stringify(target.value)])).rows[0].result;
      expect(preview).toEqual({ eligible_devices: target.devices, eligible_shops: target.shops });
      const id = randomUUID(); const request = randomUUID();
      await query('select public.save_native_notification_campaign($1,$2,null,$3::jsonb)', [admin, id, JSON.stringify(target.value)]);
      await query('select public.queue_native_notification_campaign($1,$2,0,$3,null)', [admin, id, request]);
      await query('select public.enqueue_due_native_notification_campaigns(5)');
      expect((await query('select recipient_count from public.native_notification_campaign_summary where id=$1', [id])).rows[0].recipient_count).toBe(target.devices);
    }
    const updatePreview = (await query('select public.preview_native_notification_audience($1,$2::jsonb) as result', [admin,
      JSON.stringify({ audience_kind: 'update_eligible', shop_ids: [], device_ids: [], target_version: 5 })])).rows[0].result;
    expect(updatePreview).toEqual({ eligible_devices: 2, eligible_shops: 2 });
    await expect(query('select public.preview_native_notification_audience($1,$2::jsonb)', [owner, JSON.stringify(input())])).rejects.toThrow('ADMIN_REQUIRED');
  });
  it('creates one event per shop and one delivery per eligible device for a multi-device audience', async () => {
    // Seed a realistic ten devices per member. A per-row volatile expiry in a
    // SELECT DISTINCT can otherwise create multiple events for the same shop.
    const members = Array.from({ length: 40 }, () => randomUUID());
    try {
      await query("insert into public.profiles(id,role) select id,'shop_staff' from unnest($1::uuid[]) as id", [members]);
      await query("insert into public.shop_staff(user_id,shop_id,role) select id,$2,'staff' from unnest($1::uuid[]) as id", [members, shop]);
      await query(`insert into public.native_push_devices(binding_id,user_id,shop_id,fid,app_version_code,app_version_name,push_protocol)
        select gen_random_uuid(), id, $2, left(md5(id::text || ':' || n::text),22), 5, '2.1.0', 2
        from unnest($1::uuid[]) as id cross join generate_series(1,10) as n`, [members, shop]);
      await v2(other, otherShop, secondBinding, 'B'.repeat(22));
      await query('select public.register_native_push_device($1,$2,$3,$4)', [owner, shop, binding, 'A'.repeat(22)]); // v1 excluded
      await save(admin, input({ audience_kind: 'all', shop_ids: [] }));
      await queue();
      expect((await query('select public.enqueue_due_native_notification_campaigns(5) as count')).rows[0].count).toBe(1);
      const events = (await query(`select e.shop_id, count(d.id)::integer as deliveries
        from public.native_push_events e join public.native_push_deliveries d on d.event_id=e.id
        where e.campaign_id=$1 group by e.id,e.shop_id order by e.shop_id`, [campaign])).rows;
      expect(events).toEqual([{ shop_id: shop, deliveries: 400 }, { shop_id: otherShop, deliveries: 1 }]);
      expect((await query('select count(distinct expires_at)::integer as expiries from public.native_push_events where campaign_id=$1', [campaign])).rows[0].expiries).toBe(1);
      expect((await query('select count(*)::integer as count from public.native_push_delivery_log where campaign_id=$1 and outcome=\'pending\'', [campaign])).rows[0].count).toBe(401);

      // An earlier source end must still cap every shop event, even though
      // the common expiration is now calculated only once per campaign.
      const limited = randomUUID();
      await query('select public.save_native_notification_campaign($1,$2,null,$3::jsonb)', [admin, limited, JSON.stringify(input({ audience_kind: 'all', shop_ids: [] }))]);
      await query('select public.queue_native_notification_campaign($1,$2,0,$3,null)', [admin, limited, randomUUID()]);
      await query("update public.native_notification_campaigns set source_ends_at=clock_timestamp()+interval '5 minutes' where id=$1", [limited]);
      expect((await query('select public.enqueue_due_native_notification_campaigns(5) as count')).rows[0].count).toBe(1);
      const capped = (await query(`select count(*)::integer as events, bool_and(e.expires_at=c.source_ends_at) as capped
        from public.native_push_events e join public.native_notification_campaigns c on c.id=e.campaign_id where c.id=$1`, [limited])).rows[0];
      expect(capped).toEqual({ events: 2, capped: true });
    } finally {
      await query('delete from public.shop_staff where user_id=any($1::uuid[])', [members]);
      await query('delete from public.profiles where id=any($1::uuid[])', [members]);
    }
  });
  it('shares the claim budget between legacy and new worker RPCs', async () => {
    await v2();
    await query("insert into public.native_push_events(shop_id,kind) select $1,'order' from generate_series(1,121)", [shop]);
    await query('insert into public.native_push_deliveries(event_id,binding_id) select id,$1 from public.native_push_events', [binding]);
    await db.exec('set role service_role');
    try {
      for (let index = 0; index < 4; index++) {
        const rpc = index % 2 ? 'claim_native_push_deliveries' : 'claim_native_push_deliveries_budgeted';
        expect((await query(`select * from public.${rpc}(30)`)).rows).toHaveLength(30);
      }
      expect((await query('select * from public.claim_native_push_deliveries(30)')).rows).toHaveLength(0);
      await expect(query('select * from public.claim_native_push_deliveries_unbudgeted(1)')).rejects.toThrow(/permission denied/i);
    } finally { await db.exec('reset role'); }
    await query("update public.native_push_worker_quota set window_start=clock_timestamp()-interval '61 seconds'");
    expect((await query('select * from public.claim_native_push_deliveries(30)')).rows).toHaveLength(1);
    expect((await query('select claimed from public.native_push_worker_quota')).rows[0].claimed).toBe(1);
  });
  it('schedules idempotently, targets only the selected shop and logs acceptance separately from display', async () => {
    await v2(); await v2(other, otherShop, secondBinding, 'B'.repeat(22));
    await save(); await queue(); await queue();
    expect((await query('select public.enqueue_due_native_notification_campaigns(5) as n')).rows[0].n).toBe(1);
    expect((await query('select public.enqueue_due_native_notification_campaigns(5) as n')).rows[0].n).toBe(0);
    const claim = (await query('select * from public.claim_native_push_deliveries(30)')).rows;
    expect(claim).toHaveLength(1); expect(claim[0]).toMatchObject({ binding_id: binding, kind: 'important' });
    const payload = (await query('select public.native_push_campaign_payload($1,$2) as payload', [claim[0].delivery_id, claim[0].lease_token])).rows[0].payload;
    expect(payload).toMatchObject({ title: 'Notice', message: 'A synthetic message', tap_action: 'announcement' });
    expect((await query('select public.record_native_push_display($1,$2,$3) as ok', [other, binding, claim[0].event_id])).rows[0].ok).toBe(false);
    expect((await query('select public.record_native_push_display($1,$2,$3) as ok', [owner, binding, claim[0].event_id])).rows[0].ok).toBe(true);
    expect((await query("select public.finish_native_push_delivery_logged($1,$2,'sent') as outcome", [claim[0].delivery_id, claim[0].lease_token])).rows[0].outcome).toBe('sent');
    const log = (await query('select outcome,attempts,displayed_at from public.native_push_delivery_log')).rows[0];
    expect(log).toMatchObject({ outcome: 'sent', attempts: 1 }); expect(log.displayed_at).not.toBeNull();
    await query('select public.complete_native_notification_campaigns()');
    expect((await query('select status from public.native_notification_campaigns')).rows[0].status).toBe('completed');
  });
  it('automatically schedules one announcement, updates it without duplicates, and cancels it when disabled', async () => {
    await v2();
    await query("insert into public.subscription_announcements values ($1,'Announcement','Hello',true,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours',$2)", [requestId, admin]);
    await query("update public.subscription_announcements set message='Edited' where id=$1", [requestId]);
    const campaigns = (await query("select status,message,source_kind from public.native_notification_campaigns")).rows;
    expect(campaigns).toEqual([{ status: 'scheduled', message: 'Edited', source_kind: 'subscription_announcement' }]);
    await query('update public.subscription_announcements set enabled=false where id=$1', [requestId]);
    expect((await query('select status from public.native_notification_campaigns')).rows[0].status).toBe('cancelled');
    expect((await query('select public.enqueue_due_native_notification_campaigns(5) as n')).rows[0].n).toBe(0);
  });
  it('queues maintenance only on an actual transition and cancels it when restored', async () => {
    await query("insert into public.platform_settings(key,value,updated_by) values ('maintenance','false',$1)", [admin]);
    await query("update public.platform_settings set value='true' where key='maintenance'");
    await query("update public.platform_settings set value='true' where key='maintenance'");
    expect((await query("select * from public.native_notification_campaigns where source_kind='maintenance'")).rows).toHaveLength(1);
    expect((await query("select actor from public.native_notification_audit where action='maintenance_notification_queued'")).rows[0].actor).toBe(admin);
    await query("update public.platform_settings set value='false' where key='maintenance'");
    expect((await query('select status from public.native_notification_campaigns')).rows[0].status).toBe('cancelled');
  });
  it('binds a queue request to its actor, revision and schedule even after its due time', async () => {
    await save();
    const scheduled = new Date(Date.now() + 1500).toISOString();
    const queueAt = (time: string, revision = 0) => query('select public.queue_native_notification_campaign($1,$2,$3,$4,$5) as result', [admin, campaign, revision, requestId, time]);
    await queueAt(scheduled);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect((await queueAt(scheduled)).rows[0].result).toMatchObject({ status: 'scheduled', replayed: true });
    await expect(queueAt(scheduled, 1)).rejects.toThrow('NOTIFICATION_REQUEST_CONFLICT');
    await expect(queueAt('2000-01-01T00:00:00Z')).rejects.toThrow('NOTIFICATION_REQUEST_CONFLICT');
    await query("select public.change_native_notification_campaign($1,$2,1,'cancel')", [admin, campaign]);
    expect((await queueAt(scheduled)).rows[0].result).toMatchObject({ status: 'cancelled', replayed: true });
    await expect(query('select public.queue_native_notification_campaign($1,$2,0,$3,$4)', [admin, campaign, randomUUID(), '2000-01-01T00:00:00Z'])).rejects.toThrow('INVALID_SCHEDULE');
  });
  it('records terminal acceptance from a legacy worker during an ordered rollout', async () => {
    await v2(); await save(); await queue(); await query('select public.enqueue_due_native_notification_campaigns(5)');
    const lease = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    expect((await query("select public.finish_native_push_delivery($1,$2,'sent') as result", [lease.delivery_id, lease.lease_token])).rows[0].result).toBe('sent');
    expect((await query('select outcome,attempts from public.native_push_delivery_log')).rows[0]).toEqual({ outcome: 'sent', attempts: 1 });
  });
  it('cancels a sending campaign and invalidates an existing lease before its next payload read', async () => {
    await v2(); await save(); await queue(); await query('select public.enqueue_due_native_notification_campaigns(5)');
    const lease = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    expect((await query('select public.native_push_campaign_payload($1,$2) as payload', [lease.delivery_id, lease.lease_token])).rows[0].payload).not.toBeNull();
    await query("select public.change_native_notification_campaign($1,$2,1,'cancel')", [admin, campaign]);
    expect((await query('select public.native_push_campaign_payload($1,$2) as payload', [lease.delivery_id, lease.lease_token])).rows[0].payload).toBeNull();
    expect((await query("select public.finish_native_push_delivery_logged($1,$2,'sent') as result", [lease.delivery_id, lease.lease_token])).rows[0].result).toBe('unconfirmed');
    expect((await query('select status from public.native_notification_campaigns')).rows[0].status).toBe('cancelled');
    expect((await query('select outcome,attempts from public.native_push_delivery_log')).rows[0]).toEqual({ outcome: 'drop', attempts: 1 });
  });
  it('does not send a linked announcement while its promo is inactive or fully reserved', async () => {
    await v2();
    await query('insert into public.subscription_promos values ($1,false,null,null,1)', [secondBinding]);
    await query("insert into public.subscription_announcements(id,title,message,enabled,updated_by,promo_id) values($1,'Linked notice','Details',true,$2,$3)", [requestId, admin, secondBinding]);
    expect((await query('select public.enqueue_due_native_notification_campaigns(5) as n')).rows[0].n).toBe(0);
    await query('update public.subscription_promos set enabled=true where id=$1', [secondBinding]);
    await query("insert into public.subscription_purchases values ($1,'submitted')", [secondBinding]);
    expect((await query('select public.enqueue_due_native_notification_campaigns(5) as n')).rows[0].n).toBe(0);
    await query('delete from public.subscription_purchases');
    expect((await query('select public.enqueue_due_native_notification_campaigns(5) as n')).rows[0].n).toBe(1);
    const lease = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    await query('update public.subscription_promos set enabled=false where id=$1', [secondBinding]);
    expect((await query('select public.native_push_campaign_payload($1,$2) as payload', [lease.delivery_id, lease.lease_token])).rows[0].payload).toBeNull();
    await query("select public.finish_native_push_delivery_logged($1,$2,'drop')", [lease.delivery_id, lease.lease_token]);
    await query('select public.complete_native_notification_campaigns()');
    const id = (await query('select id from public.native_notification_campaigns')).rows[0].id;
    await expect(query('select public.retry_native_notification_campaign($1,$2,$3)', [admin, id, randomUUID()])).rejects.toThrow('NOTIFICATION_SOURCE_INACTIVE');
  });
  it('stops unsent announcement and maintenance work when the source is turned off', async () => {
    await v2();
    await query("insert into public.subscription_announcements(id,title,message,enabled,updated_by) values($1,'Announcement','Hello',true,$2)", [requestId, admin]);
    await query('select public.enqueue_due_native_notification_campaigns(5)');
    const ann = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    await query('update public.subscription_announcements set enabled=false where id=$1', [requestId]);
    expect((await query('select status from public.native_notification_campaigns')).rows[0].status).toBe('cancelled');
    expect((await query('select public.native_push_campaign_payload($1,$2) as payload', [ann.delivery_id, ann.lease_token])).rows[0].payload).toBeNull();
    expect((await query('select outcome from public.native_push_delivery_log where delivery_id=$1', [ann.delivery_id])).rows[0].outcome).toBe('drop');
    await query("insert into public.platform_settings(key,value,updated_by) values ('maintenance','true',$1)", [admin]);
    await query('select public.enqueue_due_native_notification_campaigns(5)');
    const maintenance = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    await query("update public.platform_settings set value='false' where key='maintenance'");
    expect((await query('select public.native_push_campaign_payload($1,$2) as payload', [maintenance.delivery_id, maintenance.lease_token])).rows[0].payload).toBeNull();
    expect((await query("select status from public.native_notification_campaigns where source_kind='maintenance'")).rows[0].status).toBe('cancelled');
    expect((await query("select action,actor from public.native_notification_audit where action like '%notification_cancelled' order by action")).rows)
      .toEqual([{ action: 'announcement_notification_cancelled', actor: admin }, { action: 'maintenance_notification_cancelled', actor: admin }]);
  });
  it('does not block source writes if automatic notification queueing fails or is rate limited', async () => {
    // The source accepts this title, but it becomes whitespace when control characters are removed.
    await query('insert into public.subscription_announcements(id,title,message,enabled,updated_by) values($1,$2,$3,true,$4)', [requestId, '\n', 'Hello', admin]);
    expect((await query('select id from public.subscription_announcements')).rows).toHaveLength(1);
    expect((await query('select id from public.native_notification_campaigns')).rows).toHaveLength(0);
    await query("insert into public.native_notification_audit(actor,action,subject_id) select $1,'campaign_queued',gen_random_uuid() from generate_series(1,10)", [admin]);
    await query("insert into public.platform_settings(key,value,updated_by) values ('maintenance','true',$1)", [admin]);
    expect((await query("select value from public.platform_settings where key='maintenance'")).rows[0].value).toBe(true);
    expect((await query("select action,actor from public.native_notification_audit where action='maintenance_notification_rate_limited'")).rows)
      .toEqual([{ action: 'maintenance_notification_rate_limited', actor: admin }]);
    await save(); await expect(queue()).rejects.toThrow('NOTIFICATION_RATE_LIMIT');
  });
  it('logs opt-out and membership cascades and finishes empty campaigns', async () => {
    await v2(); await v2(other, otherShop, secondBinding, 'B'.repeat(22));
    await save(admin, input({ audience_kind: 'all', shop_ids: [] })); await queue(); await query('select public.enqueue_due_native_notification_campaigns(5)');
    await query('select public.unregister_native_push_device($1,$2)', [owner, binding]);
    await query('delete from public.shop_staff where user_id=$1 and shop_id=$2', [other, otherShop]);
    expect((await query('select * from public.native_push_deliveries')).rows).toHaveLength(0);
    expect((await query('select outcome from public.native_push_delivery_log order by binding_id')).rows).toEqual([{ outcome: 'drop' }, { outcome: 'drop' }]);
    await query('select public.complete_native_notification_campaigns()');
    expect((await query('select status from public.native_notification_campaigns')).rows[0].status).toBe('completed');
  });
  it('does not block order writes or device opt-out if logging fails', async () => {
    await v2();
    await db.exec('alter table public.native_push_delivery_log add constraint synthetic_log_failure check (false) not valid');
    try {
      await query("insert into public.orders(id,shop_id,status,payment_method,payment_status) values($1,$2,'queued','cod','pending')", [randomUUID(), shop]);
      expect((await query('select id from public.orders')).rows).toHaveLength(1);
      expect((await query('select id from public.native_push_events')).rows).toHaveLength(0);
    } finally { await db.exec('alter table public.native_push_delivery_log drop constraint synthetic_log_failure'); }
    await save(); await queue(); await query('select public.enqueue_due_native_notification_campaigns(5)');
    await db.exec("alter table public.native_push_delivery_log add constraint synthetic_log_failure check (outcome<>'drop') not valid");
    try {
      await query('select public.unregister_native_push_device($1,$2)', [owner, binding]);
      expect((await query('select binding_id from public.native_push_devices')).rows).toHaveLength(0);
      expect((await query('select id from public.native_push_deliveries')).rows).toHaveLength(0);
      // A stale log is preferable to retaining a revoked device; operators must investigate it.
      expect((await query('select outcome from public.native_push_delivery_log')).rows[0].outcome).toBe('pending');
    } finally { await db.exec('alter table public.native_push_delivery_log drop constraint synthetic_log_failure'); }
  });
  it('records UNREGISTERED separately and does not delete a freshly re-registered device', async () => {
    await v2(); await save(); await queue(); await query('select public.enqueue_due_native_notification_campaigns(5)');
    const first = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    await v2();
    expect((await query("select public.finish_native_push_delivery_logged($1,$2,'gone') as result", [first.delivery_id, first.lease_token])).rows[0].result).toBe('retry');
    expect((await query('select outcome,attempts from public.native_push_delivery_log')).rows[0]).toEqual({ outcome: 'retry', attempts: 1 });
    expect((await query('select binding_id from public.native_push_devices')).rows).toHaveLength(1);
    await query('update public.native_push_deliveries set next_attempt_at=clock_timestamp()');
    const second = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    expect((await query("select public.finish_native_push_delivery_logged($1,$2,'gone') as result", [second.delivery_id, second.lease_token])).rows[0].result).toBe('gone');
    expect((await query('select outcome,attempts from public.native_push_delivery_log')).rows[0]).toEqual({ outcome: 'gone', attempts: 2 });
    expect((await query('select binding_id from public.native_push_devices')).rows).toHaveLength(0);
  });
  it('sweeps expired deliveries only after the lease ends and audits overdue scheduled campaigns', async () => {
    await v2(); await save(); await queue(); await query('select public.enqueue_due_native_notification_campaigns(5)');
    const lease = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    await query("update public.native_push_events set expires_at=clock_timestamp()-interval '1 second'");
    await query('select public.sweep_native_push()');
    expect((await query('select state from public.native_push_deliveries')).rows[0].state).toBe('pending');
    expect((await query('select public.native_push_campaign_payload($1,$2) as payload', [lease.delivery_id, lease.lease_token])).rows[0].payload).toBeNull();
    await query("update public.native_push_deliveries set lease_until=clock_timestamp()-interval '1 second'");
    await query('select public.sweep_native_push()');
    expect((await query('select outcome from public.native_push_delivery_log')).rows[0].outcome).toBe('drop');
    await query('select public.complete_native_notification_campaigns()');
    expect((await query('select status from public.native_notification_campaigns')).rows[0].status).toBe('completed');
    const delayed = randomUUID();
    await query('select public.save_native_notification_campaign($1,$2,null,$3::jsonb)', [admin, delayed, JSON.stringify(input())]);
    await query('select public.queue_native_notification_campaign($1,$2,0,$3,null)', [admin, delayed, randomUUID()]);
    await query("update public.native_notification_campaigns set scheduled_at=clock_timestamp()-interval '2 days' where id=$1", [delayed]);
    await query('select public.enqueue_due_native_notification_campaigns(5)');
    expect((await query('select status from public.native_notification_campaigns where id=$1', [delayed])).rows[0].status).toBe('cancelled');
    expect((await query("select subject_id from public.native_notification_audit where action='campaign_expired'")).rows).toEqual([{ subject_id: delayed }]);
  });
  it('publishes immutable releases, activates one current version, queues an optional update notice and supports rollback', async () => {
    const second = '88888888-8888-4888-8888-888888888888';
    const ids = ['99999999-9999-4999-8999-999999999991','99999999-9999-4999-8999-999999999992','99999999-9999-4999-8999-999999999993','99999999-9999-4999-8999-999999999994','99999999-9999-4999-8999-999999999995'];
    const release = { version_code: 5, version_name: '2.1.0', minimum_version_code: 4, apk_url: 'https://github.com/dawar-tariq/Printly-/releases/download/v2.1.0/owner.apk',
      apk_sha256: 'a'.repeat(64), certificate_sha256: 'b'.repeat(64), notes: 'Changes', mandatory: false, released_at: '2026-01-01T05:30:00.123456789+05:30' };
    await expect(query('select public.save_native_app_release($1,$2,null,$3::jsonb)', [owner, campaign, JSON.stringify(release)])).rejects.toThrow('ADMIN_REQUIRED');
    await query('select public.save_native_app_release($1,$2,null,$3::jsonb)', [admin, campaign, JSON.stringify(release)]);
    await query("select public.change_native_app_release($1,$2,0,$3,'publish',false)", [admin, campaign, ids[0]]);
    await query("select public.change_native_app_release($1,$2,1,$3,'activate',true)", [admin, campaign, ids[1]]);
    const current = (await query('select public.current_native_app_release() as current')).rows[0].current;
    expect(current).toMatchObject({ available: true, versionCode: 5, minimumVersionCode: 4 });
    // PostgreSQL normalizes offsets and nanoseconds; its actual JSON timestamp
    // must still pass the server contract consumed by the Android policy.
    const parsed = parseNativeUpdateRelease(current);
    expect(parsed).not.toBeNull();
    expect(parsed!.releasedAt).toMatch(/\.123457(?:Z|[+-]\d{2}:\d{2})$/);
    expect((await query("select audience_kind,target_version,status from public.native_notification_campaigns")).rows).toEqual([{ audience_kind: 'update_eligible', target_version: 5, status: 'scheduled' }]);
    await query('select public.save_native_app_release($1,$2,null,$3::jsonb)', [admin, second, JSON.stringify({ ...release, version_code: 6, version_name: '2.2.0', apk_url: release.apk_url.replace('v2.1.0', 'v2.2.0') })]);
    await query("select public.change_native_app_release($1,$2,0,$3,'publish',false)", [admin, second, ids[2]]);
    await query("select public.change_native_app_release($1,$2,1,$3,'activate',false)", [admin, second, ids[3]]);
    expect((await query("select status,source_kind,source_id from public.native_notification_campaigns")).rows)
      .toEqual([{ status: 'cancelled', source_kind: 'app_release', source_id: campaign }]);
    const oldRevision = (await query('select revision from public.native_app_releases where id=$1', [campaign])).rows[0].revision;
    await query("select public.change_native_app_release($1,$2,$3,$4,'activate',false)", [admin, campaign, oldRevision, ids[4]]);
    expect((await query('select public.current_native_app_release() as current')).rows[0].current).toMatchObject({ versionCode: 5 });
    await query("select public.change_native_app_release($1,$2,3,$3,'unpublish',false)", [admin, second, '99999999-9999-4999-8999-999999999996']);
    await expect(query('select public.save_native_app_release($1,$2,4,$3::jsonb)', [admin, second, JSON.stringify(release)])).rejects.toThrow('RELEASE_CHANGED');
  });
  it('replays the exact release request without repeating a notification, and rejects changed parameters', async () => {
    const release = { version_code: 5, version_name: '2.1.0', minimum_version_code: 4, apk_url: 'https://github.com/dawar-tariq/Printly-/releases/download/v2.1.0/owner.apk',
      apk_sha256: 'a'.repeat(64), certificate_sha256: 'b'.repeat(64), notes: '', mandatory: false, released_at: '2026-01-01T00:00:00Z' };
    const publishRequest = randomUUID(), activationRequest = randomUUID();
    await query('select public.save_native_app_release($1,$2,null,$3::jsonb)', [admin, campaign, JSON.stringify(release)]);
    await query("select public.change_native_app_release($1,$2,0,$3,'publish',false)", [admin, campaign, publishRequest]);
    expect((await query("select public.change_native_app_release($1,$2,0,$3,'publish',false) as result", [admin, campaign, publishRequest])).rows[0].result).toMatchObject({ replayed: true });
    const first = (await query("select public.change_native_app_release($1,$2,1,$3,'activate',true) as result", [admin, campaign, activationRequest])).rows[0].result as Record<string, unknown>;
    expect((await query("select public.native_app_release_request_result($1,$2,1,$3,'activate',true) as result", [admin, campaign, activationRequest])).rows[0].result)
      .toEqual({ ok: true, replayed: true, campaign_id: first.campaign_id });
    expect((await query("select public.change_native_app_release($1,$2,1,$3,'activate',true) as result", [admin, campaign, activationRequest])).rows[0].result).toMatchObject({ replayed: true });
    await expect(query("select public.change_native_app_release($1,$2,1,$3,'activate',false)", [admin, campaign, activationRequest])).rejects.toThrow('NOTIFICATION_REQUEST_CONFLICT');
    await expect(query("select public.native_app_release_request_result($1,$2,2,$3,'activate',true)", [admin, campaign, activationRequest])).rejects.toThrow('NOTIFICATION_REQUEST_CONFLICT');
    await expect(query("select public.native_app_release_request_result($1,$2,1,$3,'activate',true)", [owner, campaign, activationRequest])).rejects.toThrow('ADMIN_REQUIRED');
    expect((await query('select id from public.native_notification_campaigns')).rows).toHaveLength(1);
  });
  it('cancels pending update notices and invalidates their leases on unpublish', async () => {
    await v2(owner, shop, binding, 'A'.repeat(22), 4);
    const release = { version_code: 5, version_name: '2.1.0', minimum_version_code: 4, apk_url: 'https://github.com/dawar-tariq/Printly-/releases/download/v2.1.0/owner.apk',
      apk_sha256: 'a'.repeat(64), certificate_sha256: 'b'.repeat(64), notes: '', mandatory: false, released_at: '2026-01-01T00:00:00Z' };
    await query('select public.save_native_app_release($1,$2,null,$3::jsonb)', [admin, campaign, JSON.stringify(release)]);
    await query("select public.change_native_app_release($1,$2,0,$3,'publish',false)", [admin, campaign, randomUUID()]);
    await query("select public.change_native_app_release($1,$2,1,$3,'activate',true)", [admin, campaign, randomUUID()]);
    await query('select public.enqueue_due_native_notification_campaigns(5)');
    const lease = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    expect((await query('select public.native_push_campaign_payload($1,$2) as payload', [lease.delivery_id, lease.lease_token])).rows[0].payload).not.toBeNull();
    await query("select public.change_native_app_release($1,$2,2,$3,'unpublish',false)", [admin, campaign, randomUUID()]);
    expect((await query('select status from public.native_notification_campaigns')).rows[0].status).toBe('cancelled');
    expect((await query('select public.native_push_campaign_payload($1,$2) as payload', [lease.delivery_id, lease.lease_token])).rows[0].payload).toBeNull();
    expect((await query('select outcome from public.native_push_delivery_log')).rows[0].outcome).toBe('drop');
    expect((await query("select action from public.native_notification_audit where action='release_notification_cancelled'")).rows).toHaveLength(1);
  });
  it('does not send managed messages to old clients and only retries discarded eligible deliveries', async () => {
    await query('select public.register_native_push_device($1,$2,$3,$4)', [owner, shop, binding, 'A'.repeat(22)]);
    await save(); await queue(); await query('select public.enqueue_due_native_notification_campaigns(5)');
    expect((await query('select * from public.native_push_deliveries')).rows).toHaveLength(0);
    await db.exec('truncate public.native_notification_campaigns, public.native_notification_audit, public.native_push_events cascade');
    await v2(); await save(); await queue(); await query('select public.enqueue_due_native_notification_campaigns(5)');
    const row = (await query('select * from public.claim_native_push_deliveries(1)')).rows[0];
    await query("select public.finish_native_push_delivery_logged($1,$2,'drop')", [row.delivery_id, row.lease_token]);
    await query('select public.complete_native_notification_campaigns()');
    const retryId = '77777777-7777-4777-8777-777777777777';
    expect((await query('select public.retry_native_notification_campaign($1,$2,$3) as result', [admin, campaign, retryId])).rows[0].result).toMatchObject({ retried: 1 });
    expect((await query('select public.retry_native_notification_campaign($1,$2,$3) as result', [admin, campaign, retryId])).rows[0].result).toMatchObject({ replayed: true, retried: 1 });
    await expect(query('select public.retry_native_notification_campaign($1,$2,$3)', [admin, randomUUID(), retryId])).rejects.toThrow('NOTIFICATION_REQUEST_CONFLICT');
    expect((await query("select count(*)::integer as n from public.native_push_deliveries where state='pending'")).rows[0].n).toBe(1);
  });
});
