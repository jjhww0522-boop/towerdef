import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgressionStore } from '../tools/progression.mjs';

const content = { battlefields: [{ id: 1 }, { id: 2 }, { id: 3 }], recipes: [
  { id: 'basic', unlockBattlefield: 0 },
  { id: 'legend', unlockBattlefield: 1, researchCost: 60 },
  { id: 'ultimate', unlockBattlefield: 2, researchCost: 100 }
] };
const result = (overrides = {}) => ({ battlefieldId: 1, status: 'cleared', cleared: true, researchCredits: 40,
  wave: 24, kills: 300, elapsedTicks: 6000, miningProgress: 1, reason: null, ...overrides });
const memoryStore = () => createProgressionStore({ content });

test('profiles start empty and only an opaque bearer authenticates them', () => {
  const store = memoryStore(), created = store.createProfile();
  assert.match(created.profileToken, /^[a-f0-9]{64}$/);
  assert.equal(created.profile.researchCredits, 0);
  assert.deepEqual(created.profile.unlockedRecipes, []);
  assert.deepEqual(created.profile.unlockedBattlefields, [1]);
  assert.equal(store.authenticate(created.profile.id), null);
  assert.equal(store.authenticate('bad-token'), null);
  assert.equal(store.authenticate(created.profileToken).id, created.profile.id);
  assert.equal(created.profile.tokenHash, undefined);
  assert.equal(created.profile.rewards, undefined);
  created.profile.researchCredits = 9999;
  created.profile.unlockedRecipes.push('ultimate');
  assert.equal(store.getProfile(created.profile.id).researchCredits, 0);
  assert.deepEqual(store.getProfile(created.profile.id).unlockedRecipes, []);
});

test('a personal terminal reward is applied once per expedition without replacing its result', () => {
  const store = memoryStore(), { profile } = store.createProfile();
  const defeat = result({ status: 'defeated', cleared: false, researchCredits: 10, wave: 8, miningProgress: .25 });
  assert.equal(store.recordResult(profile.id, 'expedition-one', defeat).applied, true);
  assert.equal(store.recordResult(profile.id, 'expedition-one', result()).applied, false);
  const current = store.getProfile(profile.id);
  assert.equal(current.researchCredits, 10);
  assert.deepEqual(current.stats, { expeditions: 1, clears: 0 });
  assert.equal(current.lastResult.status, 'defeated');
  assert.deepEqual(current.unlockedBattlefields, [1]);
  store.recordResult(profile.id, 'expedition-two', result());
  assert.equal(store.getProfile(profile.id).researchCredits, 50);
  assert.deepEqual(store.getProfile(profile.id).unlockedBattlefields, [1, 2]);
  assert.deepEqual(store.getProfile(profile.id).unlockedRecipes, [], 'a clear unlocks the planet, not paid research');
});

test('research requires its clear and funds, deducts atomically, and is idempotent', () => {
  const store = memoryStore(), { profile } = store.createProfile();
  assert.throws(() => store.research(profile.id, 'legend'), /research_prerequisite/);
  store.recordResult(profile.id, 'one', result());
  assert.throws(() => store.research(profile.id, 'legend'), /insufficient_research_credits/);
  assert.equal(store.getProfile(profile.id).researchCredits, 40);
  store.recordResult(profile.id, 'two', result());
  assert.equal(store.research(profile.id, 'legend').alreadyUnlocked, false);
  assert.equal(store.research(profile.id, 'legend').alreadyUnlocked, true);
  assert.equal(store.getProfile(profile.id).researchCredits, 20);
  assert.deepEqual(store.getProfile(profile.id).unlockedRecipes, ['legend']);
  assert.throws(() => store.research(profile.id, 'ultimate'), /research_prerequisite/);
  assert.throws(() => store.research(profile.id, 'basic'), /recipe_not_researchable/);
  assert.throws(() => store.research(profile.id, 'missing'), /recipe_not_researchable/);
  assert.throws(() => store.recordResult(profile.id, 'forged', result({ researchCredits: -5 })), /Invalid authoritative result/);
  assert.throws(() => store.recordResult(profile.id, 'skipped-planet', result({ battlefieldId: 3 })), /Invalid authoritative result/);
  assert.equal(store.getProfile(profile.id).researchCredits, 20);
});

test('balances, unlocks and payout receipts survive a store restart without storing bearer plaintext', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-progression-'));
  const filePath = join(directory, 'profiles.json');
  t.after(async () => { await rm(filePath, { force: true }); await rmdir(directory); });
  let store = createProgressionStore({ filePath, content });
  const created = store.createProfile();
  store.recordResult(created.profile.id, 'one', result());
  store.recordResult(created.profile.id, 'two', result());
  store.research(created.profile.id, 'legend');
  const persisted = await readFile(filePath, 'utf8');
  assert.ok(!persisted.includes(created.profileToken));
  store = createProgressionStore({ filePath, content });
  assert.equal(store.authenticate(created.profileToken).researchCredits, 20);
  assert.deepEqual(store.getProfile(created.profile.id).unlockedRecipes, ['legend']);
  assert.equal(store.recordResult(created.profile.id, 'one', result()).applied, false);
  assert.equal(store.research(created.profile.id, 'legend').alreadyUnlocked, true);
  assert.equal(store.getProfile(created.profile.id).researchCredits, 20);
  await writeFile(filePath, '{damaged json');
  assert.throws(() => createProgressionStore({ filePath, content }), /JSON|property/);
});
