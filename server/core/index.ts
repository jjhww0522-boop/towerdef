import contentData from '../../shared/content.json';
import { unitPoint, enemyPoint, distanceSquared, getBattlefieldLayout } from '../../shared/battle-geometry';

export const content = contentData;
export type ActionType = 'summon' | 'combine' | 'upgrade' | 'dispatch' | 'salvage' | 'leave';
export interface Action { seq: number; type: ActionType; recipeId?: string; tag?: string; unitIds?: number[] }
export interface ActionResult { ok: boolean; error?: string }
export interface AttackHit { targetId: number | string; progress?: number; routeIndex?: number; damage: number; boss?: boolean }
export interface Unit {
  id: number; definitionId: string; slot: number; dispatched: boolean; attackCooldownTicks: number;
  lastAttackTick: number | null; lastTargetId: number | string | null;
  lastAttackHits: AttackHit[];
  investedGold: number;
}
export interface Enemy { id: number; hp: number; maxHp: number; progress: number; routeIndex?: number; boss: boolean; slowUntilTick?: number; siegeCooldownTicks?: number }
export type Rules = typeof content.rules;
export interface ExpeditionResult {
  battlefieldId: number; status: 'defeated' | 'cleared' | 'left'; cleared: boolean; researchCredits: number;
  wave: number; kills: number; elapsedTicks: number; miningProgress: number;
  reason: 'overcrowded' | 'boss_timeout' | 'facility_destroyed' | null;
}
export interface Player {
  id: string; gold: number; status: 'active' | 'defeated' | 'cleared' | 'left';
  connected: boolean; lastSeq: number; units: Unit[]; enemies: Enemy[]; enemySpawnCount: number;
  defeatReason: 'overcrowded' | 'boss_timeout' | 'facility_destroyed' | null;
  facilityHp: number | null; lastFacilityHitTick: number | null;
  upgrades: { [tag: string]: number }; disconnectedAtTick: number | null;
  overcrowdedTicks: number; lastActionKey: string; lastActionResult: ActionResult;
  unlockedRecipes: string[]; kills: number; investmentActions: number; result: ExpeditionResult | null;
}
export interface Story { wave: number; hp: number; maxHp: number; remainingTicks: number; status: 'active' | 'success' | 'failed' }
export interface GameState {
  protocolVersion: string; contentVersion: string; tick: number; wave: number;
  status: 'playing' | 'finished'; practice: boolean; players: Player[]; story: Story | null;
  rngState: number; placementRngState: number; nextEntityId: number;
  battlefieldId: number; rules: Rules; stories: typeof content.stories;
  objective: typeof content.battlefields[number]['objective'];
}

const tags = ['shu', 'wei', 'wu', 'infantry', 'archer', 'cavalry', 'might', 'strategy', 'command'];
const fail = (error: string): ActionResult => ({ ok: false, error });
const playerById = (game: GameState, id: string): Player | undefined => game.players.filter(p => p.id === id)[0];
const definition = (id: string) => content.units.filter(u => u.id === id)[0];
const safeInteger = (value: number): boolean => typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value > 0 && value <= 9007199254740991;

export function createGame(options: { playerIds: string[]; seed: number; practice?: boolean; battlefieldId?: number; unlockedRecipesByPlayer?: { [playerId: string]: string[] } }): GameState {
  if (!options.playerIds.length || options.playerIds.length > 8) throw new Error('Expected 1 to 8 players');
  if (!isFinite(options.seed)) throw new Error('Expected finite seed');
  const battlefieldId = options.battlefieldId === undefined ? 1 : options.battlefieldId;
  const battlefield = content.battlefields.filter(b => b.id === battlefieldId)[0];
  if (!battlefield) throw new Error('Unknown battlefield');
  const rules: Rules = { ...content.rules, ...battlefield.rules };
  const ids: string[] = [];
  const players = options.playerIds.map(id => {
    if (typeof id !== 'string' || !id.length || ids.indexOf(id) >= 0) throw new Error('Expected unique non-empty player IDs');
    ids.push(id);
    const upgrades: { [tag: string]: number } = {};
    tags.forEach(tag => { upgrades[tag] = 0; });
    const requestedUnlocks = options.unlockedRecipesByPlayer && options.unlockedRecipesByPlayer[id] || [];
    const unlockedRecipes = content.recipes.filter(recipe => recipe.unlockBattlefield > 0 && Array.isArray(requestedUnlocks) && requestedUnlocks.indexOf(recipe.id) >= 0).map(recipe => recipe.id);
    return { id, gold: rules.startingGold, status: 'active' as 'active', connected: true, lastSeq: 0,
      units: [], enemies: [], enemySpawnCount: 0, upgrades, disconnectedAtTick: null, overcrowdedTicks: 0, defeatReason: null,
      facilityHp: battlefield.objective.kind === 'overcrowd' ? null : battlefield.objective.facilityHp, lastFacilityHitTick: null,
      lastActionKey: '', lastActionResult: { ok: false }, unlockedRecipes, kills: 0, investmentActions: 0, result: null };
  });
  return { protocolVersion: '1', contentVersion: content.version, tick: 0, wave: 1,
    status: 'playing', practice: options.practice !== false, players, story: null,
    rngState: (options.seed >>> 0) || 0x6d2b79f5,
    placementRngState: ((options.seed ^ 0x9e3779b9) >>> 0) || 0x6d2b79f5, nextEntityId: 1, battlefieldId, rules,
    objective: { ...battlefield.objective }, stories: battlefield.stories.map(story => ({ ...story })) };
}

export function expeditionProgress(game: GameState) {
  const miningTicks = game.rules.waveTicks * game.rules.totalWaves;
  const completedWaves = Math.min(game.rules.totalWaves, Math.floor(game.tick / game.rules.waveTicks));
  return {
    phase: game.status === 'finished' ? 'complete' : game.tick >= miningTicks ? 'evacuation' : 'mining',
    miningProgress: completedWaves / game.rules.totalWaves, completedWaves, totalWaves: game.rules.totalWaves,
    remainingTicks: Math.max(0, miningTicks + (game.objective.kind === 'mining' ? 0 : game.rules.bossTicks) - game.tick)
  };
}

function random(game: GameState, placement = false): number {
  let x = placement ? game.placementRngState : game.rngState;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  if (placement) game.placementRngState = x >>> 0;
  else game.rngState = x >>> 0;
  return (x >>> 0) / 4294967296;
}

function newUnit(game: GameState, definitionId: string, slot: number, investedGold = game.rules.summonCost): Unit {
  return { id: game.nextEntityId++, definitionId, slot, dispatched: false, attackCooldownTicks: 0, lastAttackTick: null, lastTargetId: null, lastAttackHits: [], investedGold };
}

export function getUnitAttack(player: Player, unit: Unit, rules: Rules = content.rules): number {
  const d = definition(unit.definitionId);
  return d.attack * (1 + (player.upgrades[d.faction] + player.upgrades[d.troop] + player.upgrades[d.trait]) * rules.upgradeBonus);
}

function selectedUnits(player: Player, ids: number[] | undefined, rules: Rules): Unit[] | null {
  if (!Array.isArray(ids) || !ids.length || ids.length > rules.maxUnits) return null;
  const units: Unit[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (!safeInteger(ids[i]) || ids.indexOf(ids[i]) !== i) return null;
    const unit = player.units.filter(u => u.id === ids[i])[0];
    if (!unit || unit.dispatched) return null;
    units.push(unit);
  }
  return units;
}

function returnUnits(player: Player): void { player.units.forEach(u => { u.dispatched = false; }); }
function retire(game: GameState, player: Player, status: 'defeated' | 'cleared' | 'left', reason: Player['defeatReason'] = null): void {
  if (player.result) return;
  const progress = expeditionProgress(game);
  const milestones = Math.min(3, Math.floor(progress.miningProgress * 4), Math.floor(player.kills / 20));
  const eligible = !game.practice && status !== 'left' && player.investmentActions >= 3 && player.kills >= 10;
  player.result = {
    battlefieldId: game.battlefieldId, status, cleared: status === 'cleared',
    researchCredits: eligible ? game.battlefieldId * (milestones * 5 + (status === 'cleared' ? 25 : 0)) : 0,
    wave: game.wave, kills: player.kills, elapsedTicks: game.tick, miningProgress: progress.miningProgress, reason
  };
  player.status = status;
  player.defeatReason = reason;
  returnUnits(player);
  if (status === 'left') player.connected = false;
}
function updateFinished(game: GameState): void {
  if (!game.players.some(p => p.status === 'active')) {
    game.status = 'finished';
    if (game.story && game.story.status === 'active') game.story.status = 'failed';
  }
}

function performAction(game: GameState, player: Player, action: Action): ActionResult {
  const rules = game.rules;
  switch (action.type) {
    case 'summon': {
      if (player.units.length >= rules.maxUnits) return fail('UNIT_CAP');
      if (player.gold < rules.summonCost) return fail('INSUFFICIENT_GOLD');
      const roll = random(game) * 10000;
      let rarity = rules.summonRarities[2];
      if (roll < rules.summonWeights[0]) rarity = rules.summonRarities[0];
      else if (roll < rules.summonWeights[0] + rules.summonWeights[1]) rarity = rules.summonRarities[1];
      const pool = content.units.filter(u => u.rarity === rarity);
      const unit = pool[Math.floor(random(game) * pool.length)];
      const emptySlots: number[] = [];
      for (let slot = 0; slot < rules.maxUnits; slot++) {
        if (!player.units.some(u => u.slot === slot)) emptySlots.push(slot);
      }
      const slot = emptySlots[Math.floor(random(game, true) * emptySlots.length)];
      player.gold -= rules.summonCost;
      player.units.push(newUnit(game, unit.id, slot));
      return { ok: true };
    }
    case 'combine': {
      const recipe = content.recipes.filter(r => r.id === action.recipeId)[0];
      if (!recipe) return fail('UNKNOWN_RECIPE');
      if (recipe.unlockBattlefield > 0 && player.unlockedRecipes.indexOf(recipe.id) < 0) return fail('RECIPE_LOCKED');
      const units = selectedUnits(player, action.unitIds, rules);
      if (!units || units.length !== recipe.ingredients.length) return fail('INVALID_INGREDIENTS');
      const expected = recipe.ingredients.slice().sort();
      const actual = units.map(u => u.definitionId).sort();
      if (expected.some((id, i) => id !== actual[i])) return fail('INVALID_INGREDIENTS');
      // Ordered ingredients: the first is the player's chosen base robot.
      const slot = units[0].slot;
      const investedGold = units.reduce((sum, unit) => sum + (unit.investedGold || rules.summonCost), 0);
      player.units = player.units.filter(u => units.indexOf(u) < 0);
      player.units.push(newUnit(game, recipe.result, slot, investedGold));
      return { ok: true };
    }
    case 'upgrade': {
      if (typeof action.tag !== 'string' || tags.indexOf(action.tag) < 0) return fail('UNKNOWN_TAG');
      const level = player.upgrades[action.tag];
      if (level >= rules.maxUpgradeLevel) return fail('UPGRADE_CAP');
      const cost = rules.upgradeCosts[level];
      if (player.gold < cost) return fail('INSUFFICIENT_GOLD');
      player.gold -= cost;
      player.upgrades[action.tag]++;
      return { ok: true };
    }
    case 'dispatch': {
      if (!game.story || game.story.status !== 'active') return fail('NO_ACTIVE_STORY');
      const units = selectedUnits(player, action.unitIds, rules);
      if (!units) return fail('INVALID_UNITS');
      if (units.length + player.units.filter(u => u.dispatched).length > rules.maxDispatch) return fail('DISPATCH_CAP');
      units.forEach(u => { u.dispatched = true; });
      return { ok: true };
    }
    case 'salvage': {
      const units = selectedUnits(player, action.unitIds, rules);
      if (!units || units.length !== 1) return fail('INVALID_UNITS');
      player.gold += Math.floor((units[0].investedGold || rules.summonCost) * rules.salvageRefundRatio);
      player.units = player.units.filter(unit => unit !== units[0]);
      return { ok: true };
    }
    case 'leave': retire(game, player, 'left'); updateFinished(game); return { ok: true };
    default: return fail('UNKNOWN_ACTION');
  }
}

export function applyAction(game: GameState, playerId: string, action: Action): ActionResult {
  const player = playerById(game, playerId);
  if (!player) return fail('UNKNOWN_PLAYER');
  if (!action || !safeInteger(action.seq) || typeof action.type !== 'string') return fail('INVALID_ACTION');
  const key = JSON.stringify([action.type, action.recipeId, action.tag, action.unitIds]);
  if (action.seq === player.lastSeq) return key === player.lastActionKey ? player.lastActionResult : fail('SEQUENCE_REUSED');
  if (action.seq < player.lastSeq) return fail('STALE_SEQUENCE');
  if (game.status !== 'playing' || player.status !== 'active') return fail('NOT_ACTIVE');
  if (!player.connected) return fail('DISCONNECTED');
  player.lastSeq = action.seq;
  player.lastActionKey = key;
  player.lastActionResult = performAction(game, player, action);
  if (player.lastActionResult.ok && (action.type === 'summon' || action.type === 'combine' || action.type === 'upgrade')) player.investmentActions++;
  return player.lastActionResult;
}

export function setConnection(game: GameState, playerId: string, connected: boolean): void {
  const rules = game.rules;
  const player = playerById(game, playerId);
  if (!player || player.status === 'left') return;
  if (connected && player.status === 'active' && player.disconnectedAtTick !== null && game.tick - player.disconnectedAtTick > rules.disconnectGraceTicks) {
    retire(game, player, 'left');
    updateFinished(game);
    return;
  }
  if (player.connected === connected) return;
  player.connected = connected;
  player.disconnectedAtTick = connected ? null : game.tick;
}

function spawnEnemy(game: GameState, player: Player, boss: boolean): void {
  const rules = game.rules, depth = game.wave - 1;
  const hp = boss ? rules.bossHp : Math.round(rules.enemyBaseHp + depth * rules.enemyHpPerWave + depth * depth * rules.enemyHpAcceleration);
  // Player-local cycling does not consume summon RNG or multiply the spawn count.
  const routeIndex = player.enemySpawnCount++ % getBattlefieldLayout(game.battlefieldId).routes.length;
  player.enemies.push({ id: game.nextEntityId++, hp, maxHp: hp, progress: 0, routeIndex, boss });
}

function finishStory(game: GameState, success: boolean): void {
  const story = game.story!;
  story.status = success ? 'success' : 'failed';
  const reward = game.stories.filter(s => s.wave === story.wave)[0].rewardGold;
  game.players.forEach(p => {
    returnUnits(p);
    if (success && p.status === 'active') p.gold += reward;
  });
}

function attackTargets(enemies: Enemy[], primary: Enemy, pattern: string, battlefieldId: number): { enemy: Enemy; multiplier: number }[] {
  const targets = [{ enemy: primary, multiplier: pattern === 'blast' ? 0.8 : 1 }];
  if (pattern !== 'blast' && pattern !== 'arc') return targets;
  for (let hop = 0; hop < 2; hop++) {
    const origin = pattern === 'blast' ? primary : targets[targets.length - 1].enemy;
    const radius = pattern === 'blast' ? 0.06 : 0.1;
    const closed = getBattlefieldLayout(battlefieldId).routes[0].closed;
    // Preserve the legacy loop's splash reach in world units on open routes.
    const worldRadius = radius * getBattlefieldLayout(1).routes[0].length;
    let closest: Enemy | undefined, closestDistance = Infinity;
    enemies.forEach(enemy => {
      if (targets.some(target => target.enemy.id === enemy.id)) return;
      // Open routes may share progress while being at opposite entrances.
      const gap = Math.abs(origin.progress - enemy.progress);
      const distance = closed ? Math.min(gap, 1 - gap) : distanceSquared(enemyPoint(origin.progress, battlefieldId, origin.routeIndex), enemyPoint(enemy.progress, battlefieldId, enemy.routeIndex));
      if (distance <= (closed ? radius : worldRadius * worldRadius) && (distance < closestDistance || (distance === closestDistance && closest && enemy.id < closest.id))) {
        closest = enemy;
        closestDistance = distance;
      }
    });
    if (!closest) break;
    targets.push({ enemy: closest, multiplier: pattern === 'blast' || hop === 0 ? 0.45 : 0.25 });
  }
  return targets;
}

export function tick(game: GameState): void {
  if (game.status !== 'playing') return;
  const rules = game.rules;
  game.tick++;
  const bossStart = rules.waveTicks * rules.totalWaves;
  const nextWave = Math.min(rules.totalWaves, Math.floor(game.tick / rules.waveTicks) + 1);
  if (nextWave !== game.wave) {
    game.wave = nextWave;
    game.players.forEach(p => { if (p.status === 'active') p.gold += rules.waveGold + (game.wave - 1) * rules.waveGoldGrowth; });
    const mission = game.stories.filter(s => s.wave === game.wave)[0];
    if (mission) game.story = { wave: mission.wave, hp: mission.hp, maxHp: mission.hp,
      remainingTicks: mission.durationTicks, status: 'active' };
  }
  // Resolve departures and personal defeat before story contribution/rewards.
  game.players.forEach(p => {
    if (p.status !== 'active') return;
    if (p.disconnectedAtTick !== null && game.tick - p.disconnectedAtTick > rules.disconnectGraceTicks) {
      retire(game, p, 'left'); return;
    }
    const spawnInterval = Math.max(rules.minSpawnIntervalTicks, rules.spawnIntervalTicks - Math.floor((game.wave - 1) / rules.spawnRampEveryWaves));
    if (game.tick < bossStart && game.tick % spawnInterval === 0) spawnEnemy(game, p, false);
    if (game.tick === bossStart && game.objective.kind !== 'mining') spawnEnemy(game, p, true);
    p.overcrowdedTicks = game.objective.kind === 'overcrowd' && p.enemies.length >= rules.overcrowdCount ? p.overcrowdedTicks + 1 : 0;
    if (p.overcrowdedTicks >= rules.overcrowdTicks) retire(game, p, 'defeated', 'overcrowded');
    else if (game.objective.kind !== 'mining' && game.tick >= bossStart + rules.bossTicks) retire(game, p, 'defeated', 'boss_timeout');
  });
  game.players.forEach(p => {
    if (p.status !== 'active') return;
    p.enemies.forEach(e => {
      const slowed = (e.slowUntilTick || 0) >= game.tick;
      const speed = slowed ? (e.boss ? rules.bossSlowMultiplier : rules.frostSlowMultiplier) : 1;
      const next = e.progress + rules.enemyProgressPerTick * speed;
      e.progress = p.facilityHp === null ? next % 1 : Math.min(game.objective.arrivalProgress, next);
      if (p.facilityHp !== null && e.progress >= game.objective.arrivalProgress) {
        // Arrived enemies stay alive and attack independently; slow affects travel only.
        e.siegeCooldownTicks = Math.max(0, (e.siegeCooldownTicks || 0) - 1);
        if (e.siegeCooldownTicks === 0) {
          p.facilityHp = Math.max(0, p.facilityHp - game.objective.damage * (e.boss ? 6 : 1));
          p.lastFacilityHitTick = game.tick;
          e.siegeCooldownTicks = game.objective.attackIntervalTicks;
        }
      }
    });
    // Destruction wins ties with completion and prevents this lane earning story rewards.
    if (p.facilityHp === 0) { retire(game, p, 'defeated', 'facility_destroyed'); return; }
    if (game.objective.kind === 'mining' && game.tick >= bossStart) { retire(game, p, 'cleared'); return; }
    p.units.forEach(u => {
      if (u.attackCooldownTicks > 0) u.attackCooldownTicks--;
      if (u.attackCooldownTicks > 0) return;
      if (p.status !== 'active') return;
      u.lastAttackHits = [];
      const d = definition(u.definitionId), pattern = d.attackPattern || 'bolt';
      const damage = getUnitAttack(p, u, rules);
      if (u.dispatched) {
        if (!game.story || game.story.status !== 'active' || game.story.hp <= 0) return;
        const applied = Math.min(game.story.hp, damage * (pattern === 'blast' ? 0.8 : 1));
        game.story.hp = Math.max(0, game.story.hp - applied);
        u.lastTargetId = 'story:' + game.story.wave;
        u.lastAttackHits.push({ targetId: u.lastTargetId, damage: applied, boss: true });
      } else {
        if (!p.enemies.length) return;
        // Keep stable oldest-first targeting, restricted to this robot's range.
        const position = unitPoint(u.slot, game.battlefieldId), rangeSquared = d.attackRange * d.attackRange;
        const primary = p.enemies.filter(enemy => distanceSquared(position, enemyPoint(enemy.progress, game.battlefieldId, enemy.routeIndex)) <= rangeSquared)[0];
        if (!primary) return;
        u.lastTargetId = primary.id;
        const targets = attackTargets(p.enemies, primary, pattern, game.battlefieldId);
        targets.forEach(target => {
          const enemy = target.enemy, applied = Math.min(enemy.hp, damage * target.multiplier);
          enemy.hp = Math.max(0, enemy.hp - applied);
          if (d.element === 'frost' && enemy.hp > 0) enemy.slowUntilTick = game.tick + rules.frostSlowTicks;
          u.lastAttackHits.push({ targetId: enemy.id, progress: enemy.progress, routeIndex: enemy.routeIndex || 0, damage: applied, boss: enemy.boss });
        });
        const killed = targets.filter(target => target.enemy.hp === 0);
        p.enemies = p.enemies.filter(enemy => enemy.hp > 0);
        p.kills += killed.length;
        p.gold += rules.killGold * killed.length;
        if (killed.some(target => target.enemy.boss)) retire(game, p, 'cleared');
      }
      u.lastAttackTick = game.tick;
      u.attackCooldownTicks = definition(u.definitionId).attackIntervalTicks;
    });
  });
  if (game.story && game.story.status === 'active') {
    game.story.remainingTicks--;
    if (game.story.hp <= 0) finishStory(game, true);
    else if (game.story.remainingTicks <= 0) finishStory(game, false);
  }
  updateFinished(game);
}
