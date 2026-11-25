// Synthetic-only native FCM registration/outbox exercise. No Google network
// request is made: CI uses a fake RSA identity, and never starts a scheduler.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function testNativePushLocal({ admin, ownerAuth, otherAuth, ownerToken, otherToken, shop, otherShop, otherUser, call, guardNonce }) {
  assert.equal(process.env.PRINTLY_DISPOSABLE_NATIVE_TEST, '1');
  assert.match(guardNonce || '', /^[a-f0-9]{64}$/);
  const guard = await admin.from('native_integration_guard').select('nonce').single();
  assert(!guard.error && guard.data?.nonce === guardNonce, 'refusing push writes without a matching disposable stack guard');
  const checked = (result, label) => {
    if (result.error) throw new Error(`${label} failed (${result.error.code || result.error.status || 'error'})`);
    return result.data;
  };
  const bindingA = randomUUID(), bindingB = randomUUID(), bindingC = randomUUID(), bindingD = randomUUID(), racingBinding = randomUUID();
  const fidA = 'A'.repeat(22), fidB = 'B'.repeat(22), racingFid = 'R'.repeat(22);
  const register = (token, shopId, binding, fid) => call('push-device', { method: 'POST', token, body: { shop_id: shopId, binding_id: binding, fid } });
  const remove = (token, binding) => call('push-device', { method: 'DELETE', token, body: { binding_id: binding } });
  assert.equal((await register(undefined, shop, bindingA, fidA)).status, 401);
  assert.equal((await register(otherToken, shop, bindingA, fidA)).status, 403);
  assert.equal((await register(ownerToken, shop, bindingA, 'bad')).status, 422);
  assert.equal((await register(ownerToken, shop, bindingA, fidA)).status, 200);
  assert.equal((await register(otherToken, otherShop, bindingB, fidB)).status, 200);
  assert.equal((await remove(otherToken, bindingA)).status, 200); // idempotent, cannot remove another user
  // A real Postgres race: either POST commits before DELETE and is removed,
  // or DELETE commits first and its tombstone rejects POST. Neither ordering
  // may leave a device that can receive an event after cleanup.
  const [racingRegistration, racingRemoval] = await Promise.all([
    register(ownerToken, shop, racingBinding, racingFid), remove(ownerToken, racingBinding),
  ]);
  assert([200, 409].includes(racingRegistration.status), 'concurrent registration must succeed or be revoked');
  assert.equal(racingRemoval.status, 200, 'concurrent revocation must succeed');
  assert.equal((await register(ownerToken, shop, racingBinding, racingFid)).status, 409, 'late registration remains revoked');
  for (const client of [ownerAuth, otherAuth]) {
    const table = await client.from('native_push_devices').select('*');
    const worker = await client.rpc('claim_native_push_deliveries', { p_limit: 10 });
    assert(table.error && worker.error, 'app clients must not read devices or run the worker');
  }
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  async function insert(id, shopId) {
    checked(await admin.from('orders').insert({ id, shop_id: shopId, status: 'queued', payment_method: 'cod', payment_status: 'cod_pending', customer_name: 'Private synthetic customer' }), 'insert local order');
  }
  const claim = async () => checked(await admin.rpc('claim_native_push_deliveries', { p_limit: 10 }), 'claim local push');
  await insert(ids[0], shop); await insert(ids[1], otherShop);
  const first = await claim();
  assert.equal(first.length, 2);
  assert(first.some((row) => row.binding_id === bindingA && row.fid === fidA && row.kind === 'order'));
  assert(first.some((row) => row.binding_id === bindingB && row.fid === fidB && row.kind === 'order'));
  assert(!JSON.stringify(first).includes('Private synthetic customer') && !JSON.stringify(first).includes(ids[0]));
  assert.equal((await claim()).length, 0, 'leased work cannot be claimed twice');
  const a = first.find((row) => row.binding_id === bindingA);
  const b = first.find((row) => row.binding_id === bindingB);
  assert.equal(checked(await admin.rpc('finish_native_push_delivery', { p_id: a.delivery_id, p_lease: randomUUID(), p_outcome: 'sent' }), 'stale lease'), 'unconfirmed');
  assert.equal(checked(await admin.rpc('finish_native_push_delivery', { p_id: a.delivery_id, p_lease: a.lease_token, p_outcome: 'sent' }), 'finish local push'), 'sent');
  assert.equal(checked(await admin.rpc('finish_native_push_delivery', { p_id: b.delivery_id, p_lease: b.lease_token, p_outcome: 'gone' }), 'remove unregistered local device'), 'gone');
  assert.equal((await remove(ownerToken, bindingA)).status, 200);
  await insert(ids[2], shop);
  assert.equal((await claim()).length, 0, 'signed-out phone receives no new delivery');
  // An older POST arriving after sign-out must not resurrect the revoked
  // binding. A new opt-in uses a fresh binding, even with the same FID.
  assert.equal((await register(ownerToken, shop, bindingA, fidA)).status, 409);
  assert.equal((await register(ownerToken, shop, bindingD, fidA)).status, 200);
  await insert(ids[3], shop);
  assert.equal((await register(otherToken, otherShop, bindingC, fidA)).status, 200);
  assert.equal((await claim()).length, 0, 'old account queue must not transfer with a phone');
  assert.equal((await register(ownerToken, shop, bindingA, fidA)).status, 409, 'late revoked POST must not take the new device back');
  await insert(ids[4], otherShop);
  const oldSend = (await claim())[0];
  assert.equal(oldSend.binding_id, bindingC);
  assert.equal((await register(otherToken, otherShop, bindingC, fidA)).status, 200);
  assert.equal(checked(await admin.rpc('finish_native_push_delivery', { p_id: oldSend.delivery_id, p_lease: oldSend.lease_token, p_outcome: 'gone' }), 'finish stale FCM response'), 'retry');
  checked(await admin.from('shop_staff').delete().eq('shop_id', otherShop).eq('user_id', otherUser), 'remove local membership');
  await insert(ids[5], otherShop);
  assert.equal((await claim()).length, 0, 'membership removal revokes the device');
  checked(await admin.from('shop_staff').insert({ shop_id: otherShop, user_id: otherUser, role: 'owner' }), 'restore local membership');
  checked(await admin.from('orders').delete().in('id', ids), 'remove synthetic orders');
  console.log('PASS: native FCM registration, shop isolation, private outbox, lease, sign-out and membership removal (no Firebase send)');
}
