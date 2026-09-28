import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import core from '../dist/server/core/index.js';

export const ENGINE_MAX = 5;
export const ENGINE_RECOVERY_MS = 30 * 60 * 1000;
export const ENGINE_REFILL_PRODUCT = 'engine_refill';

const clone = value => JSON.parse(JSON.stringify(value));
const hash = token => createHash('sha256').update(token).digest('hex');
const RETIRED_RESEARCH_COSTS = { make_liu_bei: 60, make_cao_cao: 100, make_sun_quan: 160, make_orbital_ark: 240 };
const ROSTER_MIGRATION = 'six-elements-v1';

export class ProgressionError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}

// One local server process owns this store. A complete transaction is flushed to
// a sibling file, then renamed, before its new balance is returned to a client.
export function createProgressionStore({ filePath = null, content = core.content, now = Date.now } = {}) {
  const target = filePath ? resolve(filePath) : null;
  const bootId = randomUUID();
  let data = { version: 1, profiles: {} }, writeNumber = 0;
  if (target && existsSync(target)) {
    data = JSON.parse(readFileSync(target, 'utf8'));
    if (data.version !== 1 || !data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles)) {
      throw new Error('Unsupported or damaged progression store; preserve the file for recovery.');
    }
  }
  const battlefields = () => content.battlefields || [{ id: 1 }];
  function unlockedRecipes(profile) {
    const recipes = profile.unlockedRecipes.filter(id => content.recipes.some(recipe => recipe.id === id && recipe.unlockType !== 'future'));
    for (const recipe of content.recipes) {
      if (recipe.unlockType === 'clear' && recipe.unlockBattlefield > 0 && recipe.researchCost === 0 &&
          profile.clearedBattlefields.includes(recipe.unlockBattlefield) && !recipes.includes(recipe.id)) recipes.push(recipe.id);
    }
    return recipes;
  }
  function engineBalance(profile, timestamp = now()) {
    const stored = profile.engines || { count: ENGINE_MAX, nextRecoveryAt: null };
    let { count, nextRecoveryAt } = stored;
    if (count < ENGINE_MAX && nextRecoveryAt !== null && timestamp >= nextRecoveryAt) {
      const recovered = Math.floor((timestamp - nextRecoveryAt) / ENGINE_RECOVERY_MS) + 1;
      count = Math.min(ENGINE_MAX, count + recovered);
      nextRecoveryAt = count === ENGINE_MAX ? null : nextRecoveryAt + recovered * ENGINE_RECOVERY_MS;
    }
    return { count, nextRecoveryAt };
  }
  const view = (profile, timestamp = now()) => ({
    id: profile.id,
    tutorialCompleted: profile.tutorialCompleted === true,
    engines: { ...engineBalance(profile, timestamp), max: ENGINE_MAX, recoveryIntervalMs: ENGINE_RECOVERY_MS, serverTime: timestamp },
    researchCredits: profile.researchCredits,
    rosterMigration: profile.rosterMigration?.refundedCredits > 0 ? { version: profile.rosterMigration.version, refundedCredits: profile.rosterMigration.refundedCredits } : null,
    unlockedRecipes: unlockedRecipes(profile),
    clearedBattlefields: [...profile.clearedBattlefields],
    unlockedBattlefields: battlefields().filter(field => field.id === 1 || profile.clearedBattlefields.includes(field.id - 1)).map(field => field.id),
    stats: { ...profile.stats },
    lastResult: profile.lastResult ? clone(profile.lastResult) : null,
    lastInterruption: profile.lastInterruption ? clone(profile.lastInterruption) : null
  });
  function commit(next) {
    if (target) {
      mkdirSync(dirname(target), { recursive: true });
      const temporary = target + '.' + process.pid + '.' + ++writeNumber + '.tmp';
      let descriptor;
      try {
        descriptor = openSync(temporary, 'wx', 0o600);
        writeFileSync(descriptor, JSON.stringify(next));
        fsyncSync(descriptor);
        closeSync(descriptor); descriptor = undefined;
        renameSync(temporary, target);
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        if (existsSync(temporary)) unlinkSync(temporary);
        throw error;
      }
    }
    data = next;
  }
  function requireProfile(profileId) {
    const profile = data.profiles[profileId];
    if (!profile) throw new ProgressionError('profile_required', 401);
    return profile;
  }
  // Content replacement retires old paid research, never maps it onto unrelated robots.
  // Persist the refund receipt in the same atomic write as the balance and new unlocks.
  function migrateRoster() {
    if (!content.units?.some(unit => unit.id === 'guardian_s')) return 0;
    const next = clone(data); let migrated = 0;
    for (const profile of Object.values(next.profiles)) {
      if (profile.rosterMigration?.version === ROSTER_MIGRATION) continue;
      const retiredRecipes = [...new Set(profile.unlockedRecipes.filter(id => !content.recipes.some(recipe => recipe.id === id)))];
      const refundedCredits = retiredRecipes.reduce((sum, id) => sum + (Object.hasOwn(RETIRED_RESEARCH_COSTS, id) ? RETIRED_RESEARCH_COSTS[id] : 0), 0);
      profile.researchCredits += refundedCredits;
      if (!Number.isSafeInteger(profile.researchCredits)) throw new Error('Research balance exceeds supported range.');
      profile.unlockedRecipes = unlockedRecipes(profile);
      profile.rosterMigration = { version: ROSTER_MIGRATION, retiredRecipes, refundedCredits };
      migrated++;
    }
    if (migrated) commit(next);
    return migrated;
  }
  return {
    migrateRoster,
    // Called before server admission. Engine refunds require this explicit recovery call.
    // Old engineEntries without this new ledger are deliberately not recoverable.
    recoverInterruptedExpeditions() {
      const next = clone(data), timestamp = now();
      let recovered = 0;
      for (const profile of Object.values(next.profiles)) {
        for (const [expeditionId, entry] of Object.entries(profile.expeditions || {})) {
          if (entry.status !== 'active' || typeof entry.bootId !== 'string' || entry.bootId === bootId) continue;
          // A pre-existing reward receipt takes precedence over any stale active marker.
          if (Object.hasOwn(profile.rewards, expeditionId)) {
            entry.status = 'settled'; entry.settledAt = timestamp;
            recovered++;
            continue;
          }
          const engines = engineBalance(profile, timestamp);
          const count = Math.min(ENGINE_MAX, engines.count + 1);
          profile.engines = { count, nextRecoveryAt: count === ENGINE_MAX ? null : engines.nextRecoveryAt };
          entry.status = 'aborted'; entry.abortedAt = timestamp; entry.reason = 'server_restart';
          entry.enginesRefunded = count - engines.count;
          profile.lastInterruption = { expeditionId, reason: entry.reason, at: timestamp, enginesRefunded: entry.enginesRefunded };
          recovered++;
        }
      }
      if (recovered) commit(next);
      return recovered;
    },
    createProfile() {
      const profileToken = randomBytes(32).toString('hex'), id = randomUUID();
      const profile = { id, tokenHash: hash(profileToken), tutorialCompleted: false, researchCredits: 0, unlockedRecipes: [], clearedBattlefields: [],
        stats: { expeditions: 0, clears: 0 }, lastResult: null, rewards: {},
        engines: { count: ENGINE_MAX, nextRecoveryAt: null }, engineEntries: {} };
      if (content.units?.some(unit => unit.id === 'guardian_s')) profile.rosterMigration = { version: ROSTER_MIGRATION, retiredRecipes: [], refundedCredits: 0 };
      const next = clone(data); next.profiles[id] = profile; commit(next);
      return { profileToken, profile: view(profile) };
    },
    authenticate(token) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
      const digest = hash(token), profile = Object.values(data.profiles).find(item => item.tokenHash === digest);
      return profile ? view(profile) : null;
    },
    getProfile(profileId) { return view(requireProfile(profileId)); },
    completeTutorial(profileId) {
      const profile = requireProfile(profileId);
      if (profile.tutorialCompleted === true) return { applied: false, profile: view(profile) };
      const next = clone(data), updated = next.profiles[profileId];
      updated.tutorialCompleted = true;
      commit(next);
      return { applied: true, profile: view(updated) };
    },
    consumeEngine(profileId, expeditionId) {
      const profile = requireProfile(profileId);
      if (typeof expeditionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(expeditionId)) throw new Error('Invalid authoritative expedition ID.');
      if (Object.hasOwn(profile.engineEntries || {}, expeditionId)) return { applied: false, profile: view(profile) };
      const timestamp = now(), engines = engineBalance(profile, timestamp);
      if (engines.count === 0) throw new ProgressionError('insufficient_engines');
      const next = clone(data), updated = next.profiles[profileId];
      updated.engines = { count: engines.count - 1, nextRecoveryAt: engines.nextRecoveryAt ?? timestamp + ENGINE_RECOVERY_MS };
      updated.engineEntries ||= {};
      updated.engineEntries[expeditionId] = timestamp;
      updated.expeditions ||= {};
      updated.expeditions[expeditionId] = { status: 'active', bootId, startedAt: timestamp };
      commit(next);
      return { applied: true, profile: view(updated) };
    },
    // Internal only: the HTTP layer must verify a store purchase and account binding first.
    refillEngines(profileId, purchase) {
      const profile = requireProfile(profileId);
      if (!purchase || !['apple', 'google'].includes(purchase.platform) ||
          typeof purchase.transactionId !== 'string' || !purchase.transactionId.length || purchase.transactionId.length > 512 ||
          purchase.productId !== ENGINE_REFILL_PRODUCT || purchase.profileId !== profileId || purchase.status !== 'purchased') {
        throw new ProgressionError('purchase_not_verified', 400);
      }
      const key = purchase.platform + ':' + purchase.transactionId;
      if (Object.hasOwn(data.enginePurchases || {}, key)) {
        if (data.enginePurchases[key].profileId !== profileId) throw new ProgressionError('purchase_already_claimed');
        return { applied: false, profile: view(profile) };
      }
      const next = clone(data), updated = next.profiles[profileId];
      updated.engines = { count: ENGINE_MAX, nextRecoveryAt: null };
      next.enginePurchases ||= {};
      next.enginePurchases[key] = { profileId, productId: ENGINE_REFILL_PRODUCT };
      commit(next);
      return { applied: true, profile: view(updated) };
    },
    research(profileId, recipeId) {
      const profile = requireProfile(profileId);
      const recipe = content.recipes.find(item => item.id === recipeId);
      if (!recipe || ['clear', 'future'].includes(recipe.unlockType) || !(recipe.unlockBattlefield > 0) || !Number.isSafeInteger(recipe.researchCost) || recipe.researchCost <= 0) {
        throw new ProgressionError('recipe_not_researchable', 400);
      }
      if (profile.unlockedRecipes.includes(recipeId)) return { ok: true, alreadyUnlocked: true, profile: view(profile) };
      if (!profile.clearedBattlefields.includes(recipe.unlockBattlefield)) throw new ProgressionError('research_prerequisite');
      if (profile.researchCredits < recipe.researchCost) throw new ProgressionError('insufficient_research_credits');
      const next = clone(data), updated = next.profiles[profileId];
      updated.researchCredits -= recipe.researchCost;
      updated.unlockedRecipes.push(recipeId);
      commit(next);
      return { ok: true, alreadyUnlocked: false, profile: view(updated) };
    },
    recordResult(profileId, expeditionId, result) {
      const profile = requireProfile(profileId);
      if (typeof expeditionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(expeditionId)) throw new Error('Invalid authoritative expedition ID.');
      if (Object.hasOwn(profile.rewards, expeditionId)) return { applied: false, profile: view(profile) };
      const entry = profile.expeditions?.[expeditionId];
      if (entry && entry.status !== 'active') return { applied: false, profile: view(profile) };
      if (result?.practice === true || result?.tutorial === true) {
        if (entry && ['cleared', 'defeated', 'left'].includes(result.status)) {
          const next = clone(data), updated = next.profiles[profileId];
          updated.expeditions[expeditionId] = { ...entry, status: 'settled', settledAt: now(), resultStatus: result.status };
          commit(next);
          return { applied: false, profile: view(updated) };
        }
        return { applied: false, profile: view(profile) };
      }
      if (!result || !['cleared', 'defeated', 'left'].includes(result.status) || result.cleared !== (result.status === 'cleared') ||
          !Number.isSafeInteger(result.researchCredits) || result.researchCredits < 0 ||
          (result.status === 'left' && result.researchCredits !== 0) || !view(profile).unlockedBattlefields.includes(result.battlefieldId)) {
        throw new Error('Invalid authoritative result.');
      }
      const next = clone(data), updated = next.profiles[profileId];
      updated.researchCredits += result.researchCredits;
      if (!Number.isSafeInteger(updated.researchCredits)) throw new Error('Research balance exceeds supported range.');
      if (result.cleared && !updated.clearedBattlefields.includes(result.battlefieldId)) {
        updated.clearedBattlefields.push(result.battlefieldId);
        updated.clearedBattlefields.sort((a, b) => a - b);
      }
      updated.unlockedRecipes = unlockedRecipes(updated);
      updated.stats.expeditions++;
      if (result.cleared) updated.stats.clears++;
      updated.lastResult = { ...clone(result), expeditionId };
      updated.rewards[expeditionId] = { researchCredits: result.researchCredits, battlefieldId: result.battlefieldId };
      if (entry) updated.expeditions[expeditionId] = { ...entry, status: 'settled', settledAt: now(), resultStatus: result.status };
      commit(next);
      return { applied: true, profile: view(updated) };
    }
  };
}
