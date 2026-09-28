import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import core from '../dist/server/core/index.js';
import { createDevServer } from '../tools/dev-server.mjs';

async function serve(t) {
  let room;
  const server = createDevServer({ automaticTicks: false, onRoomCreated: created => { room = created; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed; });
  const request = (path, body, token) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path,
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return { request, room: () => room };
}

test('HTTP publishes exact field mod contract, preserves owned choices on seat recovery, and rejects stale or altered selection', async t => {
  const { request, room } = await serve(t);
  const content = (await request('/content')).body;
  assert.equal(content.version, core.content.version);
  assert.deepEqual(content.fieldMods.map(mod => [mod.id, mod.condition, mod.bonus]), [
    ['tracker', 'controlled', .15], ['scatter', 'secondary', .2], ['opener', 'healthy', .1]
  ]);
  const account = (await request('/profile', {})).body;
  const admission = { roomId: 'mods', playerId: 'p', profileToken: account.profileToken,
    expectedServerInstanceId: content.serverInstanceId, contentVersion: content.version };
  const first = (await request('/session', admission)).body;
  const peer = (await request('/session', { roomId: 'mods', playerId: 'peer' })).body;
  const choose = { seq: 1, type: 'choose_mod', offerId: 'survey', modId: 'tracker' };
  room().game.tick = 400;
  const selected = (await request('/action', choose, first.token)).body;
  assert.equal(selected.ok, true);
  assert.deepEqual(Object.keys(selected.state.players[0].fieldMod).sort(), ['activeId', 'available', 'history', 'nextOfferTick', 'offerId', 'optionIds', 'stats']);
  assert.equal(selected.state.players[1].fieldMod.activeId, null);
  assert.equal(selected.profile.engines.count, 4);
  room().game.tick = 800;
  assert.equal((await request('/action', choose, first.token)).body.ok, true);
  assert.equal((await request('/action', { ...choose, modId: 'scatter' }, first.token)).body.error, 'SEQUENCE_REUSED');
  assert.equal((await request('/action', { ...choose, seq: 2 }, first.token)).body.error, 'STALE_MOD_OFFER');
  const resumed = (await request('/session', admission)).body;
  assert.equal((await request('/state', undefined, first.token)).status, 401);
  assert.equal(resumed.state.players[0].fieldMod.activeId, 'tracker');
  assert.equal(resumed.state.players[0].fieldMod.history.length, 1);
  const retuned = (await request('/action', { seq: 3, type: 'choose_mod', offerId: 'retune', modId: 'opener' }, resumed.token)).body;
  assert.equal(retuned.ok, true); assert.equal(retuned.state.players[0].fieldMod.activeId, 'opener');
  assert.equal(retuned.state.players[0].fieldMod.history.length, 2);
  assert.equal(retuned.state.players[1].fieldMod.activeId, null);
  assert.equal((await request('/state', undefined, peer.token)).body.players[1].fieldMod.activeId, null);
});

test('personal clear saves frozen actual field mod stats while the peer continues, without adding permanent profile power', async t => {
  const { request, room } = await serve(t);
  const account = (await request('/profile', {})).body;
  const session = (await request('/session', { roomId: 'result', playerId: 'p', profileToken: account.profileToken })).body;
  await request('/session', { roomId: 'result', playerId: 'peer' });
  const game = room().game, player = game.players[0];
  game.rules.spawnIntervalTicks = game.rules.minSpawnIntervalTicks = 99999;
  await request('/action', { seq: 1, type: 'summon' }, session.token);
  Object.assign(player.units[0], { definitionId: 'laser_1', slot: 2 });
  game.tick = 400; game.wave = 5;
  await request('/action', { seq: 2, type: 'choose_mod', offerId: 'survey', modId: 'opener' }, session.token);
  player.enemies = [{ id: game.nextEntityId++, hp: 1000, maxHp: 1000, progress: .2, boss: false }];
  core.tick(game);
  player.enemies = [{ id: game.nextEntityId++, hp: 1, maxHp: 1, progress: .2, boss: true }];
  player.units[0].attackCooldownTicks = 0; core.tick(game);
  assert.equal(player.status, 'cleared'); assert.equal(game.players[1].status, 'active');
  const terminal = (await request('/state', undefined, session.token)).body;
  const frozen = terminal.profile.lastResult.fieldMod;
  assert.equal(frozen.activeId, 'opener'); assert.equal(frozen.available, false);
  assert.equal(frozen.stats.find(stat => stat.modId === 'opener').hits, 1);
  assert.ok(frozen.stats.find(stat => stat.modId === 'opener').bonusDamage > 0);
  assert.equal(terminal.profile.fieldMod, undefined);
  assert.equal(terminal.profile.researchCredits, 0, 'choosing is not an investment action');
  game.tick = 800; core.tick(game);
  const later = (await request('/profile', undefined, account.profileToken)).body.profile;
  assert.deepEqual(later.lastResult.fieldMod, frozen);
  const serialized = JSON.parse(JSON.stringify(game));
  assert.deepEqual(serialized.players[0].result.fieldMod, frozen);
});
