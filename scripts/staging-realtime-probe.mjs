// One-off, synthetic-only staging probe. It has no production or FCM access.
// The runner's ephemeral PGP public key is sent to the operator. A synthetic
// password is generated in the staging database and delivered encrypted over
// a public Realtime topic; neither the password nor JWT is logged or stored.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const SITE = 'https://printly-native-test.vercel.app';
const SUPABASE = 'https://rahfmpsdbwbktlobntkm.supabase.co';
const USER = '3049591d-5607-4a50-8c1d-d3fa8ee236e9';
const SHOP = '314cba6e-0f37-4508-ad71-1e16b2bab019';
const ORDER = 'd3f765af-e3a5-4379-80f3-86188be5b693';
const USER_B = 'b806a09c-299f-4393-8a7f-04535614e314';
const SHOP_B = 'afaaa660-70e3-4c97-a1b5-496b3c98ab35';
const ORDER_B = '3558a75d-0e2b-4d74-a4bf-317e4d76f9ce';
const OTHER_ORDER = '88372173-8d3f-49b1-aab1-c37a9b1ce12c';
const MARKER = '8bc0021a447ec7e4825d9c819d6465ea';
const EMAIL = `synthetic-realtime-${USER}@example.com`;
const EMAIL_B = `synthetic-realtime-${USER_B}@example.com`;
const directory = process.env.PRINTLY_STAGING_PROBE_DIR;
const runnerTemp = process.env.RUNNER_TEMP;
assert.equal(process.env.PRINTLY_STAGING_REALTIME_PROBE, '1');
assert(directory && runnerTemp && directory.startsWith(`${runnerTemp}/`));
const require = createRequire(`${runnerTemp}/printly-staging-probe-deps/package.json`);
const { createClient } = require('@supabase/supabase-js');
const mark = (name) => writeFileSync(join(directory, name), 'ok\n', { mode: 0o600 });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const trackingTopic = (id) => `printly-track:${createHash('sha256').update(id.toLowerCase()).digest('hex')}`;

async function until(predicate, label, timeout = 240_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error(label);
}

function subscribe(channel) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('channel_timeout')), 40_000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer); reject(new Error('channel_failed'));
      }
    });
  });
}

function decrypt(ciphertext) {
  return new Promise((resolve, reject) => {
    if (typeof ciphertext !== 'string' || ciphertext.length > 16_384 || !/^[A-Za-z0-9+/=\r\n]+$/.test(ciphertext)) {
      reject(new Error('invalid_ciphertext')); return;
    }
    const child = spawn('gpg', ['--batch', '--quiet', '--decrypt'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 1024) child.kill(); });
    child.on('error', () => reject(new Error('decrypt_failed')));
    child.on('close', (code) => {
      if (code !== 0 || !/^[a-f0-9]{64}$/.test(output)) reject(new Error('decrypt_failed'));
      else resolve(output);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(ciphertext, 'base64'));
  });
}

function ownerSubscription(apiKey, token, shop) {
  const endpoint = new URL('/realtime/v1/websocket', SUPABASE);
  endpoint.protocol = 'wss:';
  endpoint.searchParams.set('apikey', apiKey);
  endpoint.searchParams.set('vsn', '2.0.0');
  const socket = new WebSocket(endpoint);
  const topic = `realtime:printly-orders:${shop}`;
  const bindings = ['INSERT', 'UPDATE'].map((event) => ({ event, schema: 'public', table: 'orders', filter: `shop_id=eq.${shop}` }));
  const state = { socket, joined: false, ready: false, failed: false, ids: [], changes: [], confirmedChanges: [] };
  socket.addEventListener('open', () => socket.send(JSON.stringify(['1', '1', topic, 'phx_join', {
    config: { broadcast: { ack: false, self: false }, presence: { key: '', enabled: false }, postgres_changes: bindings, private: false },
    access_token: token,
  }])));
  socket.addEventListener('error', () => { state.failed = true; });
  socket.addEventListener('close', () => { if (!state.finished) state.failed = true; });
  socket.addEventListener('message', (message) => {
    let frame;
    try { frame = JSON.parse(String(message.data)); } catch { return; }
    if (!Array.isArray(frame) || frame[2] !== topic || !frame[4]) return;
    const event = frame[3], payload = frame[4];
    if (event === 'phx_reply' && frame[1] === '1') {
      const confirmed = payload.response?.postgres_changes;
      if (payload.status !== 'ok' || !Array.isArray(confirmed) || confirmed.length !== bindings.length ||
          confirmed.some((entry, i) => entry.event !== bindings[i].event || entry.schema !== 'public' ||
            entry.table !== 'orders' || entry.filter !== bindings[i].filter || !Number.isInteger(entry.id))) {
        state.failed = true; return;
      }
      state.ids = confirmed.map((entry) => entry.id); state.joined = true;
    }
    if (event === 'system' && payload.extension === 'postgres_changes') {
      if (payload.status === 'error') state.failed = true;
      if (payload.status === 'ok') state.ready = true;
    }
    if (event === 'postgres_changes') {
      // Count every frame on this topic for the negative isolation checks,
      // even one with an unexpected subscription ID.
      state.changes.push(payload.data);
      if (payload.ids?.some((id) => state.ids.includes(id))) state.confirmedChanges.push(payload.data);
    }
  });
  let heartbeat = 2;
  state.heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify([null, String(heartbeat++), 'phoenix', 'heartbeat', {}]));
  }, 20_000);
  return state;
}

async function main() {
  const diagnosticResponse = await fetch(`${SITE}/api/native/v1/test-environment`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!diagnosticResponse.ok) throw new Error('isolation_check_failed');
  const diagnostic = await diagnosticResponse.json();
  if (diagnostic.isolated_test !== true || diagnostic.supabase_url !== SUPABASE ||
      diagnostic.public_auth_check !== 'ok' || diagnostic.server_database_read !== 'ok') throw new Error('isolation_check_failed');
  const configResponse = await fetch(`${SITE}/api/native/v1/config`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!configResponse.ok) throw new Error('config_check_failed');
  const config = await configResponse.json();
  if (config.api_version !== 1 || config.supabase_url !== SUPABASE ||
      typeof config.supabase_anon_key !== 'string' || !config.supabase_anon_key.startsWith('sb_publishable_')) throw new Error('config_check_failed');
  const apiKey = config.supabase_anon_key;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const customer = createClient(SUPABASE, apiKey, options);
  const owner = createClient(SUPABASE, apiKey, options);
  const ownerB = createClient(SUPABASE, apiKey, options);
  const signals = [], unrelated = [], anonymousChanges = [];
  let provisioning;
  const control = customer.channel(`printly-synthetic-realtime:${MARKER}`)
    .on('broadcast', { event: 'provisioned' }, (message) => {
      if (message?.payload?.marker === MARKER && message.payload.version === 2 &&
          typeof message.payload.ciphertextA === 'string' && typeof message.payload.ciphertextB === 'string') provisioning = message.payload;
    });
  const tracking = customer.channel(trackingTopic(ORDER), { config: { private: false } })
    .on('broadcast', { event: 'changed' }, (message) => signals.push(message));
  const otherTracking = customer.channel(trackingTopic(OTHER_ORDER), { config: { private: false } })
    .on('broadcast', { event: 'changed' }, (message) => unrelated.push(message));
  const anonymousOrders = [SHOP, SHOP_B].map((shop, index) => customer.channel(`synthetic-anon:${MARKER}:${index}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `shop_id=eq.${shop}` }, (message) => anonymousChanges.push(message)));
  const sockets = [];
  try {
    await Promise.all([control, tracking, otherTracking, ...anonymousOrders].map(subscribe));
    mark('listening');
    await until(() => provisioning != null, 'provision_timeout');
    const password = await decrypt(provisioning.ciphertextA);
    const passwordB = await decrypt(provisioning.ciphertextB);
    const [signIn, signInB] = await Promise.all([
      owner.auth.signInWithPassword({ email: EMAIL, password }),
      ownerB.auth.signInWithPassword({ email: EMAIL_B, password: passwordB }),
    ]);
    if (signIn.error || signIn.data?.user?.id !== USER || !signIn.data.session?.access_token ||
        signInB.error || signInB.data?.user?.id !== USER_B || !signInB.data.session?.access_token) throw new Error('synthetic_signin_failed');
    const own = ownerSubscription(apiKey, signIn.data.session.access_token, SHOP);
    const foreign = ownerSubscription(apiKey, signIn.data.session.access_token, SHOP_B);
    const ownB = ownerSubscription(apiKey, signInB.data.session.access_token, SHOP_B);
    const foreignB = ownerSubscription(apiKey, signInB.data.session.access_token, SHOP);
    sockets.push(own, foreign, ownB, foreignB);
    await until(() => sockets.some((s) => s.failed) || sockets.every((s) => s.joined && s.ready), 'owner_subscribe_timeout', 40_000);
    if (sockets.some((s) => s.failed)) throw new Error('owner_subscribe_failed');
    mark('owner-ready');
    const sawUpdate = (state, order, shop, eta) => state.confirmedChanges.some((change) => change?.type === 'UPDATE' &&
      change?.record?.id === order && change.record.shop_id === shop && change.record.eta_minutes === eta);
    await until(() => sockets.some((s) => s.failed) || (signals.length > 0 && sawUpdate(own, ORDER, SHOP, 41) &&
      sawUpdate(ownB, ORDER_B, SHOP_B, 42)), 'update_timeout');
    if (sockets.some((s) => s.failed)) throw new Error('owner_socket_failed');
    // The two positive-control deliveries confirm that both changes reached
    // Realtime; leave all foreign/anonymous subscriptions open a little longer.
    await delay(6000);
    if (sockets.some((s) => s.failed)) throw new Error('owner_socket_failed');
    if (unrelated.length || anonymousChanges.length || foreign.changes.length || foreignB.changes.length) throw new Error('realtime_isolation_failed');
    for (const signal of signals) {
      const payload = signal?.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('tracking_payload_failed');
      const keys = Object.keys(payload).sort();
      if (!(keys.length === 0 || (keys.length === 1 && keys[0] === 'id'))) throw new Error('tracking_payload_failed');
      if (keys.length && !/^[0-9a-f-]{36}$/i.test(payload.id)) throw new Error('tracking_payload_failed');
      if (JSON.stringify(signal).includes(ORDER)) throw new Error('tracking_payload_failed');
    }
    const [ownRead, foreignRead, ownReadB, foreignReadB, anonRead, anonReadB] = await Promise.all([
      owner.from('orders').select('id').eq('id', ORDER),
      owner.from('orders').select('id').eq('id', ORDER_B),
      ownerB.from('orders').select('id').eq('id', ORDER_B),
      ownerB.from('orders').select('id').eq('id', ORDER),
      customer.from('orders').select('id').eq('id', ORDER),
      customer.from('orders').select('id').eq('id', ORDER_B),
    ]);
    if (ownRead.error || ownRead.data?.length !== 1 || ownRead.data[0].id !== ORDER ||
        ownReadB.error || ownReadB.data?.length !== 1 || ownReadB.data[0].id !== ORDER_B) throw new Error('owner_rls_failed');
    if (foreignRead.error || foreignRead.data?.length !== 0 || foreignReadB.error || foreignReadB.data?.length !== 0) throw new Error('foreign_rls_failed');
    if (anonRead.error || anonRead.data?.length !== 0 || anonReadB.error || anonReadB.data?.length !== 0) throw new Error('anonymous_rls_failed');
    if (sockets.some((s) => s.failed) || unrelated.length || anonymousChanges.length || foreign.changes.length || foreignB.changes.length) throw new Error('realtime_isolation_failed');
    console.log('PASS: two staging owners received own changes; foreign and anonymous listeners received none; tracking hint and wrong-topic isolation passed.');
    mark('passed');
  } finally {
    for (const socket of sockets) { socket.finished = true; clearInterval(socket.heartbeat); socket.socket.close(); }
    await Promise.all([owner, ownerB].map((client) => client.auth.signOut({ scope: 'local' }).catch(() => {})));
    await Promise.all([customer, owner, ownerB].map((client) => client.removeAllChannels().catch(() => {})));
  }
}

main().then(() => process.exit(0)).catch((error) => {
  const code = typeof error?.message === 'string' && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : 'unexpected_error';
  console.error(`STAGING_PROBE_FAILURE: ${code}`);
  try { writeFileSync(join(directory, 'failed'), `${code}\n`, { mode: 0o600 }); } catch {}
  process.exit(1);
});
