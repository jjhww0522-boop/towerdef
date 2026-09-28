import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../dist/server/core/index.js';
import protocol from '../dist/server/protocol.js';
import geometry from '../dist/shared/battle-geometry.js';
const { getBattlefieldLayout, enemyPoint, unitPoint } = geometry;

test('mobile snapshots publish only the six element upgrade levels', () => {
  const game = core.createGame({ playerIds: ['mobile'], battlefieldId: 1, seed: 27 });
  const upgrades = protocol.publicState(game).players[0].upgrades;
  assert.deepEqual(Object.keys(upgrades), ['fire', 'water', 'frost', 'wind', 'electric', 'laser']);
  assert.deepEqual(Object.values(upgrades), [0, 0, 0, 0, 0, 0]);
});

test('mobile content publishes the authoritative geometry including the tutorial without changing content rules', () => {
  assert.equal(typeof protocol.publicContent, 'function');
  const content = protocol.publicContent();
  assert.deepEqual(content.rules, core.content.rules);
  assert.deepEqual(content.units, core.content.units);
  assert.deepEqual(content.recipes, core.content.recipes);
  assert.deepEqual(content.battlefieldLayouts.map(layout => layout.battlefieldId), [0, ...core.content.battlefields.map(field => field.id)]);
  for (const layout of content.battlefieldLayouts) {
    assert.deepEqual(layout, { battlefieldId: layout.battlefieldId, ...getBattlefieldLayout(layout.battlefieldId) });
    for (let slot = 0; slot < layout.slots.length; slot++) assert.deepEqual(layout.slots[slot], unitPoint(slot, layout.battlefieldId));
  }
  assert.equal(content.battlefieldLayouts[0].facility, null);
  assert.equal(content.battlefieldLayouts[0].slots.length, 4);
  assert.equal(content.version, core.content.version);
});

test('a native consumer can place every route endpoint and bend from public content alone', () => {
  assert.equal(typeof protocol.publicContent, 'function');
  const content = JSON.parse(JSON.stringify(protocol.publicContent()));
  for (const layout of content.battlefieldLayouts) for (let index = 0; index < layout.routes.length; index++) {
    const route = layout.routes[index];
    let traveled = 0;
    for (let vertex = 0; vertex < route.points.length; vertex++) {
      if (vertex > 0) traveled += Math.hypot(route.points[vertex].x - route.points[vertex - 1].x, route.points[vertex].y - route.points[vertex - 1].y);
      const actual = enemyPoint(traveled / route.length, layout.battlefieldId, index);
      assert.ok(Math.abs(actual.x - route.points[vertex].x) < 1e-8);
      assert.ok(Math.abs(actual.y - route.points[vertex].y) < 1e-8);
    }
    assert.ok(route.length > 0);
  }
});

test('stage previews receive resolved rules instead of mistaking partial overrides for complete rules', () => {
  const content = protocol.publicContent();
  const first = content.battlefields[0], mining = content.battlefields[1];
  assert.ok(first.resolvedRules, 'resolved stage rules must be published');
  assert.equal((first.resolvedRules.waveTicks * first.resolvedRules.totalWaves + first.resolvedRules.bossTicks) / first.resolvedRules.ticksPerSecond, 180);
  assert.equal(mining.resolvedRules.waveTicks * mining.resolvedRules.totalWaves / mining.resolvedRules.ticksPerSecond, 240);
  assert.equal(first.rules.waveTicks, 100, 'raw content remains compatible with existing consumers');
  assert.equal(core.content.rules.waveTicks, 150, 'stage resolution cannot mutate global content');
});
