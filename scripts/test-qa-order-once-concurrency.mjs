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

  const owner = '14013050-0d77-4a6a-966b-46671008afe1';
  const shop = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4';
  const target = '11111111-1111-4111-8111-111111111111';
  const old = '22222222-2222-4222-8222-222222222222';
  await sql(`alter table public.shops add column owner_id uuid, add column is_open boolean default true;
    alter table public.orders add column customer_name text, add column notes text;
    insert into public.profiles values('${owner}','shop_staff');
    insert into public.shops(id,name,owner_id) values('${shop}','QA Test Shop c47d26a6','${owner}');
    insert into public.shop_staff(user_id,shop_id,role) values('${owner}','${shop}','owner');
    revoke execute on function public.claim_native_push_deliveries(integer), public.claim_native_push_deliveries_budgeted(integer), public.claim_native_push_deliveries_unbudgeted(integer) from public,anon,authenticated,service_role;
    select public.register_native_push_device('${owner}','${shop}','${old}','BBBBBBBBBBBBBBBBBBBBBB');
    select public.register_native_push_device_v2('${owner}','${shop}','${target}','AAAAAAAAAAAAAAAAAAAAAA',5,'2.1.0-isolated-test')`);
  await sqlFile(await readFile(path.join(root,'scripts/qa-order-notification-one-shot.sql'),'utf8'));
  const c='select count(*) from public.claim_printly_qa_order_00a80dd5_once()';
  assert.equal(await contested(c,c),'0');
  assert.equal(await sql('select count(*) from public.orders'), '1');
  assert.equal(await sql("select count(*) from public.native_push_deliveries where state='pending' and attempts=8"), '1');
  assert.equal(await sql("select count(*) from public.native_push_deliveries where state='discarded' and attempts=8"), '1');
  assert.equal(await sql("select count(*) from public.native_push_deliveries where binding_id='"+target+"' and state='pending'"), '1');
  await sql("update public.native_push_deliveries set lease_until=clock_timestamp()-interval '1 second'; select public.sweep_native_push(); delete from public.orders");
  assert.equal(await sql(c),'0');
  assert.equal(await sql("select count(*) from public.native_push_deliveries where state='pending'"),'0');
  console.log('✓ Concurrent duplicate calls produce one order and one terminally bounded target; deletion cannot rearm it');
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve)); server.kill('SIGTERM');
    const timeout = setTimeout(() => server.kill('SIGKILL'), 10000); await exited; clearTimeout(timeout);
  }
  await rm(tmp, { recursive: true, force: true });
}
