import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recipeMaterials, evolutionOptions, theoreticalDps } from '../playtest/evolution-model.mjs';
import core from '../dist/server/core/index.js';

const content = JSON.parse(readFileSync('shared/content.json', 'utf8'));
const unit = (id, definitionId, dispatched = false) => ({ id, definitionId, dispatched });
const recipe = content.recipes.find(r => r.id === 'make_fire_2');
test('evolution consumes the clicked duplicate instance and exact other materials', () => {
  const units = [unit(1, 'fire_1'), unit(2, 'fire_1'), unit(3, 'fire_1')];
  const before = JSON.stringify(units);
  const choice = recipeMaterials(recipe, units, 2);
  assert.equal(choice.ready, true);
  assert.deepEqual(choice.ids, [2, 1, 3]);
  assert.equal(JSON.stringify(units), before);
});
test('missing, unrelated or dispatched focus cannot evolve even if other copies can', () => {
  const units = [unit(1, 'fire_1'), unit(2, 'fire_1', true), unit(3, 'fire_1'), unit(4, 'electric_1')];
  for (const focus of [2, 4, 999]) assert.equal(recipeMaterials(recipe, units, focus).ready, false);
  assert.equal(recipeMaterials(recipe, [unit(1, 'fire_1'), unit(3, 'fire_1', true)], 1).ready, false);
});
test('duplicate ingredients require distinct units and locked paths remain unavailable', () => {
  const double = { ingredients: ['fire_1', 'fire_1'], unlockBattlefield: 0 };
  assert.equal(recipeMaterials(double, [unit(1, 'fire_1')], 1).ready, false);
  assert.deepEqual(recipeMaterials(double, [unit(1, 'fire_1'), unit(2, 'fire_1')], 2).ids, [2, 1]);
  assert.equal(recipeMaterials({ ...double, unlockBattlefield: 1 }, [unit(1, 'fire_1'), unit(2, 'fire_1')], 1).ready, false);
});
test('only paths using the focused definition are shown, including missing branches', () => {
  const player = { units: [unit(1, 'frost_2')] };
  const options = evolutionOptions(content, player, 1);
  assert.deepEqual(options.map(o => o.recipe.result), ['frost_3']);
  assert.ok(options.every(o => !o.materials.ready));
  assert.deepEqual(evolutionOptions(content, player, 999), []);
});
test('displayed primary damage agrees with a real server attack for every robot and its upgrades', () => {
  for (const definition of content.units) {
    const game = core.createGame({ playerIds: ['p'], seed: 1 });
    const player = game.players[0]; player.upgrades.fire = 3; player.upgrades.laser = 2;
    core.applyAction(game, player.id, { seq: 1, type: 'summon' });
    player.units[0].definitionId = definition.id;
    player.units[0].slot = 0;
    player.enemies.push({ id: game.nextEntityId++, progress: 0, hp: 10000, maxHp: 10000, boss: true });
    core.tick(game);
    const applied = 10000 - player.enemies[0].hp;
    const expected = applied * game.rules.ticksPerSecond / definition.attackIntervalTicks;
    assert.ok(Math.abs(theoreticalDps(definition, player, game.rules) - expected) < 1e-8, definition.id);
  }
});

test('displayed DPS follows one element and common S follows the highest element without stacking', () => {
  const player = { upgrades: { fire: 0, water: 0, frost: 0, wind: 0, electric: 0, laser: 0 } };
  const fire = content.units.find(unit => unit.id === 'fire_1'), water = content.units.find(unit => unit.id === 'water_1');
  const guardian = content.units.find(unit => unit.id === 'guardian_s');
  const baseline = [fire, water, guardian].map(unit => theoreticalDps(unit, player, content.rules));
  assert.ok(baseline.every(Number.isFinite));
  player.upgrades.fire = 3;
  assert.equal(theoreticalDps(fire, player, content.rules), baseline[0] * 1.3);
  assert.equal(theoreticalDps(water, player, content.rules), baseline[1]);
  assert.equal(theoreticalDps(guardian, player, content.rules), baseline[2] * 1.3);
  player.upgrades.water = 2;
  assert.equal(theoreticalDps(guardian, player, content.rules), baseline[2] * 1.3);
});
