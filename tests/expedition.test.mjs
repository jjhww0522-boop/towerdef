import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, setConnection, content } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { scriptedMatch } from '../tools/simulate.mjs';

const create = (options = {}) => createGame({ playerIds: ['one', 'two'], seed: 19, practice: false, ...options });
const act = (game, player, action) => applyAction(game, player.id, { seq: player.lastSeq + 1, ...action });
const give = (game, player, definitionId, investedGold = game.rules.summonCost) => {
  const unit = { id: game.nextEntityId++, definitionId, slot: player.units.length, dispatched: false,
    attackCooldownTicks: 0, lastAttackTick: null, lastTargetId: null, investedGold };
  player.units.push(unit); return unit;
};
const enemy = (game, hp = 1e12, boss = false) => ({ id: game.nextEntityId++, hp, maxHp: hp, progress: 0, boss });
const invest = (game, player) => { for (let i = 0; i < 3; i++) assert.equal(act(game, player, { type: 'summon' }).ok, true); };
const overwhelm = (game, player) => {
  player.enemies = Array.from({ length: game.rules.overcrowdCount }, () => enemy(game));
  player.overcrowdedTicks = game.rules.overcrowdTicks - 1; tick(game);
};

test('three planets expose independent rules and objective-specific expedition deadlines', () => {
  const games = [1, 2, 3].map(battlefieldId => create({ battlefieldId }));
  assert.deepEqual(games.map(g => publicState(g).expedition.remainingTicks / g.rules.ticksPerSecond), [492, 1600, 1806]);
  assert.deepEqual(games.map(g => g.stories.map(s => s.wave)), [[6, 12, 18], [16, 32, 48], [17, 34, 51]]);
  assert.ok(games[1].rules.enemyHpAcceleration > games[0].rules.enemyHpAcceleration);
  assert.ok(games[2].rules.bossHp > games[1].rules.bossHp);
  assert.throws(() => create({ battlefieldId: 99 }), /battlefield/);
  assert.equal(createGame({ playerIds: ['practice'], seed: 1 }).practice, true);
  const original = games[1].rules.waveGold;
  games[0].rules.waveGold++;
  assert.equal(games[1].rules.waveGold, original);
});

test('mining transitions into evacuation at the selected planet deadline and stops spawning normal enemies', () => {
  for (const battlefieldId of [1, 3]) {
    const game = create({ battlefieldId }), bossStart = game.rules.waveTicks * game.rules.totalWaves;
    game.tick = bossStart - 1;
    assert.equal(publicState(game).expedition.phase, 'mining');
    tick(game);
    const state = publicState(game);
    assert.equal(state.battlefieldId, battlefieldId);
    assert.equal(state.expedition.phase, 'evacuation');
    assert.equal(state.expedition.miningProgress, 1);
    assert.equal(state.bossRemainingTicks, game.rules.bossTicks);
    assert.equal(state.rules.totalWaves, game.rules.totalWaves);
    assert.deepEqual(state.stories, game.stories);
    for (const player of game.players) assert.equal(player.enemies.filter(e => e.boss).length, 1);
    for (let i = 0; i < 20; i++) tick(game);
    assert.ok(game.players.every(p => p.enemies.length === 1));
    game.tick = bossStart + game.rules.bossTicks - 1; tick(game);
    assert.equal(publicState(game).expedition.phase, 'complete');
    assert.equal(game.players[0].result.reason, 'boss_timeout');
  }
});

test('deep mining increases enemy strength, arrival pressure and wave income without changing summon odds', () => {
  const early = create({ battlefieldId: 2 }), late = create({ battlefieldId: 2 });
  early.tick = early.rules.waveTicks - 1; late.tick = late.rules.waveTicks * 47 - 1;
  const earlyGold = early.players[0].gold, lateGold = late.players[0].gold;
  tick(early); tick(late);
  assert.ok(late.players[0].gold - lateGold > early.players[0].gold - earlyGold);
  early.players.forEach(p => p.enemies = []); late.players.forEach(p => p.enemies = []);
  for (let i = 0; i < 120; i++) { tick(early); tick(late); }
  assert.ok(late.players[0].enemies.length > early.players[0].enemies.length);
  assert.ok(late.players[0].enemies[0].hp > early.players[0].enemies[0].hp);
  assert.deepEqual(late.rules.summonWeights, content.rules.summonWeights);
});

test('researched blueprint accepts exact ingredients but cannot bypass ownership or material requirements', () => {
  const recipe = content.recipes.find(r => r.id === 'make_liu_bei');
  const locked = create(), owner = locked.players[0];
  const lockedUnits = recipe.ingredients.map(id => give(locked, owner, id));
  assert.equal(act(locked, owner, { type: 'combine', recipeId: recipe.id, unitIds: lockedUnits.map(u => u.id) }).error, 'RECIPE_LOCKED');
  assert.equal(owner.units.length, 3);
  const unlocked = create({ unlockedRecipesByPlayer: { one: [recipe.id, recipe.id, 'forged'] } }), player = unlocked.players[0];
  assert.deepEqual(player.unlockedRecipes, [recipe.id]);
  assert.deepEqual(createGame({ playerIds: ['__proto__'], seed: 1, unlockedRecipesByPlayer: {} }).players[0].unlockedRecipes, []);
  assert.equal(act(unlocked, player, { type: 'combine', recipeId: recipe.id, unitIds: [] }).error, 'INVALID_INGREDIENTS');
  const units = recipe.ingredients.map(id => give(unlocked, player, id));
  const other = give(unlocked, unlocked.players[1], recipe.ingredients[0]);
  assert.equal(act(unlocked, player, { type: 'combine', recipeId: recipe.id, unitIds: [other.id, units[1].id, units[2].id] }).error, 'INVALID_INGREDIENTS');
  assert.equal(act(unlocked, player, { type: 'combine', recipeId: recipe.id, unitIds: units.map(u => u.id) }).ok, true);
  assert.deepEqual(player.units.map(u => u.definitionId), [recipe.result]);
});

test('free high-tier route is always available and ultimate requires researched shared-material chain', () => {
  const free = content.recipes.find(r => r.result === 'salvage_colossus');
  const ultimate = content.recipes.find(r => r.result === 'orbital_ark');
  assert.equal(free.unlockBattlefield, 0);
  assert.equal(content.units.find(u => u.id === ultimate.result).tier, 'ultimate');
  assert.ok(ultimate.ingredients.every(id => content.recipes.some(r => r.result === id && r.unlockBattlefield > 0)));
  const game = create(), player = game.players[0];
  const units = free.ingredients.map(id => give(game, player, id));
  assert.equal(act(game, player, { type: 'combine', recipeId: free.id, unitIds: units.map(u => u.id) }).ok, true);
  assert.deepEqual(player.unlockedRecipes, []);
  const research = create({ unlockedRecipesByPlayer: { one: [ultimate.id] } }), builder = research.players[0];
  const parts = ultimate.ingredients.map(id => give(research, builder, id, 240));
  assert.equal(act(research, builder, { type: 'combine', recipeId: ultimate.id, unitIds: parts.map(u => u.id) }).ok, true);
  assert.equal(builder.units.length, 1);
  assert.equal(builder.units[0].definitionId, 'orbital_ark');
  assert.equal(builder.units[0].investedGold, 720);
});

test('salvage refunds only invested cost fraction, is idempotent and rejects foreign, multiple or dispatched units', () => {
  const game = create(), player = game.players[0];
  assert.equal(act(game, player, { type: 'summon' }).ok, true);
  const unit = player.units[0], original = player.gold;
  assert.equal(publicState(game).players[0].units[0].salvageGold, 7);
  const action = { seq: player.lastSeq + 1, type: 'salvage', unitIds: [unit.id] };
  assert.equal(applyAction(game, player.id, action).ok, true);
  assert.equal(applyAction(game, player.id, action).ok, true);
  assert.equal(player.gold, original + 7);
  assert.equal(player.units.length, 0);
  const a = give(game, player, 'shu_guard'), b = give(game, player, 'shu_rider');
  const other = give(game, game.players[1], 'shu_guard');
  for (const unitIds of [[other.id], [a.id, b.id], [a.id, a.id]]) assert.equal(act(game, player, { type: 'salvage', unitIds }).error, 'INVALID_UNITS');
  a.dispatched = true;
  assert.equal(act(game, player, { type: 'salvage', unitIds: [a.id] }).error, 'INVALID_UNITS');
  assert.equal(player.units.length, 2);
  a.dispatched = false;
  assert.equal(act(game, player, { type: 'combine', recipeId: 'make_guan_ping', unitIds: [a.id, b.id] }).ok, true);
  assert.equal(publicState(game).players[0].units[0].salvageGold, 14);
});

test('partial research rewards require real combat and investment; leave, practice and idle cannot farm them', () => {
  const real = create(), player = real.players[0];
  invest(real, player); player.kills = 45;
  real.tick = real.rules.waveTicks * 12;
  overwhelm(real, player);
  assert.equal(player.result.cleared, false);
  assert.equal(player.result.researchCredits, 10);
  assert.equal(real.players[1].status, 'active');
  const snapshot = JSON.stringify(player.result);
  real.tick = real.rules.waveTicks * real.rules.totalWaves; tick(real);
  setConnection(real, player.id, false); setConnection(real, player.id, true);
  assert.equal(JSON.stringify(player.result), snapshot);
  for (const mode of ['idle', 'leave', 'practice']) {
    const game = create({ practice: mode === 'practice' }), p = game.players[0];
    if (mode !== 'idle') invest(game, p);
    p.kills = 80; game.tick = game.rules.waveTicks * 18;
    if (mode === 'leave') act(game, p, { type: 'leave' }); else overwhelm(game, p);
    assert.equal(p.result.researchCredits, 0, mode);
  }
});

test('evacuation clear freezes a single result and grants its bonus only to the clearing player', () => {
  const game = create({ battlefieldId: 3 }), player = game.players[0];
  invest(game, player); player.kills = 60;
  game.tick = game.rules.waveTicks * game.rules.totalWaves;
  player.enemies = [enemy(game, 1, true)];
  tick(game);
  assert.equal(player.status, 'cleared');
  assert.equal(player.result.researchCredits, 120);
  assert.equal(player.result.battlefieldId, 3);
  assert.equal(player.result.miningProgress, 1);
  assert.equal(game.players[1].result, null);
  assert.equal(game.status, 'playing');
  const result = JSON.stringify(player.result);
  for (let i = 0; i < 100; i++) tick(game);
  assert.equal(JSON.stringify(player.result), result);
  assert.equal(publicState(game).players[0].result.researchCredits, 120);
});

test('late-planet story retains personal lanes, reserved slots and equal active-player rewards', () => {
  const game = create({ battlefieldId: 3 }), owner = game.players[0], peer = game.players[1];
  game.tick = (game.stories[1].wave - 1) * game.rules.waveTicks - 1; tick(game);
  const unit = give(game, owner, 'salvage_colossus');
  const target = enemy(game); owner.enemies = [target];
  assert.equal(act(game, owner, { type: 'dispatch', unitIds: [unit.id] }).ok, true);
  const before = game.players.map(p => p.gold);
  game.story.hp = 1; tick(game);
  assert.equal(target.hp, target.maxHp);
  assert.equal(game.story.status, 'success');
  assert.equal(unit.dispatched, false);
  assert.equal(unit.slot, 0);
  assert.equal(owner.gold - before[0], game.stories[1].rewardGold);
  assert.equal(peer.gold - before[1], game.stories[1].rewardGold);
  assert.equal(peer.result, null);
});

test('main expedition is clearable without researched recipes under seeded legal play and requires input', () => {
  const results = [1, 2, 3].map(seed => scriptedMatch(4, seed, 'dispatch', false, { battlefieldId: 2, practice: false }));
  const clears = results.reduce((sum, result) => sum + result.cleared, 0);
  assert.ok(clears > 0);
  assert.ok(results.every(result => result.players.every(player => !player.hasLockedRecipeUnit)));
  assert.ok(results.every(result => result.players.every(player => player.result.wave > 32)));
  assert.ok(results.every(result => result.successfulActions.combine > 0 && result.successfulActions.upgrade > 0));
  const idle = scriptedMatch(4, 1, 'no-input', false, { battlefieldId: 2, practice: false });
  assert.equal(idle.cleared, 0);
  assert.ok(idle.players.every(player => player.result.researchCredits === 0));
});

test('final planet can earn its first clear with base blueprints rather than its own locked reward', () => {
  const match = scriptedMatch(4, 1, 'dispatch', false, { battlefieldId: 3, practice: false });
  assert.ok(match.cleared > 0);
  assert.ok(match.players.every(player => !player.hasLockedRecipeUnit));
  for (const player of match.players.filter(player => player.status === 'cleared')) {
    assert.equal(player.result.battlefieldId, 3);
    assert.equal(player.result.researchCredits, 120);
  }
});
