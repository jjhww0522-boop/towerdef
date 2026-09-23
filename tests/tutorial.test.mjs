import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content, expeditionProgress } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { getBattlefieldLayout, unitPoint, distanceSquared } from '../shared/battle-geometry.js';

const create = (seed = 42) => createGame({ playerIds: ['p'], seed, tutorial: true, practice: false });
const player = game => game.players[0];
const act = (game, type, extra = {}) => applyAction(game, 'p', { seq: player(game).lastSeq + 1, type, ...extra });
function accepted(game, type, extra = {}) { assert.deepEqual(act(game, type, extra), { ok: true }); }
function draw(game) {
  while (game.tick < player(game).nextSummonTick) tick(game);
  accepted(game, 'summon'); return player(game).units.at(-1);
}
function fill(game) {
  accepted(game, 'tutorial_next'); const anchor = draw(game);
  accepted(game, 'tutorial_next', { unitIds: [anchor.id] });
  const support = draw(game), sale = draw(game);
  return { anchor, support, sale };
}
function materials(game) {
  const units = fill(game); accepted(game, 'salvage', { unitIds: [units.sale.id] });
  return { ...units, coil: draw(game) };
}
function ready(game) {
  const units = materials(game);
  accepted(game, 'combine', { recipeId: 'make_cheng_yu', unitIds: [units.anchor.id, units.coil.id] });
  return { ...units, result: player(game).units.find(unit => unit.definitionId === 'cheng_yu') };
}
function actionState(game) {
  const p = player(game);
  return structuredClone({ tutorial: game.tutorial, gold: p.gold, units: p.units, upgrades: p.upgrades,
    investmentActions: p.investmentActions, rngState: game.rngState,
    placementRngState: game.placementRngState, nextEntityId: game.nextEntityId });
}
function rejected(game, type, extra = {}, error = 'TUTORIAL_ACTION_REQUIRED') {
  const before = actionState(game);
  assert.deepEqual(act(game, type, extra), { ok: false, error });
  assert.deepEqual(actionState(game), before, 'rejected action leaves lesson, resources and robots unchanged');
}

test('tutorial creates isolated solo practice with three slots and no campaign unlocks', () => {
  const originalRules = structuredClone(content.rules), game = create();
  assert.equal(game.battlefieldId, 0); assert.equal(game.practice, true);
  assert.equal(game.rules.maxUnits, 3); assert.deepEqual(game.stories, []);
  assert.equal(player(game).facilityHp, null);
  assert.deepEqual(game.tutorial, { step: 'intro', drawCount: 0, anchorUnitId: null, saleUnitId: null, bossAtTick: null });
  assert.deepEqual(publicState(game).tutorial, game.tutorial);
  assert.deepEqual(content.rules, originalRules);
  assert.throws(() => createGame({ playerIds: ['p', 'other'], seed: 1, tutorial: true }), /solo/);
  const withUnlocks = createGame({ playerIds: ['p'], seed: 1, tutorial: true, unlockedRecipesByPlayer: { p: content.recipes.map(recipe => recipe.id) } });
  assert.deepEqual(player(withUnlocks).unlockedRecipes, []);
});

test('tutorial advances only at its checkpoint and validates the inspected robot', () => {
  const game = create(); rejected(game, 'summon'); rejected(game, 'upgrade', { tag: 'wei' });
  accepted(game, 'tutorial_next'); assert.equal(game.tutorial.step, 'summon');
  rejected(game, 'tutorial_next'); const anchor = draw(game);
  assert.equal(game.tutorial.step, 'inspect'); rejected(game, 'summon'); rejected(game, 'tutorial_next');
  rejected(game, 'tutorial_next', { unitIds: [anchor.id + 100] });
  rejected(game, 'tutorial_next', { unitIds: [anchor.id, anchor.id] });
  accepted(game, 'tutorial_next', { unitIds: [anchor.id] }); assert.equal(game.tutorial.step, 'fill');
  rejected(game, 'combine', { recipeId: 'make_cheng_yu', unitIds: [anchor.id] });
  rejected(game, 'dispatch', { unitIds: [anchor.id] });
});

test('guided summons enforce cooldown without consuming resources or the next scripted draw', () => {
  const game = create(); accepted(game, 'tutorial_next'); const anchor = draw(game);
  accepted(game, 'tutorial_next', { unitIds: [anchor.id] });
  assert.equal(player(game).nextSummonTick - game.tick, game.rules.summonCooldownTicks);
  rejected(game, 'summon', {}, 'SUMMON_COOLDOWN');
  while (game.tick < player(game).nextSummonTick - 1) tick(game);
  rejected(game, 'summon', {}, 'SUMMON_COOLDOWN'); tick(game); accepted(game, 'summon');
  assert.equal(player(game).units.at(-1).definitionId, 'wei_guard'); assert.equal(game.tutorial.drawCount, 2);
});

test('fixed draws teach the real unit cap, protect ingredients and reuse the sold slot without RNG', () => {
  for (const seed of [0, 1, 42, 98765]) {
    const game = create(seed), rng = [game.rngState, game.placementRngState];
    const { anchor, support, sale } = fill(game), p = player(game);
    assert.deepEqual(p.units.map(unit => unit.definitionId), ['wei_archer', 'wei_guard', 'wu_archer']);
    assert.deepEqual(p.units.map(unit => unit.slot), [0, 1, 2]); assert.equal(game.tutorial.saleUnitId, sale.id);
    rejected(game, 'summon', {}, 'UNIT_CAP'); rejected(game, 'salvage', { unitIds: [anchor.id] });
    rejected(game, 'salvage', { unitIds: [support.id] });
    rejected(game, 'salvage', { unitIds: [sale.id, support.id] }); rejected(game, 'upgrade', { tag: 'wei' });
    const gold = p.gold, refund = Math.floor(sale.investedGold * game.rules.salvageRefundRatio);
    accepted(game, 'salvage', { unitIds: [sale.id] });
    assert.equal(p.gold, gold + refund); assert.equal(p.units.length, 2);
    assert.equal(game.tutorial.step, 'replacement'); assert.ok(!p.units.some(unit => unit.id === sale.id));
    const coil = draw(game);
    assert.equal(coil.definitionId, 'wu_guard'); assert.equal(coil.slot, sale.slot);
    assert.equal(game.tutorial.step, 'combine'); assert.equal(game.tutorial.drawCount, 4);
    assert.deepEqual([game.rngState, game.placementRngState], rng);
  }
});

test('only the chosen recipe and anchor order complete the assembly lesson', () => {
  const game = create(), { anchor, support, coil } = materials(game);
  rejected(game, 'combine', { recipeId: 'make_cheng_yu', unitIds: [coil.id, anchor.id] });
  rejected(game, 'combine', { recipeId: 'make_ma_liang', unitIds: [anchor.id, coil.id] });
  rejected(game, 'combine', { recipeId: 'make_cheng_yu', unitIds: [anchor.id, support.id] }, 'INVALID_INGREDIENTS');
  accepted(game, 'combine', { recipeId: 'make_cheng_yu', unitIds: [anchor.id, coil.id] });
  const result = player(game).units.find(unit => unit.definitionId === 'cheng_yu');
  assert.ok(result); assert.equal(result.slot, anchor.slot);
  assert.equal(result.investedGold, anchor.investedGold + coil.investedGold);
  assert.deepEqual(player(game).units.map(unit => unit.definitionId).sort(), ['cheng_yu', 'wei_guard']);
  assert.equal(game.tutorial.step, 'boss_ready'); assert.equal(game.tutorial.bossAtTick, null);
});

test('retransmitted summon, sale, combine and ready packets never repeat lesson effects', () => {
  const game = create(); accepted(game, 'tutorial_next');
  function repeat(type, extra = {}) {
    const packet = { seq: player(game).lastSeq + 1, type, ...extra };
    assert.deepEqual(applyAction(game, 'p', packet), { ok: true }); const after = actionState(game);
    assert.deepEqual(applyAction(game, 'p', packet), { ok: true }); assert.deepEqual(actionState(game), after);
    return packet;
  }
  repeat('summon'); const anchor = player(game).units[0];
  accepted(game, 'tutorial_next', { unitIds: [anchor.id] }); draw(game); const sale = draw(game);
  repeat('salvage', { unitIds: [sale.id] }); const coil = draw(game);
  const combined = repeat('combine', { recipeId: 'make_cheng_yu', unitIds: [anchor.id, coil.id] });
  assert.deepEqual(applyAction(game, 'p', { seq: combined.seq, type: 'tutorial_next' }), { ok: false, error: 'SEQUENCE_REUSED' });
  assert.equal(game.tutorial.bossAtTick, null);
  repeat('tutorial_next'); assert.equal(game.tutorial.bossAtTick, game.tick + 80);
});

test('every reading checkpoint stays safe beyond normal timers and the old spawn sentinel', () => {
  const checkpoints = [
    () => {}, game => accepted(game, 'tutorial_next'),
    game => { accepted(game, 'tutorial_next'); draw(game); },
    game => { accepted(game, 'tutorial_next'); const unit = draw(game); accepted(game, 'tutorial_next', { unitIds: [unit.id] }); },
    fill, game => { const { sale } = fill(game); accepted(game, 'salvage', { unitIds: [sale.id] }); }, materials, ready,
  ];
  for (const setup of checkpoints) {
    const game = create(); setup(game); const step = game.tutorial.step, gold = player(game).gold;
    // Move the test clock to boundary values instead of looping ten million ticks.
    for (const boundary of [80, 680, 10000000, 10000080]) {
      game.tick = boundary - 1; tick(game); tick(game);
      assert.equal(game.tutorial.step, step); assert.equal(game.status, 'playing');
      assert.equal(player(game).status, 'active'); assert.equal(player(game).result, null);
      assert.equal(player(game).gold, gold); assert.equal(player(game).enemySpawnCount, 0);
      assert.deepEqual(player(game).enemies, []); assert.equal(game.story, null);
      assert.equal(expeditionProgress(game).miningProgress, 0); assert.equal(expeditionProgress(game).remainingTicks, 0);
      assert.equal(publicState(game).bossRemainingTicks, null);
    }
  }
});

test('readiness starts an eight-second boss countdown after an arbitrarily long lesson', () => {
  const game = create(); ready(game); game.tick = 1234567; tick(game); const started = game.tick;
  accepted(game, 'tutorial_next'); assert.equal(game.tutorial.step, 'countdown');
  assert.equal(game.tutorial.bossAtTick, started + 8 * game.rules.ticksPerSecond);
  rejected(game, 'tutorial_next');
  for (let i = 1; i < 80; i++) { tick(game); assert.equal(player(game).enemies.length, 0); }
  assert.equal(game.tutorial.step, 'countdown'); tick(game);
  assert.equal(game.tutorial.step, 'boss'); assert.equal(player(game).enemies.length, 1);
  assert.equal(player(game).enemies[0].boss, true); assert.equal(player(game).enemies[0].maxHp, 720);
  assert.equal(publicState(game).bossRemainingTicks, game.rules.bossTicks);
});

test('all three tutorial positions cover every boss-route segment with the lens assembly', () => {
  const layout = getBattlefieldLayout(0), lens = content.units.find(unit => unit.id === 'cheng_yu');
  assert.equal(layout.width, 420); assert.equal(layout.height, 220); assert.equal(layout.slots.length, 3);
  assert.equal(new Set(layout.slots.map(point => [point.x, point.y].join(','))).size, 3);
  for (let slot = 0; slot < 3; slot++) {
    assert.deepEqual(unitPoint(slot, 0), layout.slots[slot]);
    for (const route of layout.routes) for (const point of route.points) {
      assert.ok(distanceSquared(unitPoint(slot, 0), point) <= lens.attackRange ** 2, 'vertices and their straight connecting segments stay in range');
    }
  }
});

test('the guided roster clears by real attacks and grants no expedition credit reward', () => {
  const game = create(), { result } = ready(game); accepted(game, 'tutorial_next');
  const deadline = game.tutorial.bossAtTick + game.rules.bossTicks; let lensHits = 0;
  while (game.status === 'playing' && game.tick <= deadline) {
    tick(game);
    if (result.lastAttackTick === game.tick) lensHits += result.lastAttackHits.filter(hit => hit.boss && hit.damage > 0).length;
  }
  assert.ok(lensHits > 1, 'the assembled robot repeatedly attacks the boss');
  assert.equal(game.status, 'finished'); assert.equal(game.tutorial.step, 'complete');
  assert.equal(player(game).status, 'cleared'); assert.equal(player(game).kills, 1);
  assert.equal(player(game).result.researchCredits, 0); assert.equal(player(game).result.battlefieldId, 0);
  assert.ok(game.tick < deadline); assert.deepEqual(player(game).enemies, []);
  const complete = structuredClone(game); tick(game); assert.deepEqual(game, complete);
});

test('leaving a lesson is not completion or a rewarded clear', () => {
  const game = create(); fill(game); accepted(game, 'leave');
  assert.equal(game.status, 'finished'); assert.equal(player(game).status, 'left');
  assert.notEqual(game.tutorial.step, 'complete'); assert.equal(player(game).result.cleared, false);
  assert.equal(player(game).result.researchCredits, 0); assert.equal(create().tutorial.step, 'intro');
});

test('normal games retain random summons, normal limits and enemy timers without tutorial gates', () => {
  const game = createGame({ playerIds: ['p'], seed: 42, practice: false }), rng = [game.rngState, game.placementRngState];
  assert.equal(game.tutorial, null); assert.equal(game.battlefieldId, 1); assert.equal(game.practice, false);
  assert.equal(game.rules.maxUnits, content.battlefields.find(battlefield => battlefield.id === 1).rules.maxUnits);
  assert.notEqual(game.rules.maxUnits, 3); accepted(game, 'summon');
  assert.notEqual(game.rngState, rng[0]); assert.notEqual(game.placementRngState, rng[1]);
  assert.deepEqual(act(game, 'tutorial_next'), { ok: false, error: 'UNKNOWN_ACTION' });
  while (game.tick < game.rules.spawnIntervalTicks) tick(game);
  assert.ok(player(game).enemySpawnCount > 0, 'the ordinary spawn timer remains active');
});
