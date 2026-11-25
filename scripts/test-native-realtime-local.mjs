// Disposable LOCAL-ONLY Realtime/RLS exercise for the native Phoenix v2 wire
// format. No production credentials or data may be passed to this helper.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function localOrigin(value) {
  const url = new URL(value || '');
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port &&
    !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
  'Realtime test requires disposable loopback Supabase');
  return url;
}

async function until(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for local Realtime ${label}`);
}

function subscribe(url, anonKey, accessToken, shop) {
  const endpoint = new URL('/realtime/v1/websocket', url);
  endpoint.protocol = 'ws:';
  endpoint.searchParams.set('apikey', anonKey);
  endpoint.searchParams.set('vsn', '2.0.0');
  const socket = new WebSocket(endpoint);
  const topic = `realtime:printly-orders:${shop}`;
  const bindings = ['INSERT', 'UPDATE'].map((event) => ({ event, schema: 'public', table: 'orders', filter: `shop_id=eq.${shop}` }));
  const state = { socket, joined: false, ready: false, failed: false, ids: [], changes: [] };
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify(['1', '1', topic, 'phx_join', {
      config: { broadcast: { ack: false, self: false }, presence: { key: '', enabled: false }, postgres_changes: bindings, private: false },
      access_token: accessToken,
    }]));
  });
  socket.addEventListener('error', () => { state.failed = true; });
  socket.addEventListener('message', (message) => {
    let frame;
    try { frame = JSON.parse(String(message.data)); } catch { return; }
    if (!Array.isArray(frame) || frame[2] !== topic || !frame[4]) return;
    const [,, , event, payload] = frame;
    if (event === 'phx_reply' && frame[1] === '1') {
      if (payload.status !== 'ok' || !Array.isArray(payload.response?.postgres_changes)) { state.failed = true; return; }
      const confirmed = payload.response.postgres_changes;
      if (confirmed.length !== 2 || confirmed.some((entry, index) =>
        entry.event !== bindings[index].event || entry.schema !== 'public' || entry.table !== 'orders' ||
        entry.filter !== bindings[index].filter || !Number.isInteger(entry.id))) { state.failed = true; return; }
      state.ids = confirmed.map((entry) => entry.id); state.joined = true;
    }
    if (event === 'system' && payload.extension === 'postgres_changes') {
      if (payload.status === 'error') state.failed = true;
      if (payload.status === 'ok') state.ready = true;
    }
    if (event === 'postgres_changes' && payload.ids?.some((id) => state.ids.includes(id))) state.changes.push(payload.data);
  });
  return state;
}

export async function testNativeRealtimeLocal({ supabaseUrl, anonKey, admin, ownerToken, otherToken, shop, orderId, guardNonce }) {
  assert.equal(process.env.PRINTLY_DISPOSABLE_NATIVE_TEST, '1', 'explicit disposable-test opt-in is required');
  const origin = localOrigin(supabaseUrl);
  assert.match(guardNonce || '', /^[a-f0-9]{64}$/, 'per-run disposable stack guard required');
  const guard = await admin.from('native_integration_guard').select('nonce').single();
  assert(!guard.error && guard.data?.nonce === guardNonce, 'refusing realtime writes without the matching disposable stack guard');
  assert.match(shop, /^[0-9a-f-]{36}$/i); assert.match(orderId, /^[0-9a-f-]{36}$/i);
  const owner = subscribe(origin, anonKey, ownerToken, shop);
  // An authenticated owner from another shop maliciously asks for this shop.
  const foreign = subscribe(origin, anonKey, otherToken, shop);
  const customer = createClient(origin.toString(), anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const topic = `printly-track:${createHash('sha256').update(orderId.toLowerCase()).digest('hex')}`;
  let customerReady = false; let unrelatedReady = false;
  const signals = []; const unrelatedSignals = [];
  const customerChannel = customer.channel(topic).on('broadcast', { event: 'changed' }, (message) => signals.push(message))
    .subscribe((status) => { if (status === 'SUBSCRIBED') customerReady = true; });
  const unrelatedChannel = customer.channel(`printly-track:${'a'.repeat(64)}`).on('broadcast', { event: 'changed' }, (message) => unrelatedSignals.push(message))
    .subscribe((status) => { if (status === 'SUBSCRIBED') unrelatedReady = true; });
  try {
    await until(() => owner.failed || foreign.failed || (owner.joined && owner.ready && foreign.joined && foreign.ready && customerReady && unrelatedReady), 'subscriptions');
    assert(!owner.failed && !foreign.failed, 'local Realtime subscription failed');
    const anonymousOrders = await customer.from('orders').select('id').eq('id', orderId);
    assert(anonymousOrders.error || anonymousOrders.data?.length === 0, 'anonymous clients must not read order rows');
    const update = await admin.from('orders').update({ notes: 'Synthetic local Realtime test', eta_minutes: 37 }).eq('id', orderId).eq('shop_id', shop);
    assert(!update.error, 'synthetic local order update failed');
    await until(() => owner.changes.some((event) => event?.type === 'UPDATE' && event?.record?.shop_id === shop), 'authorized update');
    await until(() => signals.length > 0, 'customer tracking invalidation');
    const second = await admin.from('orders').update({ eta_minutes: 38 }).eq('id', orderId).eq('shop_id', shop);
    assert(!second.error, 'second synthetic local order update failed');
    await until(() => signals.length >= 2, 'second customer tracking invalidation');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(foreign.changes.length, 0, 'Realtime must not expose another shop’s order');
    assert.equal(unrelatedSignals.length, 0, 'a different tracking topic must not receive the event');
    for (const signal of signals) {
      // realtime.send adds a fresh random message ID to the empty payload in
      // newer Supabase versions. No order fields or tracking ID may appear.
      const keys = Object.keys(signal.payload).sort();
      assert(keys.length === 0 || (keys.length === 1 && keys[0] === 'id'), 'customer broadcast must contain no order or customer fields');
      if (keys.length) assert.match(signal.payload.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert(!JSON.stringify(signal).includes(orderId), 'tracking ID must not be sent in the event');
    }
    if (signals[0].payload.id && signals[1].payload.id) assert.notEqual(signals[0].payload.id, signals[1].payload.id, 'message IDs must be fresh, not a stable order identifier');
    console.log('PASS: local owner Realtime and cross-shop RLS; anonymous tracking invalidation contains no order data');
  } finally {
    owner.socket.close(); foreign.socket.close();
    await customer.removeChannel(customerChannel); await customer.removeChannel(unrelatedChannel);
  }
}
