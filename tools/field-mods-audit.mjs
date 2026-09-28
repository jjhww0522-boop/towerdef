// Independent, deterministic diagnostics. These are not human playtests.
// Build the current core first: npm run build && node tools/field-mods-audit.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGame, applyAction, tick, content, getUnitAttack } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { getUpgradeLevel } from '../shared/upgrade-model.js';
import { unitPoint, enemyPoint, distanceSquared, getBattlefieldLayout } from '../shared/battle-geometry.js';

const definitions = new Map(content.units.map(unit => [unit.id, unit]));
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const policies = ['none', 'tracker', 'scatter', 'opener', 'retune'];
const round = n => Math.round(n * 1000) / 1000;
const sum = (xs, key) => xs.reduce((n, x) => n + x[key], 0);
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
const view = game => publicState(game).players[0].fieldMod;
const coverageCache = new Map();

function coverage(definition, slot, battlefieldId) {
  const key = `${definition.id}:${slot}:${battlefieldId}`;
  if (!coverageCache.has(key)) {
    const position = unitPoint(slot, battlefieldId), radius = definition.attackRange ** 2;
    const routes = getBattlefieldLayout(battlefieldId).routes;
    let hits = 0;
    for (let route = 0; route < routes.length; route++) for (let sample = 0; sample < 120; sample++) {
      if (distanceSquared(position, enemyPoint(sample / 120, battlefieldId, route)) <= radius) hits++;
    }
    const travel = hits / (120 * routes.length);
    const siege = routes.filter((_, route) => distanceSquared(position, enemyPoint(1, battlefieldId, route)) <= radius).length / routes.length;
    coverageCache.set(key, routes[0].closed ? travel : (travel + siege) / 2);
  }
  return coverageCache.get(key);
}

function ingredients(player, recipe, battlefieldId) {
  const available = player.units.filter(unit => !unit.dispatched), chosen = [];
  for (const definitionId of recipe.ingredients) {
    const index = available.findIndex(unit => unit.definitionId === definitionId);
    if (index < 0) return null;
    chosen.push(available.splice(index, 1)[0]);
  }
  const result = definitions.get(recipe.result);
  return chosen.sort((a, b) => coverage(result, b.slot, battlefieldId) - coverage(result, a.slot, battlefieldId) || a.id - b.id).map(unit => unit.id);
}

function action(game, payload, record) {
  const player = game.players[0], beforeGold = player.gold;
  const result = applyAction(game, player.id, { seq: player.lastSeq + 1, ...payload });
  assert.equal(result.ok, true, JSON.stringify({ payload, result, tick: game.tick }));
  if (record) {
    record.actions[payload.type] = (record.actions[payload.type] || 0) + 1;
    record.spending += beforeGold - player.gold;
  }
}

// Exclude only fields which choosing a modifier is permitted to change.
function choiceInvariant(game) {
  const copy = structuredClone(game);
  for (const player of copy.players) for (const key of ['fieldMod', 'lastSeq', 'lastActionKey', 'lastActionResult']) delete player[key];
  return copy;
}

function choose(game, modId, record) {
  const offer = view(game), before = choiceInvariant(game);
  assert.equal(offer.available, true);
  action(game, { type: 'choose_mod', offerId: offer.offerId, modId }, record);
  assert.deepEqual(choiceInvariant(game), before, 'Choice changed RNG, currency, investment eligibility, units, enemies or another non-mod field');
}

function play(seed, battlefieldId, modPolicy) {
  const unlockedRecipes = content.recipes.filter(recipe => recipe.unlockType === 'clear' && recipe.unlockBattlefield < battlefieldId).map(recipe => recipe.id);
  const game = createGame({ playerIds: ['audit'], seed, battlefieldId, practice: true, unlockedRecipesByPlayer: { audit: unlockedRecipes } });
  const player = game.players[0], rules = game.rules;
  const record = { actions: { summon: 0, combine: 0, upgrade: 0, salvage: 0, dispatch: 0, tactic: 0, choose_mod: 0 }, spending: 0, earned: 0 };
  const summonSequence = [], checkpoints = [];
  let fullBoardSeconds = 0, firstCombineTick = null;
  while (game.status === 'playing' && game.tick < rules.waveTicks * rules.totalWaves + rules.bossTicks + 1) {
    if (game.tick % rules.ticksPerSecond === 0 && player.status === 'active') {
      let recipe;
      do {
        recipe = content.recipes.slice().reverse().find(r => (r.unlockBattlefield === 0 || player.unlockedRecipes.includes(r.id)) && ingredients(player, r, battlefieldId));
        if (recipe) {
          action(game, { type: 'combine', recipeId: recipe.id, unitIds: ingredients(player, recipe, battlefieldId) }, record);
          firstCombineTick ??= game.tick;
        }
      } while (recipe);
      // Identical spending policy for every modifier: one useful tag upgrade per wave.
      if (player.units.length >= 8 && game.tick % rules.waveTicks === 0) {
        const value = tag => player.units.reduce((total, unit) => {
          const d = definitions.get(unit.definitionId);
          const upgraded = { ...player.upgrades, [tag]: player.upgrades[tag] + 1 };
          return total + (getUpgradeLevel(d, upgraded) - getUpgradeLevel(d, player.upgrades)) * d.attack / d.attackIntervalTicks;
        }, 0) / rules.upgradeCosts[player.upgrades[tag]];
        const tag = Object.keys(player.upgrades).filter(t => player.upgrades[t] < rules.maxUpgradeLevel).sort((a, b) => value(b) - value(a))[0];
        if (tag && value(tag) > 0 && player.gold >= rules.upgradeCosts[player.upgrades[tag]]) action(game, { type: 'upgrade', tag }, record);
      }
      // Deliberately never salvage to make space; no hidden every-second gold churn.
      if (player.units.length === rules.maxUnits) fullBoardSeconds++;
      if (player.gold >= rules.summonCost && player.units.length < rules.maxUnits && game.tick >= player.nextSummonTick) {
        action(game, { type: 'summon' }, record);
        summonSequence.push(player.units.at(-1).definitionId);
      }
      const offer = view(game);
      if (modPolicy !== 'none' && offer.available) {
        const modId = modPolicy === 'retune' ? (offer.offerId === 'survey' ? 'scatter' : player.units.some(unit => definitions.get(unit.definitionId).element === 'frost') ? 'tracker' : 'opener') : modPolicy;
        checkpoints.push({ tick: game.tick, offerId: offer.offerId, modId, army: player.units.map(unit => unit.definitionId) });
        choose(game, modId, record);
      }
    }
    const beforeGold = player.gold;
    tick(game);
    assert.ok(player.gold >= beforeGold, 'Unexpected non-action gold loss');
    record.earned += player.gold - beforeGold;
  }
  assert.equal(game.status, 'finished');
  assert.equal(player.gold, rules.startingGold + record.earned - record.spending);
  assert.equal(record.actions.salvage, 0);
  assert.ok(player.result.fieldMod.history.length <= 2);
  assert.equal(view(game).available, false);
  return { seed, battlefieldId, modPolicy, status: player.status, reason: player.result.reason,
    seconds: player.result.elapsedTicks / rules.ticksPerSecond, remainingBossHp: round(player.enemies.find(enemy => enemy.boss)?.hp || 0),
    firstCombineSeconds: firstCombineTick === null ? null : firstCombineTick / rules.ticksPerSecond,
    gold: player.gold, facilityHp: player.facilityHp, fullBoardSeconds, ...record, summonSequence, checkpoints,
    battleStats: player.result.battleStats, fieldMod: player.result.fieldMod };
}

function fixture(modId, definitionId, enemies, { overdrive = false, dispatched = false } = {}) {
  const game = createGame({ playerIds: ['fixture'], seed: 7, battlefieldId: 1 });
  game.tick = 400; game.wave = 5;
  choose(game, modId);
  const player = game.players[0];
  player.units = [{ id: game.nextEntityId++, definitionId, slot: 0, dispatched, attackCooldownTicks: 0,
    lastAttackTick: null, lastTargetId: null, lastAttackHits: [], investedGold: 20 }];
  player.enemies = enemies.map((enemy, i) => ({ id: game.nextEntityId++, hp: 1000, maxHp: 1000, progress: .03 + i * .001,
    routeIndex: 0, boss: false, archetype: 'grunt', ...enemy }));
  if (overdrive) player.overdriveUntilTick = 500;
  if (dispatched) game.story = { wave: 5, hp: 1000, maxHp: 1000, remainingTicks: 100, status: 'active' };
  const base = getUnitAttack(player, player.units[0], game.rules);
  tick(game);
  const stat = view(game).stats.find(s => s.modId === modId);
  return { game, base, stat, hits: player.units[0].lastAttackHits };
}

function conditionFixtures() {
  const results = [];
  const check = (name, test, expectedBonus, expectedHits) => {
    close(test.stat.bonusDamage, expectedBonus, name);
    assert.equal(test.stat.hits, expectedHits, name);
    results.push({ name, expectedBonus: round(expectedBonus), actualBonus: round(test.stat.bonusDamage), effectiveHits: test.stat.hits,
      actualHitDamage: test.hits.map(hit => round(hit.damage)) });
  };
  let f = fixture('tracker', 'frost_1', [{}]);
  check('tracker: first frost hit cannot use its own new slow', f, 0, 0);
  f = fixture('tracker', 'frost_1', [{ slowUntilTick: 450 }]);
  check('tracker: pre-existing slow qualifies', f, f.base * .15, 1);
  f = fixture('tracker', 'fire_1', [{ stunnedUntilTick: 450 }], { overdrive: true });
  check('tracker: stun and overdrive multiply the same hit', f, f.base * 1.5 * .15, 1);
  f = fixture('scatter', 'wind_1', [{}, {}, {}]);
  check('scatter: only the two secondary blast hits qualify', f, f.base * .45 * .2 * 2, 2);
  f = fixture('scatter', 'electric_2', [{}, {}, {}]);
  check('scatter: both secondary arc multipliers qualify', f, f.base * (.45 + .25) * .2, 2);
  f = fixture('scatter', 'wind_1', [{}]);
  check('scatter: isolated target has no bonus', f, 0, 0);
  f = fixture('opener', 'fire_1', [{ hp: 800 }]);
  check('opener: exact 80 percent boundary qualifies', f, f.base * .1, 1);
  f = fixture('opener', 'fire_1', [{ hp: 799 }]);
  check('opener: below 80 percent gives no bonus', f, 0, 0);
  f = fixture('opener', 'fire_1', [{ hp: 1, maxHp: 1 }]);
  check('opener: already lethal base hit has zero extra contribution', f, 0, 0);
  f = fixture('opener', 'fire_1', [{}], { dispatched: true });
  check('opener: story dispatch gets no home modifier', f, 0, 0);
  const tutorial = createGame({ playerIds: ['training'], seed: 1, tutorial: true });
  assert.equal(view(tutorial), null);
  assert.equal(applyAction(tutorial, 'training', { seq: 1, type: 'choose_mod', offerId: 'survey', modId: 'opener' }).ok, false);
  return results;
}

assert.deepEqual(content, JSON.parse(readFileSync(new URL('../shared/content.json', import.meta.url), 'utf8')), 'Build current content before running this audit');
const immutableContent = JSON.stringify(content);
const contentDigest = createHash('sha256').update(immutableContent).digest('hex');
const fixtures = conditionFixtures();
const runs = [1, 2].flatMap(battlefieldId => policies.flatMap(policy => seeds.map(seed => play(seed, battlefieldId, policy))));
assert.equal(JSON.stringify(content), immutableContent, 'Diagnostic fixtures and matches must not change game content');
const summaries = [1, 2].flatMap(battlefieldId => policies.map(modPolicy => {
  const rows = runs.filter(run => run.battlefieldId === battlefieldId && run.modPolicy === modPolicy);
  return { battlefieldId, modPolicy, matches: rows.length, clears: rows.filter(row => row.status === 'cleared').length,
    bossTimeouts: rows.filter(row => row.reason === 'boss_timeout').length, facilityDestroyed: rows.filter(row => row.reason === 'facility_destroyed').length,
    meanSeconds: round(sum(rows, 'seconds') / rows.length), meanGold: round(sum(rows, 'gold') / rows.length),
    meanFacilityHp: battlefieldId === 2 ? round(sum(rows, 'facilityHp') / rows.length) : null,
    meanKills: round(rows.reduce((n, row) => n + row.battleStats.kills, 0) / rows.length),
    zeroBenefitRuns: rows.filter(row => sum(row.fieldMod.stats, 'bonusDamage') === 0).length,
    meanFullBoardSeconds: round(sum(rows, 'fullBoardSeconds') / rows.length), meanSpending: round(sum(rows, 'spending') / rows.length),
    actualExtraDamage: round(rows.reduce((n, row) => n + sum(row.fieldMod.stats, 'bonusDamage'), 0)),
    effectiveHits: rows.reduce((n, row) => n + sum(row.fieldMod.stats, 'hits'), 0),
    salvageActions: rows.reduce((n, row) => n + row.actions.salvage, 0),
    changedSummonSequenceVsNone: rows.filter(row => JSON.stringify(row.summonSequence) !== JSON.stringify(runs.find(base => base.battlefieldId === battlefieldId && base.seed === row.seed && base.modPolicy === 'none').summonSequence)).length };
}));
const report = { contentVersion: content.version, contentDigest, node: process.version, platform: process.platform,
  humanParticipants: 0, physicalDevices: 0, seeds, matches: runs.length,
  policy: 'Solo practice, prior-stage clear recipes only; reverse recipe priority, coverage-aware anchor; summon once/sec, upgrade at wave boundary with >=8 units. No salvage/dispatch/tactics/research. Retune is scatter first, then tracker if any frost robot, otherwise opener. No timing delay or reading burden simulated.',
  interpretation: 'Actual extra hit damage is HP-capped accounting, not causal win contribution. Same seed can still yield different later affordable actions after kills shift. Modifier action asserts all non-mod/replay state unchanged. No claim about human enjoyment or mobile performance.',
  fixtures, summaries, runs };
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/field-mods-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ contentVersion: report.contentVersion, fixtures: fixtures.length, matches: runs.length, summaries }, null, 2));
