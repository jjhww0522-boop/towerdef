import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevServer } from '../tools/dev-server.mjs';
import { createProgressionStore } from '../tools/progression.mjs';
import { setConnection } from '../dist/server/core/index.js';

async function serve(t) {
  const rooms = [], store = createProgressionStore({ now: () => 1_800_000_000_000 });
  const server = createDevServer({ automaticTicks: false, progressionStore: store, onRoomCreated: room => rooms.push(room) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections(); await closed;
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (path, body, token) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { rooms, store, request };
}
const start = (request, account, roomId, extra = {}, token) => request('/session', {
  roomId, playerId: account.profile.id.replaceAll('-', ''), profileToken: account.profileToken, ...extra
}, token);

test('invalid room modes reject before room creation or engine consumption; old requests remain coop', async t => {
  const { rooms, store, request } = await serve(t);
  const account = (await request('/profile', {})).body;
  for (const mode of [null, true, 1, '', 'single', [], {}]) {
    const response = await start(request, account, 'invalid', { mode });
    assert.equal(response.status, 400); assert.equal(response.body.error, 'invalid_mode');
    assert.equal(store.getProfile(account.profile.id).engines.count, 5); assert.equal(rooms.length, 0);
  }
  const legacy = await start(request, account, 'legacy');
  assert.equal(legacy.status, 200); assert.equal(legacy.body.state.mode, 'coop');
  assert.equal(legacy.body.profile.engines.count, 4);
});

test('solo denies visitors and mismatched reconnects without charging; omitted-mode recovery preserves the room', async t => {
  const { rooms, store, request } = await serve(t);
  const host = (await request('/profile', {})).body, guest = (await request('/profile', {})).body;
  const joined = await start(request, host, 'personal', { mode: 'solo' });
  assert.equal(joined.status, 200);
  const first = joined.body;
  assert.equal(first.state.mode, 'solo'); assert.deepEqual(first.state.stories, []);
  assert.equal(first.profile.engines.count, 4);
  for (const extra of [{}, { mode: 'solo' }, { mode: 'coop' }]) {
    const denied = await start(request, guest, 'personal', extra);
    assert.equal(denied.status, 409);
    assert.equal(denied.body.error, extra.mode === 'coop' ? 'mode_mismatch' : 'solo_only');
    assert.equal(store.getProfile(guest.profile.id).engines.count, 5);
  }
  const wrong = await start(request, host, 'personal', { mode: 'coop' }, first.token);
  assert.equal(wrong.status, 409); assert.equal(wrong.body.error, 'mode_mismatch');
  assert.equal(store.getProfile(host.profile.id).engines.count, 4);
  const summon = await request('/action', { seq: 1, type: 'summon' }, first.token);
  assert.equal(summon.body.ok, true);
  setConnection(rooms[0].game, first.playerId, false);
  const recovered = await start(request, host, 'personal');
  assert.equal(recovered.status, 200); assert.equal(recovered.body.state.mode, 'solo');
  assert.equal(recovered.body.state.players[0].connected, true);
  assert.equal(recovered.body.state.players[0].lastSeq, 1);
  assert.deepEqual(recovered.body.state.players[0].units, summon.body.state.players[0].units);
  assert.equal(recovered.body.profile.engines.count, 4);
  assert.equal(recovered.body.state.expeditionId, first.state.expeditionId);
  assert.equal((await request('/state', undefined, first.token)).status, 401);
  assert.equal(rooms[0].game.players.length, 1);
  const left = await request('/action', { seq: 2, type: 'leave' }, recovered.body.token);
  assert.equal(left.body.state.players[0].result.mode, 'solo');
  assert.equal(left.body.profile.lastResult.mode, 'solo');
  const stats = left.body.profile.stats;
  const again = await request('/state', undefined, recovered.body.token);
  assert.deepEqual(again.body.profile.stats, stats, 'mode recording does not duplicate settlement');
});

test('cooperative room mode survives one-player waiting, invite, teammate leave and reconnect', async t => {
  const { rooms, store, request } = await serve(t);
  const host = (await request('/profile', {})).body, guest = (await request('/profile', {})).body;
  const first = (await start(request, host, 'shared', { mode: 'coop' })).body;
  assert.equal(first.state.mode, 'coop'); assert.equal(first.state.players.length, 1);
  assert.ok(first.state.stories.length > 0);
  const rejected = await start(request, guest, 'shared', { mode: 'solo' });
  assert.equal(rejected.status, 409); assert.equal(rejected.body.error, 'mode_mismatch');
  assert.equal(store.getProfile(guest.profile.id).engines.count, 5);
  const invited = await start(request, guest, 'shared');
  assert.equal(invited.status, 200); assert.equal(invited.body.state.mode, 'coop');
  assert.equal(invited.body.state.players.length, 2); assert.equal(invited.body.profile.engines.count, 4);
  await request('/action', { seq: 1, type: 'leave' }, invited.body.token);
  setConnection(rooms[0].game, first.playerId, false);
  const resumed = await start(request, host, 'shared', { mode: 'coop' });
  assert.equal(resumed.status, 200); assert.equal(resumed.body.state.mode, 'coop');
  assert.equal(resumed.body.state.players.filter(player => player.status === 'active').length, 1);
  assert.deepEqual(resumed.body.state.stories, first.state.stories);
  assert.equal(resumed.body.profile.engines.count, 4);
  assert.equal(resumed.body.state.expeditionId, first.state.expeditionId);
});

test('tutorial requests always create solo regardless of requested mode and never charge entry', async t => {
  const { request } = await serve(t);
  const account = (await request('/profile', {})).body;
  const joined = await start(request, account, 'tutorial-mode', { mode: 'coop', tutorial: true });
  assert.equal(joined.status, 200); assert.equal(joined.body.state.mode, 'solo');
  assert.deepEqual(joined.body.state.stories, []); assert.equal(joined.body.profile.engines.count, 5);
  const resumed = await start(request, account, 'tutorial-mode');
  assert.equal(resumed.body.state.mode, 'solo'); assert.equal(resumed.body.profile.engines.count, 5);
});
