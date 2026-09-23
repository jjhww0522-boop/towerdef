import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { BOARD_WIDTH, BOARD_HEIGHT, getBattlefieldLayout, unitPoint, enemyPoint, distanceSquared } from '../shared/battle-geometry.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const create = battlefieldId => createGame({ playerIds: ['owner', 'peer'], seed: 19, battlefieldId });

function legacyEnemyPoint(progress) {
  let distance = ((progress % 1 + 1) % 1) * 1932;
  if (distance < 720) return { x: distance, y: 0, face: 1 };
  distance -= 720;
  if (distance < 246) return { x: 720, y: distance, face: 1 };
  distance -= 246;
  if (distance < 720) return { x: 720 - distance, y: 246, face: -1 };
  return { x: 0, y: 246 - (distance - 720), face: -1 };
}

test('stage one preserves every original slot and rectangle position, including the loop seam', () => {
  for (let index = 0; index < 30; index++) {
    const expected = { x: 98 + index % 10 * 60, y: 79 + Math.floor(index / 10) * 61 };
    assert.deepEqual(unitPoint(index), expected);
    assert.deepEqual(unitPoint(index, 1), expected);
  }
  for (const progress of [-1, -.01, 0, .1, 720 / 1932, 966 / 1932, 1686 / 1932, .9999, 1, 1.1]) {
    const expected = legacyEnemyPoint(progress), actual = enemyPoint(progress);
    close(actual.x, expected.x); close(actual.y, expected.y); assert.equal(actual.face, expected.face);
  }
});

test('chapter one has five distinct closed layouts with legal slots inside each route', () => {
  assert.deepEqual(content.battlefields.map(stage => stage.id), [1, 2, 3, 4, 5]);
  assert.ok(content.battlefields.every(stage => stage.chapterId === 1 && stage.planetId === 'scrap'));
  const layouts = content.battlefields.map(stage => getBattlefieldLayout(stage.id));
  assert.deepEqual(layouts.map(layout => layout.slots.length), [30, 28, 26, 22, 24]);
  assert.equal(new Set(layouts.map(layout => JSON.stringify(layout.route))).size, 5);
  assert.equal(new Set(layouts.map(layout => JSON.stringify(layout.slots))).size, 5);
  for (const layout of layouts) {
    let walked = 0;
    for (let i = 0; i < layout.route.length; i++) {
      const from = layout.route[i], to = layout.route[(i + 1) % layout.route.length];
      const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      assert.ok(length > 0 && (from.x === to.x || from.y === to.y));
      const midpoint = enemyPoint((walked + length / 2) / layout.length, layouts.indexOf(layout) + 1);
      close(midpoint.x, (from.x + to.x) / 2); close(midpoint.y, (from.y + to.y) / 2);
      walked += length;
    }
    close(walked, layout.length);
    for (const point of layout.slots) {
      assert.ok(point.x > 0 && point.x < BOARD_WIDTH && point.y > 0 && point.y < BOARD_HEIGHT);
      let inside = false;
      for (let i = 0, j = layout.route.length - 1; i < layout.route.length; j = i++) {
        const a = layout.route[i], b = layout.route[j];
        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      assert.equal(inside, true, 'summon slot must be inside its walkable loop');
    }
  }
});

test('each map fills its actual slots and combines at the chosen anchor without changing summon rules', () => {
  for (const stage of content.battlefields) {
    const game = create(stage.id), player = game.players[0], max = game.rules.maxUnits;
    assert.equal(max, getBattlefieldLayout(stage.id).slots.length);
    assert.deepEqual(game.rules.summonWeights, content.rules.summonWeights);
    assert.deepEqual(game.rules.summonRarities, content.rules.summonRarities);
    player.gold = 10000;
    for (let seq = 1; seq <= max; seq++) assert.equal(applyAction(game, player.id, { seq, type: 'summon' }).ok, true);
    assert.deepEqual(player.units.map(unit => unit.slot).sort((a, b) => a - b), Array.from({ length: max }, (_, i) => i));
    assert.equal(applyAction(game, player.id, { seq: max + 1, type: 'summon' }).error, 'UNIT_CAP');
    const recipe = content.recipes[0], anchor = player.units.find(unit => unit.slot === max - 1), other = player.units.find(unit => unit.slot === 0);
    anchor.definitionId = recipe.ingredients[0]; other.definitionId = recipe.ingredients[1];
    assert.equal(applyAction(game, player.id, { seq: max + 2, type: 'combine', recipeId: recipe.id, unitIds: [anchor.id, other.id] }).ok, true);
    assert.equal(player.units.at(-1).slot, max - 1);
    assert.equal(applyAction(game, player.id, { seq: max + 3, type: 'summon' }).ok, true);
    assert.equal(player.units.at(-1).slot, 0, 'only the consumed material slot was freed');
  }
});

test('server range checks use the selected map rather than the default rectangle', () => {
  const range = content.units.find(unit => unit.id === 'shu_guard').attackRange;
  for (const id of [2, 3, 4, 5]) for (const expectedHit of [true, false]) {
    let sample;
    for (let slot = 0; slot < getBattlefieldLayout(id).slots.length && !sample; slot++) {
      for (let step = 3; step < 80; step++) {
        const progress = step / 100;
        const actual = distanceSquared(unitPoint(slot, id), enemyPoint(progress, id));
        const legacy = distanceSquared(unitPoint(slot), enemyPoint(progress));
        if ((actual < (range - 1) ** 2 && legacy > (range + 1) ** 2 && expectedHit) ||
            (actual > (range + 1) ** 2 && legacy < (range - 1) ** 2 && !expectedHit)) {
          sample = { slot, progress }; break;
        }
      }
    }
    assert.ok(sample, `map ${id} needs a distinguishable range boundary`);
    const game = create(id), player = game.players[0];
    applyAction(game, player.id, { seq: 1, type: 'summon' });
    Object.assign(player.units[0], { definitionId: 'shu_guard', slot: sample.slot });
    const target = { id: game.nextEntityId++, hp: 10000, maxHp: 10000, boss: false, progress: sample.progress - game.rules.enemyProgressPerTick };
    player.enemies.push(target); tick(game);
    assert.equal(target.hp < target.maxHp, expectedHit, `map ${id}, slot ${sample.slot}`);
  }
});

test('new stages spawn bosses at ten and fifteen minutes and keep distinct defeat objectives', () => {
  for (const [id, seconds] of [[4, 600], [5, 900]]) {
    const game = create(id), player = game.players[0];
    const deadline = game.rules.waveTicks * game.rules.totalWaves;
    assert.equal(deadline / game.rules.ticksPerSecond, seconds);
    assert.equal(game.objective.kind, id === 4 ? 'overcrowd' : 'engine');
    assert.equal(player.facilityHp, id === 4 ? null : game.objective.facilityHp);
    game.tick = deadline - 1; tick(game);
    const state = publicState(game);
    assert.equal(state.battlefieldId, id);
    assert.equal(state.bossRemainingTicks, game.rules.bossTicks);
    assert.equal(player.status, 'active');
    const boss = player.enemies.find(enemy => enemy.boss);
    assert.ok(boss); boss.hp = 1;
    applyAction(game, player.id, { seq: 1, type: 'summon' });
    Object.assign(player.units[0], { definitionId: 'wei_archer', slot: 0 });
    tick(game); assert.equal(player.status, 'cleared');
    assert.equal(game.players[1].status, 'active', 'one lane clear never clears a teammate');
  }
  const final = create(5), player = final.players[0];
  player.facilityHp = final.objective.damage;
  player.enemies.push({ id: final.nextEntityId++, hp: 10000, maxHp: 10000, boss: false, progress: final.objective.arrivalProgress });
  tick(final); assert.equal(player.defeatReason, 'facility_destroyed');
});
