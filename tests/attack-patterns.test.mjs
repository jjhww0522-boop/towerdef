import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content, getUnitAttack } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';

function setup(definitionId = 'shu_guard', slot = 3) {
  const game = createGame({ playerIds: ['one', 'two'], seed: 9 });
  game.rules.spawnIntervalTicks = game.rules.minSpawnIntervalTicks = 99999;
  const player = game.players[0];
  assert.equal(applyAction(game, player.id, { seq: 1, type: 'summon' }).ok, true);
  const unit = player.units[0];
  unit.definitionId = definitionId;
  unit.slot = slot;
  return { game, player, unit };
}
function addEnemy(game, player, progress, hp = 10000, boss = false) {
  const enemy = { id: game.nextEntityId++, hp, maxHp: hp, progress, boss };
  player.enemies.push(enemy);
  return enemy;
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('default bolt damages only the oldest enemy and publishes its real position and damage', () => {
  const { game, player, unit } = setup('shu_guard', 2);
  const oldest = addEnemy(game, player, 0.2), next = addEnemy(game, player, 0.21);
  assert.deepEqual(unit.lastAttackHits, []);
  tick(game);
  assert.equal(oldest.hp, oldest.maxHp - getUnitAttack(player, unit));
  assert.equal(next.hp, next.maxHp);
  assert.deepEqual(unit.lastAttackHits, [{ targetId: oldest.id, progress: oldest.progress, routeIndex: 0, damage: getUnitAttack(player, unit), boss: false }]);
  assert.deepEqual(publicState(game).players[0].units[0].lastAttackHits, unit.lastAttackHits);
});

test('blast uses circular proximity, the closest two neighbors, and never hits another lane', () => {
  const { game, player, unit } = setup('han_dang', 0);
  player.upgrades.wu = 2;
  const primary = addEnemy(game, player, 0.99);
  const farther = addEnemy(game, player, 0.04);
  const nearest = addEnemy(game, player, 0.98), acrossSeam = addEnemy(game, player, 0.015);
  const outside = addEnemy(game, player, 0.1);
  const peer = addEnemy(game, game.players[1], 0.99);
  const damage = getUnitAttack(player, unit);
  tick(game);
  assert.deepEqual(unit.lastAttackHits.map(hit => hit.targetId), [primary.id, nearest.id, acrossSeam.id]);
  close(primary.maxHp - primary.hp, damage * 0.8);
  for (const enemy of [nearest, acrossSeam]) close(enemy.maxHp - enemy.hp, damage * 0.45);
  for (const enemy of [farther, outside, peer]) assert.equal(enemy.hp, enemy.maxHp);
});

test('blast stops at its radius while arc chains from each previous hit and caps at three targets', () => {
  for (const definitionId of ['han_dang', 'lu_su']) {
    const { game, player, unit } = setup(definitionId, 0);
    const enemies = [1 - 140 / 1280, 0, 140 / 1280, 280 / 1280].map(progress => addEnemy(game, player, progress));
    const damage = getUnitAttack(player, unit);
    tick(game);
    if (definitionId === 'han_dang') {
      assert.equal(unit.lastAttackHits.length, 1);
      for (const enemy of enemies.slice(1)) assert.equal(enemy.hp, enemy.maxHp);
    } else {
      assert.deepEqual(unit.lastAttackHits.map(hit => hit.targetId), enemies.slice(0, 3).map(enemy => enemy.id));
      close(enemies[0].maxHp - enemies[0].hp, damage);
      close(enemies[1].maxHp - enemies[1].hp, damage * 0.45);
      close(enemies[2].maxHp - enemies[2].hp, damage * 0.25);
      assert.equal(enemies[3].hp, enemies[3].maxHp);
    }
  }
});

test('equal-distance chain candidates resolve by entity id and reproduce across copies', () => {
  const { game, player, unit } = setup('lu_su');
  const primary = addEnemy(game, player, 0.3);
  const first = addEnemy(game, player, 0.35), second = addEnemy(game, player, 0.35);
  player.enemies = [primary, second, first];
  const replay = JSON.parse(JSON.stringify(game));
  tick(game); tick(replay);
  assert.deepEqual(game, replay);
  assert.deepEqual(unit.lastAttackHits.map(hit => hit.targetId), [primary.id, first.id, second.id]);
});

test('multi-target kills clamp damage, award once per victim and retain positions after removal', () => {
  const { game, player, unit } = setup('han_dang');
  const victims = [0.3, 0.31, 0.32].map(progress => addEnemy(game, player, progress, 1));
  const gold = player.gold;
  tick(game);
  assert.equal(player.enemies.length, 0);
  assert.equal(player.kills, 3);
  assert.equal(player.gold, gold + game.rules.killGold * 3);
  assert.ok(victims.every(enemy => enemy.hp === 0));
  assert.deepEqual(unit.lastAttackHits, victims.map(enemy => ({ targetId: enemy.id, progress: enemy.progress, routeIndex: 0, damage: 1, boss: false })));
  const hits = structuredClone(unit.lastAttackHits), stamp = unit.lastAttackTick;
  tick(game);
  assert.deepEqual(unit.lastAttackHits, hits);
  while (unit.attackCooldownTicks > 0) tick(game);
  assert.deepEqual(unit.lastAttackHits, []);
  assert.equal(unit.lastAttackTick, stamp);
  assert.equal(player.kills, 3);
  assert.equal(player.gold, gold + game.rules.killGold * 3);
});

test('a boss killed by splash clears only its owner after all simultaneous kills are counted', () => {
  const { game, player, unit } = setup('salvage_colossus');
  addEnemy(game, player, 0.3, 1);
  const boss = addEnemy(game, player, 0.31, 1, true);
  addEnemy(game, player, 0.32, 1);
  const peer = addEnemy(game, game.players[1], 0.31, 1, true);
  tick(game);
  assert.equal(player.status, 'cleared');
  assert.equal(player.kills, 3);
  assert.equal(player.result.kills, 3);
  assert.equal(game.players[1].status, 'active');
  assert.equal(peer.hp, 1);
  assert.deepEqual(unit.lastAttackHits.find(hit => hit.targetId === boss.id), { targetId: boss.id, progress: boss.progress, routeIndex: 0, damage: 1, boss: true });
});

test('story uses the same primary multiplier, isolates home enemies, and input replays emit no hits', () => {
  for (const definitionId of ['shu_guard', 'han_dang', 'lu_su']) {
    const { game, player, unit } = setup(definitionId);
    const mission = game.stories[0];
    game.story = { wave: mission.wave, hp: 10000, maxHp: 10000, remainingTicks: 100, status: 'active' };
    const home = addEnemy(game, player, 0.2);
    const action = { seq: 2, type: 'dispatch', unitIds: [unit.id] };
    assert.equal(applyAction(game, player.id, action).ok, true);
    assert.equal(applyAction(game, player.id, action).ok, true);
    assert.deepEqual(unit.lastAttackHits, []);
    assert.equal(unit.lastAttackTick, null);
    const damage = getUnitAttack(player, unit) * (definitionId === 'han_dang' ? 0.8 : 1);
    tick(game);
    close(game.story.maxHp - game.story.hp, damage);
    assert.equal(home.hp, home.maxHp);
    assert.deepEqual(unit.lastAttackHits, [{ targetId: `story:${mission.wave}`, damage, boss: true }]);
    const recorded = structuredClone(unit.lastAttackHits);
    assert.equal(applyAction(game, player.id, action).ok, true);
    assert.deepEqual(unit.lastAttackHits, recorded);
    assert.equal(unit.lastAttackTick, game.tick);
  }
});

test('free legend and ultimate retain a primary damage-per-second gain over their recipe ingredients', () => {
  function primaryDps(definitionId) {
    const { game, player, unit } = setup(definitionId);
    addEnemy(game, player, 0.3, 100000);
    tick(game);
    const definition = content.units.find(unit => unit.id === definitionId);
    return unit.lastAttackHits[0].damage * game.rules.ticksPerSecond / definition.attackIntervalTicks;
  }
  for (const id of ['salvage_colossus', 'orbital_ark']) {
    const recipe = content.recipes.find(recipe => recipe.result === id);
    assert.ok(primaryDps(id) > recipe.ingredients.reduce((sum, ingredient) => sum + primaryDps(ingredient), 0));
  }
});
