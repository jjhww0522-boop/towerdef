import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { enemyPoint, unitPoint, distanceSquared, getBattlefieldLayout } from '../shared/battle-geometry.js';

const create = battlefieldId => createGame({ playerIds: ['owner', 'peer'], seed: 17, battlefieldId });
function target(game, player, routeIndex, progress, hp = 10000) {
  const enemy = { id: game.nextEntityId++, routeIndex, progress, hp, maxHp: hp, boss: false };
  player.enemies.push(enemy); return enemy;
}
function robot(game, id, slot) {
  const player = game.players[0];
  applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' });
  const unit = player.units.at(-1);
  Object.assign(unit, { definitionId: id, slot });
  return unit;
}

test('route cycling is player-local, fixed at spawn and independent of summon RNG and other departures', () => {
  for (const id of [4, 5]) {
    const a = create(id), b = create(id), routes = getBattlefieldLayout(id).routes.length;
    robot(b, 'wei_archer', 0).dispatched = true;
    applyAction(b, 'peer', { seq: 1, type: 'leave' });
    const before = [a.rngState, a.placementRngState, b.rngState, b.placementRngState];
    const spawnCount = 12, ticks = spawnCount * a.rules.spawnIntervalTicks;
    for (let i = 0; i < ticks; i++) { tick(a); tick(b); }
    const expected = Array.from({ length: spawnCount }, (_, i) => i % routes);
    assert.deepEqual(a.players[0].enemies.map(enemy => enemy.routeIndex), expected);
    assert.deepEqual(a.players[1].enemies.map(enemy => enemy.routeIndex), expected);
    assert.deepEqual(b.players[0].enemies.map(enemy => enemy.routeIndex), expected);
    assert.equal(a.players[0].enemies.length, spawnCount, 'multiple entrances divide rather than multiply spawns');
    assert.deepEqual([a.rngState, a.placementRngState, b.rngState, b.placementRngState], before);
    const survivor = a.players[0].enemies[1], routeIndex = survivor.routeIndex;
    a.players[0].enemies.shift();
    for (let i = 0; i < a.rules.spawnIntervalTicks; i++) tick(a);
    assert.equal(survivor.routeIndex, routeIndex);
    assert.equal(a.players[0].enemies.at(-1).routeIndex, spawnCount % routes);
    const view = publicState(a).players[0];
    assert.deepEqual(view.enemies.map(enemy => enemy.routeIndex), a.players[0].enemies.map(enemy => enemy.routeIndex));
    assert.equal('enemySpawnCount' in view, false);
  }
});

test('each open route has a bounded travel window and every entrance attacks the same facility', () => {
  for (const id of [2, 3, 4, 5]) {
    const game = create(id), player = game.players[0], count = getBattlefieldLayout(id).routes.length;
    assert.equal(game.objective.arrivalProgress, 1);
    const travelSeconds = Math.ceil(1 / game.rules.enemyProgressPerTick) / game.rules.ticksPerSecond;
    assert.ok(travelSeconds >= 28 && travelSeconds <= 46);
    game.rules.spawnIntervalTicks = game.rules.minSpawnIntervalTicks = 99999;
    const enemies = Array.from({ length: count }, (_, routeIndex) => target(game, player, routeIndex, .999));
    tick(game);
    assert.ok(enemies.every(enemy => enemy.progress === 1));
    assert.equal(player.facilityHp, game.objective.facilityHp - count * game.objective.damage);
    for (let i = 0; i < game.objective.attackIntervalTicks; i++) tick(game);
    assert.ok(enemies.every(enemy => enemy.progress === 1));
    assert.equal(player.facilityHp, game.objective.facilityHp - 2 * count * game.objective.damage);
    assert.equal(publicState(game).players[0].facilityAttackers, count);
    assert.equal(game.players[1].facilityHp, game.objective.facilityHp);
  }
});

test('primary targeting and hit telemetry use the fixed enemy route, including after death', () => {
  const game = create(4), player = game.players[0], unit = robot(game, 'shu_guard', 1);
  const left = target(game, player, 0, .3, 1), right = target(game, player, 1, .3, 1);
  tick(game);
  assert.equal(left.hp, 0); assert.equal(right.hp, 1);
  assert.deepEqual(unit.lastAttackHits.map(hit => [hit.targetId, hit.routeIndex]), [[left.id, 0]]);
  unit.attackCooldownTicks = 0; unit.slot = 6;
  tick(game);
  assert.equal(right.hp, 0);
  assert.deepEqual(publicState(game).players[0].units[0].lastAttackHits.map(hit => [hit.targetId, hit.routeIndex]), [[right.id, 1]]);
});

test('blast and arc do not connect distant entrances merely because progress matches', () => {
  for (const definitionId of ['han_dang', 'lu_su']) {
    const game = create(4), player = game.players[0], unit = robot(game, definitionId, 0);
    const primary = target(game, player, 0, .1), far = target(game, player, 1, .1), near = target(game, player, 0, .12);
    tick(game);
    assert.deepEqual(unit.lastAttackHits.map(hit => hit.targetId), [primary.id, near.id]);
    assert.equal(far.hp, far.maxHp);
  }
});

test('arc can cross nearby entrances at the facility using world distance; blast keeps its smaller reach', () => {
  for (const definitionId of ['han_dang', 'lu_su']) {
    const game = create(5), player = game.players[0], unit = robot(game, definitionId, 0);
    const left = target(game, player, 0, .99), right = target(game, player, 1, .99), top = target(game, player, 2, .99);
    tick(game);
    assert.deepEqual(unit.lastAttackHits.map(hit => hit.targetId), definitionId === 'lu_su' ? [left.id, top.id, right.id] : [left.id]);
    for (const hit of unit.lastAttackHits) assert.equal(hit.routeIndex, player.enemies.find(enemy => enemy.id === hit.targetId).routeIndex);
  }
});

test('every placement slot can attack at least one route even with the shortest fire range', () => {
  for (const id of [2, 3, 4, 5]) {
    const layout = getBattlefieldLayout(id);
    for (const [routeIndex] of layout.routes.entries()) {
      const endpoint = enemyPoint(1, id, routeIndex);
      assert.ok(layout.slots.some(point => distanceSquared(point, endpoint) < 160 ** 2), 'fire has a slot that can defend each endpoint');
    }
    for (const [slot, point] of layout.slots.entries()) {
      assert.deepEqual(unitPoint(slot, id), point);
      assert.ok(layout.routes.some((route, routeIndex) => Array.from({ length: 121 }, (_, i) => enemyPoint(i / 120, id, routeIndex)).some(enemy => distanceSquared(point, enemy) <= 160 ** 2)), 'no random slot makes a fire robot entirely inactive');
    }
  }
});
