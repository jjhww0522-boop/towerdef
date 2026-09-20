import contentData from '../../shared/content.json';

export const content = contentData;
export type ActionType = 'summon' | 'combine' | 'upgrade' | 'dispatch' | 'leave';
export interface Action { seq: number; type: ActionType; recipeId?: string; tag?: string; unitIds?: number[] }
export interface ActionResult { ok: boolean; error?: string }
export interface Unit {
  id: number; definitionId: string; slot: number; dispatched: boolean; attackCooldownTicks: number;
  lastAttackTick: number | null; lastTargetId: number | string | null;
}
export interface Enemy { id: number; hp: number; maxHp: number; progress: number; boss: boolean }
export interface Player {
  id: string; gold: number; status: 'active' | 'defeated' | 'cleared' | 'left';
  connected: boolean; lastSeq: number; units: Unit[]; enemies: Enemy[];
  defeatReason: 'overcrowded' | 'boss_timeout' | null;
  upgrades: { [tag: string]: number }; disconnectedAtTick: number | null;
  overcrowdedTicks: number; lastActionKey: string; lastActionResult: ActionResult;
}
export interface Story { wave: number; hp: number; maxHp: number; remainingTicks: number; status: 'active' | 'success' | 'failed' }
export interface GameState {
  protocolVersion: string; contentVersion: string; tick: number; wave: number;
  status: 'playing' | 'finished'; practice: boolean; players: Player[]; story: Story | null;
  rngState: number; nextEntityId: number;
}

const tags = ['shu', 'wei', 'wu', 'infantry', 'archer', 'cavalry', 'might', 'strategy', 'command'];
const rules = content.rules;
const fail = (error: string): ActionResult => ({ ok: false, error });
const playerById = (game: GameState, id: string): Player | undefined => game.players.filter(p => p.id === id)[0];
const definition = (id: string) => content.units.filter(u => u.id === id)[0];
const safeInteger = (value: number): boolean => typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value > 0 && value <= 9007199254740991;

export function createGame(options: { playerIds: string[]; seed: number; practice?: boolean }): GameState {
  if (!options.playerIds.length || options.playerIds.length > 8) throw new Error('Expected 1 to 8 players');
  if (!isFinite(options.seed)) throw new Error('Expected finite seed');
  const ids: string[] = [];
  const players = options.playerIds.map(id => {
    if (typeof id !== 'string' || !id.length || ids.indexOf(id) >= 0) throw new Error('Expected unique non-empty player IDs');
    ids.push(id);
    const upgrades: { [tag: string]: number } = {};
    tags.forEach(tag => { upgrades[tag] = 0; });
    return { id, gold: rules.startingGold, status: 'active' as 'active', connected: true, lastSeq: 0,
      units: [], enemies: [], upgrades, disconnectedAtTick: null, overcrowdedTicks: 0, defeatReason: null,
      lastActionKey: '', lastActionResult: { ok: false } };
  });
  return { protocolVersion: '1', contentVersion: content.version, tick: 0, wave: 1,
    status: 'playing', practice: options.practice !== false, players, story: null,
    rngState: (options.seed >>> 0) || 0x6d2b79f5, nextEntityId: 1 };
}

function random(game: GameState): number {
  let x = game.rngState;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  game.rngState = x >>> 0;
  return game.rngState / 4294967296;
}

function newUnit(game: GameState, definitionId: string, slot: number): Unit {
  return { id: game.nextEntityId++, definitionId, slot, dispatched: false, attackCooldownTicks: 0, lastAttackTick: null, lastTargetId: null };
}

export function getUnitAttack(player: Player, unit: Unit): number {
  const d = definition(unit.definitionId);
  return d.attack * (1 + (player.upgrades[d.faction] + player.upgrades[d.troop] + player.upgrades[d.trait]) * rules.upgradeBonus);
}

function selectedUnits(player: Player, ids: number[] | undefined): Unit[] | null {
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
function retire(player: Player, status: 'defeated' | 'cleared' | 'left', reason: Player['defeatReason'] = null): void {
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
      let slot = 0;
      while (player.units.some(u => u.slot === slot)) slot++;
      player.gold -= rules.summonCost;
      player.units.push(newUnit(game, unit.id, slot));
      return { ok: true };
    }
    case 'combine': {
      const recipe = content.recipes.filter(r => r.id === action.recipeId)[0];
      if (!recipe) return fail('UNKNOWN_RECIPE');
      // Persistent unlocks are intentionally unavailable in this first practice build.
      if (recipe.unlockBattlefield > 0) return fail('RECIPE_LOCKED');
      const units = selectedUnits(player, action.unitIds);
      if (!units || units.length !== recipe.ingredients.length) return fail('INVALID_INGREDIENTS');
      const expected = recipe.ingredients.slice().sort();
      const actual = units.map(u => u.definitionId).sort();
      if (expected.some((id, i) => id !== actual[i])) return fail('INVALID_INGREDIENTS');
      const slot = Math.min.apply(null, units.map(u => u.slot));
      player.units = player.units.filter(u => units.indexOf(u) < 0);
      player.units.push(newUnit(game, recipe.result, slot));
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
      const units = selectedUnits(player, action.unitIds);
      if (!units) return fail('INVALID_UNITS');
      if (units.length + player.units.filter(u => u.dispatched).length > rules.maxDispatch) return fail('DISPATCH_CAP');
      units.forEach(u => { u.dispatched = true; });
      return { ok: true };
    }
    case 'leave': retire(player, 'left'); updateFinished(game); return { ok: true };
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
  return player.lastActionResult;
}

export function setConnection(game: GameState, playerId: string, connected: boolean): void {
  const player = playerById(game, playerId);
  if (!player || player.status === 'left') return;
  if (connected && player.status === 'active' && player.disconnectedAtTick !== null && game.tick - player.disconnectedAtTick > rules.disconnectGraceTicks) {
    retire(player, 'left');
    updateFinished(game);
    return;
  }
  if (player.connected === connected) return;
  player.connected = connected;
  player.disconnectedAtTick = connected ? null : game.tick;
}

function spawnEnemy(game: GameState, player: Player, boss: boolean): void {
  const hp = boss ? rules.bossHp : rules.enemyBaseHp + (game.wave - 1) * rules.enemyHpPerWave;
  player.enemies.push({ id: game.nextEntityId++, hp, maxHp: hp, progress: 0, boss });
}

function finishStory(game: GameState, success: boolean): void {
  const story = game.story!;
  story.status = success ? 'success' : 'failed';
  const reward = content.stories.filter(s => s.wave === story.wave)[0].rewardGold;
  game.players.forEach(p => {
    returnUnits(p);
    if (success && p.status === 'active') p.gold += reward;
  });
}

export function tick(game: GameState): void {
  if (game.status !== 'playing') return;
  game.tick++;
  const bossStart = rules.waveTicks * rules.totalWaves;
  const nextWave = Math.min(rules.totalWaves, Math.floor(game.tick / rules.waveTicks) + 1);
  if (nextWave !== game.wave) {
    game.wave = nextWave;
    game.players.forEach(p => { if (p.status === 'active') p.gold += rules.waveGold; });
    const mission = content.stories.filter(s => s.wave === game.wave)[0];
    if (mission) game.story = { wave: mission.wave, hp: mission.hp, maxHp: mission.hp,
      remainingTicks: mission.durationTicks, status: 'active' };
  }
  // Resolve departures and personal defeat before story contribution/rewards.
  game.players.forEach(p => {
    if (p.status !== 'active') return;
    if (p.disconnectedAtTick !== null && game.tick - p.disconnectedAtTick > rules.disconnectGraceTicks) {
      retire(p, 'left'); return;
    }
    if (game.tick < bossStart && game.tick % rules.spawnIntervalTicks === 0) spawnEnemy(game, p, false);
    if (game.tick === bossStart) spawnEnemy(game, p, true);
    p.overcrowdedTicks = p.enemies.length >= rules.overcrowdCount ? p.overcrowdedTicks + 1 : 0;
    if (p.overcrowdedTicks >= rules.overcrowdTicks) retire(p, 'defeated', 'overcrowded');
    else if (game.tick >= bossStart + rules.bossTicks) retire(p, 'defeated', 'boss_timeout');
  });
  game.players.forEach(p => {
    if (p.status !== 'active') return;
    p.enemies.forEach(e => { e.progress = (e.progress + rules.enemyProgressPerTick) % 1; });
    p.units.forEach(u => {
      if (u.attackCooldownTicks > 0) u.attackCooldownTicks--;
      if (u.attackCooldownTicks > 0) return;
      const damage = getUnitAttack(p, u);
      if (u.dispatched) {
        if (!game.story || game.story.status !== 'active' || game.story.hp <= 0) return;
        game.story.hp = Math.max(0, game.story.hp - damage);
        u.lastTargetId = 'story:' + game.story.wave;
      } else {
        if (!p.enemies.length) return;
        // The oldest surviving enemy is the stable target on the looping path.
        const target = p.enemies[0];
        u.lastTargetId = target.id;
        target.hp = Math.max(0, target.hp - damage);
        if (target.hp === 0) {
          p.enemies.shift();
          p.gold += rules.killGold;
          if (target.boss) retire(p, 'cleared');
        }
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
