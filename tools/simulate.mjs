import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createGame, applyAction, tick, content, getUnitAttack } from '../dist/server/core/index.js';

const { rules } = content;
const definitions = new Map(content.units.map(unit => [unit.id, unit]));
const ids = count => Array.from({ length: count }, (_, i) => 'scripted-player-' + (i + 1));
const rounded = value => Math.round(value * 1000) / 1000;
const summary = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { mean: rounded(values.reduce((a, b) => a + b, 0) / values.length), p95: rounded(sorted[Math.ceil(sorted.length * .95) - 1]), max: rounded(sorted[sorted.length - 1]) };
};

function chooseIngredients(player, recipe) {
  const available = player.units.filter(unit => !unit.dispatched);
  const chosen = [];
  for (const id of recipe.ingredients) {
    const index = available.findIndex(unit => unit.definitionId === id);
    if (index < 0) return null;
    chosen.push(available[index].id);
    available.splice(index, 1);
  }
  return chosen;
}

function act(game, player, action, counts) {
  const result = applyAction(game, player.id, { seq: player.lastSeq + 1, ...action });
  if (!result.ok) throw new Error('Script policy generated invalid action: ' + result.error);
  counts[action.type]++;
}

// A fixed, intentionally simple policy. All progression uses validated gameplay actions.
function policy(game, player, counts, strategy) {
  if (player.status !== 'active' || strategy === 'no-input') return;
  let recipe;
  if (strategy !== 'summon-only') do {
    recipe = content.recipes.find(candidate => candidate.unlockBattlefield === 0 && chooseIngredients(player, candidate));
    if (recipe) act(game, player, { type: 'combine', recipeId: recipe.id, unitIds: chooseIngredients(player, recipe) }, counts);
  } while (recipe);

  if ((strategy === 'upgrade' || strategy === 'dispatch') && player.units.length >= 8 && game.tick % rules.waveTicks === 0) {
    const candidates = Object.keys(player.upgrades).filter(tag => player.upgrades[tag] < rules.maxUpgradeLevel);
    candidates.sort((a, b) => tagValue(player, b) - tagValue(player, a));
    const tag = candidates[0];
    if (tag && player.gold >= rules.upgradeCosts[player.upgrades[tag]]) act(game, player, { type: 'upgrade', tag }, counts);
  }
  while (player.gold >= rules.summonCost && player.units.length < rules.maxUnits) act(game, player, { type: 'summon' }, counts);

  if (strategy === 'dispatch' && game.story?.status === 'active' && player.units.length >= 5 && player.enemies.length < 40) {
    const available = rules.maxDispatch - player.units.filter(unit => unit.dispatched).length;
    const candidates = player.units.filter(unit => !unit.dispatched).sort((a, b) => dps(player, b) - dps(player, a)).slice(0, available);
    if (candidates.length) act(game, player, { type: 'dispatch', unitIds: candidates.map(unit => unit.id) }, counts);
  }
}

function dps(player, unit) { return getUnitAttack(player, unit) / definitions.get(unit.definitionId).attackIntervalTicks; }
function tagValue(player, tag) {
  return player.units.reduce((sum, unit) => {
    const d = definitions.get(unit.definitionId);
    return sum + ([d.faction, d.troop, d.trait].includes(tag) ? d.attack / d.attackIntervalTicks : 0);
  }, 0) / rules.upgradeCosts[player.upgrades[tag]];
}

export function scriptedMatch(seats, seed, strategy = 'dispatch', measure = true) {
  const game = createGame({ playerIds: ids(seats), seed, practice: true });
  const actions = { summon: 0, combine: 0, upgrade: 0, dispatch: 0 };
  const tickMs = [], snapshotBytes = [], stories = [];
  const start = performance.now();
  const maxTicks = rules.waveTicks * rules.totalWaves + rules.bossTicks + 1;
  while (game.status === 'playing' && game.tick < maxTicks) {
    if (game.tick % rules.ticksPerSecond === 0) for (const player of game.players) policy(game, player, actions, strategy);
    const tickStart = measure ? performance.now() : 0;
    tick(game);
    if (measure) tickMs.push(performance.now() - tickStart);
    if (measure) snapshotBytes.push(Buffer.byteLength(JSON.stringify(game), 'utf8'));
    if (game.story && game.story.status !== 'active' && !stories.some(story => story.wave === game.story.wave)) stories.push({ wave: game.story.wave, status: game.story.status });
  }
  if (game.status !== 'finished') throw new Error('Simulation failed to finish by the rules deadline');
  return { kind: 'scripted-practice-match', seats, seed, strategy, status: game.status, ticks: game.tick,
    simulatedSeconds: game.tick / rules.ticksPerSecond, wallMs: rounded(performance.now() - start),
    cleared: game.players.filter(p => p.status === 'cleared').length,
    defeated: game.players.filter(p => p.status === 'defeated').length,
    players: game.players.map(p => ({ id: p.id, status: p.status, units: p.units.length, gold: p.gold, hasLegend: p.units.some(u => definitions.get(u.definitionId).rarity === 'legend') })),
    stories, successfulActions: actions, coreTickMs: measure ? summary(tickMs) : null, snapshotBytes: measure ? summary(snapshotBytes) : null };
}

function syntheticStress(seats) {
  const game = createGame({ playerIds: ids(seats), seed: 1, practice: true });
  for (const player of game.players) {
    player.units = Array.from({ length: rules.maxUnits }, (_, slot) => ({ id: game.nextEntityId++, definitionId: 'zhang_fei', slot, dispatched: false, attackCooldownTicks: 0 }));
    player.enemies = Array.from({ length: rules.overcrowdCount }, () => ({ id: game.nextEntityId++, hp: 1e12, maxHp: 1e12, progress: 0, boss: false }));
  }
  const tickMs = [], snapshotBytes = [];
  for (let i = 0; i < 100; i++) {
    // Reset benchmark conditions outside the timed region, preserving 30 units/70 enemies.
    game.tick = 100; // Next tick has no wave boundary or new spawn.
    for (const player of game.players) {
      player.overcrowdedTicks = 0;
      for (const unit of player.units) unit.attackCooldownTicks = 0;
    }
    const start = performance.now();
    tick(game);
    tickMs.push(performance.now() - start);
    if (game.players.some(p => p.status !== 'active' || p.units.length !== rules.maxUnits || p.enemies.length !== rules.overcrowdCount)) throw new Error('Synthetic stress load was not preserved');
    snapshotBytes.push(Buffer.byteLength(JSON.stringify(game), 'utf8'));
  }
  return { kind: 'synthetic-full-cap-core-stress', seats, samples: 100, unitsPerSeat: rules.maxUnits,
    enemiesPerSeat: rules.overcrowdCount, allUnitsAttackEverySample: true,
    resetConditions: 'Clock, overcrowd timer and attack cooldowns reset before each sample; enemies have synthetic HP.',
    coreTickMs: summary(tickMs), snapshotBytes: summary(snapshotBytes) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify({ contentVersion: content.version, environment: { node: process.version, platform: process.platform, arch: process.arch },
  interpretation: 'Local Node CPU samples and uncompressed JSON state sizes only. Scripted policy is not human balance validation; synthetic stress is not a legal match. These measurements do not verify Nakama, network latency, client rendering or iPhone performance.',
  ...(process.argv.includes('--compare') ? { strategyComparison: compareStrategies() } : { scriptedMatches: [4, 8].flatMap(seats => [1, 42, 2026].map(seed => scriptedMatch(seats, seed))),
  syntheticStress: [4, 8].map(syntheticStress) }) }, null, 2));

export function compareStrategies(seats = 4, seeds = Array.from({ length: 20 }, (_, i) => i + 1)) {
  return ['no-input', 'summon-only', 'greedy-combine', 'upgrade', 'dispatch'].map(strategy => {
    const matches = seeds.map(seed => scriptedMatch(seats, seed, strategy, false));
    return { strategy, seats, seeds, lanes: seats * seeds.length,
      cleared: matches.reduce((sum, match) => sum + match.cleared, 0),
      defeated: matches.reduce((sum, match) => sum + match.defeated, 0),
      fullTeamClears: matches.filter(match => match.cleared === seats).length,
      successfulStories: matches.reduce((sum, match) => sum + match.stories.filter(story => story.status === 'success').length, 0),
      results: matches.map(match => ({ seed: match.seed, cleared: match.cleared, defeated: match.defeated, simulatedSeconds: match.simulatedSeconds })) };
  });
}
