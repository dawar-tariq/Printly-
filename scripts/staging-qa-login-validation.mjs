// Temporary staging-only validation. Password and JWT remain in runner memory;
// only PGP ciphertext is published to workflow step names for the operator.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const SITE = 'https://printly-native-test.vercel.app';
const SUPABASE = 'https://rahfmpsdbwbktlobntkm.supabase.co';
const USER = '14013050-0d77-4a6a-966b-46671008afe1';
const SHOP = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4';
const EMAIL = 'qa-c47d26a6@example.com';
const MARKER = 'c47d26a62fcb3059fc4920e3fdea6cf5';
const directory = process.env.PRINTLY_QA_LOGIN_DIR;
const temp = process.env.RUNNER_TEMP;
assert.equal(process.env.PRINTLY_QA_LOGIN_CHECK, '1');
assert(directory && temp && directory.startsWith(`${temp}/`));
const require = createRequire(`${temp}/printly-qa-login-deps/package.json`);
const { createClient } = require('@supabase/supabase-js');
const mark = (name, content = 'ok\n') => writeFileSync(join(directory, name), content, { mode: 0o600 });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decrypt(ciphertext) {
  return new Promise((resolve, reject) => {
    if (typeof ciphertext !== 'string' || ciphertext.length > 16_384 || !/^[A-Za-z0-9+/=\r\n]+$/.test(ciphertext)) {
      reject(new Error('bad_ciphertext')); return;
    }
    const child = spawn('gpg', ['--batch', '--quiet', '--decrypt'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 128) child.kill(); });
    child.on('error', () => reject(new Error('decrypt_failed')));
    child.on('close', (code) => {
      if (code !== 0 || !/^[A-Za-z0-9_-]{16}$/.test(output)) reject(new Error('decrypt_failed'));
      else resolve(output);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(ciphertext, 'base64'));
  });
}

let phase = 'isolation';
let client;
let channel;
try {
  const diagResponse = await fetch(`${SITE}/api/native/v1/test-environment`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!diagResponse.ok) throw new Error('isolation');
  const diag = await diagResponse.json();
  if (diag.isolated_test !== true || diag.supabase_url !== SUPABASE || diag.public_auth_check !== 'ok' || diag.server_database_read !== 'ok') throw new Error('isolation');
  const cfgResponse = await fetch(`${SITE}/api/native/v1/config`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!cfgResponse.ok) throw new Error('config');
  const cfg = await cfgResponse.json();
  if (cfg.api_version !== 1 || cfg.supabase_url !== SUPABASE || typeof cfg.supabase_anon_key !== 'string' || !cfg.supabase_anon_key.startsWith('sb_publishable_')) throw new Error('config');
  client = createClient(SUPABASE, cfg.supabase_anon_key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let provisioning;
  phase = 'listener';
  channel = client.channel(`printly-qa-login:${MARKER}`)
    .on('broadcast', { event: 'created' }, (message) => {
      const payload = message?.payload;
      if (payload?.marker === MARKER && payload.version === 1 && typeof payload.runner_cipher === 'string' && typeof payload.local_cipher === 'string') provisioning = payload;
    });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('channel_timeout')), 40_000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('channel_failed')); }
    });
  });
  mark('listening');
  const deadline = Date.now() + 300_000;
  while (!provisioning && Date.now() < deadline) await delay(100);
  if (!provisioning) throw new Error('provision_timeout');
  // Save only ciphertext for the operator. The corresponding private key is local to them.
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(provisioning.local_cipher) || provisioning.local_cipher.length > 4096) throw new Error('bad_ciphertext');
  mark('local.cipher', provisioning.local_cipher.replace(/[\r\n]/g, ''));
  phase = 'decrypt';
  const password = await decrypt(provisioning.runner_cipher);
  phase = 'sign_in';
  const signed = await client.auth.signInWithPassword({ email: EMAIL, password });
  if (signed.error || signed.data?.user?.id !== USER || !signed.data.session?.access_token) throw new Error('signin');
  const token = signed.data.session.access_token;
  phase = 'native_shop';
  const shopResponse = await fetch(`${SITE}/api/native/v1/shop/me`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!shopResponse.ok) throw new Error('native_shop');
  const shop = await shopResponse.json();
  if (shop.shop?.id !== SHOP || shop.is_owner !== true || !Array.isArray(shop.services)) throw new Error('native_shop');
  phase = 'native_board';
  const boardResponse = await fetch(`${SITE}/api/native/v1/shop/board`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop_id: SHOP, pages: {}, search: '' }), redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!boardResponse.ok) throw new Error('native_board');
  const board = await boardResponse.json();
  if (board.shop_id !== SHOP || !['confirm', 'queued', 'printing', 'ready'].every((name) => Array.isArray(board.lanes?.[name]?.orders) && board.lanes[name].orders.length === 0)) throw new Error('native_board');
  phase = 'subscription';
  const billingResponse = await fetch(`${SITE}/api/native/v1/shop/subscription`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!billingResponse.ok) throw new Error('subscription');
  const billing = await billingResponse.json();
  const expiry = Date.parse(billing.subscription?.expires_at);
  if (billing.shop?.id !== SHOP || billing.subscription?.shop_id !== SHOP || billing.subscription?.is_permanent !== false || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('subscription');
  phase = 'sign_out';
  const signout = await client.auth.signOut();
  if (signout.error) throw new Error('signout');
  mark('passed');
} catch (_) {
  // Do not print exception messages, payloads, credentials, JWTs or HTTP bodies.
  mark('failed', `Synthetic QA validation failed at ${phase}.\n`);
} finally {
  if (client && channel) await client.removeChannel(channel).catch(() => {});
  process.exit(0);
}
