import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import core from '../dist/server/core/index.js';

const clone = value => JSON.parse(JSON.stringify(value));
const hash = token => createHash('sha256').update(token).digest('hex');

export class ProgressionError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}

// One local server process owns this store. A complete transaction is flushed to
// a sibling file, then renamed, before its new balance is returned to a client.
export function createProgressionStore({ filePath = null, content = core.content } = {}) {
  const target = filePath ? resolve(filePath) : null;
  let data = { version: 1, profiles: {} }, writeNumber = 0;
  if (target && existsSync(target)) {
    data = JSON.parse(readFileSync(target, 'utf8'));
    if (data.version !== 1 || !data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles)) {
      throw new Error('Unsupported or damaged progression store; preserve the file for recovery.');
    }
  }
  const battlefields = () => content.battlefields || [{ id: 1 }];
  const view = profile => ({
    id: profile.id,
    researchCredits: profile.researchCredits,
    unlockedRecipes: [...profile.unlockedRecipes],
    clearedBattlefields: [...profile.clearedBattlefields],
    unlockedBattlefields: battlefields().filter(field => field.id === 1 || profile.clearedBattlefields.includes(field.id - 1)).map(field => field.id),
    stats: { ...profile.stats },
    lastResult: profile.lastResult ? clone(profile.lastResult) : null
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
  return {
    createProfile() {
      const profileToken = randomBytes(32).toString('hex'), id = randomUUID();
      const profile = { id, tokenHash: hash(profileToken), researchCredits: 0, unlockedRecipes: [], clearedBattlefields: [],
        stats: { expeditions: 0, clears: 0 }, lastResult: null, rewards: {} };
      const next = clone(data); next.profiles[id] = profile; commit(next);
      return { profileToken, profile: view(profile) };
    },
    authenticate(token) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
      const digest = hash(token), profile = Object.values(data.profiles).find(item => item.tokenHash === digest);
      return profile ? view(profile) : null;
    },
    getProfile(profileId) { return view(requireProfile(profileId)); },
    research(profileId, recipeId) {
      const profile = requireProfile(profileId);
      const recipe = content.recipes.find(item => item.id === recipeId);
      if (!recipe || !(recipe.unlockBattlefield > 0) || !Number.isSafeInteger(recipe.researchCost) || recipe.researchCost <= 0) {
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
      updated.stats.expeditions++;
      if (result.cleared) updated.stats.clears++;
      updated.lastResult = { ...clone(result), expeditionId };
      updated.rewards[expeditionId] = { researchCredits: result.researchCredits, battlefieldId: result.battlefieldId };
      commit(next);
      return { applied: true, profile: view(updated) };
    }
  };
}
