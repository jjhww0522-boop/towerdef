import contentData from '../../shared/content.json';
import { unitPoint, enemyPoint, distanceSquared, getBattlefieldLayout } from '../../shared/battle-geometry';
import { upgradeKeys, getUpgradeLevel } from '../../shared/upgrade-model';

export const content = contentData;
export type ActionType = 'summon' | 'combine' | 'upgrade' | 'dispatch' | 'salvage' | 'leave' | 'tutorial_next' | 'tactic' | 'choose_mod';
export type Tactic = 'overdrive' | 'emp';
export type EnemyArchetype = 'grunt' | 'runner' | 'plated' | 'swarm' | 'boss';
export interface Action { seq: number; type: ActionType; recipeId?: string; tag?: string; unitIds?: number[]; tactic?: Tactic; offerId?: string; modId?: string }
export interface ActionResult { ok: boolean; error?: string }
export interface AttackHit { targetId: number | string; progress?: number; routeIndex?: number; damage: number; boss?: boolean }
export interface Unit {
  id: number; definitionId: string; slot: number; dispatched: boolean; attackCooldownTicks: number;
  lastAttackTick: number | null; lastTargetId: number | string | null;
  lastAttackHits: AttackHit[];
  investedGold: number;
}
export interface Enemy { id: number; hp: number; maxHp: number; progress: number; routeIndex?: number; boss: boolean; archetype?: EnemyArchetype; slowUntilTick?: number; stunnedUntilTick?: number; siegeCooldownTicks?: number }
export interface BattleStats {
  kills: number; damageDealt: number; facilityDamageTaken: number; biggestHit: number; peakEnemies: number;
  tacticsUsed: { overdrive: number; emp: number };
}
export interface FieldModSelection {
  activeId: string | null;
  history: { offerId: 'survey' | 'retune'; modId: string; tick: number }[];
  stats: { modId: string; hits: number; bonusDamage: number }[];
}
export interface FieldModView extends FieldModSelection {
  offerId: 'survey' | 'retune' | null; available: boolean; nextOfferTick: number | null; optionIds: string[];
}
export interface Encounter {
  wave: number; label: string; description: string; archetype: EnemyArchetype; count: number;
  startTick: number; spawnIntervalTicks: number; routeCount: number;
}
export type Rules = typeof content.rules;
export interface ExpeditionResult {
  battlefieldId: number; status: 'defeated' | 'cleared' | 'left'; cleared: boolean; researchCredits: number;
  wave: number; kills: number; elapsedTicks: number; miningProgress: number;
  reason: 'overcrowded' | 'boss_timeout' | 'facility_destroyed' | null;
  battleStats: BattleStats;
  fieldMod?: FieldModView | null;
}
export interface Player {
  id: string; gold: number; status: 'active' | 'defeated' | 'cleared' | 'left';
  connected: boolean; lastSeq: number; nextSummonTick: number; units: Unit[]; enemies: Enemy[]; enemySpawnCount: number;
  defeatReason: 'overcrowded' | 'boss_timeout' | 'facility_destroyed' | null;
  facilityHp: number | null; lastFacilityHitTick: number | null;
  upgrades: { [tag: string]: number }; disconnectedAtTick: number | null;
  overcrowdedTicks: number; lastActionKey: string; lastActionResult: ActionResult;
  unlockedRecipes: string[]; kills: number; investmentActions: number; result: ExpeditionResult | null;
  nextTacticTick: number; overdriveUntilTick: number; lastTacticTick: number | null; lastTactic: Tactic | null;
  battleStats: BattleStats;
  fieldMod: FieldModSelection | null;
}
export interface Story { wave: number; hp: number; maxHp: number; remainingTicks: number; status: 'active' | 'success' | 'failed' }
export interface Tutorial {
  step: 'intro' | 'summon' | 'skirmish' | 'inspect' | 'fill' | 'sell' | 'replacement' | 'combine' | 'counterattack' | 'boss_ready' | 'countdown' | 'boss' | 'complete';
  drawCount: number; anchorUnitId: number | null; saleUnitId: number | null; skirmishAtTick: number | null; bossAtTick: number | null;
}
export interface GameState {
  protocolVersion: string; contentVersion: string; tick: number; wave: number;
  status: 'playing' | 'finished'; practice: boolean; tutorial: Tutorial | null; players: Player[]; story: Story | null;
  rngState: number; placementRngState: number; nextEntityId: number;
  battlefieldId: number; rules: Rules; stories: typeof content.stories;
  objective: typeof content.battlefields[number]['objective'];
}

const tags = upgradeKeys;
const fail = (error: string): ActionResult => ({ ok: false, error });
const playerById = (game: GameState, id: string): Player | undefined => game.players.filter(p => p.id === id)[0];
const definition = (id: string) => content.units.filter(u => u.id === id)[0];
const safeInteger = (value: number): boolean => typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value > 0 && value <= 9007199254740991;

export function createGame(options: { playerIds: string[]; seed: number; practice?: boolean; tutorial?: boolean; battlefieldId?: number; unlockedRecipesByPlayer?: { [playerId: string]: string[] } }): GameState {
  if (!options.playerIds.length || options.playerIds.length > 8) throw new Error('Expected 1 to 8 players');
  if (!isFinite(options.seed)) throw new Error('Expected finite seed');
  if (options.tutorial && options.playerIds.length !== 1) throw new Error('Tutorial is solo');
  const battlefieldId = options.tutorial ? 0 : options.battlefieldId === undefined ? 1 : options.battlefieldId;
  const battlefield = content.battlefields.filter(b => b.id === (options.tutorial ? 1 : battlefieldId))[0];
  if (!battlefield) throw new Error('Unknown battlefield');
  const rules: Rules = { ...content.rules, ...battlefield.rules };
  if (options.tutorial) Object.assign(rules, { maxUnits: 4, startingGold: 100, waveTicks: 80,
    totalWaves: 1, enemyBaseHp: 120,
    bossTicks: 600, bossHp: 720, waveGold: 0, waveGoldGrowth: 0 });
  const ids: string[] = [];
  const players = options.playerIds.map(id => {
    if (typeof id !== 'string' || !id.length || ids.indexOf(id) >= 0) throw new Error('Expected unique non-empty player IDs');
    ids.push(id);
    const upgrades: { [tag: string]: number } = {};
    tags.forEach(tag => { upgrades[tag] = 0; });
    const requestedUnlocks = options.tutorial ? [] : options.unlockedRecipesByPlayer && options.unlockedRecipesByPlayer[id] || [];
    const unlockedRecipes = content.recipes.filter(recipe => recipe.unlockBattlefield > 0 && Array.isArray(requestedUnlocks) && requestedUnlocks.indexOf(recipe.id) >= 0).map(recipe => recipe.id);
    return { id, gold: rules.startingGold, status: 'active' as 'active', connected: true, lastSeq: 0, nextSummonTick: 0,
      units: [], enemies: [], enemySpawnCount: 0, upgrades, disconnectedAtTick: null, overcrowdedTicks: 0, defeatReason: null,
      facilityHp: battlefield.objective.kind === 'overcrowd' ? null : battlefield.objective.facilityHp, lastFacilityHitTick: null,
      nextTacticTick: 0, overdriveUntilTick: 0, lastTacticTick: null, lastTactic: null,
      fieldMod: options.tutorial ? null : { activeId: null, history: [], stats: content.fieldMods.map(mod => ({ modId: mod.id, hits: 0, bonusDamage: 0 })) },
      battleStats: { kills: 0, damageDealt: 0, facilityDamageTaken: 0, biggestHit: 0, peakEnemies: 0, tacticsUsed: { overdrive: 0, emp: 0 } },
      lastActionKey: '', lastActionResult: { ok: false }, unlockedRecipes, kills: 0, investmentActions: 0, result: null };
  });
  return { protocolVersion: '1', contentVersion: content.version, tick: 0, wave: 1,
    status: 'playing', practice: options.tutorial === true || options.practice !== false, players, story: null,
    tutorial: options.tutorial ? { step: 'intro', drawCount: 0, anchorUnitId: null, saleUnitId: null, skirmishAtTick: null, bossAtTick: null } : null,
    rngState: (options.seed >>> 0) || 0x6d2b79f5,
    placementRngState: ((options.seed ^ 0x9e3779b9) >>> 0) || 0x6d2b79f5, nextEntityId: 1, battlefieldId, rules,
    objective: { ...battlefield.objective }, stories: options.tutorial ? [] : battlefield.stories.map(story => ({ ...story })) };
}

export function tutorialCombatPaused(game: GameState): boolean {
  return !!game.tutorial && ['skirmish', 'counterattack', 'boss'].indexOf(game.tutorial.step) < 0;
}

export function fieldModView(game: GameState, player: Player): FieldModView | null {
  if (game.tutorial || !player.fieldMod) return null;
  const duration = game.rules.waveTicks * game.rules.totalWaves;
  const surveyAt = Math.floor(duration / 3), retuneAt = Math.floor(duration * 2 / 3);
  const currentTick = player.result ? player.result.elapsedTicks : game.tick;
  const offerId = currentTick >= retuneAt ? 'retune' : currentTick >= surveyAt ? 'survey' : null;
  return {
    activeId: player.fieldMod.activeId, offerId,
    available: game.status === 'playing' && player.status === 'active' && player.connected && offerId !== null &&
      !player.fieldMod.history.some(choice => choice.offerId === offerId),
    nextOfferTick: currentTick < surveyAt ? surveyAt : currentTick < retuneAt ? retuneAt : null,
    optionIds: content.fieldMods.map(mod => mod.id),
    history: player.fieldMod.history.map(choice => ({ ...choice })),
    stats: player.fieldMod.stats.map(stat => ({ ...stat }))
  };
}

function encounterDefinition(wave: number) {
  return content.encounters[wave <= 2 ? content.encounters.length - 1 : (wave - 3) % content.encounters.length];
}

function waveEncounter(game: GameState, wave: number): Encounter {
  const rules = game.rules, boss = wave > rules.totalWaves;
  const encounter = encounterDefinition(wave);
  const baseInterval = Math.max(rules.minSpawnIntervalTicks, rules.spawnIntervalTicks - Math.floor((wave - 1) / rules.spawnRampEveryWaves));
  const interval = Math.max(1, Math.round(baseInterval * encounter.intervalMultiplier));
  return { wave: Math.min(wave, rules.totalWaves),
    label: boss ? '거대 회수기 출현' : encounter.label,
    description: boss ? '제한 시간 안에 보스를 쓰러뜨리세요. 증폭과 조립을 준비하세요.' : encounter.description,
    archetype: boss ? 'boss' : encounter.archetype as EnemyArchetype,
    count: boss ? 1 : Math.floor((rules.waveTicks - 1) / interval) * encounter.batchSize,
    startTick: (wave - 1) * rules.waveTicks, spawnIntervalTicks: boss ? 0 : interval,
    routeCount: getBattlefieldLayout(game.battlefieldId).routes.length };
}

export function encounterPreview(game: GameState): { current: Encounter; next: Encounter | null; remainingTicks: number } | null {
  if (game.tutorial) return null;
  const afterWaves = game.tick >= game.rules.waveTicks * game.rules.totalWaves;
  const wave = afterWaves && game.objective.kind !== 'mining' ? game.rules.totalWaves + 1 : game.wave;
  const current = waveEncounter(game, wave);
  const next = wave <= game.rules.totalWaves && !(wave === game.rules.totalWaves && game.objective.kind === 'mining') ? waveEncounter(game, wave + 1) : null;
  return { current, next, remainingTicks: Math.max(0, current.startTick + (wave > game.rules.totalWaves ? game.rules.bossTicks : game.rules.waveTicks) - game.tick) };
}

export function expeditionProgress(game: GameState) {
  if (game.tutorial) {
    const arrival = game.tutorial.bossAtTick, ready = arrival !== null, boss = ready && game.tick >= arrival!;
    return { phase: game.status === 'finished' ? 'complete' : boss ? 'evacuation' : 'mining',
      miningProgress: ready ? Math.max(0, Math.min(1, 1 - (arrival! - game.tick) / 80)) : 0,
      completedWaves: boss ? 1 : 0, totalWaves: 1,
      remainingTicks: ready ? Math.max(0, arrival! + game.rules.bossTicks - game.tick) : 0 };
  }
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
  return d.attack * (1 + getUpgradeLevel(d, player.upgrades) * rules.upgradeBonus);
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
  const fieldMod = fieldModView(game, player);
  if (fieldMod) fieldMod.available = false;
  player.result = {
    battlefieldId: game.battlefieldId, status, cleared: status === 'cleared',
    researchCredits: eligible ? game.battlefieldId * (milestones * 5 + (status === 'cleared' ? 25 : 0)) : 0,
    wave: game.wave, kills: player.kills, elapsedTicks: game.tick, miningProgress: progress.miningProgress, reason,
    battleStats: { ...player.battleStats, tacticsUsed: { ...player.battleStats.tacticsUsed } }, fieldMod
  };
  if (game.tutorial && status === 'cleared') game.tutorial.step = 'complete';
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
  const rules = game.rules, tutorial = game.tutorial;
  if (tutorial) {
    if (action.type === 'tutorial_next') {
      if (tutorial.step === 'intro') tutorial.step = 'summon';
      else if (tutorial.step === 'inspect' && action.unitIds && action.unitIds.length === 1 && action.unitIds[0] === tutorial.anchorUnitId) tutorial.step = 'fill';
      else if (tutorial.step === 'boss_ready') {
        tutorial.step = 'countdown'; tutorial.bossAtTick = game.tick + 80;
        rules.waveTicks = tutorial.bossAtTick;
      } else return fail('TUTORIAL_ACTION_REQUIRED');
      return { ok: true };
    }
    const allowed = action.type === 'leave' ||
      action.type === 'summon' && ['summon', 'fill', 'sell', 'replacement'].indexOf(tutorial.step) >= 0 ||
      action.type === 'salvage' && tutorial.step === 'sell' && action.unitIds && action.unitIds.length === 1 && action.unitIds[0] === tutorial.saleUnitId ||
      action.type === 'combine' && tutorial.step === 'combine' && action.recipeId === 'make_laser_2' && action.unitIds && action.unitIds[0] === tutorial.anchorUnitId;
    if (!allowed) return fail('TUTORIAL_ACTION_REQUIRED');
  }
  switch (action.type) {
    case 'choose_mod': {
      const offer = fieldModView(game, player);
      if (!content.fieldMods.some(mod => mod.id === action.modId)) return fail('UNKNOWN_FIELD_MOD');
      if (!offer || offer.offerId === null) return fail('MOD_NOT_AVAILABLE');
      if (action.offerId !== offer.offerId) return fail('STALE_MOD_OFFER');
      if (!offer.available) return fail('MOD_ALREADY_CHOSEN');
      player.fieldMod!.activeId = action.modId!;
      player.fieldMod!.history.push({ offerId: offer.offerId, modId: action.modId!, tick: game.tick });
      return { ok: true };
    }
    case 'tactic': {
      if (action.tactic !== 'overdrive' && action.tactic !== 'emp') return fail('UNKNOWN_TACTIC');
      if (game.tick < player.nextTacticTick) return fail('TACTIC_COOLDOWN');
      if (action.tactic === 'overdrive') {
        if (!player.units.some(unit => !unit.dispatched)) return fail('NO_HOME_UNITS');
        player.overdriveUntilTick = game.tick + rules.overdriveTicks;
      } else {
        if (!player.enemies.length) return fail('NO_ENEMIES');
        player.enemies.forEach(enemy => { enemy.stunnedUntilTick = game.tick + (enemy.boss ? rules.empBossTicks : rules.empTicks); });
      }
      player.nextTacticTick = game.tick + rules.tacticCooldownTicks;
      player.lastTacticTick = game.tick;
      player.lastTactic = action.tactic;
      player.battleStats.tacticsUsed[action.tactic]++;
      return { ok: true };
    }
    case 'summon': {
      if (player.units.length >= rules.maxUnits) return fail('UNIT_CAP');
      if (player.gold < rules.summonCost) return fail('INSUFFICIENT_GOLD');
      if (game.tick < player.nextSummonTick) return fail('SUMMON_COOLDOWN');
      let unit;
      if (tutorial) unit = definition(['laser_1', 'frost_1', 'laser_1', 'fire_1', 'laser_1'][tutorial.drawCount]);
      else {
        const roll = random(game) * 10000;
        let rarity = rules.summonRarities[2];
        if (roll < rules.summonWeights[0]) rarity = rules.summonRarities[0];
        else if (roll < rules.summonWeights[0] + rules.summonWeights[1]) rarity = rules.summonRarities[1];
        const pool = content.units.filter(u => u.rarity === rarity);
        unit = pool[Math.floor(random(game) * pool.length)];
      }
      const emptySlots: number[] = [];
      for (let slot = 0; slot < rules.maxUnits; slot++) {
        if (!player.units.some(u => u.slot === slot)) emptySlots.push(slot);
      }
      const slot = tutorial ? emptySlots[0] : emptySlots[Math.floor(random(game, true) * emptySlots.length)];
      player.gold -= rules.summonCost;
      const created = newUnit(game, unit.id, slot);
      player.units.push(created);
      if (tutorial) {
        tutorial.drawCount++;
        if (tutorial.drawCount === 1) tutorial.anchorUnitId = created.id;
        else if (tutorial.drawCount === 2) { tutorial.step = 'skirmish'; tutorial.skirmishAtTick = game.tick; }
        else if (tutorial.drawCount === 4) { tutorial.saleUnitId = created.id; tutorial.step = 'sell'; }
        else if (tutorial.drawCount === 5) tutorial.step = 'combine';
      }
      player.nextSummonTick = game.tick + rules.summonCooldownTicks;
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
      if (tutorial) tutorial.step = 'counterattack';
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
      if (tutorial) tutorial.step = 'replacement';
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
  const key = JSON.stringify([action.type, action.recipeId, action.tag, action.unitIds, action.tactic, action.offerId, action.modId]);
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

function spawnEnemy(game: GameState, player: Player, boss: boolean, batchRoute?: number): void {
  const rules = game.rules, depth = game.wave - 1;
  const archetype = boss ? 'boss' : game.tutorial ? 'grunt' : encounterDefinition(game.wave).archetype as EnemyArchetype;
  const role = content.enemyArchetypes.filter(role => role.id === archetype)[0];
  const hp = boss ? rules.bossHp : Math.max(1, Math.round((rules.enemyBaseHp + depth * rules.enemyHpPerWave + depth * depth * rules.enemyHpAcceleration) * role.hpMultiplier));
  // Player-local cycling does not consume summon RNG or multiply the spawn count.
  const routeIndex = batchRoute === undefined ? player.enemySpawnCount % getBattlefieldLayout(game.battlefieldId).routes.length : batchRoute;
  player.enemySpawnCount++;
  player.enemies.push({ id: game.nextEntityId++, hp, maxHp: hp, progress: 0, routeIndex, boss, archetype });
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
    const worldRadius = pattern === 'blast' ? 115.92 : 193.2;
    const closed = getBattlefieldLayout(battlefieldId).routes[0].closed;
    // Keep the original physical reach when route lengths change.
    const radius = worldRadius / getBattlefieldLayout(battlefieldId).routes[0].length;
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
  if (game.tutorial?.step === 'countdown' && game.tick >= game.tutorial.bossAtTick!) game.tutorial.step = 'boss';
  const bossStart = game.tutorial && game.tutorial.bossAtTick === null ? Infinity : rules.waveTicks * rules.totalWaves;
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
    if (game.tutorial?.step === 'skirmish') {
      const elapsed = game.tick - game.tutorial.skirmishAtTick!;
      if (elapsed <= 41 && (elapsed - 1) % 20 === 0) spawnEnemy(game, p, false);
      if (elapsed >= 80) game.tutorial.step = 'inspect';
    }
    if (!game.tutorial && game.tick < bossStart) {
      const encounter = waveEncounter(game, game.wave), elapsed = game.tick - encounter.startTick;
      if (elapsed > 0 && elapsed % encounter.spawnIntervalTicks === 0) {
        const batch = encounterDefinition(game.wave).batchSize;
        // A swarm arrives together on one route, so blast and chaining can answer it.
        const route = (elapsed / encounter.spawnIntervalTicks - 1) % encounter.routeCount;
        for (let i = 0; i < batch; i++) spawnEnemy(game, p, false, route);
      }
    }
    if (game.tick === bossStart && game.objective.kind !== 'mining') spawnEnemy(game, p, true);
    p.battleStats.peakEnemies = Math.max(p.battleStats.peakEnemies, p.enemies.length);
    p.overcrowdedTicks = game.objective.kind === 'overcrowd' && p.enemies.length >= rules.overcrowdCount ? p.overcrowdedTicks + 1 : 0;
    if (p.overcrowdedTicks >= rules.overcrowdTicks) retire(game, p, 'defeated', 'overcrowded');
    else if (game.objective.kind !== 'mining' && game.tick >= bossStart + rules.bossTicks) retire(game, p, 'defeated', 'boss_timeout');
  });
  game.players.forEach(p => {
    if (p.status !== 'active') return;
    if (tutorialCombatPaused(game)) {
      // Keep timed slows and weapon cooldowns frozen while the player reads.
      p.enemies.forEach(e => { if ((e.slowUntilTick || 0) >= game.tick - 1) e.slowUntilTick = (e.slowUntilTick || 0) + 1; });
      return;
    }
    p.enemies.forEach(e => {
      if ((e.stunnedUntilTick || 0) >= game.tick) return;
      const slowed = (e.slowUntilTick || 0) >= game.tick;
      const role = content.enemyArchetypes.filter(role => role.id === (e.archetype || (e.boss ? 'boss' : 'grunt')))[0];
      const speed = role.speedMultiplier * (slowed ? (e.boss ? rules.bossSlowMultiplier : rules.frostSlowMultiplier) : 1);
      const next = e.progress + rules.enemyProgressPerTick * speed;
      e.progress = p.facilityHp === null ? next % 1 : Math.min(game.objective.arrivalProgress, next);
      if (p.facilityHp !== null && e.progress >= game.objective.arrivalProgress) {
        // Arrived enemies stay alive and attack independently; slow affects travel only.
        e.siegeCooldownTicks = Math.max(0, (e.siegeCooldownTicks || 0) - 1);
        if (e.siegeCooldownTicks === 0) {
          const damage = Math.min(p.facilityHp, game.objective.damage * role.siegeMultiplier);
          p.facilityHp -= damage;
          p.battleStats.facilityDamageTaken += damage;
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
        targets.forEach((target, hitIndex) => {
          const enemy = target.enemy;
          const boost = p.overdriveUntilTick >= game.tick ? rules.overdriveMultiplier : 1;
          const baseDamage = damage * target.multiplier * boost;
          const mod = p.fieldMod && content.fieldMods.filter(item => item.id === p.fieldMod!.activeId)[0];
          const qualifies = mod && (mod.condition === 'controlled' && ((enemy.slowUntilTick || 0) >= game.tick || (enemy.stunnedUntilTick || 0) >= game.tick) ||
            mod.condition === 'secondary' && hitIndex > 0 && (pattern === 'blast' || pattern === 'arc') ||
            mod.condition === 'healthy' && enemy.hp >= enemy.maxHp * 0.8);
          const applied = Math.min(enemy.hp, baseDamage * (qualifies ? 1 + mod!.bonus : 1));
          const extra = applied - Math.min(enemy.hp, baseDamage);
          if (extra > 0 && p.fieldMod) {
            const stat = p.fieldMod.stats.filter(item => item.modId === mod!.id)[0];
            stat.hits++; stat.bonusDamage += extra;
          }
          enemy.hp = Math.max(0, enemy.hp - applied);
          p.battleStats.damageDealt += applied;
          p.battleStats.biggestHit = Math.max(p.battleStats.biggestHit, applied);
          if (d.element === 'frost' && enemy.hp > 0) enemy.slowUntilTick = game.tick + rules.frostSlowTicks;
          u.lastAttackHits.push({ targetId: enemy.id, progress: enemy.progress, routeIndex: enemy.routeIndex || 0, damage: applied, boss: enemy.boss });
        });
        const killed = targets.filter(target => target.enemy.hp === 0);
        p.enemies = p.enemies.filter(enemy => enemy.hp > 0);
        p.kills += killed.length;
        p.battleStats.kills = p.kills;
        p.gold += killed.reduce((sum, target) => {
          const role = content.enemyArchetypes.filter(role => role.id === (target.enemy.archetype || (target.enemy.boss ? 'boss' : 'grunt')))[0];
          return sum + Math.max(1, Math.round(rules.killGold * role.killGoldMultiplier));
        }, 0);
        if (killed.some(target => target.enemy.boss)) retire(game, p, 'cleared');
      }
      u.lastAttackTick = game.tick;
      u.attackCooldownTicks = definition(u.definitionId).attackIntervalTicks;
    });
  });
  if (game.tutorial?.step === 'counterattack' && game.players[0].status === 'active' && game.players[0].enemies.length === 0) game.tutorial.step = 'boss_ready';
  if (game.story && game.story.status === 'active') {
    game.story.remainingTicks--;
    if (game.story.hp <= 0) finishStory(game, true);
    else if (game.story.remainingTicks <= 0) finishStory(game, false);
  }
  updateFinished(game);
}
