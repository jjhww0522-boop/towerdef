import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';

const create = () => {
  const game = createGame({ playerIds: ['one', 'two'], seed: 9 });
  game.rules.summonCooldownTicks = 0; // Attack signals are independent of summon timing.
  return game;
};
function summon(game, player) {
  assert.equal(applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' }).ok, true);
  player.units[player.units.length - 1].slot = player.units.length - 1;
  return player.units[player.units.length - 1];
}
function enemy(game, hp) { return { id: game.nextEntityId++, hp, maxHp: hp, progress: 0, boss: false }; }

// Animation must observe a real server attack, not cooldown readiness or an input action.
test('new and idle units have no attack signal, including after upgrade input', () => {
  const game = create(), p = game.players[0], unit = summon(game, p);
  assert.equal(unit.lastAttackTick, null);
  assert.equal(unit.lastTargetId, null);
  assert.deepEqual(unit.lastAttackHits, []);
  for (let i = 0; i < 5; i++) tick(game);
  assert.equal(applyAction(game, p.id, { seq: p.lastSeq + 1, type: 'upgrade', tag: 'shu' }).ok, true);
  assert.equal(unit.lastAttackTick, null);
  assert.equal(unit.lastTargetId, null);
  assert.equal(unit.attackCooldownTicks, 0);
  const visible = publicState(game).players[0].units[0];
  assert.equal(visible.lastAttackTick, null);
  assert.equal(visible.lastTargetId, null);
  assert.deepEqual(visible.lastAttackHits, []);
  assert.equal(visible.attackCooldownTicks, 0);
});

test('real home attack records its target and tick, persists through cooldown, and updates next shot', () => {
  const game = create(), p = game.players[0], unit = summon(game, p);
  const target = enemy(game, 1);
  p.enemies.push(target);
  tick(game);
  assert.equal(unit.lastAttackTick, 1);
  assert.equal(unit.lastTargetId, target.id);
  assert.equal(p.enemies.length, 0);
  const cooldown = unit.attackCooldownTicks;
  const next = enemy(game, 999999);
  p.enemies.push(next);
  for (let i = 0; i < cooldown - 1; i++) tick(game);
  assert.equal(unit.lastAttackTick, 1);
  assert.equal(unit.lastTargetId, target.id);
  assert.equal(next.hp, next.maxHp);
  tick(game);
  assert.equal(unit.lastAttackTick, cooldown + 1);
  assert.equal(unit.lastTargetId, next.id);
  assert.ok(next.hp < next.maxHp);
  const visible = publicState(game).players[0].units[0];
  assert.equal(visible.lastAttackTick, unit.lastAttackTick);
  assert.equal(visible.lastTargetId, next.id);
  assert.equal(visible.attackCooldownTicks, unit.attackCooldownTicks);
});

test('story attack uses a wave-specific target and cannot emit phantom attacks after shared target dies', () => {
  const game = create(), p = game.players[0];
  const storyStart = (game.stories[0].wave - 1) * game.rules.waveTicks;
  game.tick = storyStart - 1; tick(game);
  const first = summon(game, p), second = summon(game, p);
  assert.equal(applyAction(game, p.id, { seq: p.lastSeq + 1, type: 'dispatch', unitIds: [first.id, second.id] }).ok, true);
  assert.equal(first.lastAttackTick, null);
  assert.equal(second.lastAttackTick, null);
  game.story.hp = 1;
  tick(game);
  assert.equal(game.story.status, 'success');
  assert.equal(first.lastAttackTick, storyStart + 1);
  assert.equal(first.lastTargetId, 'story:' + game.stories[0].wave);
  assert.equal(first.dispatched, false);
  assert.equal(second.lastAttackTick, null);
  assert.equal(second.lastTargetId, null);
  assert.deepEqual(first.lastAttackHits, [{ targetId: 'story:' + game.stories[0].wave, damage: 1, boss: true }]);
  assert.deepEqual(second.lastAttackHits, []);
  const visible = publicState(game).players[0].units[0];
  assert.equal(visible.lastTargetId, 'story:' + game.stories[0].wave);
});

test('defeated players do not advance their last attack signal', () => {
  const game = create(), p = game.players[0], unit = summon(game, p);
  p.enemies.push(enemy(game, 999999)); tick(game);
  assert.equal(unit.lastAttackTick, 1);
  const lastTick = unit.lastAttackTick, lastTarget = unit.lastTargetId;
  p.status = 'defeated';
  for (let i = 0; i < 20; i++) tick(game);
  assert.equal(unit.lastAttackTick, lastTick);
  assert.equal(unit.lastTargetId, lastTarget);
});

test('a combined unit starts without inherited ingredient attack signals', () => {
  const game = create(), p = game.players[0], recipe = content.recipes[0];
  p.units = recipe.ingredients.map((definitionId, slot) => ({ id: game.nextEntityId++, definitionId, slot,
    dispatched: false, attackCooldownTicks: 2, lastAttackTick: 42, lastTargetId: 123 }));
  const ids = p.units.map(unit => unit.id);
  assert.equal(applyAction(game, p.id, { seq: 1, type: 'combine', recipeId: recipe.id, unitIds: ids }).ok, true);
  assert.equal(p.units[0].lastAttackTick, null);
  assert.equal(p.units[0].lastTargetId, null);
  assert.deepEqual(p.units[0].lastAttackHits, []);
  assert.equal(p.units[0].attackCooldownTicks, 0);
});
