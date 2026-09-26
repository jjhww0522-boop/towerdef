import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createGame, tick, content } from '../dist/server/core/index.js';

// Read-only instrumentation of the exact existing bot, without copying its
// heuristics or changing simulate.mjs. Fail clearly if its private entry changes.
const policyUrl = new URL('./simulate.mjs', import.meta.url);
const original = await readFile(policyUrl, 'utf8');
if (!original.includes('function policy(game, player, counts, strategy)')) throw new Error('Audit policy hook needs review');
const source = original.replace('function policy(game, player, counts, strategy)', 'export function policy(game, player, counts, strategy)')
  .replace(/from '(\.\.?\/[^']+)'/g, (_, path) => `from '${new URL(path, policyUrl).href}'`);
const { policy } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const holdSource = source.replace('if ((strategy === \'upgrade\' || strategy === \'dispatch\') && player.units.length >= rules.maxUnits', 'if (false && (strategy === \'upgrade\' || strategy === \'dispatch\') && player.units.length >= rules.maxUnits');
if (holdSource === source) throw new Error('Audit hold-at-cap hook needs review');
const { policy: holdPolicy } = await import('data:text/javascript;base64,' + Buffer.from(holdSource).toString('base64'));
const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
const contentBefore = JSON.stringify(content);
const round = number => Math.round(number * 100) / 100;
const mean = values => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
const variants = {
  baseline() {},
  'economy-only'(r) { r.startingGold = 100; r.waveGold = Math.round(r.waveGold * .6); r.waveGoldGrowth = Math.round(r.waveGoldGrowth * .5); r.killGold = 1; },
  'pressure-only'(r) { r.enemyHpPerWave *= 1.6; r.enemyHpAcceleration *= 1.5; r.spawnIntervalTicks = Math.round(r.spawnIntervalTicks * .85); r.minSpawnIntervalTicks = Math.round(r.minSpawnIntervalTicks * .85); },
  'moderate-combined'(r) { r.startingGold = 120; r.waveGold = Math.round(r.waveGold * .75); r.killGold = 1; r.enemyHpPerWave *= 1.35; r.spawnIntervalTicks = Math.round(r.spawnIntervalTicks * .9); r.minSpawnIntervalTicks = Math.round(r.minSpawnIntervalTicks * .9); }
};

function run(battlefieldId, seed, strategy, variant, hold = false) {
  const unlockedRecipes = content.recipes.filter(recipe => recipe.unlockType === 'clear' && recipe.unlockBattlefield < battlefieldId).map(recipe => recipe.id);
  const game = createGame({ playerIds: ['scripted-player-1'], battlefieldId, seed, practice: true, unlockedRecipesByPlayer: { 'scripted-player-1': unlockedRecipes } });
  variants[variant](game.rules); // Only this match's merged rules, never content or files.
  const player = game.players[0], r = game.rules;
  player.gold = r.startingGold;
  const miningEnd = r.totalWaves * r.waveTicks, deadline = miningEnd + r.bossTicks;
  const counts = { summon: 0, combine: 0, upgrade: 0, salvage: 0, dispatch: 0 };
  const spending = { summon: 0, upgrade: 0, salvageRefund: 0 };
  const goldAt = {}, fullFundedTicks = { value: 0 }, arrived = new Set();
  let normalTicks = 0, emptyTicks = 0, peakPreBoss = 0, killsPreBoss = 0, spawnedPreBoss = 0, facilityDamagePreBoss = 0;
  let income = 0, firstCap = null, firstCombine = null;
  while (game.status === 'playing' && game.tick < deadline + 1) {
    if (game.tick % r.ticksPerSecond === 0) {
      const beforeGold = player.gold, beforeSummons = counts.summon, beforeCombine = counts.combine, beforeLevels = { ...player.upgrades };
      (hold ? holdPolicy : policy)(game, player, counts, strategy);
      const summons = (counts.summon - beforeSummons) * r.summonCost;
      let upgrades = 0;
      for (const tag of Object.keys(beforeLevels)) for (let level = beforeLevels[tag]; level < player.upgrades[tag]; level++) upgrades += r.upgradeCosts[level];
      spending.summon += summons; spending.upgrade += upgrades;
      spending.salvageRefund += player.gold - beforeGold + summons + upgrades;
      if (firstCombine === null && counts.combine > beforeCombine) firstCombine = game.tick / r.ticksPerSecond;
    }
    if (firstCap === null && player.units.length === r.maxUnits) firstCap = game.tick / r.ticksPerSecond;
    if (game.tick < miningEnd) {
      normalTicks++;
      if (!player.enemies.length) emptyTicks++;
      if (player.gold >= r.summonCost && player.units.length === r.maxUnits) fullFundedTicks.value++;
      // Include enemies that arrive and die in this same tick: siege happens
      // before robot attacks. These runs never use support.
      if (player.facilityHp !== null) for (const enemy of player.enemies) {
        const role = content.enemyArchetypes.find(role => role.id === enemy.archetype);
        const slow = (enemy.slowUntilTick || 0) >= game.tick + 1 ? r.frostSlowMultiplier : 1;
        if (!enemy.boss && enemy.progress + r.enemyProgressPerTick * role.speedMultiplier * slow >= game.objective.arrivalProgress) arrived.add(enemy.id);
      }
    }
    const beforeGold = player.gold;
    tick(game); income += player.gold - beforeGold;
    if (game.tick < miningEnd) {
      peakPreBoss = Math.max(peakPreBoss, player.battleStats.peakEnemies);
      killsPreBoss = player.kills; spawnedPreBoss = player.enemySpawnCount;
      facilityDamagePreBoss = player.battleStats.facilityDamageTaken;
    }
    for (const fraction of [.25, .5, .75, 1]) if (!(fraction in goldAt) && game.tick >= Math.round(miningEnd * fraction)) goldAt[fraction] = player.gold;
  }
  const accountedGold = r.startingGold + income + spending.salvageRefund - spending.summon - spending.upgrade;
  if (Math.abs(accountedGold - player.gold) > 1e-8) throw new Error('Gold ledger mismatch');
  return { battlefieldId, seed, strategy, variant, hold, status: player.status, reason: player.defeatReason,
    seconds: game.tick / r.ticksPerSecond, goldAt, endGold: player.gold,
    startingGold: r.startingGold, earnedGold: income, spending, counts, firstCap, firstCombine,
    normalTicks, emptyPercent: round(emptyTicks / normalTicks * 100), fullFundedPercent: round(fullFundedTicks.value / normalTicks * 100),
    peakPreBoss, peakToOvercrowdThreshold: round(peakPreBoss / r.overcrowdCount),
    normalSpawns: spawnedPreBoss, normalKills: killsPreBoss, arrivals: arrived.size,
    normalKillPercent: round(killsPreBoss / Math.max(1, spawnedPreBoss) * 100),
    normalFacilityLossPercent: player.facilityHp === null ? null : round(facilityDamagePreBoss / game.objective.facilityHp * 100),
    endFacilityLossPercent: player.facilityHp === null ? null : round(player.battleStats.facilityDamageTaken / game.objective.facilityHp * 100),
    upgradeLevels: Object.values(player.upgrades).reduce((a, b) => a + b, 0),
    maxedTags: Object.values(player.upgrades).filter(level => level === r.maxUpgradeLevel).length };
}

function aggregate(runs) {
  const metric = key => mean(runs.map(run => run[key]).filter(value => value !== null));
  return { stage: runs[0].battlefieldId, strategy: runs[0].strategy, variant: runs[0].variant, hold: runs[0].hold,
    clears: runs.filter(run => run.status === 'cleared').length,
    failures: Object.fromEntries(['overcrowded', 'facility_destroyed', 'boss_timeout'].map(reason => [reason, runs.filter(run => run.reason === reason).length])),
    goldQuartiles: [.25, .5, .75, 1].map(fraction => ({ fraction, reached: runs.filter(run => fraction in run.goldAt).length, mean: mean(runs.filter(run => fraction in run.goldAt).map(run => run.goldAt[fraction])) })),
    ...Object.fromEntries(['endGold','earnedGold','normalSpawns','normalKills','arrivals','normalKillPercent','peakPreBoss','peakToOvercrowdThreshold','emptyPercent','fullFundedPercent','normalFacilityLossPercent','endFacilityLossPercent','upgradeLevels','maxedTags','firstCap','firstCombine'].map(key => [key, metric(key)])),
    spending: Object.fromEntries(['summon','upgrade','salvageRefund'].map(key => [key, mean(runs.map(run => run.spending[key]))])),
    actions: Object.fromEntries(Object.keys(runs[0].counts).map(key => [key, mean(runs.map(run => run.counts[key]))])) };
}

const report = { kind: 'automated-economy-pressure-audit', contentVersion: content.version, seeds,
  assumptions: 'Solo exact current simulate.mjs bot, once per second, prior-stage automatic recipes only; no paid research/support. All proposals edit only each newly created in-memory match rules; no production file/content mutation. Hold cohort differs only by disabling capacity sale/rebuy churn. Gold quartiles refer to normal-wave duration, not boss deadline; missing checkpoints are excluded with reached counts. Peak/threshold ratio is descriptive only on facility maps, which do not use overcrowd defeat.',
  groups: [], runs: [] };
for (const variant of Object.keys(variants)) for (const stage of content.battlefields) for (const strategy of ['upgrade', 'dispatch']) {
  const runs = seeds.map(seed => run(stage.id, seed, strategy, variant));
  report.runs.push(...runs); report.groups.push(aggregate(runs));
}
for (const stage of content.battlefields) {
  const runs = seeds.map(seed => run(stage.id, seed, 'dispatch', 'baseline', true));
  report.runs.push(...runs); report.groups.push(aggregate(runs));
}
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
if (JSON.stringify(content) !== contentBefore) throw new Error('Audit mutated shared content');
await writeFile(new URL('../artifacts/economy-pressure-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ matches: report.runs.length, groups: report.groups.map(group => ({ stage: group.stage, strategy: group.strategy, variant: group.variant, hold: group.hold, clears: group.clears, peakPreBoss: group.peakPreBoss, endGold: group.endGold })), artifact: 'artifacts/economy-pressure-audit.json' }, null, 2));
