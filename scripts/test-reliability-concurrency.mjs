#!/usr/bin/env node
// Isolated multi-backend PostgreSQL tests: creates its own temporary cluster,
// uses only a private Unix socket, and never connects to an existing database.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = process.cwd();
const bindir = process.env.PRINTLY_PG_BIN || (() => { try { return execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
if (!bindir) throw new Error('Set PRINTLY_PG_BIN to a directory containing initdb, postgres and psql.');
const bin = (name) => path.join(bindir, name);
const tmp = await mkdtemp(path.join(os.tmpdir(), 'printly-reliability-test-'));
const data = path.join(tmp, 'data'), socket = path.join(tmp, 'socket');
const env = { ...process.env, PSQL_PAGER: 'cat' };
const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-U', 'printly_test', '-d', 'postgres'];
let server;
async function sql(command) { return (await exec(bin('psql'), [...args, '-c', command], { env, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
async function sqlFile(contents) {
  const proc = spawn(bin('psql'), [...args, '-f', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = ''; proc.stderr.on('data', (chunk) => { err += chunk; }); proc.stdin.end(contents);
  const code = await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('exit', resolve); });
  if (code !== 0) throw new Error(`PostgreSQL setup failed: ${err}`);
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
  proc.stdin.end(`begin;\n${statement};\nselect 'TEST_LOCK_HELD';\nselect pg_sleep(2);\ncommit;\n`);
  return { locked, done, proc };
}
async function contested(first, second, expectedError) {
  const active = holder(first);
  try {
    await active.locked;
    const started = Date.now(); let output = '', failure = '';
    try { output = await sql(second); } catch (error) { failure = `${error.stderr || ''} ${error.message || ''}`; }
    const elapsed = Date.now() - started; await active.done;
    assert(elapsed > 900, `Expected the competing backend to wait; waited ${elapsed}ms`);
    if (expectedError) assert(failure.includes(expectedError), `Expected ${expectedError}, got ${failure || output}`);
    else assert(!failure, `Competing transaction failed: ${failure}`);
    return output;
  } catch (error) { active.proc.kill('SIGTERM'); await active.done.catch(() => {}); throw error; }
}
const shop = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const ticket = '33333333-3333-4333-8333-333333333333';
const initial = '44444444-4444-4444-8444-444444444444';
const reply = '55555555-5555-4555-8555-555555555555';
const other = '66666666-6666-4666-8666-666666666666';
const actor = '77777777-7777-4777-8777-777777777777';
const create = `select public.create_support_ticket('${ticket}','${'a'.repeat(64)}','Help','${initial}','First message')`;
const append = (id, body = 'Reply') => `select public.append_support_message('${ticket}','${id}','customer',null,'${body}')`;

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
  const source = await readFile(path.join(root, 'src/lib/order-draft-safeguards.test.ts'), 'utf8');
  const fixture = source.match(/const schema = `([\s\S]*?)`;\n\nconst shop/);
  assert(fixture, 'Could not find the shared order fixture');
  await sqlFile(fixture[1]);
  await sql('alter table public.orders add column created_at timestamptz not null default now()');
  for (const name of ['0010_order_draft_safeguards.sql', '0013_public_abuse_limits.sql', '0014_more_abuse_limits.sql', '0018_board_tracking.sql', '0019_private_support.sql', '0020_upi_duplicate_warning.sql']) {
    await sqlFile(await readFile(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  await sql(`insert into public.shops(id,name,upi_id) values ('${shop}','Demo','demo@upi');
    insert into public.orders(id,shop_id,status,payment_method,payment_status,utr,total_paise) values ('${a}','${shop}','draft','upi','submitted',null,500),('${b}','${shop}','draft','upi','submitted',null,500);
    insert into public.payments(order_id,provider,amount_paise,status) values ('${a}','upi',500,'submitted'),('${b}','upi',500,'submitted')`);
  const confirm = (id, ref) => `select public.decide_shop_upi_payment_checked('${id}','${shop}','confirm','${actor}','${ref}',false)`;
  const warning = JSON.parse(await contested(confirm(a, 'TEMP-123'), confirm(b, 'temp 123')));
  assert.equal(warning.outcome, 'possible_duplicate'); assert.equal(Number(warning.duplicate_count), 1);
  assert.equal(await sql(`select status::text || ':' || payment_status::text from public.orders where id='${b}'`), 'draft:submitted');
  console.log('✓ Competing confirmations of the same reference serialize and warn before the second mutation');

  assert.equal(await contested(create, create), 'exists');
  assert.equal(await sql(`select count(*) from public.support_messages where ticket_id='${ticket}'`), '1');
  console.log('✓ Concurrent retries create one private conversation');

  assert.equal(await contested(append(reply), append(reply)), 'exists');
  assert.equal(await sql(`select message_count from public.support_tickets where id='${ticket}'`), '2');
  console.log('✓ Concurrent retries append one message');

  await sql(`insert into public.support_messages(id,ticket_id,sender,position,body) select gen_random_uuid(),'${ticket}','customer',n,'filler' from generate_series(3,99) n;
    update public.support_tickets set message_count=99 where id='${ticket}'`);
  await contested(append(other), append('88888888-8888-4888-8888-888888888888'), 'SUPPORT_FULL');
  assert.equal(await sql(`select count(*) from public.support_messages where ticket_id='${ticket}'`), '100');
  assert.equal(await sql(`select message_count from public.support_tickets where id='${ticket}'`), '100');
  console.log('✓ Concurrent replies cannot exceed the conversation cap');

  const c = '99999999-9999-4999-8999-999999999999', d = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const fileC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', fileD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const pathC = `${shop}/${c}/${fileC}-file.pdf`, pathD = `${shop}/${d}/${fileD}-file.pdf`;
  await sql(`insert into public.orders(id,shop_id) values ('${c}','${shop}'),('${d}','${shop}')`);
  const attach = (orderId, fileId, objectPath) => `insert into public.order_files(id,order_id,shop_id,storage_path,original_name,mime) values ('${fileId}','${orderId}','${shop}','${objectPath}','file.pdf','application/pdf')`;
  const remove = (orderId, fileId, objectPath) => `select public.remove_draft_file('${orderId}','${fileId}','${objectPath}')`;
  await contested(remove(c, fileC, pathC), attach(c, fileC, pathC), 'FILE_REMOVED');
  assert.equal(await sql(`select count(*) from public.order_files where id='${fileC}'`), '0');
  assert.equal(await sql(`select count(*) from public.order_file_tombstones where storage_path='${pathC}'`), '1');
  console.log('✓ A removal committed before finalization prevents a delayed attach');

  await contested(attach(d, fileD, pathD), remove(d, fileD, pathD));
  assert.equal(await sql(`select count(*) from public.order_files where id='${fileD}'`), '0');
  assert.equal(await sql(`select count(*) from public.order_file_tombstones where storage_path='${pathD}'`), '1');
  console.log('✓ A removal racing after finalization detaches and tombstones the file');
  // Apply the shop availability migration after the original reliability fixtures have
  // completed. This local PostgreSQL cluster is isolated from all live data.
  await sql(`create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users(id) values ('${actor}'),('${other}');
    alter table public.shops add column owner_id uuid;
    update public.shops set owner_id='${actor}' where id='${shop}'`);
  for (const name of ['0021_shop_availability.sql']) {
    await sqlFile(await readFile(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  const closeShop = `select public.set_shop_open('${shop}','${actor}',false)`;
  const openShop = `select public.set_shop_open('${shop}','${actor}',true)`;
  const draft = '12121212-1212-4212-8212-121212121212';
  const line = '13131313-1313-4313-8313-131313131313';
  const newDraft = `insert into public.orders(id,shop_id) values ('${draft}','${shop}')`;
  await contested(closeShop, newDraft, 'SHOP_CLOSED');
  assert.equal(await sql(`select count(*) from public.orders where id='${draft}'`), '0');
  console.log('✓ Closing serializes before a competing new draft');
  await sql(openShop);
  await contested(newDraft, closeShop);
  assert.equal(await sql(`select is_open from public.shops where id='${shop}'`), 'f');
  assert.equal(await sql(`select count(*) from public.orders where id='${draft}'`), '1');
  console.log('✓ An in-flight draft finishes before a competing close takes effect');
  await sql(openShop);
  await sql(`insert into public.order_items(id,order_id,service) values ('${line}','${draft}','print')`);
  const checkout = `select public.commit_draft_checkout('${draft}',(select draft_version from public.orders where id='${draft}'),
    '[]'::jsonb,1800,(select jsonb_build_object('name',name,'upi_id',upi_id,'eta_minutes',eta_minutes,'commission_bps',commission_bps,'rush_surcharge_bps',rush_surcharge_bps,'status',status) from public.shops where id='${shop}'),
    '[{"id":"${line}","unit_price_paise":200,"line_total_paise":200}]'::jsonb,
    '{"method":"cod","customer_name":"Customer","customer_phone":"9797000000","subtotal_paise":200,"tax_paise":36,"total_paise":236,"commission_paise":0,"quote_token":"abc"}'::jsonb)`;
  await contested(closeShop, checkout, 'SHOP_CLOSED');
  assert.equal(await sql(`select status::text || ':' || coalesce(payment_method::text,'none') from public.orders where id='${draft}'`), 'draft:none');
  assert.equal(await sql(`select count(*) from public.payments where order_id='${draft}'`), '0');
  console.log('✓ Closing before checkout prevents the first payment transition and rolls back its writes');
  await sql(openShop);
  await contested(checkout, closeShop);
  assert.equal(await sql(`select status::text from public.orders where id='${draft}'`), 'queued');
  assert.equal(await sql(`select is_open from public.shops where id='${shop}'`), 'f');
  console.log('✓ Checkout already holding the shop lock completes before closing');

  console.log('Real PostgreSQL reliability concurrency checks passed.');
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve)); server.kill('SIGTERM');
    const timeout = setTimeout(() => server.kill('SIGKILL'), 10000); await exited; clearTimeout(timeout);
  }
  await rm(tmp, { recursive: true, force: true });
}
