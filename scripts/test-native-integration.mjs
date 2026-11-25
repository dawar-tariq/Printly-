#!/usr/bin/env node
// Destructive synthetic-data tests against a disposable LOCAL Supabase stack.
// This script refuses non-loopback hosts before it creates users or writes data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { testNativeRealtimeLocal } from './test-native-realtime-local.mjs';

function localOrigin(value, label) {
  const url = new URL(value || '');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be a disposable HTTP service on loopback with an explicit port`);
  }
  return url.origin;
}
assert.equal(process.env.PRINTLY_DISPOSABLE_NATIVE_TEST, '1', 'explicit disposable-test opt-in is required');
const supabaseUrl = localOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL, 'Supabase URL');
const site = localOrigin(process.env.PRINTLY_TEST_SITE_URL, 'Test site URL');
assert.equal(localOrigin(process.env.NEXT_PUBLIC_SITE_URL, 'Configured test site URL'), site);
assert.notEqual(supabaseUrl, site, 'the app and disposable backend must use separate ports');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const guardNonce = process.env.PRINTLY_NATIVE_DISPOSABLE_NONCE || '';
assert(serviceKey && anonKey, 'local test keys are required');
assert.match(guardNonce, /^[a-f0-9]{64}$/, 'a per-run disposable stack guard is required');
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(supabaseUrl, serviceKey, options);
const ownerAuth = createClient(supabaseUrl, anonKey, options);
const otherAuth = createClient(supabaseUrl, anonKey, options);
const shop = 'a1111111-1111-4111-8111-111111111111';
const submittedOrder = 'c3333333-3333-4333-8333-333333330004';
const queuedOrder = 'c3333333-3333-4333-8333-333333330002';

function checked(result, label) {
  if (result.error) throw new Error(`${label} failed (${result.error.code || result.error.status || 'error'})`);
  return result.data;
}
// Loopback alone could be a tunnel to a hosted database. Require a unique
// marker created in this run's freshly initialized stack before any writes.
const guard = checked(await admin.from('native_integration_guard').select('nonce').single(), 'verify disposable stack');
assert.equal(guard?.nonce, guardNonce, 'refusing to write without the matching disposable stack guard');
async function waitForServer() {
  const deadline = Date.now() + 120_000;
  let last = 'not started';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${site}/api/native/v1/shop/me`, { signal: AbortSignal.timeout(8_000) });
      if (response.status === 401) return;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.name; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Local test site did not become ready (${last})`);
}
async function call(path, { method = 'GET', token, body, headers = {} } = {}) {
  const result = await fetch(`${site}/api/native/v1/shop/${path}`, {
    method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return result;
}
async function json(path, settings, expectedStatus = 200) {
  const response = await call(path, settings);
  const body = await response.json();
  assert.equal(response.status, expectedStatus, `${settings.method || 'GET'} ${path}: ${JSON.stringify(body).slice(0, 500)}`);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  return body;
}
async function signIn(client, email, password) {
  const result = checked(await client.auth.signInWithPassword({ email, password }), 'local Auth sign-in');
  assert(result.session?.access_token && result.user?.id, 'local Auth must issue an access token');
  return result.session.access_token;
}
const forOwner = (body, method = 'POST') => ({ method, token: ownerToken, body });
let ownerToken;

await waitForServer();
const noAuth = await call('me', { headers: { Cookie: 'not-a-native-session=example' } });
assert.equal(noAuth.status, 401);
assert.equal((await call('me', { token: 'invalid.token' })).status, 401);
ownerToken = await signIn(ownerAuth, 'demoshop@printly.test', 'demo1234');
const other = checked(await admin.auth.admin.createUser({
  email: 'native-other@printly.test', password: 'synthetic-local-only-password', email_confirm: true,
  user_metadata: { full_name: 'Other Test Owner' },
}), 'create second local user').user;
assert(other?.id);
const otherShop = randomUUID();
checked(await admin.rpc('create_shop_application', {
  p_shop: { id: otherShop, owner_id: other.id, name: 'Other Synthetic Shop', slug: 'other-native-test', short_code: 'NATIVE2',
    address: 'Synthetic address', city: 'Test City', phone: '0000000000', owner_name: 'Other Test Owner', gstin: '', upi_id: '' },
  p_onboarding: {}, p_services: ['print'], p_rates: [], p_inventory: [], p_photo_path: null,
}), 'create second local shop');
checked(await admin.from('shop_subscriptions').insert({ shop_id: otherShop, is_permanent: true }), 'grant second local shop access');
const otherToken = await signIn(otherAuth, 'native-other@printly.test', 'synthetic-local-only-password');
const contexts = await Promise.all(Array.from({ length: 8 }, (_, index) => json('me', { token: index % 2 ? otherToken : ownerToken })));
for (let i = 0; i < contexts.length; i++) assert.equal(contexts[i].shop.id, i % 2 ? otherShop : shop);
assert.equal((await call(`orders/${submittedOrder}`, { token: otherToken })).status, 403);
console.log('PASS: real Auth tokens, concurrent request isolation, membership and cross-shop denial');
await testNativeRealtimeLocal({ supabaseUrl, anonKey, admin, ownerToken, otherToken, shop, orderId: queuedOrder, guardNonce });

// Seed one known duplicate reference; the local migration seed only places
// references on payment rows for some of its orders, while the guard checks orders.
checked(await admin.from('orders').update({ utr: 'SYNTHETIC-DUP' }).eq('id', 'c3333333-3333-4333-8333-333333330001'), 'seed local duplicate reference');
const board = await json('board', forOwner({ pages: {}, search: '' }));
assert(board.lanes.confirm.orders.some((order) => order.id === submittedOrder));
assert(board.lanes.queued.orders.some((order) => order.id === queuedOrder));
const detail = await json(`orders/${submittedOrder}`, { token: ownerToken });
assert.equal(detail.order.payment_status, 'submitted');
assert(detail.items.length > 0 && Array.isArray(detail.files));
await json(`orders/${submittedOrder}/confirm-payment`, forOwner({ action: 'confirm' }), 422);
const duplicate = await json(`orders/${submittedOrder}/confirm-payment`, forOwner({
  action: 'confirm', verification_confirmed: true, utr: 'SYNTHETIC-DUP',
}), 409);
assert.equal(duplicate.error.code, 'possible_duplicate');
assert.equal((await json(`orders/${submittedOrder}`, { token: ownerToken })).order.payment_status, 'submitted');
await json(`orders/${submittedOrder}/confirm-payment`, forOwner({
  action: 'confirm', verification_confirmed: true, duplicate_acknowledged: true, utr: 'SYNTHETIC-DUP',
}));
for (const to of ['printing', 'ready', 'collected']) await json(`orders/${submittedOrder}/status`, forOwner({ to }));
assert.equal((await json(`orders/${submittedOrder}`, { token: ownerToken })).order.status, 'collected');
console.log('PASS: order detail, explicit UPI verification, duplicate warning and state transitions');

const added = await json('inventory', forOwner({ name: 'Synthetic paper', category: 'paper', qty: 10, unit: 'sheets', low_stock_threshold: 3 }));
const stock = (await json('inventory', { token: ownerToken })).items.find((item) => item.id === added.id);
assert(stock, 'created stock must be visible');
const expectedStock = Object.fromEntries(['name', 'category', 'qty', 'unit', 'low_stock_threshold'].map((key) => [key, stock[key]]));
const stockChanges = await Promise.all([11, 12].map((quantity) => call(`inventory/${added.id}`, forOwner({ expected: expectedStock, set_qty: quantity }, 'PATCH'))));
assert.deepEqual(stockChanges.map((response) => response.status).sort((a, b) => a - b), [200, 409]);
const latestStock = (await json('inventory', { token: ownerToken })).items.find((item) => item.id === added.id);
const latestExpected = Object.fromEntries(['name', 'category', 'qty', 'unit', 'low_stock_threshold'].map((key) => [key, latestStock[key]]));
await json(`inventory/${added.id}`, forOwner({ expected: latestExpected }, 'DELETE'));
assert(!(await json('inventory', { token: ownerToken })).items.some((item) => item.id === added.id));
const rates = (await json('rate-card', { token: ownerToken })).rows;
assert(rates.length > 0);
const rate = rates[0];
const expectedRate = Object.fromEntries(['service', 'paper_size', 'color', 'sides', 'paper_gsm', 'option', 'unit', 'price_paise'].map((key) => [key, rate[key]]));
const rateChanges = await Promise.all([1, 2].map((change) => call(`rate-card/${rate.id}`, forOwner({ expected: expectedRate, price_paise: rate.price_paise + change }, 'PATCH'))));
assert.deepEqual(rateChanges.map((response) => response.status).sort((a, b) => a - b), [200, 409]);
console.log('PASS: real concurrent inventory and price changes reject a stale snapshot');

await json('settings', forOwner({ eta_minutes: 25, services: [{ service: 'scan', enabled: false }] }, 'PUT'));
const settings = await json('me', { token: ownerToken });
assert.equal(settings.shop.eta_minutes, 25);
assert.equal(settings.services.find((service) => service.service === 'scan').enabled, false);
await json('availability', forOwner({ is_open: false }, 'PUT'));
assert.equal((await json('me', { token: ownerToken })).shop.is_open, false);
await json('availability', forOwner({ is_open: true }, 'PUT'));
assert.equal((await json('me', { token: ownerToken })).shop.is_open, true);
// A week keeps this deterministic even if the job crosses midnight in India.
const report = await json('reports?range=week', { token: ownerToken });
assert.equal(report.paid_orders_count, 3);
assert.equal(report.revenue_paise, 9204 + 7080 + 885);
console.log('PASS: settings, availability and creation-date paid-order report');

// A real local storage object must only be signed for an authorized shop.
const draftId = randomUUID(), fileId = randomUUID();
checked(await admin.from('orders').insert({ id: draftId, shop_id: shop, customer_name: 'Synthetic file draft' }), 'create local draft');
const filePath = `${shop}/${draftId}/${fileId}-synthetic.pdf`;
const fileBytes = Buffer.from('%PDF-1.4\n% synthetic test only\n');
checked(await admin.storage.from('order-files').upload(filePath, fileBytes, { contentType: 'application/pdf' }), 'upload local file');
checked(await admin.from('order_files').insert({ id: fileId, shop_id: shop, order_id: draftId, storage_path: filePath,
  original_name: 'synthetic.pdf', mime: 'application/pdf', size_bytes: fileBytes.length, page_count: 1 }), 'attach local file');
const fileEndpoint = `orders/${draftId}/files/${fileId}/download`;
assert.equal((await call(fileEndpoint, { token: otherToken })).status, 403);
const signed = await call(fileEndpoint, { token: ownerToken });
assert.equal(signed.status, 302);
assert.match(signed.headers.get('cache-control') || '', /no-store/);
const signedUrl = new URL(signed.headers.get('location'));
assert.equal(signedUrl.origin, supabaseUrl);
assert(signedUrl.pathname.startsWith('/storage/v1/object/sign/order-files/'));
const download = await fetch(signedUrl, { signal: AbortSignal.timeout(15_000) });
assert.equal(download.status, 200);
assert.deepEqual(Buffer.from(await download.arrayBuffer()), fileBytes);
console.log('PASS: private file authorization and local signed-object download');

checked(await admin.from('subscription_plan').update({ monthly_paise: 49900, six_months_paise: 249900,
  yearly_paise: 449900, upi_id: 'synthetic@upi', payee_name: 'Synthetic Payee' }).eq('id', true), 'configure local subscription plan');
const quote = (await json('subscription', forOwner({ action: 'quote', term: 'monthly', code: null }))).result;
const key = randomUUID();
const start = { action: 'start', term: 'monthly', code: null, request_key: key, expected_quote: quote };
const first = (await json('subscription', forOwner(start))).result;
const again = (await json('subscription', forOwner(start))).result;
assert.equal(first.purchase.id, again.purchase.id);
assert.equal(again.existing, true);
assert.equal(first.purchase.amount_paise, 49900);
await json('subscription', forOwner({ action: 'submit', purchase_id: first.purchase.id, utr: 'SYNTHETIC123' }));
assert((await json('subscription', { token: ownerToken })).purchases.some((purchase) => purchase.id === first.purchase.id && purchase.status === 'submitted'));
console.log('PASS: local subscription quote, idempotent request and payment report');

// Expire the seed shop, then verify only eligible recovery remains available.
checked(await admin.from('shop_subscriptions').update({ is_permanent: false, term: 'grace',
  started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), expires_at: new Date(Date.now() - 86_400_000).toISOString() }).eq('shop_id', shop), 'expire local subscription');
assert.equal((await call('me', { token: ownerToken })).status, 403);
assert.equal((await call(`orders/${draftId}`, { token: ownerToken })).status, 403);
const recovery = await json('recovery', { token: ownerToken });
assert(recovery.orders.some((order) => order.id === queuedOrder));
assert(!recovery.orders.some((order) => order.id === draftId));
await json(`orders/${queuedOrder}/status`, forOwner({ to: 'printing' }));
console.log('PASS: expired-shop recovery excludes unstarted drafts and permits an open-order transition');

checked(await admin.from('platform_settings').update({ value: true }).eq('key', 'maintenance'), 'enable local maintenance');
assert.equal((await call('recovery', { token: ownerToken })).status, 503);
checked(await admin.from('platform_settings').update({ value: false }).eq('key', 'maintenance'), 'disable local maintenance');
assert.equal((await call('recovery', { token: ownerToken })).status, 200);
console.log('PASS: native middleware enforces the real maintenance flag');
console.log('Disposable local Supabase native gateway checks passed; no live data or payment was used.');
