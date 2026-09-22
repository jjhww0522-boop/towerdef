import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { unitPoint, enemyPoint, distanceSquared, projectPoint } from '../shared/battle-geometry.js';
import { recipeMaterials } from '../playtest/evolution-model.mjs';

function setup(definitionId = 'shu_guard', slot = 5) {
  const game = createGame({ playerIds: ['one', 'two'], seed: 15 });
  game.rules.spawnIntervalTicks = game.rules.minSpawnIntervalTicks = 99999;
  const player = game.players[0];
  applyAction(game, player.id, { seq: 1, type: 'summon' });
  Object.assign(player.units[0], { definitionId, slot });
  return { game, player, unit: player.units[0] };
}
function enemy(game, player, progress, boss = false) {
  const enemy = { id: game.nextEntityId++, hp: 1e6, maxHp: 1e6, progress, boss };
  player.enemies.push(enemy);
  return enemy;
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('placement visits all empty slots without changing unit draws or leaking RNG state', () => {
  const a = createGame({ playerIds: ['p'], seed: 123 });
  const b = structuredClone(a); b.placementRngState = 87;
  const counts = Array(30).fill(0);
  for (let seq = 1; seq <= 6000; seq++) {
    for (const game of [a, b]) {
      const player = game.players[0]; player.units = []; player.gold = 100;
      assert.equal(applyAction(game, player.id, { seq, type: 'summon' }).ok, true);
    }
    assert.equal(a.players[0].units[0].definitionId, b.players[0].units[0].definitionId);
    counts[a.players[0].units[0].slot]++;
  }
  assert.ok(counts.every(count => count > 140 && count < 270), JSON.stringify(counts));
  assert.equal(a.rngState, b.rngState);
  assert.equal('placementRngState' in publicState(a), false);
});

test('summon preserves occupied and dispatched slots, respects the cap and retries exactly once', () => {
  const { game, player } = setup(); player.gold = 10000;
  player.units[0].dispatched = true;
  const reserved = player.units[0].slot;
  for (let seq = 2; seq <= 30; seq++) {
    const action = { seq, type: 'summon' };
    assert.equal(applyAction(game, player.id, action).ok, true);
    const rng = game.placementRngState, slot = player.units.at(-1).slot;
    assert.equal(applyAction(game, player.id, action).ok, true);
    assert.equal(game.placementRngState, rng);
    assert.equal(player.units.at(-1).slot, slot);
  }
  assert.equal(new Set(player.units.map(unit => unit.slot)).size, 30);
  assert.equal(player.units.filter(unit => unit.slot === reserved).length, 1);
  assert.equal(applyAction(game, player.id, { seq: 31, type: 'summon' }).error, 'UNIT_CAP');
});

test('either selected recipe ingredient anchors the result, even at a higher slot number', () => {
  for (const selectedIndex of [0, 1]) {
    const { game, player } = setup(), recipe = content.recipes[0];
    player.units = recipe.ingredients.map((definitionId, i) => ({ id: game.nextEntityId++, definitionId,
      slot: [26, 2][i], dispatched: false, attackCooldownTicks: 0, investedGold: 20 }));
    const focus = player.units[selectedIndex], materials = recipeMaterials(recipe, player.units, focus.id);
    const originalSlot = focus.slot;
    assert.equal(materials.ids[0], focus.id);
    assert.equal(applyAction(game, player.id, { seq: 2, type: 'combine', recipeId: recipe.id, unitIds: materials.ids }).ok, true);
    assert.equal(player.units.length, 1);
    assert.equal(player.units[0].slot, originalSlot);
    assert.equal(player.units[0].definitionId, recipe.result);
  }
});

test('fire waits for a target in range and can skip an older unreachable enemy', () => {
  const { game, player, unit } = setup();
  const far = enemy(game, player, .60);
  tick(game);
  assert.equal(unit.lastAttackTick, null);
  assert.equal(unit.attackCooldownTicks, 0);
  const near = enemy(game, player, .20);
  tick(game);
  assert.equal(unit.lastTargetId, near.id);
  assert.equal(far.hp, far.maxHp);
  assert.ok(near.hp < near.maxHp);
  const definition = content.units.find(d => d.id === unit.definitionId);
  assert.ok(distanceSquared(unitPoint(unit.slot), enemyPoint(near.progress)) <= definition.attackRange ** 2);
});

test('laser reaches farther than fire and damages only one enemy', () => {
  const { game, player, unit } = setup('wei_archer');
  const targets = [enemy(game, player, .6), enemy(game, player, .61)];
  tick(game);
  assert.equal(unit.lastAttackHits.length, 1);
  assert.equal(targets[1].hp, targets[1].maxHp);
  assert.ok(targets[0].hp < targets[0].maxHp);
  assert.ok(distanceSquared(unitPoint(unit.slot), enemyPoint(targets[0].progress)) > 160 ** 2);
});

test('frost slows normal enemies and bosses for exactly the configured duration', () => {
  for (const boss of [false, true]) {
    const { game, player } = setup('wei_guard');
    const target = enemy(game, player, .2, boss);
    tick(game);
    assert.equal(target.slowUntilTick, game.tick + game.rules.frostSlowTicks);
    assert.equal(publicState(game).players[0].enemies[0].slowed, true);
    player.units = [];
    const speed = game.rules.enemyProgressPerTick * (boss ? game.rules.bossSlowMultiplier : game.rules.frostSlowMultiplier);
    for (let i = 0; i < game.rules.frostSlowTicks; i++) {
      const before = target.progress; tick(game); close(target.progress - before, speed);
    }
    assert.equal(publicState(game).players[0].enemies[0].slowed, false);
    const before = target.progress; tick(game); close(target.progress - before, game.rules.enemyProgressPerTick);
  }
});

test('multiple frost hits refresh duration without multiplying the slowdown', () => {
  const { game, player, unit } = setup('wei_guard');
  player.units.push({ ...unit, id: game.nextEntityId++, slot: 4 });
  const target = enemy(game, player, .2);
  tick(game);
  const before = target.progress; tick(game);
  close(target.progress - before, game.rules.enemyProgressPerTick * game.rules.frostSlowMultiplier);
  assert.equal(target.slowUntilTick, 1 + game.rules.frostSlowTicks);
});

test('portrait rotates the same slot topology instead of dealing a new arrangement', () => {
  const road = { left: 72, right: 504, top: 126, bottom: 616 };
  const a = projectPoint(unitPoint(0), road, true), b = projectPoint(unitPoint(9), road, true);
  close(a.x, b.x); assert.ok(a.y < b.y);
  const c = projectPoint(unitPoint(10), road, true);
  close(a.y, c.y); assert.ok(c.x < a.x);
});
