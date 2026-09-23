import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { SLOT_COUNT, getBattlefieldLayout, unitPoint, enemyPoint, distanceSquared, projectPoint } from '../shared/battle-geometry.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const create = battlefieldId => createGame({ playerIds: ['owner', 'peer'], seed: 19, battlefieldId });

function introductoryEnemyPoint(progress) {
  let distance = ((progress % 1 + 1) % 1) * 1280;
  if (distance < 420) return { x: distance, y: 0, face: 1 };
  distance -= 420;
  if (distance < 220) return { x: 420, y: distance, face: 1 };
  distance -= 220;
  if (distance < 420) return { x: 420 - distance, y: 220, face: -1 };
  return { x: 0, y: 220 - (distance - 420), face: -1 };
}
function ready(game, player) { while (game.tick < player.nextSummonTick) tick(game); }

test('stage one starts with ten slots on a compact loop, including the loop seam', () => {
  assert.equal(SLOT_COUNT, 10);
  for (let index = 0; index < 10; index++) {
    const expected = { x: 50 + index % 5 * 80, y: 65 + Math.floor(index / 5) * 90 };
    assert.deepEqual(unitPoint(index), expected);
    assert.deepEqual(unitPoint(index, 1), expected);
  }
  for (const progress of [-1, -.01, 0, .1, 420 / 1280, 640 / 1280, 1060 / 1280, .9999, 1, 1.1]) {
    const expected = introductoryEnemyPoint(progress), actual = enemyPoint(progress);
    close(actual.x, expected.x); close(actual.y, expected.y); assert.equal(actual.face, expected.face);
  }
});

test('chapter one has distinct loop, vertical, horizontal, opposing and cross routes with legal slots', () => {
  assert.deepEqual(content.battlefields.map(stage => stage.id), [1, 2, 3, 4, 5]);
  assert.ok(content.battlefields.every(stage => stage.chapterId === 1 && stage.planetId === 'scrap'));
  const layouts = content.battlefields.map(stage => getBattlefieldLayout(stage.id));
  assert.deepEqual(layouts.map(layout => layout.slots.length), [10, 12, 14, 16, 20]);
  assert.deepEqual(layouts.map(layout => layout.routes.length), [1, 1, 1, 2, 4]);
  assert.equal(new Set(layouts.map(layout => JSON.stringify(layout.routes))).size, 5);
  assert.equal(new Set(layouts.map(layout => JSON.stringify(layout.slots))).size, 5);
  const areas = layouts.map(layout => layout.width * layout.height), lengths = layouts.map(layout => layout.routes.reduce((sum, route) => sum + route.length, 0));
  assert.deepEqual(lengths, [1280, 1360, 1550, 1740, 2520]);
  assert.ok(areas.every((area, index) => !index || area > areas[index - 1]));
  assert.ok(lengths.every((length, index) => !index || length > lengths[index - 1]));
  for (const [index, layout] of layouts.entries()) {
    assert.equal(layout.rotateInPortrait, index === 0);
    for (const [routeIndex, route] of layout.routes.entries()) {
      assert.equal(route.closed, index === 0);
      let walked = 0;
      for (let i = 0; i < route.points.length - (route.closed ? 0 : 1); i++) {
        const from = route.points[i], to = route.points[(i + 1) % route.points.length];
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        assert.ok(length > 0 && (from.x === to.x || from.y === to.y));
        const midpoint = enemyPoint((walked + length / 2) / route.length, index + 1, routeIndex);
        close(midpoint.x, (from.x + to.x) / 2); close(midpoint.y, (from.y + to.y) / 2);
        walked += length;
      }
      close(walked, route.length);
      if (!route.closed) {
        for (const progress of [-2, 0, 1, 2]) {
          const point = enemyPoint(progress, index + 1, routeIndex), endpoint = route.points[progress <= 0 ? 0 : route.points.length - 1];
          close(point.x, endpoint.x); close(point.y, endpoint.y);
        }
        const stop = route.points.at(-1), distance = Math.sqrt(distanceSquared(stop, layout.facility));
        assert.ok(distance >= 60 && distance <= 90, 'attackers stop in front of the facility, not on its body');
      }
    }
    for (const point of layout.slots) {
      assert.ok(point.x >= 0 && point.x <= layout.width && point.y >= 0 && point.y <= layout.height);
      if (layout.facility) assert.ok(distanceSquared(point, layout.facility) >= 90 ** 2, 'facility body stays clear of summon slots');
    }
  }
  assert.deepEqual(layouts[1].routes[0].points, [{ x: 300, y: 0 }, { x: 300, y: 1360 }]);
  assert.deepEqual(layouts[2].routes[0].points, [{ x: 0, y: 400 }, { x: 1550, y: 400 }]);
  assert.deepEqual(layouts[4].routes.map(route => route.points[0]), [{ x: 0, y: 720 }, { x: 1440, y: 720 }, { x: 720, y: 0 }, { x: 720, y: 1440 }]);
});

test('open routes retain their ingress direction after rotation; stage one keeps its introductory loop rotation', () => {
  const road = { left: 10, right: 210, top: 30, bottom: 430 };
  for (const id of [2, 3, 4, 5]) for (const point of getBattlefieldLayout(id).routes.flatMap(route => route.points)) {
    assert.deepEqual(projectPoint(point, road, true, id), projectPoint(point, road, false, id));
  }
  assert.deepEqual(projectPoint({ x: 0, y: 0 }, road, true), { x: 210, y: 30 });
  assert.deepEqual(projectPoint({ x: 0, y: 0 }, road, false), { x: 10, y: 30 });
});
test('each map fills its actual slots and combines at the chosen anchor without changing summon rules', () => {
  for (const stage of content.battlefields) {
    const game = create(stage.id), player = game.players[0], max = game.rules.maxUnits;
    assert.equal(max, getBattlefieldLayout(stage.id).slots.length);
    assert.deepEqual(game.rules.summonWeights, content.rules.summonWeights);
    assert.deepEqual(game.rules.summonRarities, content.rules.summonRarities);
    player.gold = 10000;
    for (let seq = 1; seq <= max; seq++) { ready(game, player); assert.equal(applyAction(game, player.id, { seq, type: 'summon' }).ok, true); }
    ready(game, player);
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
    for (let slot = 0; slot < Math.min(SLOT_COUNT, getBattlefieldLayout(id).slots.length) && !sample; slot++) {
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

test('new stages spawn a single boss at ten and fifteen minutes and defend their shared facility', () => {
  for (const [id, seconds] of [[4, 600], [5, 900]]) {
    const game = create(id), player = game.players[0];
    const deadline = game.rules.waveTicks * game.rules.totalWaves;
    assert.equal(deadline / game.rules.ticksPerSecond, seconds);
    assert.equal(game.objective.kind, 'engine');
    assert.equal(player.facilityHp, game.objective.facilityHp);
    game.tick = deadline - 1; tick(game);
    const state = publicState(game);
    assert.equal(state.battlefieldId, id);
    assert.equal(state.bossRemainingTicks, game.rules.bossTicks);
    assert.equal(player.status, 'active');
    const boss = player.enemies.find(enemy => enemy.boss);
    assert.ok(boss); assert.equal(player.enemies.filter(enemy => enemy.boss).length, 1); boss.hp = 1;
    applyAction(game, player.id, { seq: 1, type: 'summon' });
    const bossPoint = enemyPoint(boss.progress, id, boss.routeIndex);
    const slot = getBattlefieldLayout(id).slots.findIndex(point => distanceSquared(point, bossPoint) < 500 ** 2);
    assert.ok(slot >= 0);
    Object.assign(player.units[0], { definitionId: 'wei_archer', slot });
    tick(game); assert.equal(player.status, 'cleared');
    assert.equal(game.players[1].status, 'active', 'one lane clear never clears a teammate');
  }
  const final = create(5), player = final.players[0];
  player.facilityHp = final.objective.damage;
  player.enemies.push({ id: final.nextEntityId++, hp: 10000, maxHp: 10000, boss: false, progress: final.objective.arrivalProgress });
  tick(final); assert.equal(player.defeatReason, 'facility_destroyed');
});
