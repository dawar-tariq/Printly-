// Disposable LOCAL-ONLY Realtime/RLS exercise for the native Phoenix v2 wire
// format. No production credentials or data may be passed to this helper.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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

function subscribe(url, anonKey, accessToken, shop, events = ['INSERT', 'UPDATE']) {
  const endpoint = new URL('/realtime/v1/websocket', url);
  endpoint.protocol = 'ws:';
  endpoint.searchParams.set('apikey', anonKey);
  endpoint.searchParams.set('vsn', '2.0.0');
  const socket = new WebSocket(endpoint);
  const topic = `realtime:printly-orders:${shop || 'unfiltered'}`;
  const bindings = events.map((event) => ({
    event, schema: 'public', table: 'orders', ...(shop ? { filter: `shop_id=eq.${shop}` } : {}),
  }));
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
      if (confirmed.length !== bindings.length || confirmed.some((entry, index) =>
        entry.event !== bindings[index].event || entry.schema !== 'public' || entry.table !== 'orders' ||
        (entry.filter || '') !== (bindings[index].filter || '') || !Number.isInteger(entry.id))) { state.failed = true; return; }
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
  // A foreign owner can request this shop directly or omit the app's filter.
  const foreign = subscribe(origin, anonKey, otherToken, shop);
  const events = ['INSERT', 'UPDATE', 'DELETE'];
  const ownerUnfiltered = subscribe(origin, anonKey, ownerToken, null, events);
  const foreignUnfiltered = subscribe(origin, anonKey, otherToken, null, events);
  const anonymousUnfiltered = subscribe(origin, anonKey, anonKey, null, events);
  const subscribers = [owner, foreign, ownerUnfiltered, foreignUnfiltered, anonymousUnfiltered];
  const customer = createClient(origin.toString(), anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const topic = `printly-track:${createHash('sha256').update(orderId.toLowerCase()).digest('hex')}`;
  let customerReady = false; let unrelatedReady = false;
  const signals = []; const unrelatedSignals = [];
  const customerChannel = customer.channel(topic).on('broadcast', { event: 'changed' }, (message) => signals.push(message))
    .subscribe((status) => { if (status === 'SUBSCRIBED') customerReady = true; });
  const unrelatedChannel = customer.channel(`printly-track:${'a'.repeat(64)}`).on('broadcast', { event: 'changed' }, (message) => unrelatedSignals.push(message))
    .subscribe((status) => { if (status === 'SUBSCRIBED') unrelatedReady = true; });
  try {
    await until(() => subscribers.some((state) => state.failed) ||
      (subscribers.every((state) => state.joined && state.ready) && customerReady && unrelatedReady), 'subscriptions');
    assert(subscribers.every((state) => !state.failed), 'local Realtime subscription failed');
    const wrongNonce = `${guardNonce[0] === '0' ? '1' : '0'}${guardNonce.slice(1)}`;
    const wrongGuard = await admin.rpc('native_integration_unpublish_orders', { p_nonce: wrongNonce });
    assert.match(wrongGuard.error?.message || '', /INVALID_DISPOSABLE_STACK/, 'a wrong nonce must not change the publication');
    const deniedGuard = await customer.rpc('native_integration_unpublish_orders', { p_nonce: guardNonce });
    assert(deniedGuard.error, 'an anonymous client must not run the disposable-only publication helper');
    const anonymousOrders = await customer.from('orders').select('id').eq('id', orderId);
    assert(anonymousOrders.error || anonymousOrders.data?.length === 0, 'anonymous clients must not read order rows');
    const note = 'Synthetic private Realtime sentinel';
    const update = await admin.from('orders').update({ notes: note, eta_minutes: 37 }).eq('id', orderId).eq('shop_id', shop);
    assert(!update.error, 'synthetic local order update failed');
    const updateMatches = (event) => event?.type === 'UPDATE' && event?.record?.id === orderId;
    await until(() => owner.changes.some(updateMatches) && ownerUnfiltered.changes.some(updateMatches), 'authorized filtered and unfiltered updates');
    assert.equal(ownerUnfiltered.changes.find(updateMatches)?.record?.notes, note, 'positive control must include the synthetic private field');
    await until(() => signals.length > 0, 'customer tracking invalidation');
    const second = await admin.from('orders').update({ eta_minutes: 38 }).eq('id', orderId).eq('shop_id', shop);
    assert(!second.error, 'second synthetic local order update failed');
    await until(() => signals.length >= 2, 'second customer tracking invalidation');

    // Exercise INSERT as well as UPDATE with no business data or payment.
    const probe = randomUUID();
    const inserted = await admin.from('orders').insert({ id: probe, shop_id: shop, customer_name: 'Synthetic Realtime probe', notes: note });
    assert(!inserted.error, 'synthetic local insert failed');
    const insertMatches = (event) => event?.type === 'INSERT' && event?.record?.id === probe;
    await until(() => owner.changes.some(insertMatches) && ownerUnfiltered.changes.some(insertMatches), 'authorized filtered and unfiltered inserts');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    for (const state of [foreign, foreignUnfiltered, anonymousUnfiltered]) {
      assert(!state.changes.some((event) => updateMatches(event) || insertMatches(event)),
        'foreign and anonymous subscribers must not receive the synthetic INSERT/UPDATE');
    }
    assert.equal(unrelatedSignals.length, 0, 'a different tracking topic must not receive the event');

    // This is a diagnostic, not a cross-shop DELETE security assertion. RLS
    // handling of deletes differs from inserts/updates, and real deployments
    // can use different Realtime versions or replica identities. A positive
    // owner control and bounded wait make the observation useful, not proof.
    const deleted = await admin.from('orders').delete().eq('id', probe).eq('shop_id', shop);
    assert(!deleted.error, 'synthetic local delete failed');
    const deleteMatches = (event) => event?.type === 'DELETE' && event?.old_record?.id === probe;
    await until(() => ownerUnfiltered.changes.some(deleteMatches), 'unfiltered owner delete positive control');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const foreignDelete = foreignUnfiltered.changes.filter(deleteMatches);
    const anonymousDelete = anonymousUnfiltered.changes.filter(deleteMatches);
    for (const event of [...foreignDelete, ...anonymousDelete]) {
      assert.deepEqual(Object.keys(event.old_record).sort(), ['id'], 'unauthorized DELETE must not expose additional old-row fields');
      assert(!event.record || Object.keys(event.record).length === 0, 'unauthorized DELETE must not contain a new row');
      assert(!JSON.stringify(event).includes(note) && !JSON.stringify(event).includes('Synthetic Realtime probe'),
        'unauthorized DELETE must not expose the synthetic private values');
    }
    if (foreignDelete.length || anonymousDelete.length) {
      const message = `Local DELETE primary-key metadata observed by foreign=${foreignDelete.length > 0}, anonymous=${anonymousDelete.length > 0}; this is not an isolation pass.`;
      // An annotation exposes this security observation even when CI log
      // downloads are unavailable. It contains no IDs, tokens or row data.
      if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=Realtime DELETE security review required::${message}`);
      else console.warn(`SECURITY REVIEW REQUIRED: ${message}`);
    } else {
      const message = 'No foreign or anonymous DELETE was observed in the bounded local test; this is not proof of production isolation.';
      if (process.env.GITHUB_ACTIONS === 'true') console.log(`::notice title=Realtime DELETE diagnostic::${message}`);
      else console.log(`DIAGNOSTIC: ${message}`);
    }

    // Rehearse one possible stopgap on this disposable stack only. Removing
    // the table stops INSERT/UPDATE for legitimate Realtime consumers too;
    // the owner API and tracking broadcast must still work. The app's actual
    // phone polling and unknown third-party consumers need separate checks.
    const unpublished = await admin.rpc('native_integration_unpublish_orders', { p_nonce: guardNonce });
    assert(!unpublished.error && unpublished.data === true, 'local publication removal failed');
    const signalCount = signals.length;
    const afterRemoval = await admin.from('orders').update({ eta_minutes: 39 }).eq('id', orderId).eq('shop_id', shop);
    assert(!afterRemoval.error, 'synthetic update after local unpublish failed');
    await until(() => signals.length > signalCount, 'tracking invalidation after local unpublish');
    const endpoint = new URL('/rest/v1/orders', origin);
    endpoint.searchParams.set('select', 'id,eta_minutes');
    endpoint.searchParams.set('id', `eq.${orderId}`);
    const response = await fetch(endpoint, { headers: { apikey: anonKey, Authorization: `Bearer ${ownerToken}` }, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, 'authorized owner REST must remain available after local unpublish');
    const visible = await response.json();
    assert(visible.length === 1 && visible[0].id === orderId && visible[0].eta_minutes === 39,
      'authorized owner must be able to refresh the changed order');

    const secondProbe = randomUUID();
    const secondInsert = await admin.from('orders').insert({ id: secondProbe, shop_id: shop, customer_name: 'Synthetic unpublish probe' });
    assert(!secondInsert.error, 'synthetic insert after local unpublish failed');
    const secondDelete = await admin.from('orders').delete().eq('id', secondProbe).eq('shop_id', shop);
    assert(!secondDelete.error, 'synthetic delete after local unpublish failed');
    await new Promise((resolve) => setTimeout(resolve, 3500));
    for (const state of subscribers) {
      assert(!state.changes.some((event) => event?.record?.id === secondProbe || event?.old_record?.id === secondProbe ||
        (event?.type === 'UPDATE' && event?.record?.id === orderId && event?.record?.eta_minutes === 39)),
      'the removed orders publication must not emit the post-removal synthetic changes');
    }
    assert.equal(unrelatedSignals.length, 0, 'unrelated tracking topic must stay quiet after local unpublish');
    const mitigationMessage = 'On the disposable stack, removing orders from the publication stopped the observed events while owner REST and tracking broadcast still worked; legitimate order Realtime also stopped. Phone polling and other consumers were not tested.';
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::notice title=Local publication-removal rehearsal::${mitigationMessage}`);
    else console.log(`REHEARSAL: ${mitigationMessage}`);

    for (const signal of signals) {
      // realtime.send adds a fresh random message ID to the empty payload in
      // newer Supabase versions. No order fields or tracking ID may appear.
      const keys = Object.keys(signal.payload).sort();
      assert(keys.length === 0 || (keys.length === 1 && keys[0] === 'id'), 'customer broadcast must contain no order or customer fields');
      if (keys.length) assert.match(signal.payload.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert(!JSON.stringify(signal).includes(orderId), 'tracking ID must not be sent in the event');
    }
    if (signals[0].payload.id && signals[1].payload.id) assert.notEqual(signals[0].payload.id, signals[1].payload.id, 'message IDs must be fresh, not a stable order identifier');
    console.log('PASS: local filtered/unfiltered INSERT and UPDATE isolation; anonymous tracking invalidation contains no order data. DELETE is a separate diagnostic.');
  } finally {
    for (const state of subscribers) state.socket.close();
    await customer.removeChannel(customerChannel); await customer.removeChannel(unrelatedChannel);
  }
}
