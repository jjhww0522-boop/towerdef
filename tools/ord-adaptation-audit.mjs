import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { scriptedMatch } from './simulate.mjs';
import core from '../dist/server/core/index.js';
import { getBattlefieldLayout, distanceSquared, enemyPoint } from '../shared/battle-geometry.js';

const before = JSON.parse(execFileSync('git', ['show', '49a211d:shared/content.json'], { encoding: 'utf8', windowsHide: true }));
const after = structuredClone(core.content); delete before.version; delete after.version;
assert.deepEqual(after, before, 'presentation changes must not silently retune combat or progression');
const basics = core.content.units.filter(unit => unit.rarity === 'basic');
assert.equal(basics.length, 6, 'report all six actual basic element families');
const seedsFor = stage => stage <= 2 ? Array.from({ length: 10 }, (_, index) => index + 1) : [1, 2, 3];
const report = { contentVersion: core.content.version, source: 'scripted_mode_adaptation_audit', actualParticipants: 0,
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  assumptions: 'Fixed deterministic policy once per simulated second; prior-stage clear recipes only, no paid research, no tactical support or field modifications. The upgrade policy includes selling weak robots when full. Cooperative dispatch uses the same policy plus dispatch. These results diagnose correctness and policy behavior, not human win rates.',
  unchangedCombatContent: true, geometry: [], cases: [], modeIsolation: [], noInput: [] };
const soloRuns = new Map();
for (const stage of core.content.battlefields) {
  const layout = getBattlefieldLayout(stage.id), rules = { ...core.content.rules, ...stage.rules };
  let minimumSlotGap = Infinity;
  layout.slots.forEach((point, index) => layout.slots.slice(index + 1).forEach(other => {
    minimumSlotGap = Math.min(minimumSlotGap, Math.sqrt(distanceSquared(point, other)));
  }));
  const rangeCoverage = {};
  for (const unit of basics) {
    const fractions = layout.slots.map(point => {
      let hits = 0;
      layout.routes.forEach((route, index) => {
        for (let sample = 0; sample < 1000; sample++) if (distanceSquared(point, enemyPoint(sample / 1000, stage.id, index)) <= unit.attackRange ** 2) hits++;
      });
      return hits / (1000 * layout.routes.length);
    });
    rangeCoverage[unit.element] = { range: unit.attackRange, rangeToMinimumSlotGap: unit.attackRange / minimumSlotGap,
      minimumTravelCoverage: Math.min(...fractions), maximumTravelCoverage: Math.max(...fractions) };
  }
  report.geometry.push({ stage: stage.id, width: layout.width, height: layout.height, slots: layout.slots.length,
    minimumSlotGap, defenseSeconds: rules.waveTicks * rules.totalWaves / rules.ticksPerSecond,
    bossDeadlineSeconds: stage.objective.kind === 'mining' ? 0 : rules.bossTicks / rules.ticksPerSecond,
    routes: layout.routes.map(route => ({ length: route.length, seconds: 1 / (rules.enemyProgressPerTick * rules.ticksPerSecond),
      worldUnitsPerSecond: route.length * rules.enemyProgressPerTick * rules.ticksPerSecond,
      distancePerBaseSpawnInterval: route.length * rules.enemyProgressPerTick * rules.spawnIntervalTicks,
      sameRouteBaseSpawnSpacing: route.length * rules.enemyProgressPerTick * rules.spawnIntervalTicks * layout.routes.length })),
    spawnSeconds: rules.spawnIntervalTicks / rules.ticksPerSecond, minSpawnSeconds: rules.minSpawnIntervalTicks / rules.ticksPerSecond,
    ranges: Object.fromEntries(basics.map(unit => [unit.element, unit.attackRange])), rangeCoverage });
}
for (const mode of ['solo', 'coop']) for (const stage of core.content.battlefields) {
  const seats = mode === 'solo' ? 1 : 4, seeds = seedsFor(stage.id);
  const strategy = mode === 'solo' ? 'upgrade' : 'dispatch';
  const runs = seeds.map(seed => scriptedMatch(seats, seed, strategy, false, { mode, battlefieldId: stage.id }));
  assert.ok(runs.every(run => run.status === 'finished'));
  if (mode === 'solo') {
    assert.ok(runs.every(run => run.stories.length === 0 && run.successfulActions.dispatch === 0));
    soloRuns.set(stage.id, runs);
  }
  report.cases.push({ mode, stage: stage.id, strategy, seeds, seats,
    clearedLanes: runs.reduce((count, run) => count + run.cleared, 0), totalLanes: seeds.length * seats,
    storySuccesses: runs.flatMap(run => run.stories).filter(story => story.status === 'success').length,
    runs: runs.map(run => ({ seed: run.seed, cleared: run.cleared, seconds: run.simulatedSeconds, actions: run.successfulActions,
      results: run.players.map(player => ({ status: player.status, reason: player.result.reason, remainingBossHp: player.remainingBossHp })) })) });
}
// Compare the same one-seat policy/seed so participant count and dispatch cannot
// hide changes to personal combat. Legacy omitted mode remains cooperative.
function personalCombat(run) {
  return { ticks: run.ticks, cleared: run.cleared, defeated: run.defeated, actions: run.successfulActions,
    players: run.players.map(player => {
      const { mode, ...result } = player.result;
      return { ...player, result };
    }) };
}
for (const stage of core.content.battlefields) {
  for (const solo of soloRuns.get(stage.id)) {
    const legacy = scriptedMatch(1, solo.seed, 'upgrade', false, { battlefieldId: stage.id });
    assert.equal(legacy.players[0].result.mode, 'coop');
    assert.equal(legacy.successfulActions.dispatch, 0);
    assert.deepEqual(personalCombat(solo), personalCombat(legacy), `stage ${stage.id}, seed ${solo.seed}: removing stories preserves personal combat`);
    report.modeIsolation.push({ stage: stage.id, seed: solo.seed, samePersonalCombat: true,
      soloStoryCount: solo.stories.length, legacyStoryCount: legacy.stories.length });
  }
}
for (const stage of [1, 2]) {
  const run = scriptedMatch(1, 1, 'no-input', false, { mode: 'solo', battlefieldId: stage });
  assert.equal(run.cleared, 0, 'opening stages still require player action');
  report.noInput.push({ stage, seed: 1, seconds: run.simulatedSeconds, status: run.players[0].status, reason: run.players[0].result.reason });
}
await mkdir('artifacts/ord-adaptation', { recursive: true });
await writeFile('artifacts/ord-adaptation/balance-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ contentVersion: report.contentVersion, unchangedCombatContent: true,
  modeIsolationPairs: report.modeIsolation.length, noInput: report.noInput,
  cases: report.cases.map(({ runs, ...summary }) => summary) }, null, 2));
