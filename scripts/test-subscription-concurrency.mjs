#!/usr/bin/env node
// Optional multi-backend integration test. It creates its OWN temporary
// PostgreSQL cluster with a private Unix socket and destroys it afterwards;
// it never connects to an existing database or opens a TCP port.
// Requires initdb, postgres and psql (set PRINTLY_PG_BIN to their directory).
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = process.cwd();
const binDir = process.env.PRINTLY_PG_BIN || (() => {
  try { return execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
})();
if (!binDir) throw new Error('PostgreSQL binaries not found. Set PRINTLY_PG_BIN to a directory containing initdb, postgres and psql.');
const bin = (name) => path.join(binDir, name);
const temp = await mkdtemp(path.join(os.tmpdir(), 'printly-offer-test-'));
const data = path.join(temp, 'data');
const socket = path.join(temp, 'socket');
const env = { ...process.env, PSQL_PAGER: 'cat' };
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const owner2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const legacyOwner = '77777777-7777-4777-8777-777777777777';
const shop1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const shop2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const legacyShop = '88888888-8888-4888-8888-888888888888';
const key1 = '11111111-1111-4111-8111-111111111111';
const key2 = '22222222-2222-4222-8222-222222222222';
const key3 = '33333333-3333-4333-8333-333333333333';
const key4 = '44444444-4444-4444-8444-444444444444';
const key5 = '55555555-5555-4555-8555-555555555555';
const key6 = '66666666-6666-4666-8666-666666666666';
let server;

function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-U', 'printly_test', '-d', 'postgres'];
async function sql(command) {
  const result = await exec(bin('psql'), [...args, '-c', command], { env, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout.trim();
}
async function sqlFile(contents) {
  const process = spawn(bin('psql'), [...args, '-f', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  process.stdout.on('data', (chunk) => { out += chunk; });
  process.stderr.on('data', (chunk) => { err += chunk; });
  process.stdin.end(contents);
  const code = await new Promise((resolve, reject) => { process.once('error', reject); process.once('exit', resolve); });
  if (code !== 0) throw new Error(`PostgreSQL setup failed: ${err}`);
  return out.trim();
}
function holder(statement) {
  // stdbuf makes the marker observable before the transaction releases its
  // locks. The sleep is part of the tested transaction, not a readiness poll.
  const process = spawn('stdbuf', ['-oL', bin('psql'), ...args, '-f', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  const locked = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Lock-holder did not report readiness: ${err}`)), 10000);
    process.stdout.on('data', (chunk) => { out += chunk; if (out.includes('TEST_LOCK_HELD')) { clearTimeout(timeout); resolve(); } });
    process.once('error', (error) => { clearTimeout(timeout); reject(error); });
    process.once('exit', (code) => { if (!out.includes('TEST_LOCK_HELD')) { clearTimeout(timeout); reject(new Error(`Lock-holder exited ${code}: ${err}`)); } });
  });
  process.stderr.on('data', (chunk) => { err += chunk; });
  const done = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (code) => code === 0 ? resolve(out) : reject(new Error(`Lock-holder failed: ${err}`)));
  });
  process.stdin.end(`begin;\n${statement};\nselect 'TEST_LOCK_HELD';\nselect pg_sleep(2);\ncommit;\n`);
  return { locked, done, process };
}
async function contested(first, second, expectedError) {
  const active = holder(first);
  try {
    await active.locked;
    const started = Date.now();
    let output = '', failure = '';
    try { output = await sql(second); } catch (error) { failure = `${error.stderr || ''} ${error.message || ''}`; }
    const elapsed = Date.now() - started;
    await active.done;
    assert(elapsed > 900, `Expected the second backend to wait for a row lock; waited ${elapsed}ms`);
    if (expectedError) assert(failure.includes(expectedError), `Expected ${expectedError}, got ${failure || output}`);
    else assert(!failure, `Competing transaction failed: ${failure}`);
    return output;
  } catch (error) { active.process.kill('SIGTERM'); await active.done.catch(() => {}); throw error; }
}
async function promo(code, extra = {}) {
  const value = { code, discount_type: 'percent', discount_value: 100, terms: ['monthly', 'six_months', 'yearly'], starts_at: null, ends_at: null, max_uses: null, max_uses_per_shop: null, enabled: true, ...extra };
  return JSON.parse(await sql(`select public.save_subscription_promo(${literal(admin)},null,null,${literal(JSON.stringify(value))}::jsonb)`));
}
async function quote(shop, owner, code) {
  return await sql(`select public.quote_subscription_offer(${literal(shop)},${literal(owner)},'monthly',${code ? literal(code) : 'null'})`);
}
function start(shop, owner, code, key, expected) {
  return `select public.start_subscription_purchase_with_offer(${literal(shop)},${literal(owner)},'monthly',${code ? literal(code) : 'null'},${literal(key)},${literal(expected)}::jsonb)`;
}

try {
  await mkdir(socket);
  await exec(bin('initdb'), ['-D', data, '--no-locale', '--encoding=UTF8', '-A', 'trust', '-U', 'printly_test'], { env });
  server = spawn(bin('postgres'), ['-D', data, '-c', "listen_addresses=", '-c', `unix_socket_directories=${socket}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => {
    let logs = '';
    const timeout = setTimeout(() => reject(new Error(`PostgreSQL startup timed out: ${logs}`)), 15000);
    server.stderr.on('data', (chunk) => { logs += chunk; if (logs.includes('database system is ready to accept connections')) { clearTimeout(timeout); resolve(); } });
    server.once('error', (error) => { clearTimeout(timeout); reject(error); });
    server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`PostgreSQL exited ${code}: ${logs}`)); });
  });
  const testSource = await readFile(path.join(root, 'src/lib/subscriptions-db.test.ts'), 'utf8');
  const schema = testSource.match(/const schema = `([\s\S]*?)`;\nconst admin/);
  assert(schema, 'Could not find the shared test schema');
  await sqlFile(schema[1]);
  for (const name of ['0010_order_draft_safeguards.sql', '0011_subscriptions.sql', '0016_duplex_sheet_rates.sql']) {
    await sqlFile(await readFile(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  await sql(`insert into public.profiles(id,role) values (${literal(admin)},'admin'),(${literal(owner1)},'shop_staff'),(${literal(owner2)},'shop_staff'),(${literal(legacyOwner)},'shop_staff');
    insert into public.shops(id,owner_id,name) values (${literal(shop1)},${literal(owner1)},'One'),(${literal(shop2)},${literal(owner2)},'Two'),(${literal(legacyShop)},${literal(legacyOwner)},'Legacy');
    update public.subscription_plan set monthly_paise=10000,six_months_paise=50000,yearly_paise=90000,upi_id='printly@upi',payee_name='Printly',version=0`);

  // Exercise the real upgrade on representative pre-existing paid data, not
  // just empty new tables. All records live only in this temporary cluster.
  const legacyPaid = JSON.parse(await sql(`select public.start_subscription_purchase(${literal(legacyShop)},${literal(legacyOwner)},'yearly')`)).purchase;
  await sql(`select public.submit_subscription_purchase(${literal(legacyShop)},${literal(legacyPaid.id)},${literal(legacyOwner)},'LEGACY-123456')`);
  await sql(`select public.review_subscription_purchase(${literal(legacyPaid.id)},${literal(admin)},'approve','')`);
  await sql(`select public.start_subscription_purchase(${literal(legacyShop)},${literal(legacyOwner)},'monthly')`);
  const legacyFingerprint = `select md5(coalesce(string_agg(to_jsonb(p)::text,'|' order by p.id),'')) from
    (select id,shop_id,requested_by,term,amount_paise,upi_id,payee_name,status,utr,submitted_at,reviewed_by,reviewed_at,review_note,period_start,period_end,created_at,updated_at from public.subscription_purchases) p`;
  const entitlementFingerprint = `select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by s.shop_id),'')) from public.shop_subscriptions s`;
  const planFingerprint = `select md5(to_jsonb(p)::text) from public.subscription_plan p`;
  const beforeUpgrade = await Promise.all([sql(legacyFingerprint), sql(entitlementFingerprint), sql(planFingerprint)]);
  assert.equal(await sql('select count(*) from public.subscription_purchases'), '2');
  await sqlFile(await readFile(path.join(root, 'supabase/migrations/0017_subscription_offers.sql'), 'utf8'));
  assert.deepEqual(await Promise.all([sql(legacyFingerprint), sql(entitlementFingerprint), sql(planFingerprint)]), beforeUpgrade);
  console.log('✓ Upgrade preserves representative paid requests, entitlements and plan');

  await promo('FREECAP', { max_uses: 1, max_uses_per_shop: 1 });
  const [qa, qb] = await Promise.all([quote(shop1, owner1, 'FREECAP'), quote(shop2, owner2, 'FREECAP')]);
  await contested(start(shop1, owner1, 'FREECAP', key1, qa), start(shop2, owner2, 'FREECAP', key2, qb), 'PROMO_LIMIT_REACHED');
  assert.equal(await sql("select count(*) from public.subscription_purchases where promo_code='FREECAP' and status='approved'"), '1');
  console.log('✓ Simultaneous free activations cannot exceed a global use cap');

  await promo('UNLIMITED');
  const qRetry = await quote(shop1, owner1, 'UNLIMITED');
  const retryOutput = await contested(start(shop1, owner1, 'UNLIMITED', key3, qRetry), start(shop1, owner1, 'UNLIMITED', key3, qRetry));
  assert.equal(JSON.parse(retryOutput).existing, true);
  assert.equal(await sql("select count(*) from public.subscription_purchases where promo_code='UNLIMITED'"), '1');
  console.log('✓ Concurrent retries of one request grant exactly one free term');

  const sharedQuote = await quote(shop1, owner1, 'UNLIMITED');
  await contested(start(shop1, owner1, 'UNLIMITED', key5, sharedQuote), start(shop1, owner1, 'UNLIMITED', key6, sharedQuote), 'SUBSCRIPTION_QUOTE_CHANGED');
  assert.equal(await sql("select count(*) from public.subscription_purchases where promo_code='UNLIMITED'"), '2');
  console.log('✓ Different keys cannot repeat a simultaneous free activation from a stale quote');

  const oldQuote = await quote(shop2, owner2, null);
  const changePlan = `select public.update_subscription_plan(0,${literal(JSON.stringify({ monthly_paise: 11000 }))}::jsonb,${literal(admin)})`;
  await contested(changePlan, start(shop2, owner2, null, key4, oldQuote), 'SUBSCRIPTION_QUOTE_CHANGED');
  assert.equal(await sql(`select count(*) from public.subscription_purchases where shop_id=${literal(shop2)}`), '0');
  console.log('✓ A competing plan edit invalidates the stale quote before purchase');

  const retired = await promo('RETIRED', { discount_value: 50 });
  const oldPromoQuote = await quote(shop2, owner2, 'RETIRED');
  const changed = { code: 'RETIRED', discount_type: 'percent', discount_value: 50, terms: ['monthly', 'six_months', 'yearly'], starts_at: null, ends_at: null, max_uses: null, max_uses_per_shop: null, enabled: false };
  const disable = `select public.save_subscription_promo(${literal(admin)},${literal(retired.id)},0,${literal(JSON.stringify(changed))}::jsonb)`;
  await contested(disable, start(shop2, owner2, 'RETIRED', key4, oldPromoQuote), 'PROMO_UNAVAILABLE');
  assert.equal(await sql("select count(*) from public.subscription_purchases where promo_code='RETIRED'"), '0');
  console.log('✓ Pausing a promo concurrently prevents a new redemption');

  const isolationQuote = await quote(shop2, owner2, 'UNLIMITED');
  let isolationError = '';
  try { await sql(`begin isolation level repeatable read; ${start(shop2, owner2, 'UNLIMITED', key4, isolationQuote)}; commit`); }
  catch (error) { isolationError = `${error.stderr || ''} ${error.message || ''}`; }
  assert(isolationError.includes('SUBSCRIPTION_ISOLATION_UNSUPPORTED'), 'Non-read-committed transactions must fail closed');
  assert.equal(await sql(`select count(*) from public.subscription_purchases where shop_id=${literal(shop2)}`), '0');
  console.log('✓ Non-read-committed activation transactions fail closed');
  console.log('Real PostgreSQL concurrency checks passed.');
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    const timeout = setTimeout(() => server.kill('SIGKILL'), 10000);
    await exited; clearTimeout(timeout);
  }
  await rm(temp, { recursive: true, force: true });
}
