#!/usr/bin/env node
// Multi-backend tests in a brand-new local PostgreSQL cluster. It uses only a
// private Unix socket, creates synthetic fixtures, and never connects to Supabase.
// Run with PRINTLY_PG_BIN pointing to initdb, postgres and psql from PostgreSQL.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = process.cwd();
const bindir = process.env.PRINTLY_PG_BIN || (() => {
  try { return execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(); } catch { return ''; }
})();
if (!bindir) throw new Error('Set PRINTLY_PG_BIN to a PostgreSQL directory containing initdb, postgres and psql.');
const bin = (name) => path.join(bindir, name);
const tmp = await mkdtemp(path.join(os.tmpdir(), 'printly-native-concurrency-'));
const data = path.join(tmp, 'data'), socket = path.join(tmp, 'socket');
const env = { ...process.env, PSQL_PAGER: 'cat' };
const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-U', 'printly_test', '-d', 'postgres'];
let server;
async function sql(command) { return (await exec(bin('psql'), [...args, '-c', command], { env, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
async function sqlFile(contents) {
  const proc = spawn(bin('psql'), [...args, '-f', '-'], { env, stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; proc.stderr.on('data', (chunk) => { err += chunk; }); proc.stdin.end(contents);
  const code = await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('exit', resolve); });
  if (code !== 0) throw new Error(`PostgreSQL fixture failed: ${err}`);
}
function holder(statement) {
  const proc = spawn('stdbuf', ['-oL', bin('psql'), ...args, '-f', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  const locked = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Lock holder did not start: ${err}`)), 10000);
    proc.stdout.on('data', (chunk) => { out += chunk; if (out.includes('TEST_LOCK_HELD')) { clearTimeout(timeout); resolve(); } });
    proc.once('error', (error) => { clearTimeout(timeout); reject(error); });
    proc.once('exit', (code) => { if (!out.includes('TEST_LOCK_HELD')) { clearTimeout(timeout); reject(new Error(`Lock holder exited ${code}: ${err}`)); } });
  });
  proc.stderr.on('data', (chunk) => { err += chunk; });
  const done = new Promise((resolve, reject) => { proc.once('error', reject); proc.once('exit', (code) => code === 0 ? resolve(out) : reject(new Error(err))); });
  proc.stdin.end(`begin;\n${statement};\nselect 'TEST_LOCK_HELD';\nselect pg_sleep(1.5);\ncommit;\n`);
  return { locked, done, proc };
}
async function contested(first, second, expectedError) {
  const active = holder(first);
  try {
    await active.locked;
    const started = Date.now(); let output = '', failure = '';
    try { output = await sql(second); } catch (error) { failure = `${error.stderr || ''} ${error.message || ''}`; }
    const elapsed = Date.now() - started;
    await active.done;
    assert(elapsed > 600, `Expected the competing backend to wait; waited ${elapsed}ms`);
    if (expectedError) assert(failure.includes(expectedError), `Expected ${expectedError}, got ${failure || output}`);
    else assert(!failure, `Competing transaction failed: ${failure}`);
    return output;
  } catch (error) { active.proc.kill('SIGTERM'); await active.done.catch(() => {}); throw error; }
}

const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const shop = '11111111-1111-4111-8111-111111111111';
const binding = '33333333-3333-4333-8333-333333333333';
const campaign = '55555555-5555-4555-8555-555555555555';
const request = '66666666-6666-4666-8666-666666666666';
const announcement = '77777777-7777-4777-8777-777777777777';
const fid = 'A'.repeat(22);
const register = `select public.register_native_push_device_v2('${owner}','${shop}','${binding}','${fid}',5,'2.1.0')`;
const unregister = `select public.unregister_native_push_device('${owner}','${binding}')`;
const enqueue = 'select public.enqueue_due_native_notification_campaigns(5)';
const cancel = `select public.change_native_notification_campaign('${admin}','${campaign}',1,'cancel')`;
const payload = { title: 'Notice', message: 'Synthetic content', notification_type: 'general', image_url: null,
  tap_action: 'home', audience_kind: 'all', shop_ids: [], device_ids: [], target_version: null };
async function reset() {
  await sql(`truncate public.native_push_delivery_log,public.native_notification_audit,public.native_notification_templates,
    public.native_notification_campaigns,public.native_app_releases,public.native_push_worker_quota,public.native_push_events,
    public.native_push_devices,public.native_push_revocations,public.subscription_announcements,public.subscription_promos,
    public.subscription_purchases,public.platform_settings,public.orders,public.shop_staff cascade;
    insert into public.shop_staff(user_id,shop_id,role) values('${owner}','${shop}','owner')`);
}
async function scheduled() {
  await sql(`${register};
    select public.save_native_notification_campaign('${admin}','${campaign}',null,'${JSON.stringify(payload)}'::jsonb);
    select public.queue_native_notification_campaign('${admin}','${campaign}',0,'${request}',null)`);
}
const release = { version_code: 6, version_name: '2.2.0', minimum_version_code: 4,
  apk_url: 'https://github.com/dawar-tariq/Printly-/releases/download/v2.2.0/owner.apk',
  apk_sha256: 'a'.repeat(64), certificate_sha256: 'b'.repeat(64), notes: '', mandatory: false, released_at: '2020-01-01T00:00:00Z' };
const unpublish = `select public.change_native_app_release('${admin}','${campaign}',2,'88888888-8888-4888-8888-888888888888','unpublish',false)`;
async function scheduledRelease() {
  await sql(`${register};
    select public.save_native_app_release('${admin}','${campaign}',null,'${JSON.stringify(release)}'::jsonb);
    select public.change_native_app_release('${admin}','${campaign}',0,'${request}','publish',false);
    select public.change_native_app_release('${admin}','${campaign}',1,'${announcement}','activate',true)`);
}

try {
  await mkdir(socket);
  await exec(bin('initdb'), ['-D', data, '--no-locale', '--encoding=UTF8', '-A', 'trust', '-U', 'printly_test'], { env });
  server = spawn(bin('postgres'), ['-D', data, '-c', 'listen_addresses=', '-c', `unix_socket_directories=${socket}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => {
    let logs = ''; const timeout = setTimeout(() => reject(new Error(`PostgreSQL startup timed out: ${logs}`)), 15000);
    server.stderr.on('data', (chunk) => { logs += chunk; if (logs.includes('database system is ready to accept connections')) { clearTimeout(timeout); resolve(); } });
    server.once('error', (error) => { clearTimeout(timeout); reject(error); });
    server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`PostgreSQL exited ${code}: ${logs}`)); });
  });
  const fixture = (await readFile(path.join(root, 'src/lib/native-notification-management-db.test.ts'), 'utf8'))
    .match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert(fixture, 'Could not find the synthetic notification fixture');
  await sqlFile(fixture[1]);
  for (const name of ['0026_native_order_push.sql', '0027_native_notification_management.sql']) {
    await sqlFile(await readFile(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  await sql(`insert into public.profiles values('${admin}','admin'),('${owner}','shop_staff');
    insert into public.shops values('${shop}','Synthetic test shop')`);

  // Inspect actual PostgreSQL ACLs as well as the PGlite grant regression.
  // Internal helpers must not become a way to bypass the quota or roles.
  const functionGrants = JSON.parse(await sql(`select json_build_object(
      'total',count(*),
      'client_access',count(*) filter(where has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')),
      'unsafe_definer',count(*) filter(where not p.prosecdef or not coalesce('search_path=public, pg_temp'=any(p.proconfig),false)),
      'service_access',count(*) filter(where has_function_privilege('service_role',p.oid,'EXECUTE')),
      'service_internal',count(*) filter(where p.proname=any(array[
        'register_native_push_device_base','claim_native_push_deliveries_unbudgeted','enqueue_native_order_push',
        'native_push_order_event','native_push_membership_removed','log_native_push_delivery_created','log_native_push_delivery_terminal',
        'require_native_notification_admin','discard_native_campaign_pending','native_notification_source_available',
        'native_push_subscription_announcement','native_push_maintenance_change']) and has_function_privilege('service_role',p.oid,'EXECUTE')))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and (p.proname ~ '(^native_(push|notification|app)|_native_(push|notification|app|campaign))' or p.proname='enqueue_native_order_push')`));
  assert.deepEqual(functionGrants, { total: 35, client_access: 0, unsafe_definer: 0, service_access: 23, service_internal: 0 });
  const tableGrants = JSON.parse(await sql(`select json_build_object(
      'total',count(*),
      'client_access',count(*) filter(where has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
      'service_write',count(*) filter(where has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
      'service_read_mismatch',count(*) filter(where has_table_privilege('service_role',c.oid,'SELECT') <>
        (c.relname=any(array['native_notification_campaigns','native_notification_templates','native_notification_audit',
          'native_push_delivery_log','native_app_releases','native_notification_admin_devices','native_notification_campaign_summary']))),
      'missing_rls',count(*) filter(where c.relkind='r' and not c.relrowsecurity))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[
      'native_notification_campaigns','native_notification_templates','native_notification_audit','native_push_delivery_log',
      'native_app_releases','native_notification_admin_devices','native_notification_campaign_summary','native_push_devices',
      'native_push_revocations','native_push_events','native_push_deliveries','native_push_worker_quota'])`));
  assert.deepEqual(tableGrants, { total: 12, client_access: 0, service_write: 0, service_read_mismatch: 0, missing_rls: 0 });
  console.log('✓ Client and service ACLs protect notification functions, private helpers and tables');

  // Many v2 devices may share a shop. The event expiry must be evaluated
  // once, not as a volatile per-device term in SELECT DISTINCT.
  await reset();
  await sql(`${register};
    insert into public.profiles(id,role)
      select md5('synthetic-member-'||n::text)::uuid,'shop_staff' from generate_series(1,40) n;
    insert into public.shop_staff(user_id,shop_id,role)
      select md5('synthetic-member-'||n::text)::uuid,'${shop}','staff' from generate_series(1,40) n;
    insert into public.native_push_devices(binding_id,user_id,shop_id,fid,app_version_code,app_version_name,push_protocol)
      select gen_random_uuid(),s.user_id,s.shop_id,left(md5(s.user_id::text||':'||i::text),22),5,'2.1.0',2
      from public.shop_staff s cross join generate_series(1,10) i where s.user_id<>'${owner}';
    select public.save_native_notification_campaign('${admin}','${campaign}',null,'${JSON.stringify(payload)}'::jsonb);
    select public.queue_native_notification_campaign('${admin}','${campaign}',0,'${request}',null)`);
  assert.equal(await sql(enqueue), '1');
  assert.equal(await sql(`select count(*) from public.native_push_events where campaign_id='${campaign}'`), '1');
  assert.equal(await sql('select count(*) from public.native_push_deliveries'), '401');
  assert.equal(await sql(`select count(*) from public.native_push_delivery_log where campaign_id='${campaign}' and outcome='pending'`), '401');
  console.log('✓ A 401-device shop receives one event and exactly one delivery per device');

  await reset(); await scheduled();
  assert.equal(await contested(enqueue, enqueue), '0');
  assert.equal(await sql(`select count(*) from public.native_push_events where campaign_id='${campaign}'`), '1');
  assert.equal(await sql('select count(*) from public.native_push_deliveries'), '1');
  console.log('✓ Competing schedulers create only one event and delivery');

  await reset(); await scheduled();
  await contested(enqueue, cancel);
  assert.equal(await sql(`select status from public.native_notification_campaigns where id='${campaign}'`), 'cancelled');
  assert.equal(await sql('select outcome from public.native_push_delivery_log'), 'drop');
  console.log('✓ Cancellation waiting behind dispatch drops the remaining delivery');

  await reset(); await scheduled();
  assert.equal(await contested(unregister, enqueue), '1');
  assert.equal(await sql('select count(*) from public.native_push_deliveries'), '0');
  assert.equal(await sql(`select status from public.native_notification_campaigns where id='${campaign}'`), 'completed');
  console.log('✓ Opt-out commits before a waiting dispatch and excludes that device');

  await reset(); await scheduled();
  await contested(enqueue, unregister);
  assert.equal(await sql('select count(*) from public.native_push_deliveries'), '0');
  assert.equal(await sql('select outcome from public.native_push_delivery_log'), 'drop');
  console.log('✓ Opt-out after a dispatch cascades pending work into the durable log');

  await reset(); await sql(`${register}; insert into public.subscription_announcements(id,title,message,enabled,updated_by)
    values('${announcement}','Announcement','Synthetic content',true,'${admin}')`);
  await contested(enqueue, `update public.subscription_announcements set enabled=false where id='${announcement}'`);
  assert.equal(await sql('select status from public.native_notification_campaigns'), 'cancelled');
  assert.equal(await sql('select outcome from public.native_push_delivery_log'), 'drop');
  console.log('✓ Disabling an announcement racing dispatch cancels remaining work');

  await reset(); await scheduledRelease();
  await contested(enqueue, unpublish);
  assert.equal(await sql('select status from public.native_notification_campaigns'), 'cancelled');
  assert.equal(await sql('select outcome from public.native_push_delivery_log'), 'drop');
  console.log('✓ Unpublishing after dispatch cancels the remaining update notice');

  await reset(); await scheduledRelease();
  assert.equal(await contested(unpublish, enqueue), '0');
  assert.equal(await sql('select count(*) from public.native_push_deliveries'), '0');
  console.log('✓ Unpublishing before dispatch prevents the obsolete update notice');

  // The first call has changed the release and audit inside an uncommitted
  // transaction when the second starts. Replays must see the committed result
  // after waiting, rather than reapply the action or report a stale revision.
  const saveRelease = `select public.save_native_app_release('${admin}','${campaign}',null,'${JSON.stringify(release)}'::jsonb)`;
  const publish = `select public.change_native_app_release('${admin}','${campaign}',0,'${request}','publish',false)`;
  const activate = `select public.change_native_app_release('${admin}','${campaign}',1,'${announcement}','activate',true)`;
  const activateWithoutNotice = `select public.change_native_app_release('${admin}','${campaign}',1,'${announcement}','activate',false)`;
  await reset(); await sql(saveRelease);
  const publishedReplay = JSON.parse(await contested(publish, publish));
  assert.deepEqual(publishedReplay, { ok: true, replayed: true, campaign_id: null });
  assert.equal(await sql(`select revision::text || ':' || published::text from public.native_app_releases where id='${campaign}'`), '1:true');
  assert.equal(await sql(`select count(*) from public.native_notification_audit where action='release_publish' and request_id='${request}'`), '1');
  console.log('✓ Concurrent identical publication acknowledges the original action once');

  await reset(); await sql(`${register}; ${saveRelease}; ${publish}`);
  const activationReplay = JSON.parse(await contested(activate, activate));
  assert.equal(activationReplay.ok, true);
  assert.equal(activationReplay.replayed, true);
  assert.equal(await sql(`select count(*) from public.native_notification_campaigns where source_kind='app_release' and source_id='${campaign}'`), '1');
  assert.equal(await sql(`select id from public.native_notification_campaigns where source_kind='app_release'`), activationReplay.campaign_id);
  assert.equal(await sql(`select revision::text || ':' || is_current::text from public.native_app_releases where id='${campaign}'`), '2:true');
  assert.equal(await sql(`select count(*) from public.native_notification_audit where action='release_activate' and request_id='${announcement}'`), '1');
  console.log('✓ Concurrent identical activation returns its one original update campaign');

  await reset(); await sql(`${register}; ${saveRelease}; ${publish}`);
  await contested(activate, activateWithoutNotice, 'NOTIFICATION_REQUEST_CONFLICT');
  assert.equal(await sql(`select count(*) from public.native_notification_campaigns where source_kind='app_release'`), '1');
  assert.equal(await sql(`select count(*) from public.native_notification_audit where request_id='${announcement}'`), '1');
  console.log('✓ Concurrent activation rejects reuse with a different notification choice');

  await reset(); await scheduledRelease();
  assert.deepEqual(JSON.parse(await contested(unpublish, unpublish)), { ok: true, replayed: true, campaign_id: null });
  assert.equal(await sql(`select revision::text || ':' || published::text || ':' || is_current::text from public.native_app_releases where id='${campaign}'`), '3:false:false');
  assert.equal(await sql(`select status from public.native_notification_campaigns where source_kind='app_release'`), 'cancelled');
  assert.equal(await sql(`select count(*) from public.native_notification_audit where action='release_unpublish'`), '1');
  console.log('✓ Concurrent identical unpublication cancels once and acknowledges the original action');

  // Queue and release actions use one idempotency-key namespace. Neither
  // ordering may partially apply a conflicting action, even concurrently.
  const saveCampaign = `select public.save_native_notification_campaign('${admin}','${campaign}',null,'${JSON.stringify(payload)}'::jsonb)`;
  const queue = `select public.queue_native_notification_campaign('${admin}','${campaign}',0,'${request}',null)`;
  await reset(); await sql(`${saveCampaign}; ${saveRelease}`);
  await contested(queue, publish, 'NOTIFICATION_REQUEST_CONFLICT');
  assert.equal(await sql(`select published from public.native_app_releases where id='${campaign}'`), 'f');
  assert.equal(await sql(`select status from public.native_notification_campaigns where id='${campaign}'`), 'scheduled');
  assert.equal(await sql(`select count(*) from public.native_notification_audit where request_id='${request}'`), '1');
  console.log('✓ A release rejects an in-flight campaign request ID without publishing');

  await reset(); await sql(`${saveCampaign}; ${saveRelease}`);
  await contested(publish, queue, 'NOTIFICATION_REQUEST_CONFLICT');
  assert.equal(await sql(`select published from public.native_app_releases where id='${campaign}'`), 't');
  assert.equal(await sql(`select status from public.native_notification_campaigns where id='${campaign}'`), 'draft');
  assert.equal(await sql(`select count(*) from public.native_notification_audit where request_id='${request}'`), '1');
  console.log('✓ A campaign rejects an in-flight release request ID without queueing');

  await reset(); await scheduled(); await sql(enqueue);
  await sql('select count(*) from public.claim_native_push_deliveries(1)');
  const delivery = await sql('select id from public.native_push_deliveries');
  const lease = await sql('select lease_token from public.native_push_deliveries');
  const finishGone = `select public.finish_native_push_delivery_logged('${delivery}','${lease}','gone')`;
  assert.equal(await contested(register, finishGone), 'retry');
  assert.equal(await sql('select count(*) from public.native_push_devices'), '1');
  assert.equal(await sql('select outcome from public.native_push_delivery_log'), 'retry');
  console.log('✓ A stale UNREGISTERED response cannot remove a freshly registered device');

  await reset(); await sql(`${register};
    insert into public.native_push_events(shop_id,kind) select '${shop}','order' from generate_series(1,2);
    insert into public.native_push_deliveries(event_id,binding_id) select id,'${binding}' from public.native_push_events;
    insert into public.native_push_worker_quota(singleton,window_start,claimed) values(true,clock_timestamp(),119)`);
  assert.equal(await contested('select count(*) from public.claim_native_push_deliveries_budgeted(30)',
    'select count(*) from public.claim_native_push_deliveries(30)'), '0');
  assert.equal(await sql('select claimed from public.native_push_worker_quota'), '120');
  assert.equal(await sql('select count(*) from public.native_push_deliveries where lease_token is not null'), '1');
  console.log('✓ Legacy and new claim RPCs serialize against the same outbound budget');

  console.log('Real PostgreSQL native notification concurrency checks passed.');
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve)); server.kill('SIGTERM');
    const timeout = setTimeout(() => server.kill('SIGKILL'), 10000); await exited; clearTimeout(timeout);
  }
  await rm(tmp, { recursive: true, force: true });
}
