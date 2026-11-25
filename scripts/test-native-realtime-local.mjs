// Disposable LOCAL-ONLY Realtime/RLS exercise for the native Phoenix v2 wire
// format. No production credentials or data may be passed to this helper.
import assert from 'node:assert/strict';

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
  try {
    await until(() => owner.failed || foreign.failed || (owner.joined && owner.ready && foreign.joined && foreign.ready), 'subscriptions');
    assert(!owner.failed && !foreign.failed, 'local Realtime subscription failed');
    const update = await admin.from('orders').update({ notes: 'Synthetic local Realtime test' }).eq('id', orderId).eq('shop_id', shop);
    assert(!update.error, 'synthetic local order update failed');
    await until(() => owner.changes.some((event) => event?.type === 'UPDATE' && event?.record?.shop_id === shop), 'authorized update');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(foreign.changes.length, 0, 'Realtime must not expose another shop’s order');
    console.log('PASS: local Realtime native protocol, shop filter, authenticated update, cross-shop RLS');
  } finally { owner.socket.close(); foreign.socket.close(); }
}
