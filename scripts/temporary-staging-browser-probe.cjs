// Temporary preview-build-only staging smoke test. Never use production data.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { PDFDocument } = require('pdf-lib');
const { createClient } = require('@supabase/supabase-js');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium');

const PROJECT = 'rahfmpsdbwbktlobntkm';
const SHOP = 'a1111111-1111-4111-8111-111111111111';
const token = process.env.PRINTLY_STAGING_BROWSER_PROBE;
if (!token) {
  console.log('Temporary staging browser probe skipped: not configured.');
  process.exit(0);
}
if (process.env.VERCEL_ENV !== 'preview') {
  console.error('Temporary staging browser probe is permitted only in a preview build.');
  process.exit(1);
}
const next = require.resolve('next/dist/bin/next');
const base = 'http://127.0.0.1:3131';
let phase = 'staging bootstrap', server, browser, credentials;
let logs = '';
function append(chunk) { logs = (logs + chunk.toString()).slice(-12000); }
function clean(value) {
  let text = String(value || '');
  for (const part of [token, credentials?.service, credentials?.anon]) if (part) text = text.split(part).join('[redacted]');
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]').slice(-4000);
}
function child(args, env) {
  const proc = spawn(process.execPath, [next, ...args], { env, stdio: ['ignore','pipe','pipe'] });
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
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error('Staging application server exited');
    try { const res = await fetch(`${base}/api/maintenance-status`, { signal: AbortSignal.timeout(2000) }); if (res.status === 200) return; } catch {}
    await delay(500);
  }
  throw new Error('Staging application server did not become ready');
}
(async () => {
  const response = await fetch(`https://${PROJECT}.supabase.co/functions/v1/printly-staging-ef84b1ce0afef906decd?step=browser-env`, {
    headers: { 'x-printly-staging-probe': token }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Staging bootstrap returned ${response.status}`);
  credentials = await response.json();
  assert.equal(credentials.url, `https://${PROJECT}.supabase.co`);
  assert(credentials.anon && credentials.service, 'Staging keys unavailable');
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: credentials.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.anon,
    SUPABASE_SERVICE_ROLE_KEY: credentials.service,
    NEXT_PUBLIC_SITE_URL: base,
    NEXT_PUBLIC_DROPBOX_APP_KEY: '',
    VERCEL: '0', PRINTLY_TRUST_PROXY_IP: '1', NEXT_TELEMETRY_DISABLED: '1',
  };
  delete env.PRINTLY_STAGING_BROWSER_PROBE;
  phase = 'staging production build';
  await finished(child(['build'], env), 300_000);
  console.log('✓ Built the release application against isolated staging');
  phase = 'staging application startup';
  logs = '';
  server = child(['start','-H','127.0.0.1','-p','3131'], env);
  await ready(server);
  const document = await PDFDocument.create();
  document.addPage();
  let file = Buffer.from(await document.save());
  const size = 6 * 1024 * 1024 + 64 * 1024;
  file = Buffer.concat([file, Buffer.from('\n%'), Buffer.alloc(size - file.length - 2, 65)]);
  assert.equal((await PDFDocument.load(file)).getPageCount(), 1);

  phase = 'launching real Chromium';
  browser = await playwright.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args.filter((arg) => arg !== '--disable-web-security'),
    headless: true,
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  const apiFailures = [], cspViolations = [], storageMethods = [];
  page.on('console', (message) => { if (/content security policy/i.test(message.text())) cspViolations.push(message.text().slice(0,500)); });
  page.on('pageerror', (error) => { apiFailures.push(`page error: ${error.message}`); });
  page.on('response', (res) => { if (res.url().startsWith(`${base}/api/`) && res.status() >= 400) apiFailures.push(`${res.request().method()} ${new URL(res.url()).pathname}: ${res.status()}`); });
  page.on('request', (req) => { if (req.url().startsWith(`https://${PROJECT}.storage.supabase.co/storage/v1/upload/resumable/`)) storageMethods.push(req.method()); });
  await page.route(`${base}/**`, (route) => route.continue({ headers: { ...route.request().headers(), 'x-printly-client-ip': '127.0.0.1' } }));
  let failedOnce = false, signalPatch;
  const patchSeen = new Promise((resolve) => { signalPatch = resolve; });
  await page.route(`https://${PROJECT}.storage.supabase.co/storage/v1/upload/resumable/**`, async (route) => {
    if (!failedOnce && route.request().method() === 'PATCH') {
      failedOnce = true; signalPatch();
      await delay(1200);
      await route.abort('failed');
    } else await route.continue();
  });

  phase = 'staging shop and draft';
  const landing = await page.goto(`${base}/s/demo-prints/order`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  assert(landing && landing.status() === 200, 'Wizard did not load');
  assert((landing.headers()['content-security-policy'] || '').includes('https://*.supabase.co'), 'Expected CSP was not sent');
  await page.getByRole('button', { name: /^Print/ }).first().click();
  const orderResponse = page.waitForResponse((r) => r.url() === `${base}/api/orders` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const created = await orderResponse;
  assert.equal(created.status(), 200, 'Could not create synthetic staging draft');
  const { order_id: order } = await created.json();
  assert.match(order, /^[0-9a-f-]{36}$/);
  await page.getByRole('heading', { name: 'Add your files' }).waitFor();

  phase = 'real cross-origin TUS upload and recovery';
  const presigned = page.waitForResponse((r) => r.url() === `${base}/api/orders/${order}/files` && r.request().method() === 'POST');
  await page.locator('input[type=file]').setInputFiles({ name: 'staging-browser-probe.pdf', mimeType: 'application/pdf', buffer: file });
  const issued = await presigned;
  assert.equal(issued.status(), 200, 'Could not issue synthetic staging upload');
  const { path } = await issued.json();
  assert(path.startsWith(`${SHOP}/${order}/`), 'Unexpected staging object path');
  await Promise.race([patchSeen, delay(75_000).then(() => { throw new Error('No second upload chunk observed'); })]);
  assert(await page.getByRole('button', { name: /^Continue/ }).isDisabled(), 'Checkout was enabled during upload');
  await page.getByText('1 page · uploaded', { exact: true }).waitFor({ timeout: 120_000 });
  assert(failedOnce && storageMethods.filter((method) => method === 'POST').length === 1, 'The transfer did not retain the original upload');
  assert(storageMethods.includes('HEAD') && storageMethods.filter((method) => method === 'PATCH').length >= 2, 'The interrupted transfer did not resume');
  const admin = createClient(credentials.url, credentials.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const downloaded = await admin.storage.from('order-files').download(path);
  assert(!downloaded.error && downloaded.data, 'Could not download the synthetic object');
  assert(Buffer.from(await downloaded.data.arrayBuffer()).equals(file), 'Synthetic storage bytes did not match');
  assert.equal(cspViolations.length, 0, 'A browser CSP violation occurred');
  console.log(`✓ Chromium CSP/CORS, upload gating and forced resume: ${file.length} bytes matched`);

  phase = 'synthetic cash checkout and tracking';
  await page.getByRole('button', { name: /^Continue/ }).click();
  await page.getByRole('heading', { name: 'Options' }).waitFor();
  await page.getByRole('button', { name: 'Double (duplex)' }).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.getByRole('heading', { name: 'Almost there' }).waitFor();
  await page.getByPlaceholder('e.g. Aisha Khan').fill('Staging Browser Probe');
  await page.getByPlaceholder('97970 00000').fill('9999900000');
  await page.getByRole('button', { name: 'Cash at counter' }).click();
  const place = page.getByRole('button', { name: 'Place order (Cash on collection)' });
  await place.waitFor();
  for (let i = 0; i < 100 && await place.isDisabled(); i++) await delay(200);
  assert(!(await place.isDisabled()), 'Synthetic quote did not become available');
  const tracked = page.waitForResponse((r) => r.url() === `${base}/api/orders/${order}/track` && r.status() === 200, { timeout: 45_000 });
  await place.click();
  await page.waitForURL(`${base}/track/${order}`, { timeout: 45_000 });
  const track = await (await tracked).json();
  assert.equal(track?.track?.status, 'queued', 'Synthetic tracking state was incorrect');
  const saved = await admin.from('orders').select('status,payment_method,payment_status').eq('id', order).single();
  assert(!saved.error && saved.data.status === 'queued' && saved.data.payment_method === 'cod' && saved.data.payment_status === 'cod_pending', 'Synthetic checkout state was incorrect');
  assert.equal(apiFailures.length, 0, `Unexpected application failures: ${apiFailures.join(', ')}`);
  assert.equal(cspViolations.length, 0, 'A browser CSP violation occurred');
  console.log('✓ Synthetic duplex cash checkout and tracking reached the queued state');
  console.log('Temporary staging browser rehearsal passed.');
})().catch((error) => {
  console.error(`STAGING_BROWSER_PROBE_FAILED at ${phase}: ${clean(error?.message || error)}`);
  if (logs) console.error(clean(logs));
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(5000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
});
