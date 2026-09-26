import { writeFile, mkdir } from 'node:fs/promises';
import { scriptedMatch } from './simulate.mjs';
import { content } from '../dist/server/core/index.js';

// Module-loaded snapshot is fixed for this process even if another worker builds.
// All edits below affect only this process's JSON object. No gameplay files change.
const snapshot = JSON.parse(JSON.stringify(content));
const stage1 = content.battlefields.find(stage => stage.id === 1);
const stage2 = content.battlefields.find(stage => stage.id === 2);
const strategies = ['no-input', 'summon-only', 'greedy-combine', 'upgrade', 'dispatch'];
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const mean = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100 : null;
const cases = [
  { id: 'baseline-stage1', stage: 1, waveTicks: 150, bossHp: 8000 },
  { id: 'three-minute-stage1-8000', stage: 1, waveTicks: 100, bossHp: 8000 },
  { id: 'three-minute-stage1-7200', stage: 1, waveTicks: 100, bossHp: 7200 },
  { id: 'three-minute-stage1-6400', stage: 1, waveTicks: 100, bossHp: 6400 },
  { id: 'baseline-stage2', stage: 2, waveTicks: 200 },
  { id: 'four-minute-stage2', stage: 2, waveTicks: 160 }
];
const report = { kind: 'in-memory-onboarding-pace-proposals', contentSnapshot: snapshot,
  assumptions: 'Solo, seeds1..20, exact existing scriptedMatch policies once per simulated second. No support, no paid research, prior-stage clear recipes only. Baseline timing explicitly fixed at stage1 150 ticks/wave plus600 boss ticks and stage2 200 ticks/wave. Candidates preserve wave counts, incomes, enemy coefficients, stories and all later stages; only stage1/2 waveTicks and the labeled optional stage1 bossHp change. Difficulty1/1.5 are intended design labels, not measured player ratings.', cases: [] };
try {
  for (const scenario of cases) {
    stage1.rules = { ...snapshot.battlefields.find(stage => stage.id === 1).rules, waveTicks: 150, bossTicks: 600, bossHp: 8000 };
    stage2.rules = { ...snapshot.battlefields.find(stage => stage.id === 2).rules, waveTicks: 200 };
    const stage = scenario.stage === 1 ? stage1 : stage2;
    stage.rules.waveTicks = scenario.waveTicks;
    if (scenario.bossHp !== undefined) stage.rules.bossHp = scenario.bossHp;
    const groups = strategies.map(strategy => {
      const runs = seeds.map(seed => scriptedMatch(1, seed, strategy, false, { battlefieldId: scenario.stage, supportPolicy: 'none' }));
      return { strategy, seeds, clears: runs.reduce((sum, run) => sum + run.cleared, 0),
        failures: Object.fromEntries(['overcrowded', 'facility_destroyed', 'boss_timeout'].map(reason => [reason, runs.filter(run => run.players[0].result.reason === reason).length])),
        meanSeconds: mean(runs.map(run => run.simulatedSeconds)),
        meanClearSeconds: mean(runs.filter(run => run.cleared).map(run => run.simulatedSeconds)),
        failedBossHp: mean(runs.filter(run => run.players[0].result.reason === 'boss_timeout').map(run => run.players[0].remainingBossHp)),
        meanActions: Object.fromEntries(['summon', 'combine', 'upgrade', 'dispatch'].map(action => [action, mean(runs.map(run => run.successfulActions[action]))])),
        results: runs.map(run => ({ seed: run.seed, cleared: run.cleared, seconds: run.simulatedSeconds, reason: run.players[0].result.reason, remainingBossHp: run.players[0].remainingBossHp })) };
    });
    report.cases.push({ ...scenario, groups });
  }
} finally {
  stage1.rules = snapshot.battlefields.find(stage => stage.id === 1).rules;
  stage2.rules = snapshot.battlefields.find(stage => stage.id === 2).rules;
}
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/onboarding-pace-experiment.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.cases.map(({ groups, ...scenario }) => ({ ...scenario, groups: groups.map(({ results, seeds, ...group }) => group) })), null, 2));
