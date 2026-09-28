import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content, getUnitAttack } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { createDevServer } from '../tools/dev-server.mjs';

const elements = ['fire', 'water', 'frost', 'wind', 'electric', 'laser'];
const create = () => createGame({ playerIds: ['owner', 'peer'], seed: 42, practice: false });
const act = (game, tag, player = game.players[0]) => applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'upgrade', tag });
const effects = (game, player = game.players[0]) => structuredClone({ gold: player.gold, upgrades: player.upgrades,
  units: player.units, investmentActions: player.investmentActions, rng: game.rngState, entity: game.nextEntityId });
const definition = id => content.units.find(unit => unit.id === id);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function place(game, id) {
  const unit = { id: game.nextEntityId++, definitionId: id, slot: 0, dispatched: false, attackCooldownTicks: 0,
    lastAttackTick: null, lastTargetId: null, lastAttackHits: [], investedGold: 20 };
  game.players[0].units = [unit];
  return unit;
}
function attack(game, unit) {
  const target = { id: game.nextEntityId++, hp: 100000, maxHp: 100000, progress: 0, boss: false };
  game.players[0].enemies = [target]; unit.attackCooldownTicks = 0;
  tick(game);
  assert.equal(unit.lastAttackTick, game.tick);
  assert.equal(unit.lastAttackHits[0].targetId, target.id);
  return unit.lastAttackHits[0].damage;
}

test('new games and public snapshots expose exactly six zeroed element upgrades', () => {
  const game = create(), expected = Object.fromEntries(elements.map(element => [element, 0]));
  for (const player of game.players) assert.deepEqual(player.upgrades, expected);
  for (const player of publicState(game).players) assert.deepEqual(player.upgrades, expected);
  assert.deepEqual(JSON.parse(JSON.stringify(game)).players[0].upgrades, expected);
  assert.deepEqual(game.rules.upgradeCosts, [40, 60, 90, 130, 180]);
  assert.equal(game.rules.upgradeBonus, .1); assert.equal(game.rules.maxUpgradeLevel, 5);
});

test('a purchased fire level boosts real attacks from every fire tier including subsequently placed units only', () => {
  const game = create(), owner = game.players[0], peer = game.players[1], before = owner.gold;
  assert.deepEqual(act(game, 'fire'), { ok: true });
  assert.equal(owner.gold, before - 40);
  for (const id of ['fire_1', 'fire_2', 'fire_3', 'fire_4', 'water_1', 'frost_3', 'wind_4', 'electric_2', 'laser_4']) {
    const unit = place(game, id), data = definition(id), bonus = data.element === 'fire' ? 1.1 : 1;
    close(getUnitAttack(owner, unit, game.rules), data.attack * bonus);
    close(attack(game, unit), data.attack * bonus * (data.attackPattern === 'blast' ? .8 : 1));
    close(getUnitAttack(peer, unit, game.rules), data.attack);
  }
  assert.ok(Object.values(peer.upgrades).every(level => level === 0));
});

test('common S uses the largest purchased element level instead of summing families or selecting its visual element', () => {
  const game = create(), player = game.players[0]; player.gold = 10000;
  for (const [element, level] of [['fire', 2], ['water', 3], ['laser', 1]]) {
    for (let index = 0; index < level; index++) assert.deepEqual(act(game, element), { ok: true });
  }
  const unit = place(game, 'guardian_s'), base = definition('guardian_s').attack;
  close(getUnitAttack(player, unit, game.rules), base * 1.3);
  close(attack(game, unit), base * 1.3 * .8);
  for (let index = 0; index < 3; index++) assert.deepEqual(act(game, 'fire'), { ok: true });
  close(getUnitAttack(player, unit, game.rules), base * 1.5);
  close(attack(game, unit), base * 1.5 * .8);
});

test('element upgrades enforce each price, cap and sequence replay without charging twice', () => {
  const game = create(), player = game.players[0]; player.gold = 1000;
  let spent = 0;
  for (const [index, cost] of [40, 60, 90, 130, 180].entries()) {
    const packet = { seq: player.lastSeq + 1, type: 'upgrade', tag: 'water' };
    assert.deepEqual(applyAction(game, player.id, packet), { ok: true }); spent += cost;
    assert.equal(player.gold, 1000 - spent); assert.equal(player.upgrades.water, index + 1);
    const after = effects(game);
    assert.deepEqual(applyAction(game, player.id, packet), { ok: true }); assert.deepEqual(effects(game), after);
    assert.deepEqual(applyAction(game, player.id, { ...packet, tag: 'fire' }), { ok: false, error: 'SEQUENCE_REUSED' });
    assert.deepEqual(effects(game), after);
  }
  const capped = effects(game);
  assert.deepEqual(act(game, 'water'), { ok: false, error: 'UPGRADE_CAP' }); assert.deepEqual(effects(game), capped);
  player.gold = 39; const poor = effects(game);
  const denied = { seq: player.lastSeq + 1, type: 'upgrade', tag: 'fire' };
  assert.deepEqual(applyAction(game, player.id, denied), { ok: false, error: 'INSUFFICIENT_GOLD' });
  assert.deepEqual(effects(game), poor);
  player.gold = 40; const funded = effects(game);
  assert.deepEqual(applyAction(game, player.id, denied), { ok: false, error: 'INSUFFICIENT_GOLD' });
  assert.deepEqual(effects(game), funded);
  assert.deepEqual(act(game, 'fire'), { ok: true }); assert.equal(player.gold, 0);
});

test('retired faction troop and trait keys and malformed keys cannot mutate upgrades or resources', () => {
  const game = create(); game.players[0].gold = 10000;
  for (const tag of ['shu', 'wei', 'wu', 'infantry', 'archer', 'cavalry', 'might', 'strategy', 'command', '__proto__', 'constructor', '', null, 1]) {
    const before = effects(game);
    assert.deepEqual(act(game, tag), { ok: false, error: 'UNKNOWN_TAG' }, String(tag));
    assert.deepEqual(effects(game), before);
  }
});

test('HTTP accepts the element contract, publishes its level and replays a purchase without extra damage or spending', async t => {
  let room;
  const server = createDevServer({ automaticTicks: false, onRoomCreated: value => { room = value; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed; });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(path, body, token) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json',
      Origin: base, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  }
  const account = await request('/profile', {});
  const session = await request('/session', { roomId: 'upgrades', playerId: 'owner', profileToken: account.profileToken });
  const packet = { seq: 1, type: 'upgrade', tag: 'fire' };
  const bought = await request('/action', packet, session.token);
  assert.equal(bought.ok, true); assert.equal(bought.state.players[0].gold, 20);
  assert.deepEqual(bought.state.players[0].upgrades, { fire: 1, water: 0, frost: 0, wind: 0, electric: 0, laser: 0 });
  const replayed = await request('/action', packet, session.token);
  assert.deepEqual(replayed.state.players, bought.state.players);
  assert.equal(replayed.state.tick, bought.state.tick);
  const denied = await request('/action', { seq: 2, type: 'upgrade', tag: 'shu' }, session.token);
  assert.equal(denied.error, 'UNKNOWN_TAG'); assert.equal(denied.state.players[0].gold, 20);
  const unit = place(room.game, 'fire_1');
  close(attack(room.game, unit), definition('fire_1').attack * 1.1);
});
