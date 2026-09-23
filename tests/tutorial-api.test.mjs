import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../dist/server/core/index.js';
import { createDevServer } from '../tools/dev-server.mjs';
import { createProgressionStore } from '../tools/progression.mjs';

const START = 1_800_000_000_000;
async function serve(t, options = {}) {
  const rooms = [], store = options.progressionStore || createProgressionStore({ now: () => START });
  const server = createDevServer({ automaticTicks: false, ...options, progressionStore: store,
    onRoomCreated: room => rooms.push(room) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (!server.listening) return;
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
  return { store, rooms, request };
}
const start = (request, account, roomId, extra = {}) => request('/session', {
  roomId, playerId: 'player', profileToken: account.profileToken, tutorial: true, ...extra
});
const spendAll = (store, account) => {
  for (let index = 0; index < 5; index++) store.consumeEngine(account.profile.id, 'spent-' + index);
};
const step = (game, ticks) => { for (let index = 0; index < ticks; index++) core.tick(game); };

// Every tutorial action goes through HTTP. Only the server clock is advanced;
// no fixture sets a completion flag, boss health, reward or finished status.
async function complete(request, room, session) {
  let seq = session.state.players[0].lastSeq, state = session.state;
  const action = async (type, fields = {}) => {
    const response = await request('/action', { seq: ++seq, type, ...fields }, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true, JSON.stringify(response.body));
    state = response.body.state;
    return state;
  };
  await action('tutorial_next');
  await action('summon');
  const anchorId = state.tutorial.anchorUnitId;
  step(room.game, room.game.rules.summonCooldownTicks);
  await action('summon');
  step(room.game, 80);
  assert.equal(room.game.tutorial.step, 'inspect');
  await action('tutorial_next', { unitIds: [anchorId] });
  step(room.game, room.game.rules.summonCooldownTicks);
  await action('summon');
  assert.equal(state.tutorial.step, 'sell');
  await action('salvage', { unitIds: [state.tutorial.saleUnitId] });
  step(room.game, room.game.rules.summonCooldownTicks);
  await action('summon');
  const material = state.players[0].units.find(unit => unit.definitionId === 'wu_guard');
  await action('combine', { recipeId: 'make_cheng_yu', unitIds: [anchorId, material.id] });
  for (let index = 0; index < 600 && room.game.tutorial.step === 'counterattack'; index++) core.tick(room.game);
  assert.equal(room.game.tutorial.step, 'boss_ready');
  await action('tutorial_next');
  assert.equal(state.tutorial.step, 'countdown');
  const maximumTicks = 80 + room.game.rules.bossTicks;
  for (let index = 0; index < maximumTicks && room.game.status === 'playing'; index++) core.tick(room.game);
  assert.equal(room.game.players[0].status, 'cleared', 'the scripted roster must actually defeat its boss');
  const completed = await request('/state', undefined, session.token);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.tutorial.step, 'complete');
  return completed.body;
}

test('tutorial accepts an empty engine balance, stays isolated and never consumes an entry', async t => {
  const { request, store, rooms } = await serve(t);
  const account = (await request('/profile', {})).body;
  spendAll(store, account);
  const before = store.getProfile(account.profile.id);
  const joined = await start(request, account, 'free', { battlefieldId: 5, speed: 6, practice: false });
  assert.equal(joined.status, 200);
  const session = joined.body;
  assert.equal(session.state.battlefieldId, 0);
  assert.equal(session.state.practice, true); assert.equal(session.state.playbackSpeed, 1);
  assert.equal(session.state.rules.maxUnits, 3); assert.deepEqual(session.state.stories, []);
  assert.equal(session.state.tutorial.step, 'intro');
  assert.deepEqual(session.profile, before);
  assert.equal(rooms.length, 1);
  await request('/action', { seq: 1, type: 'leave' }, session.token);
  const ordinary = await start(request, account, 'normal-empty', { tutorial: false });
  assert.equal(ordinary.status, 409); assert.equal(ordinary.body.error, 'insufficient_engines');
  assert.equal(rooms.length, 1); assert.deepEqual(store.getProfile(account.profile.id), before);
});

test('normal entry and a normal-room invitation still consume an engine despite a tutorial flag', async t => {
  const { request, store, rooms } = await serve(t);
  const host = (await request('/profile', {})).body;
  const normal = await start(request, host, 'ordinary', { tutorial: false });
  assert.equal(normal.status, 200); assert.equal(normal.body.profile.engines.count, 4);
  assert.equal(normal.body.state.tutorial, null); assert.equal(normal.body.state.practice, false);
  const guest = (await request('/profile', {})).body;
  const invited = await start(request, guest, 'ordinary', { playerId: 'guest', battlefieldId: 0, tutorial: true });
  assert.equal(invited.status, 200); assert.equal(invited.body.profile.engines.count, 4);
  assert.equal(invited.body.state.tutorial, null); assert.equal(invited.body.state.battlefieldId, 1);
  const empty = (await request('/profile', {})).body;
  spendAll(store, empty);
  const rejected = await start(request, empty, 'ordinary', { playerId: 'empty', tutorial: true });
  assert.equal(rejected.status, 409); assert.equal(rejected.body.error, 'insufficient_engines');
  assert.equal(rooms[0].game.players.length, 2); assert.equal(store.getProfile(empty.profile.id).engines.count, 0);
});

test('tutorial is solo and its owner can recover the same progress at zero engines', async t => {
  const { request, store, rooms } = await serve(t);
  const account = (await request('/profile', {})).body, guest = (await request('/profile', {})).body;
  spendAll(store, account);
  const first = (await start(request, account, 'solo')).body;
  const progressed = await request('/action', { seq: 1, type: 'tutorial_next' }, first.token);
  assert.equal(progressed.body.state.tutorial.step, 'summon');
  const denied = await start(request, guest, 'solo', { playerId: 'guest', tutorial: false });
  assert.equal(denied.status, 409); assert.equal(denied.body.error, 'tutorial_solo');
  assert.equal(store.getProfile(guest.profile.id).engines.count, 5);
  const impostor = await start(request, guest, 'solo');
  assert.equal(impostor.status, 409); assert.equal(impostor.body.error, 'player_already_claimed');
  const same = await request('/session', { roomId: 'solo', playerId: 'player', profileToken: account.profileToken }, first.token);
  assert.equal(same.status, 200); assert.equal(same.body.token, first.token);
  const recovered = await start(request, account, 'solo', { tutorial: false });
  assert.equal(recovered.status, 200); assert.notEqual(recovered.body.token, first.token);
  assert.equal(recovered.body.state.expeditionId, first.state.expeditionId);
  assert.equal(recovered.body.state.tutorial.step, 'summon');
  assert.equal(recovered.body.state.players[0].lastSeq, 1);
  assert.equal(recovered.body.profile.engines.count, 0);
  assert.equal((await request('/state', undefined, first.token)).status, 401);
  assert.equal((await request('/state', undefined, recovered.body.token)).status, 200);
  assert.equal(rooms.length, 1); assert.equal(rooms[0].game.players.length, 1);
});

test('actual tutorial completion changes only tutorialCompleted and does not grant expedition rewards', async t => {
  const { request, store, rooms } = await serve(t);
  const account = (await request('/profile', {})).body;
  store.recordResult(account.profile.id, 'prior-clear', { battlefieldId: 1, status: 'cleared', cleared: true, researchCredits: 73 });
  spendAll(store, account);
  const before = store.getProfile(account.profile.id);
  const session = (await start(request, account, 'complete')).body;
  const state = await complete(request, rooms[0], session);
  assert.equal(state.players[0].result.cleared, true);
  assert.equal(state.players[0].result.researchCredits, 0);
  assert.deepEqual(state.profile, { ...before, tutorialCompleted: true });
  assert.deepEqual((await request('/profile', undefined, account.profileToken)).body.profile, state.profile);
  assert.equal(state.profile.engines.count, 0);
});

test('leaving a partially played tutorial neither completes it nor changes the profile', async t => {
  const { request, store, rooms } = await serve(t);
  const account = (await request('/profile', {})).body, before = store.getProfile(account.profile.id);
  const session = (await start(request, account, 'abandon')).body;
  assert.equal((await request('/action', { seq: 1, type: 'tutorial_next' }, session.token)).body.ok, true);
  assert.equal((await request('/action', { seq: 2, type: 'summon' }, session.token)).body.ok, true);
  const left = await request('/action', { seq: 3, type: 'leave' }, session.token);
  assert.equal(left.body.state.players[0].status, 'left');
  step(rooms[0].game, 1000);
  assert.deepEqual((await request('/state', undefined, session.token)).body.profile, before);
  assert.deepEqual((await request('/profile', undefined, account.profileToken)).body.profile, before);
  const ordinary = await start(request, account, 'after-abandon', { tutorial: false });
  assert.equal(ordinary.status, 200); assert.equal(ordinary.body.profile.engines.count, 4);
  assert.equal(ordinary.body.profile.tutorialCompleted, false);
});

test('repeated reads and separately replayed tutorials apply the completion flag only once', async t => {
  const store = createProgressionStore({ now: () => START }), settlements = [];
  const watchedStore = { ...store, completeTutorial(profileId) {
    const result = store.completeTutorial(profileId); settlements.push(result.applied); return result;
  } };
  const { request, rooms } = await serve(t, { progressionStore: watchedStore });
  const account = (await request('/profile', {})).body, before = store.getProfile(account.profile.id);
  for (let index = 0; index < 2; index++) {
    const session = (await start(request, account, 'replay-' + index)).body;
    const state = await complete(request, rooms[index], session);
    assert.deepEqual(state.profile, { ...before, tutorialCompleted: true });
    const reads = await Promise.all(Array.from({ length: 3 }, () => request('/state', undefined, session.token)));
    assert.ok(reads.every(response => response.status === 200));
    assert.ok(reads.every(response => response.body.profile.tutorialCompleted));
    assert.equal(settlements.length, index + 1, 'a settled room must not issue completion writes again');
  }
  assert.deepEqual(settlements, [true, false]);
  assert.deepEqual(store.getProfile(account.profile.id), { ...before, tutorialCompleted: true });
});