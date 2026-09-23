import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevServer } from '../tools/dev-server.mjs';
import { createProgressionStore, ENGINE_RECOVERY_MS, ProgressionError } from '../tools/progression.mjs';

const START = 1_800_000_000_000;
const verified = (profileId, overrides = {}) => ({ platform: 'apple', transactionId: 'verified-transaction',
  productId: 'engine_refill', profileId, status: 'purchased', ...overrides });
async function serve(t, options = {}) {
  const server = createDevServer({ automaticTicks: false, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (!server.listening) return;
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections(); await closed;
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  return async (path, body, token) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
}
const start = (request, account, roomId, extra = {}) => request('/session', {
  roomId, playerId: 'player', profileToken: account.profileToken, ...extra
});

test('default engine billing is authenticated, unavailable and immune to client balance claims', async t => {
  const store = createProgressionStore({ now: () => START });
  const request = await serve(t, { progressionStore: store });
  for (const [path, body] of [['/engine/store', undefined], ['/engine/refill', { engines: 999 }]]) {
    assert.equal((await request(path, body)).status, 401);
  }
  const account = (await request('/profile', { engines: { count: 999, nextRecoveryAt: 0 } })).body;
  assert.equal(account.profile.engines.count, 5);
  const session = (await start(request, account, 'billing')).body;
  assert.equal(session.profile.engines.count, 4);
  const catalog = await request('/engine/store', undefined, session.token);
  assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.body, { available: false, productId: 'engine_refill', kind: 'full_refill', reason: 'store_not_configured' });
  const response = await request('/engine/refill', { platform: 'apple', purchaseToken: 'client-claim',
    engines: 5, receipt: verified(account.profile.id), serverTime: START + ENGINE_RECOVERY_MS }, account.profileToken);
  assert.equal(response.status, 503); assert.equal(response.body.error, 'store_not_configured');
  assert.equal(store.getProfile(account.profile.id).engines.count, 4);
});

test('ordinary and both practice entry modes each cost one engine', async t => {
  const request = await serve(t);
  for (const [roomId, options, practice] of [['normal', { speed: 1 }, false], ['fast', { speed: 6 }, true],
    ['practice', { speed: 1, practice: true }, true]]) {
    const account = (await request('/profile', {})).body;
    const session = await start(request, account, roomId, options);
    assert.equal(session.status, 200);
    assert.equal(session.body.state.practice, practice);
    assert.equal(session.body.profile.engines.count, 4);
    assert.equal(session.body.state.profile.engines.count, 4);
  }
});

test('live seat recovery stays free at zero engines and revokes the lost session token', async t => {
  const store = createProgressionStore({ now: () => START });
  const request = await serve(t, { progressionStore: store });
  const account = (await request('/profile', {})).body;
  const first = (await start(request, account, 'reconnect')).body;
  for (let i = 0; i < 4; i++) store.consumeEngine(account.profile.id, 'other-fixture-' + i);
  assert.equal(store.getProfile(account.profile.id).engines.count, 0);
  const body = { roomId: 'reconnect', playerId: 'player', profileToken: account.profileToken };
  const same = await request('/session', body, first.token);
  assert.equal(same.status, 200); assert.equal(same.body.profile.engines.count, 0);
  assert.equal(same.body.state.expeditionId, first.state.expeditionId);
  const recovered = await request('/session', body);
  assert.equal(recovered.status, 200); assert.equal(recovered.body.profile.engines.count, 0);
  assert.equal(recovered.body.state.players.length, 1);
  assert.equal((await request('/state', undefined, first.token)).status, 401);
  assert.equal((await request('/state', undefined, recovered.body.token)).status, 200);
});

test('invalid and locked entry requests leave engines and rooms unchanged', async t => {
  const store = createProgressionStore({ now: () => START }), rooms = [];
  const request = await serve(t, { progressionStore: store, onRoomCreated: room => rooms.push(room) });
  const account = (await request('/profile', {})).body;
  for (const [input, error] of [[{ speed: 0 }, 'invalid_speed'], [{ practice: 'yes' }, 'invalid_practice'],
    [{ roomId: '../invalid' }, 'invalid_room_or_player_id'], [{ protocolVersion: '99' }, 'version_mismatch'],
    [{ battlefieldId: 0 }, 'invalid_battlefield'], [{ battlefieldId: 2 }, 'battlefield_locked'],
    [{ profileToken: 'wrong' }, 'profile_required']]) {
    const response = await start(request, account, 'rejected', input);
    assert.equal(response.body.error, error);
    assert.equal(store.getProfile(account.profile.id).engines.count, 5);
    assert.equal(rooms.length, 0);
  }
  const first = await start(request, account, 'accepted');
  assert.equal(first.status, 200);
  for (const [roomId, extra, error] of [['accepted', { playerId: 'duplicate' }, 'profile_already_in_room'],
    ['other', {}, 'profile_in_active_expedition']]) {
    assert.equal((await start(request, account, roomId, extra)).body.error, error);
    assert.equal(store.getProfile(account.profile.id).engines.count, 4);
  }
});

test('full rooms and the final-boss join cutoff reject a fresh guest without charging', async t => {
  const store = createProgressionStore({ now: () => START }), rooms = [];
  const request = await serve(t, { progressionStore: store, onRoomCreated: room => rooms.push(room) });
  for (let index = 0; index < 4; index++) {
    const account = (await request('/profile', {})).body;
    const joined = await start(request, account, 'party', { playerId: 'member-' + index });
    assert.equal(joined.status, 200); assert.equal(joined.body.profile.engines.count, 4);
  }
  const guest = (await request('/profile', {})).body;
  assert.equal((await start(request, guest, 'party', { playerId: 'guest' })).body.error, 'room_full_or_finished');
  assert.equal(store.getProfile(guest.profile.id).engines.count, 5);
  const host = (await request('/profile', {})).body;
  assert.equal((await start(request, host, 'late')).status, 200);
  const room = rooms.at(-1);
  room.game.tick = room.game.rules.waveTicks * room.game.rules.totalWaves;
  assert.equal((await start(request, guest, 'late', { playerId: 'guest' })).body.error, 'room_full_or_finished');
  assert.equal(store.getProfile(guest.profile.id).engines.count, 5);
  assert.equal(room.game.players.length, 1);
});

test('zero engines create no room and exact server-time recovery permits one entry', async t => {
  let time = START;
  const store = createProgressionStore({ now: () => time }), rooms = [];
  const request = await serve(t, { progressionStore: store, onRoomCreated: room => rooms.push(room) });
  const account = (await request('/profile', {})).body;
  for (let i = 0; i < 5; i++) store.consumeEngine(account.profile.id, 'spent-' + i);
  for (const nextTime of [START, START + ENGINE_RECOVERY_MS - 1]) {
    time = nextTime;
    const response = await start(request, account, 'empty', { engines: 5, serverTime: START + ENGINE_RECOVERY_MS });
    assert.equal(response.status, 409); assert.equal(response.body.error, 'insufficient_engines');
    assert.equal(rooms.length, 0);
  }
  time = START + ENGINE_RECOVERY_MS;
  const recovered = (await request('/profile', undefined, account.profileToken)).body.profile.engines;
  assert.equal(recovered.count, 1); assert.equal(recovered.serverTime, time);
  const admitted = await start(request, account, 'empty');
  assert.equal(admitted.status, 200); assert.equal(admitted.body.profile.engines.count, 0);
  assert.equal(admitted.body.profile.engines.nextRecoveryAt, START + 2 * ENGINE_RECOVERY_MS);
  assert.equal(rooms.length, 1);
});

test('concurrent duplicate admission and competing rooms each consume at most one engine', async t => {
  const store = createProgressionStore({ now: () => START }), rooms = [];
  const request = await serve(t, { progressionStore: store, onRoomCreated: room => rooms.push(room) });
  const account = (await request('/profile', {})).body;
  const copies = await Promise.all(Array.from({ length: 4 }, () => start(request, account, 'duplicates')));
  assert.ok(copies.every(response => response.status === 200));
  assert.equal(store.getProfile(account.profile.id).engines.count, 4);
  assert.equal(rooms.length, 1); assert.equal(rooms[0].game.players.length, 1);
  const other = (await request('/profile', {})).body;
  const competing = await Promise.all(['left', 'right'].map(roomId => start(request, other, roomId)));
  assert.equal(competing.filter(response => response.status === 200).length, 1);
  assert.equal(competing.find(response => response.status !== 200).body.error, 'profile_in_active_expedition');
  assert.equal(store.getProfile(other.profile.id).engines.count, 4);
  assert.equal(rooms.length, 2);
});

test('a rejected durable consume creates neither a new room nor an extra party member', async t => {
  const store = createProgressionStore({ now: () => START }), rooms = [];
  let rejectConsume = false;
  const guardedStore = { ...store, consumeEngine(...args) {
    if (rejectConsume) throw new ProgressionError('engine_write_unavailable', 503);
    return store.consumeEngine(...args);
  } };
  const request = await serve(t, { progressionStore: guardedStore, onRoomCreated: room => rooms.push(room) });
  const host = (await request('/profile', {})).body;
  await start(request, host, 'party');
  const guest = (await request('/profile', {})).body;
  rejectConsume = true;
  for (const roomId of ['new-room', 'party']) {
    const response = await start(request, guest, roomId, { playerId: 'guest' });
    assert.equal(response.status, 503);
    assert.equal(store.getProfile(guest.profile.id).engines.count, 5);
    assert.equal(rooms.length, 1); assert.equal(rooms[0].game.players.length, 1);
  }
  rejectConsume = false;
  const retry = await start(request, guest, 'party', { playerId: 'guest' });
  assert.equal(retry.status, 200); assert.equal(retry.body.profile.engines.count, 4);
  assert.equal(rooms[0].game.players.length, 2);
});

test('purchase verification receives server account binding and rejects malformed or unverified claims', async t => {
  const store = createProgressionStore({ now: () => START }), calls = [];
  let result = null, unavailable = false;
  const request = await serve(t, { progressionStore: store, verifyEnginePurchase: async input => {
    calls.push(input); if (unavailable) throw new Error('synthetic verifier outage'); return result;
  } });
  const account = (await request('/profile', {})).body;
  store.consumeEngine(account.profile.id, 'spent');
  assert.equal((await request('/engine/store', undefined, account.profileToken)).body.available, true);
  for (const body of [{}, { platform: 'web', purchaseToken: 'token' }, { platform: 'apple', purchaseToken: '' },
    { platform: 'apple', purchaseToken: [] }, { platform: 'apple', purchaseToken: 'x'.repeat(4097) }]) {
    assert.equal((await request('/engine/refill', body, account.profileToken)).status, 400);
  }
  assert.equal(calls.length, 0);
  const claim = { platform: 'apple', purchaseToken: 'opaque-purchase-token', profileId: 'forged-account',
    receipt: verified(account.profile.id), engines: 5 };
  for (const response of [null, verified(account.profile.id, { platform: 'google' }), verified('other-account'),
    verified(account.profile.id, { status: 'pending' }), verified(account.profile.id, { productId: 'wrong-product' }),
    verified(account.profile.id, { transactionId: '' })]) {
    result = response;
    const denied = await request('/engine/refill', claim, account.profileToken);
    assert.equal(denied.status, 400); assert.equal(denied.body.error, 'purchase_not_verified');
    assert.equal(store.getProfile(account.profile.id).engines.count, 4);
  }
  assert.deepEqual(calls[0], { platform: 'apple', purchaseToken: claim.purchaseToken, profileId: account.profile.id });
  unavailable = true;
  const failed = await request('/engine/refill', claim, account.profileToken);
  assert.equal(failed.status, 503); assert.equal(failed.body.error, 'purchase_verification_failed');
  assert.equal(store.getProfile(account.profile.id).engines.count, 4);
});

test('concurrent verified refills apply once and replay after spending or on another account cannot refill', async t => {
  const store = createProgressionStore({ now: () => START });
  let release, observed, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const allVerifying = new Promise(resolve => { observed = resolve; });
  const request = await serve(t, { progressionStore: store, verifyEnginePurchase: async input => {
    if (++calls === 3) observed();
    await gate;
    return verified(input.profileId);
  } });
  const account = (await request('/profile', {})).body;
  store.consumeEngine(account.profile.id, 'spent');
  const claim = { platform: 'apple', purchaseToken: 'verified-store-token' };
  const pending = Promise.all(Array.from({ length: 3 }, () => request('/engine/refill', claim, account.profileToken)));
  await allVerifying; release();
  const responses = await pending;
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(responses.filter(response => response.body.applied).length, 1);
  assert.equal(store.getProfile(account.profile.id).engines.count, 5);
  store.consumeEngine(account.profile.id, 'after-refill');
  const replay = await request('/engine/refill', claim, account.profileToken);
  assert.equal(replay.status, 200); assert.equal(replay.body.applied, false);
  assert.equal(replay.body.profile.engines.count, 4);
  const other = (await request('/profile', {})).body;
  store.consumeEngine(other.profile.id, 'other-spent');
  const stolen = await request('/engine/refill', claim, other.profileToken);
  assert.equal(stolen.status, 409); assert.equal(stolen.body.error, 'purchase_already_claimed');
  assert.equal(store.getProfile(other.profile.id).engines.count, 4);
});
