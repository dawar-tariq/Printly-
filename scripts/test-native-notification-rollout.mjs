#!/usr/bin/env node
// Disposable, synthetic-only rehearsal. The database listens on a newly
// created Unix socket, never TCP; no Supabase project or real data is used.
// PRINTLY_PG_BIN supplies initdb/postgres/psql; PRINTLY_PG_TOOLS_BIN supplies
// pg_dump/pg_restore (the dump client must be at least as new as the server).
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const serverBin = process.env.PRINTLY_PG_BIN;
const toolsBin = process.env.PRINTLY_PG_TOOLS_BIN || serverBin;
if (!serverBin || !toolsBin) throw new Error('Set PRINTLY_PG_BIN and PRINTLY_PG_TOOLS_BIN to local PostgreSQL tools.');
const root = process.cwd();
const tmp = await mkdtemp(path.join(os.tmpdir(), 'printly-native-rollout-'));
const data = path.join(tmp, 'data'), socket = path.join(tmp, 'socket');
const backup = path.join(tmp, 'synthetic-baseline.dump');
// Inherited libpq variables must not redirect a command to another database.
const env = { ...process.env, PSQL_PAGER: 'cat' };
for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key];
const binary = (dir, name) => path.join(dir, name);
const args = (database) => ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-U', 'printly_test', '-d', database];
let server;
async function sql(database, statement) {
  return (await exec(binary(serverBin, 'psql'), [...args(database), '-c', statement], { env, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
}
async function sqlInput(database, statement) {
  const proc = spawn(binary(serverBin, 'psql'), [...args(database), '-f', '-'], { env, stdio: ['pipe', 'ignore', 'pipe'] });
  let error = ''; proc.stderr.on('data', (chunk) => { error += chunk; }); proc.stdin.end(statement);
  const code = await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('exit', resolve); });
  return { code, error };
}
async function denied(database, routine) {
  try {
    await sql(database, `set role service_role; select * from ${routine}(1)`);
    throw new Error(`${routine} unexpectedly allowed a claim`);
  } catch (error) {
    assert.match(`${error.stderr || ''}`, /permission denied for function/, `${routine} must fail on the service role before a claim`);
  }
}
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const shop = '11111111-1111-4111-8111-111111111111';
const binding = '33333333-3333-4333-8333-333333333333';
const fid = 'A'.repeat(22); // synthetic only
const snapshot = `select json_build_object(
  'admins',(select count(*) from public.profiles where role='admin'),
  'owners',(select count(*) from public.profiles where role='shop_staff'),
  'shops',(select count(*) from public.shops),
  'memberships',(select count(*) from public.shop_staff),
  'devices',(select count(*) from public.native_push_devices),
  'events',(select count(*) from public.native_push_events),
  'deliveries',(select count(*) from public.native_push_deliveries),
  'device_owned',(select count(*) from public.native_push_devices where user_id='${owner}' and shop_id='${shop}' and binding_id='${binding}'),
  'worker_claim_enabled',has_function_privilege('service_role','public.claim_native_push_deliveries(integer)','execute'))`;

try {
  await mkdir(socket);
  await exec(binary(serverBin, 'initdb'), ['-D', data, '--no-locale', '--encoding=UTF8', '-A', 'trust', '-U', 'printly_test'], { env });
  server = spawn(binary(serverBin, 'postgres'), ['-D', data, '-c', 'listen_addresses=', '-c', `unix_socket_directories=${socket}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => {
    let logs = ''; const timeout = setTimeout(() => reject(new Error(`PostgreSQL startup timed out: ${logs}`)), 15000);
    server.stderr.on('data', (chunk) => { logs += chunk; if (logs.includes('database system is ready to accept connections')) { clearTimeout(timeout); resolve(); } });
    server.once('error', (error) => { clearTimeout(timeout); reject(error); });
    server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`PostgreSQL exited ${code}: ${logs}`)); });
  });
  const fixture = (await readFile(path.join(root, 'src/lib/native-notification-management-db.test.ts'), 'utf8')).match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert(fixture, 'Missing synthetic fixture');
  const migration26 = await readFile(path.join(root, 'supabase/migrations/0026_native_order_push.sql'), 'utf8');
  const migration27 = await readFile(path.join(root, 'supabase/migrations/0027_native_notification_management.sql'), 'utf8');
  const prepare = await readFile(path.join(root, 'supabase/qa/0027_prepare_source_and_pause_claims.sql'), 'utf8');
  const apply = await readFile(path.join(root, 'supabase/qa/0027_apply_staged_source_no_worker.sql'), 'utf8');
  const cleanup = await readFile(path.join(root, 'supabase/qa/0027_cleanup_source_transport.sql'), 'utf8');
  const setup = await sqlInput('postgres', `${fixture[1]}\n${migration26}\n`);
  assert.equal(setup.code, 0, setup.error);
  await sql('postgres', `insert into public.profiles values('${admin}','admin'),('${owner}','shop_staff');
    insert into public.shops values('${shop}','Synthetic test shop');
    insert into public.shop_staff values('${owner}','${shop}','owner');
    select public.register_native_push_device('${owner}','${shop}','${binding}','${fid}');
    insert into public.platform_settings(key,value) values('maintenance','false'::jsonb);`);
  const prepared = await sqlInput('postgres', `begin;\n${prepare}\ncommit;\n`);
  assert.equal(prepared.code, 0, prepared.error);
  const baseline = JSON.parse(await sql('postgres', snapshot));
  assert.deepEqual(baseline, { admins: 1, owners: 1, shops: 1, memberships: 1, devices: 1, events: 0, deliveries: 0, device_owned: 1, worker_claim_enabled: false });
  await denied('postgres', 'public.claim_native_push_deliveries');

  await exec(binary(toolsBin, 'pg_dump'), ['-h', socket, '-U', 'printly_test', '-d', 'postgres', '-Fc', '-f', backup], { env });
  for (const name of ['native_rollback', 'native_restored']) {
    await sql('postgres', `create database ${name}`);
    await exec(binary(toolsBin, 'pg_restore'), ['-h', socket, '-U', 'printly_test', '-d', name, '--exit-on-error', backup], { env });
    assert.deepEqual(JSON.parse(await sql(name, snapshot)), baseline);
  }
  console.log('✓ A synthetic, no-claim baseline was backed up and restored to two disposable databases');
  assert(!migration27.includes('$qa_source_0027$'), 'Source delimiter must be unique');
  const source = `$qa_source_0027$${migration27}$qa_source_0027$`;
  for (const name of ['native_rollback', 'native_restored']) {
    const wrongSource = await sqlInput(name, "set role service_role; select public.stage_native_qa_0027_f4f04e902c('not the reviewed source');");
    assert.notEqual(wrongSource.code, 0, 'The source helper must reject mismatched bytes');
    const anonSource = await sqlInput(name, `set role anon; select public.stage_native_qa_0027_f4f04e902c(${source});`);
    assert.notEqual(anonSource.code, 0, 'Anonymous clients must not stage the source');
    const staged = await sqlInput(name, `set role service_role; select public.stage_native_qa_0027_f4f04e902c(${source});`);
    assert.equal(staged.code, 0, staged.error);
  }
  // A deliberate final error tests that the entire migration rolls back; it is
  // never sent to a hosted server and does not simulate a provider backup.
  const failed = await sqlInput('native_rollback', `begin;\n${apply}\nselect 1/0;\ncommit;\n`);
  assert.notEqual(failed.code, 0, 'The deliberate error must abort the transaction');
  assert.equal(await sql('native_rollback', "select to_regclass('public.native_notification_campaigns') is null"), 't');
  assert.equal(await sql('native_rollback', "select count(*) from information_schema.columns where table_schema='public' and table_name='native_push_devices' and column_name='push_protocol'"), '0');
  assert.deepEqual(JSON.parse(await sql('native_rollback', snapshot)), baseline);
  console.log('✓ A deliberately failed 0027 transaction rolled back schema and preserved synthetic registrations');

  const applied = await sqlInput('native_restored', `begin;\n${apply}\ncommit;\n`);
  assert.equal(applied.code, 0, applied.error);
  assert.deepEqual(JSON.parse(await sql('native_restored', snapshot)), baseline);
  await denied('native_restored', 'public.claim_native_push_deliveries');
  await denied('native_restored', 'public.claim_native_push_deliveries_budgeted');
  await denied('native_restored', 'public.claim_native_push_deliveries_unbudgeted');
  assert.equal(await sql('native_restored', `select push_protocol from public.native_push_devices where binding_id='${binding}'`), '1');
  await sql('native_restored', `set role service_role; select public.register_native_push_device_v2('${owner}','${shop}','${binding}','${fid}',5,'2.1.0-isolated-test')`);
  assert.equal(await sql('native_restored', `select push_protocol || ':' || app_version_code || ':' || app_version_name from public.native_push_devices where binding_id='${binding}'`), '2:5:2.1.0-isolated-test');
  await sql('native_restored', `update public.platform_settings set value='true'::jsonb where key='maintenance'`);
  assert.equal(await sql('native_restored', "select count(*) from public.native_notification_campaigns where source_kind='maintenance' and status='scheduled'"), '1');
  assert.equal(await sql('native_restored', 'select count(*) from public.native_push_deliveries'), '0');
  const cleaned = await sqlInput('native_restored', `begin;\n${cleanup}\ncommit;\n`);
  assert.equal(cleaned.code, 0, cleaned.error);
  assert.equal(await sql('native_restored', "select to_regclass('public.native_qa_migration_source_f4f04e902c') is null"), 't');
  await denied('native_restored', 'public.claim_native_push_deliveries');
  await denied('native_restored', 'public.claim_native_push_deliveries_budgeted');
  console.log('✓ Atomic hash-verified 0027 preserves the device, supports v2 registration and blocks all service-role claims');
  console.log('✓ A source trigger can queue a synthetic notice without creating or sending a delivery');
  console.log('✓ Temporary source transport can be removed without re-enabling the worker');
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  await rm(tmp, { recursive: true, force: true });
}
