import test from 'node:test';
import { scriptedMatch } from '../tools/simulate.mjs';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, setConnection, content, getUnitAttack } from '../dist/server/core/index.js';

const game = (count = 4) => createGame({ playerIds: Array.from({ length: count }, (_, i) => `p${i}`), seed: 123 });
const step = (g, n) => { for (let i = 0; i < n; i++) tick(g); };
const give = (g, p, definitionId, slot = p.units.length) => {
  const unit = { id: g.nextEntityId++, definitionId, slot, dispatched: false, attackCooldownTicks: 0 };
  p.units.push(unit);
  return unit;
};
const enemy = (g, hp = 999999, boss = false) => ({ id: g.nextEntityId++, hp, maxHp: hp, progress: 0, boss });
const openStory = g => { g.tick = (g.stories[0].wave - 1) * g.rules.waveTicks - 1; tick(g); assert.equal(g.story?.status, 'active'); };

test('content has 29 valid units and 20 acyclic exact recipes including a free legend and ultimate', () => {
  assert.equal(content.units.length, 29);
  assert.equal(content.recipes.length, 20);
  const ids = content.units.map(u => u.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const u of content.units) {
    assert.ok(['shu', 'wei', 'wu'].includes(u.faction));
    assert.ok(['infantry', 'archer', 'cavalry'].includes(u.troop));
    assert.ok(['might', 'strategy', 'command'].includes(u.trait));
  }
  const ranks = { basic: 0, elite: 1, hero: 2, legend: 3 };
  for (const r of content.recipes) {
    const result = content.units.find(u => u.id === r.result);
    assert.ok(result);
    assert.ok(r.ingredients.length >= 2 && r.ingredients.length <= 3);
    for (const id of r.ingredients) assert.ok(ranks[content.units.find(u => u.id === id)?.rarity] < (result.tier === 'ultimate' ? 4 : ranks[result.rarity]));
    if (r.unlockBattlefield > 0) assert.equal(result.rarity, 'legend');
  }
});

test('same seed and actions reproduce a JSON serializable 8-lane simulation', () => {
  const a = game(8), b = game(8);
  for (const g of [a, b]) {
    for (const p of g.players) for (let seq = 1; seq <= 5; seq++) assert.equal(applyAction(g, p.id, { seq, type: 'summon' }).ok, true);
    step(g, 700);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
  assert.equal(a.players.length, 8);
});

test('summon costs are authoritative and duplicate sequences cannot spend twice', () => {
  const g = game(), p = g.players[0], before = p.gold;
  const action = { seq: 1, type: 'summon' };
  assert.deepEqual(applyAction(g, p.id, action), { ok: true });
  assert.deepEqual(applyAction(g, p.id, action), { ok: true });
  assert.equal(p.units.length, 1);
  assert.equal(p.gold, before - content.rules.summonCost);
  assert.equal(applyAction(g, p.id, { seq: 1, type: 'leave' }).ok, false);
  p.gold = 0;
  assert.equal(applyAction(g, p.id, { seq: 2, type: 'summon' }).ok, false);
  assert.equal(p.units.length, 1);
  assert.equal(p.lastSeq, 2);
  assert.equal(applyAction(g, p.id, action).ok, false);
});

test('malformed commands and unsupported tags cannot mutate resources', () => {
  const g = game(), p = g.players[0], before = p.gold;
  for (const action of [null, {}, { seq: NaN, type: 'summon' }, { seq: 0, type: 'summon' }, { seq: 1.2, type: 'summon' }]) assert.equal(applyAction(g, p.id, action).ok, false);
  assert.equal(applyAction(g, p.id, { seq: 1, type: 'upgrade', tag: '__proto__' }).ok, false);
  assert.equal(p.gold, before);
  assert.equal(applyAction(g, 'missing', { seq: 1, type: 'summon' }).ok, false);
});

test('summoning distribution matches 93/6.8/0.2 without legends', () => {
  const g = game(), p = g.players[0], counts = { basic: 0, elite: 0, hero: 0, legend: 0 };
  p.gold = 10000000;
  for (let seq = 1; seq <= 30000; seq++) {
    p.units = [];
    assert.equal(applyAction(g, p.id, { seq, type: 'summon' }).ok, true);
    counts[content.units.find(u => u.id === p.units[0].definitionId).rarity]++;
  }
  assert.ok(counts.basic / 30000 > .92 && counts.basic / 30000 < .94);
  assert.ok(counts.elite / 30000 > .06 && counts.elite / 30000 < .078);
  assert.ok(counts.hero > 35 && counts.hero < 90);
  assert.equal(counts.legend, 0);
});

test('combination atomically consumes only owned exact ingredients and reuses a slot', () => {
  const g = game(), p = g.players[0], recipe = content.recipes[0];
  const materials = recipe.ingredients.map((id, i) => give(g, p, id, i));
  const outsider = give(g, g.players[1], recipe.ingredients[0]);
  const snapshot = JSON.stringify(p.units);
  assert.equal(applyAction(g, p.id, { seq: 1, type: 'combine', recipeId: recipe.id, unitIds: [materials[0].id, outsider.id] }).ok, false);
  assert.equal(JSON.stringify(p.units), snapshot);
  assert.equal(applyAction(g, p.id, { seq: 2, type: 'combine', recipeId: recipe.id, unitIds: [materials[0].id, materials[0].id] }).ok, false);
  assert.equal(JSON.stringify(p.units), snapshot);
  assert.equal(applyAction(g, p.id, { seq: 3, type: 'combine', recipeId: recipe.id, unitIds: materials.map(u => u.id) }).ok, true);
  assert.equal(p.units.length, 1);
  assert.equal(p.units[0].definitionId, recipe.result);
  assert.equal(p.units[0].slot, 0);
  assert.equal(g.players[1].units.length, 1);
});

test('practice cannot craft locked legends even with exact materials', () => {
  const g = game(), p = g.players[0], r = content.recipes.find(r => r.unlockBattlefield > 0);
  const units = r.ingredients.map(id => give(g, p, id));
  assert.equal(applyAction(g, p.id, { seq: 1, type: 'combine', recipeId: r.id, unitIds: units.map(u => u.id) }).ok, false);
  assert.equal(p.units.length, r.ingredients.length);
});

test('three tag bonuses add and upgrades stop at five', () => {
  const g = game(), p = g.players[0], d = content.units[0], u = give(g, p, d.id);
  p.gold = 10000;
  let seq = 0;
  for (const tag of [d.faction, d.troop, d.trait]) {
    for (let n = 0; n < 5; n++) assert.equal(applyAction(g, p.id, { seq: ++seq, type: 'upgrade', tag }).ok, true);
    assert.equal(applyAction(g, p.id, { seq: ++seq, type: 'upgrade', tag }).ok, false);
  }
  assert.equal(getUnitAttack(p, u), d.attack * 2.5);
  assert.equal(p.gold, 10000 - 3 * content.rules.upgradeCosts.reduce((a, b) => a + b, 0));
});

test('a lane cannot attack another lane and overcrowding defeats only its owner after five seconds', () => {
  const g = game(), p = g.players[0], q = g.players[1];
  give(g, q, content.units.find(u => u.rarity === 'hero').id);
  p.enemies = Array.from({ length: 70 }, () => enemy(g));
  step(g, 49);
  assert.equal(p.status, 'active');
  assert.equal(p.enemies[0].hp, 999999);
  tick(g);
  assert.equal(p.status, 'defeated');
  assert.equal(p.defeatReason, 'overcrowded');
  assert.equal(q.status, 'active');
  assert.equal(g.status, 'playing');
});

test('falling below overcrowd threshold resets its consecutive timer', () => {
  const g = game(), p = g.players[0];
  p.enemies = Array.from({ length: 70 }, () => enemy(g));
  step(g, 40);
  p.enemies = [];
  tick(g);
  p.enemies = Array.from({ length: 70 }, () => enemy(g));
  step(g, 49);
  assert.equal(p.status, 'active');
});

test('story dispatch reserves capacity, excludes home combat, and returns on timeout', () => {
  const g = game(), p = g.players[0];
  openStory(g);
  const a = give(g, p, content.units[0].id), b = give(g, p, content.units[1].id);
  assert.equal(applyAction(g, p.id, { seq: 1, type: 'dispatch', unitIds: [a.id, b.id] }).ok, true);
  const c = give(g, p, content.units[2].id);
  assert.equal(applyAction(g, p.id, { seq: 2, type: 'dispatch', unitIds: [c.id] }).ok, false);
  p.enemies = [enemy(g)];
  c.attackCooldownTicks = 99999;
  const before = p.enemies[0].hp;
  g.story.remainingTicks = 1;
  tick(g);
  assert.equal(p.enemies[0].hp, before);
  assert.equal(g.story.status, 'failed');
  assert.equal(a.dispatched, false);
  assert.equal(a.slot, 0);
  assert.equal(b.slot, 1);
  assert.equal(p.status, 'active');
});

test('successful story returns all units and rewards every active player including disconnected peers', () => {
  const g = game();
  openStory(g);
  const p = g.players[0], unit = give(g, p, content.units[0].id);
  applyAction(g, p.id, { seq: 1, type: 'dispatch', unitIds: [unit.id] });
  setConnection(g, 'p1', false);
  g.players[2].status = 'defeated';
  g.players[3].status = 'left';
  const gold = g.players.map(p => p.gold);
  g.story.hp = 1;
  tick(g);
  assert.equal(g.story.status, 'success');
  assert.equal(unit.dispatched, false);
  assert.ok(p.gold > gold[0]);
  assert.equal(g.players[1].gold - gold[1], p.gold - gold[0]);
  assert.equal(g.players[2].gold, gold[2]);
  assert.equal(g.players[3].gold, gold[3]);
  const rewarded = p.gold;
  tick(g);
  assert.equal(p.gold, rewarded);
});

test('defeated players cease contributing to story before the defeat tick attack', () => {
  const g = game(), p = g.players[0];
  openStory(g);
  const u = give(g, p, content.units[0].id);
  applyAction(g, p.id, { seq: 1, type: 'dispatch', unitIds: [u.id] });
  p.enemies = Array.from({ length: 70 }, () => enemy(g));
  p.overcrowdedTicks = 49;
  const hp = g.story.hp;
  tick(g);
  assert.equal(p.status, 'defeated');
  assert.equal(p.defeatReason, 'overcrowded');
  assert.equal(g.story.hp, hp);
  assert.equal(u.dispatched, false);
});

test('dispatched units still occupy the summon cap and cannot be combined', () => {
  const g = game(), p = g.players[0], r = content.recipes[0];
  openStory(g);
  const units = r.ingredients.map(id => give(g, p, id));
  applyAction(g, p.id, { seq: 1, type: 'dispatch', unitIds: [units[0].id] });
  assert.equal(applyAction(g, p.id, { seq: 2, type: 'combine', recipeId: r.id, unitIds: units.map(u => u.id) }).ok, false);
  while (p.units.length < content.rules.maxUnits) give(g, p, content.units[0].id);
  assert.equal(applyAction(g, p.id, { seq: 3, type: 'summon' }).ok, false);
});

test('disconnect keeps autonomous combat, reconnects within grace, and expires independently', () => {
  const g = game(), p = g.players[0], u = give(g, p, content.units.find(u => u.rarity === 'hero').id);
  p.enemies = [enemy(g, 10)];
  setConnection(g, p.id, false);
  assert.equal(applyAction(g, p.id, { seq: 1, type: 'summon' }).ok, false);
  tick(g);
  assert.equal(p.enemies.length, 0);
  setConnection(g, p.id, true);
  assert.equal(p.connected, true);
  assert.equal(p.units[0], u);
  setConnection(g, p.id, false);
  g.tick = p.disconnectedAtTick + 1199;
  tick(g);
  assert.equal(p.status, 'active');
  tick(g);
  assert.equal(p.status, 'left');
  assert.equal(g.players[1].status, 'active');
  setConnection(g, p.id, true);
  assert.equal(p.connected, false);
});

test('24 waves lead to a boss with a 60 second deadline and independent clear', () => {
  const g = game(), p = g.players[0];
  g.tick = g.rules.waveTicks * g.rules.totalWaves - 1;
  tick(g);
  assert.equal(g.wave, 24);
  assert.equal(p.enemies.filter(e => e.boss).length, 1);
  const strong = give(g, p, content.units.find(u => u.rarity === 'hero').id);
  p.enemies = p.enemies.filter(e => e.boss);
  p.enemies[0].hp = 1;
  tick(g);
  assert.equal(p.status, 'cleared');
  assert.equal(strong.dispatched, false);
  assert.equal(g.players[1].status, 'active');
  g.tick = g.rules.waveTicks * g.rules.totalWaves + g.rules.bossTicks - 1;
  tick(g);
  assert.equal(g.players[1].status, 'defeated');
  assert.equal(g.players[1].defeatReason, 'boss_timeout');
  assert.equal(g.status, 'finished');
});

test('explicit leave does not terminate peers and cannot be undone', () => {
  const g = game();
  assert.equal(applyAction(g, 'p0', { seq: 1, type: 'leave' }).ok, true);
  assert.equal(g.players[0].status, 'left');
  assert.equal(g.status, 'playing');
  setConnection(g, 'p0', true);
  assert.equal(g.players[0].connected, false);
  assert.equal(applyAction(g, 'p0', { seq: 2, type: 'summon' }).ok, false);
});

test('learning-stage wave schedule opens three fixed-health stories and its configured evacuation boss', () => {
  const g = game(), opened = [];
  let previousStory = null;
  for (let t = 1; t <= g.rules.waveTicks * g.rules.totalWaves; t++) {
    for (const p of g.players) p.enemies = [];
    tick(g);
    assert.equal(g.wave, Math.min(g.rules.totalWaves, Math.floor(t / g.rules.waveTicks) + 1));
    if (g.story && g.story !== previousStory) {
      opened.push({ tick: t, wave: g.story.wave });
      previousStory = g.story;
      const mission = g.stories.find(s => s.wave === g.story.wave);
      assert.equal(g.story.maxHp, mission.hp);
    }
    if (g.story) {
      const openedAt = opened[opened.length - 1].tick;
      assert.equal(g.story.status, t - openedAt < 449 ? 'active' : 'failed');
    }
  }
  assert.deepEqual(opened, g.stories.map(s => ({ tick: (s.wave - 1) * g.rules.waveTicks, wave: s.wave })));
  assert.equal(g.players[0].enemies.length, 1);
  assert.equal(g.players[0].enemies[0].boss, true);
});

test('all four players dispatch two real units with owner upgrades and get their reserved slots back', () => {
  const g = game();
  openStory(g);
  const definition = content.units[0];
  let expectedDamage = 0;
  for (const [i, p] of g.players.entries()) {
    p.upgrades[definition.faction] = i;
    const a = give(g, p, definition.id, 4), b = give(g, p, definition.id, 9);
    expectedDamage += getUnitAttack(p, a) + getUnitAttack(p, b);
    assert.equal(applyAction(g, p.id, { seq: 1, type: 'dispatch', unitIds: [a.id, b.id] }).ok, true);
  }
  const hp = g.story.hp;
  tick(g);
  assert.ok(Math.abs(g.story.hp - (hp - expectedDamage)) < 1e-8);
  g.story.hp = 1;
  step(g, 10);
  assert.equal(g.story.status, 'success');
  for (const p of g.players) {
    assert.deepEqual(p.units.map(u => u.slot), [4, 9]);
    assert.ok(p.units.every(u => !u.dispatched));
  }
});

test('failed commands stay failed on replay even after resources arrive', () => {
  const g = game(), p = g.players[0];
  p.gold = 0;
  const action = { seq: 1, type: 'summon' };
  const failure = applyAction(g, p.id, action);
  p.gold = 500;
  assert.deepEqual(applyAction(g, p.id, action), failure);
  assert.equal(p.units.length, 0);
  assert.equal(p.gold, 500);
  assert.equal(applyAction(g, p.id, { seq: 2, type: 'summon' }).ok, true);
});

test('learning stage rewards an informed strategy and needs no researched blueprint', () => {
  const seeds = [1, 2, 3, 4, 5];
  const passive = scriptedMatch(4, 1, 'no-input', false);
  assert.equal(passive.cleared, 0);
  const summon = seeds.map(seed => scriptedMatch(4, seed, 'summon-only', false));
  const informed = seeds.map(seed => scriptedMatch(4, seed, 'dispatch', false));
  const clears = matches => matches.reduce((sum, match) => sum + match.cleared, 0);
  assert.ok(clears(informed) > clears(summon), 'Combining, upgrading and dispatching must outperform only summoning');
  assert.ok(clears(informed) > 0, 'Initial unlocked content must permit a real clear');
  for (const match of informed) {
    assert.equal(match.status, 'finished');
    assert.ok(match.players.every(player => !player.hasLockedRecipeUnit));
    for (const action of ['summon', 'combine', 'upgrade', 'dispatch']) assert.ok(match.successfulActions[action] > 0);
  }
});

test('reconnecting spectators preserves terminal results and cached commands cannot erase defeat reason', () => {
  const g = game(), defeated = g.players[0], cleared = g.players[1];
  const summon = { seq: 1, type: 'summon' };
  applyAction(g, defeated.id, summon);
  defeated.status = 'defeated';
  defeated.defeatReason = 'overcrowded';
  cleared.status = 'cleared';
  setConnection(g, defeated.id, false);
  setConnection(g, cleared.id, false);
  g.tick += content.rules.disconnectGraceTicks + 1;
  setConnection(g, defeated.id, true);
  setConnection(g, cleared.id, true);
  assert.equal(defeated.status, 'defeated');
  assert.equal(defeated.defeatReason, 'overcrowded');
  assert.equal(defeated.connected, true);
  assert.equal(cleared.status, 'cleared');
  assert.equal(cleared.defeatReason, null);
  assert.equal(cleared.connected, true);
  assert.deepEqual(applyAction(g, defeated.id, summon), { ok: true });
  assert.equal(defeated.status, 'defeated');
  assert.equal(defeated.defeatReason, 'overcrowded');
  assert.equal(defeated.units.length, 1);
});
