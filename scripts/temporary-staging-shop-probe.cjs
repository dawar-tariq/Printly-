// Temporary preview-build-only probe. It must never touch production.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { PDFDocument } = require('pdf-lib');
const { createClient } = require('@supabase/supabase-js');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium');

const project = 'rahfmpsdbwbktlobntkm';
const bootstrap = 'printly-shop-release-probe';
const token = process.env.PRINTLY_STAGING_SHOP_PROBE;
if (!token) { console.log('Temporary staging shop probe skipped: not configured.'); process.exit(0); }
if (process.env.VERCEL_ENV !== 'preview') { console.error('Staging probe is allowed only in preview builds.'); process.exit(1); }

const base = 'http://127.0.0.1:3131';
const run = randomBytes(8).toString('hex');
const email = `staging-shop-${run}@example.test`;
const staffEmail = `staging-staff-${run}@example.test`;
const password = `PrintlyProbe-${randomBytes(18).toString('base64url')}!`;
const staffPassword = `PrintlyStaff-${randomBytes(18).toString('base64url')}!`;
const ip = `10.123.${randomBytes(1)[0]}.${Math.max(1, randomBytes(1)[0])}`;
const objects = new Set();
let phase = 'bootstrap', logs = '', credentials, admin, server, browser;
let ownerId, staffId, shopId, orderId, ticketId, failed = false;
const next = require.resolve('next/dist/bin/next');
function append(chunk) { logs = (logs + chunk.toString()).slice(-12000); }
function clean(value) {
  let text = String(value || '');
  for (const part of [token, credentials?.service, credentials?.anon, password, staffPassword]) if (part) text = text.split(part).join('[redacted]');
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]').slice(-4000);
}
function child(args, env) {
  const proc = spawn(process.execPath, [next, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', append); proc.stderr.on('data', append);
  return proc;
}
function finished(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Process timed out')); }, timeoutMs);
    proc.once('error', (err) => { clearTimeout(timer); reject(err); });
    proc.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Process exited ${code ?? signal}`)); });
  });
}
async function ready(proc) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error('Staging app exited');
    try { if ((await fetch(`${base}/api/maintenance-status`, { signal: AbortSignal.timeout(2000) })).status === 200) return; } catch {}
    await delay(500);
  }
  throw new Error('Staging app did not become ready');
}
function ok(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.code || 'failed'}`);
  return result.data;
}
async function waitEnabled(locator) {
  await locator.waitFor();
  for (let i = 0; i < 100 && await locator.isDisabled(); i++) await delay(200);
  assert(!(await locator.isDisabled()), 'Expected action did not become available');
}
async function configurePage(page) {
  page.setDefaultTimeout(30000);
  await page.route(`${base}/**`, (route) => route.continue({ headers: { ...route.request().headers(), 'x-printly-client-ip': ip } }));
}

(async () => {
  const bootstrapResponse = await fetch(`https://${project}.supabase.co/functions/v1/${bootstrap}`, {
    headers: { 'x-printly-staging-probe': token }, signal: AbortSignal.timeout(15000),
  });
  assert.equal(bootstrapResponse.status, 200, 'Staging bootstrap unavailable');
  credentials = await bootstrapResponse.json();
  assert.equal(credentials.url, `https://${project}.supabase.co`, 'Refusing non-staging credentials');
  assert(credentials.anon && credentials.service, 'Staging keys unavailable');
  admin = createClient(credentials.url, credentials.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: credentials.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.anon,
    SUPABASE_SERVICE_ROLE_KEY: credentials.service, NEXT_PUBLIC_SITE_URL: base, NEXT_PUBLIC_DROPBOX_APP_KEY: '',
    VERCEL: '0', PRINTLY_TRUST_PROXY_IP: '1', NEXT_TELEMETRY_DISABLED: '1' };
  delete env.PRINTLY_STAGING_SHOP_PROBE;
  phase = 'building staging app';
  await finished(child(['build'], env), 300000);
  phase = 'starting staging app'; logs = '';
  server = child(['start', '-H', '127.0.0.1', '-p', '3131'], env);
  await ready(server);
  browser = await playwright.launch({ executablePath: await chromium.executablePath(),
    args: chromium.args.filter((arg) => arg !== '--disable-web-security'), headless: true });

  phase = 'creating synthetic shop';
  const setup = await browser.newContext();
  const signup = await setup.request.post(`${base}/api/shop/signup`, {
    headers: { origin: base, 'x-printly-client-ip': ip },
    data: { shop_name: `Staging Shop ${run}`, owner_name: 'Staging Owner', email, password,
      phone: '9999900000', address: 'Synthetic test', city: 'Srinagar', upi_id: 'staging@upi' },
  });
  assert.equal(signup.status(), 200, 'Synthetic shop application failed');
  const application = await signup.json();
  assert.match(application.short_code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(application.customer_path, `/s/p-${application.short_code.toLowerCase()}`);
  const shop = ok(await admin.from('shops').select('id,owner_id').eq('short_code', application.short_code).single(), 'Find synthetic shop');
  shopId = shop.id; ownerId = shop.owner_id;
  ok(await admin.from('shops').update({ status: 'active', kyc_status: 'approved' }).eq('id', shopId), 'Approve synthetic shop');
  ok(await admin.from('shop_subscriptions').upsert({ shop_id: shopId, is_permanent: true }), 'Activate synthetic subscription');
  const createdStaff = ok(await admin.auth.admin.createUser({ email: staffEmail, password: staffPassword, email_confirm: true }), 'Create synthetic staff');
  staffId = createdStaff.user.id;
  ok(await admin.from('profiles').update({ role: 'shop_staff' }).eq('id', staffId), 'Set synthetic staff role');
  ok(await admin.from('shop_staff').insert({ shop_id: shopId, user_id: staffId, role: 'staff' }), 'Link synthetic staff');
  await setup.close();

  phase = 'owner closes shop';
  const owner = await browser.newPage(); await configurePage(owner);
  await owner.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await owner.getByLabel('Email').fill(email);
  await owner.getByLabel('Password').fill(password);
  await Promise.all([owner.waitForURL(/\/shop(?:\?|$|\/)/, { timeout: 45000 }), owner.getByRole('button', { name: 'Sign in' }).click()]);
  const close = owner.getByRole('button', { name: 'Close shop' }); await close.waitFor();
  let update = owner.waitForResponse((r) => r.url() === `${base}/api/shop/availability` && r.request().method() === 'PUT');
  await close.click(); assert.equal((await update).status(), 200, 'Owner close failed');
  await owner.getByText('Shop is closed', { exact: true }).waitFor();
  assert.equal(ok(await admin.from('shops').select('is_open').eq('id', shopId).single(), 'Read closed state').is_open, false);

  phase = 'staff cannot change availability';
  const staff = await browser.newPage(); await configurePage(staff);
  await staff.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await staff.getByLabel('Email').fill(staffEmail);
  await staff.getByLabel('Password').fill(staffPassword);
  await Promise.all([staff.waitForURL(/\/shop(?:\?|$|\/)/, { timeout: 45000 }), staff.getByRole('button', { name: 'Sign in' }).click()]);
  await staff.getByText(/Only the owner can change this setting/).waitFor();
  assert.equal(await staff.getByRole('button', { name: 'Reopen shop' }).count(), 0);
  const denied = await staff.evaluate(async () => {
    const response = await fetch('/api/shop/availability', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_open: true }) });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'forbidden');
  assert.equal(ok(await admin.from('shops').select('is_open').eq('id', shopId).single(), 'Read staff-denied state').is_open, false);
  console.log('✓ Signed-in staff cannot reopen the shop');

  phase = 'closed storefront';
  const customer = await browser.newPage(); await configurePage(customer);
  await customer.goto(`${base}${application.customer_path}`, { waitUntil: 'domcontentloaded' });
  await customer.getByText('This shop is closed. Please check back when it reopens.').waitFor();
  await customer.goto(`${base}${application.customer_path}/order`, { waitUntil: 'domcontentloaded' });
  await customer.getByText('This shop is closed. Please check back when it reopens.').waitFor();
  const blocked = await customer.evaluate(async ({ slug }) => {
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_slug: slug }) });
    return { status: response.status, body: await response.json() };
  }, { slug: `p-${application.short_code.toLowerCase()}` });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'shop_closed');
  console.log('✓ Owner closure appears publicly and blocks new drafts');

  phase = 'reopening and starting checkout';
  const reopen = owner.getByRole('button', { name: 'Reopen shop' });
  update = owner.waitForResponse((r) => r.url() === `${base}/api/shop/availability` && r.request().method() === 'PUT');
  await reopen.click(); assert.equal((await update).status(), 200, 'Owner reopen failed');
  await owner.getByText('Shop setting: open', { exact: true }).waitFor();
  await customer.reload({ waitUntil: 'domcontentloaded' });
  await customer.getByRole('button', { name: /^Print/ }).first().click();
  const createdOrder = customer.waitForResponse((r) => r.url() === `${base}/api/orders` && r.request().method() === 'POST');
  await customer.getByRole('button', { name: 'Continue', exact: true }).click();
  const orderResponse = await createdOrder; assert.equal(orderResponse.status(), 200);
  orderId = (await orderResponse.json()).order_id; assert.match(orderId, /^[0-9a-f-]{36}$/);
  await customer.getByRole('heading', { name: 'Add your files' }).waitFor();
  const pdf = await PDFDocument.create(); pdf.addPage(); const file = Buffer.from(await pdf.save());
  const issued = customer.waitForResponse((r) => r.url() === `${base}/api/orders/${orderId}/files` && r.request().method() === 'POST');
  await customer.locator('input[type=file]').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: file });
  const issuedResponse = await issued; assert.equal(issuedResponse.status(), 200);
  const issuedBody = await issuedResponse.json(); if (issuedBody.path) objects.add(issuedBody.path);
  await customer.getByText('1 page · uploaded', { exact: true }).waitFor({ timeout: 120000 });
  await customer.getByRole('button', { name: /^Continue/ }).click();
  await customer.getByRole('heading', { name: 'Options' }).waitFor();
  await customer.getByRole('button', { name: 'Continue to payment' }).click();
  await customer.getByRole('heading', { name: 'Almost there' }).waitFor();
  await customer.getByPlaceholder('e.g. Aisha Khan').fill('Staging Customer');
  await customer.getByPlaceholder('97970 00000').fill('9999900000');
  const proceed = customer.getByRole('button', { name: /Proceed to pay/i });
  await waitEnabled(proceed);

  phase = 'closing an unstarted checkout';
  const quote = await customer.evaluate(async (id) => {
    const response = await fetch(`/api/orders/${id}/quote?rush=0`);
    return { status: response.status, body: await response.json() };
  }, orderId);
  assert.equal(quote.status, 200); assert.match(quote.body.quote_token, /^[0-9a-f]{64}$/);
  update = owner.waitForResponse((r) => r.url() === `${base}/api/shop/availability` && r.request().method() === 'PUT');
  await owner.getByRole('button', { name: 'Close shop' }).click(); assert.equal((await update).status(), 200);
  await owner.getByText('Shop is closed', { exact: true }).waitFor();
  const rejected = await customer.evaluate(async ({ id, quoteToken }) => {
    const quoteResponse = await fetch(`/api/orders/${id}/quote?rush=0`);
    const payResponse = await fetch(`/api/orders/${id}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'upi', quote_token: quoteToken, customer_name: 'Staging Customer', customer_phone: '9999900000', customer_email: '', notes: '', rush: false }) });
    return { quoteStatus: quoteResponse.status, quote: await quoteResponse.json(), payStatus: payResponse.status, pay: await payResponse.json() };
  }, { id: orderId, quoteToken: quote.body.quote_token });
  assert.equal(rejected.quoteStatus, 403); assert.equal(rejected.quote.error.code, 'shop_closed');
  assert.equal(rejected.payStatus, 403); assert.equal(rejected.pay.error.code, 'shop_closed');
  assert.equal(ok(await admin.from('orders').select('payment_method').eq('id', orderId).single(), 'Read blocked checkout').payment_method, null);
  assert.equal(ok(await admin.from('payments').select('id').eq('order_id', orderId), 'Read blocked payments').length, 0);
  update = owner.waitForResponse((r) => r.url() === `${base}/api/shop/availability` && r.request().method() === 'PUT');
  await owner.getByRole('button', { name: 'Reopen shop' }).click(); assert.equal((await update).status(), 200);
  await owner.getByText('Shop setting: open', { exact: true }).waitFor();
  console.log('✓ Closed shop rejects quotes and first checkout for an existing draft');

  phase = 'losing the checkout response';
  let payRequests = 0, payStatus = 0;
  await customer.route(`${base}/api/orders/${orderId}/pay`, async (route) => {
    payRequests++;
    const response = await route.fetch({ headers: { ...route.request().headers(), 'x-printly-client-ip': ip } });
    payStatus = response.status();
    await route.abort('failed'); // The server committed, but the browser loses the response.
  });
  await proceed.click();
  await customer.getByText(/Could not complete checkout/).waitFor();
  assert.equal(payRequests, 1); assert.equal(payStatus, 200, 'Staging checkout did not commit');
  const started = ok(await admin.from('orders').select('payment_method,payment_status,status').eq('id', orderId).single(), 'Read started checkout');
  assert.equal(started.payment_method, 'upi'); assert.equal(started.payment_status, 'pending');
  console.log('✓ Reopened shop accepts a synthetic checkout even when its response is lost');

  phase = 'recovering started UPI while closed';
  update = owner.waitForResponse((r) => r.url() === `${base}/api/shop/availability` && r.request().method() === 'PUT');
  await owner.getByRole('button', { name: 'Close shop' }).click();
  assert.equal((await update).status(), 200);
  await owner.getByText('Shop is closed', { exact: true }).waitFor();
  await customer.reload({ waitUntil: 'domcontentloaded' });
  await customer.getByRole('heading', { name: 'Check your previous checkout' }).waitFor();
  const recovery = customer.waitForResponse((r) => r.url() === `${base}/api/orders/${orderId}/pay/recover` && r.request().method() === 'POST');
  await customer.getByRole('button', { name: 'Check previous checkout' }).click();
  assert.equal((await recovery).status(), 200);
  await customer.getByText(/This checkout was already started/).waitFor();
  assert.equal(payRequests, 1, 'Recovery started another payment');
  const payments = ok(await admin.from('payments').select('id,status').eq('order_id', orderId), 'Read synthetic payments');
  assert.equal(payments.length, 1); assert.equal(payments[0].status, 'created');
  await customer.getByPlaceholder('e.g. 426178900123').fill('STAGING123456');
  const report = customer.waitForResponse((r) => r.url() === `${base}/api/orders/${orderId}/payment-submitted` && r.request().method() === 'POST');
  await customer.getByRole('button', { name: /^I have paid/ }).click();
  assert.equal((await report).status(), 200, 'Started UPI report failed while closed');
  await customer.waitForURL(`${base}/track/${orderId}`, { timeout: 45000 });
  const submitted = ok(await admin.from('orders').select('payment_status').eq('id', orderId).single(), 'Read reported payment');
  assert.equal(submitted.payment_status, 'submitted');
  console.log('✓ Same-tab reload recovers and reports one started UPI checkout while closed');

  phase = 'existing anonymous support';
  const support = await browser.newPage(); await configurePage(support);
  await support.goto(`${base}/support`, { waitUntil: 'domcontentloaded' });
  await support.getByLabel('Subject').fill('Synthetic staging request');
  await support.getByLabel('Message').fill('Synthetic support message.');
  const supportRequest = support.waitForRequest((r) => r.url() === `${base}/api/support` && r.method() === 'POST');
  const supportResponse = support.waitForResponse((r) => r.url() === `${base}/api/support` && r.request().method() === 'POST');
  await support.getByRole('button', { name: 'Send request' }).click();
  ticketId = (await supportRequest).postDataJSON().id;
  assert.equal((await supportResponse).status(), 200);
  await support.getByLabel('Your private access code').waitFor();
  await support.getByText('Synthetic support message.').waitFor();
  await support.getByLabel('Your reply').fill('Synthetic follow-up.');
  const reply = support.waitForResponse((r) => r.url() === `${base}/api/support/conversation` && r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'reply');
  await support.getByRole('button', { name: 'Send reply' }).click();
  assert.equal((await reply).status(), 200);
  await support.getByText('Synthetic follow-up.').waitFor();
  console.log('✓ Existing code-protected support creation and replies still work');
})().catch((error) => {
  failed = true;
  console.error(`STAGING_SHOP_PROBE_FAILED at ${phase}: ${clean(error?.message || error)}`);
  if (logs) console.error(clean(logs));
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null) {
    server.kill('SIGTERM'); await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(5000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  if (admin) {
    try {
      if (!ownerId) ownerId = (ok(await admin.from('profiles').select('id').eq('email', email).maybeSingle(), 'Find synthetic owner'))?.id;
      if (!shopId && ownerId) shopId = (ok(await admin.from('shops').select('id').eq('owner_id', ownerId).maybeSingle(), 'Find synthetic shop'))?.id;
      if (shopId) {
        const files = ok(await admin.from('order_files').select('storage_path').eq('shop_id', shopId), 'List synthetic files') || [];
        for (const file of files) objects.add(file.storage_path);
        if (objects.size) ok(await admin.storage.from('order-files').remove([...objects]), 'Remove synthetic objects');
        ok(await admin.from('orders').delete().eq('shop_id', shopId), 'Remove synthetic orders');
        ok(await admin.from('shops').delete().eq('id', shopId), 'Remove synthetic shop');
      }
      if (ticketId) ok(await admin.from('support_tickets').delete().eq('id', ticketId), 'Remove synthetic support request');
      if (ownerId) ok(await admin.auth.admin.deleteUser(ownerId), 'Remove synthetic owner');
      if (staffId) ok(await admin.auth.admin.deleteUser(staffId), 'Remove synthetic staff');
      console.log('✓ Removed synthetic staging users, shop, order, support request and uploaded object');
    } catch (error) { failed = true; console.error(`STAGING_SHOP_CLEANUP_FAILED: ${clean(error?.message || error)}`); }
  }
  if (failed) process.exitCode = 1;
});
