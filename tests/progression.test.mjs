import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
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
  assert.equal(created.profile.rosterMigration, null);
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

const progressionContent = { ...content, recipes: [...content.recipes,
  { id: 'clear-one-a', unlockBattlefield: 1, unlockType: 'clear', researchCost: 0 },
  { id: 'clear-one-b', unlockBattlefield: 1, unlockType: 'clear', researchCost: 0 },
  { id: 'clear-two', unlockBattlefield: 2, unlockType: 'clear', researchCost: 0 }
] };

test('stage clears grant only their automatic recipes without spending credits or duplicating rewards', () => {
  const store = createProgressionStore({ content: progressionContent, now: () => 1000 }), { profile } = store.createProfile();
  assert.deepEqual(profile.unlockedRecipes, []);
  store.recordResult(profile.id, 'failed', result({ status: 'defeated', cleared: false, researchCredits: 10 }));
  store.recordResult(profile.id, 'left', result({ status: 'left', cleared: false, researchCredits: 0 }));
  assert.deepEqual(store.getProfile(profile.id).unlockedRecipes, []);
  const first = store.recordResult(profile.id, 'first-clear', result()).profile;
  assert.deepEqual(first.unlockedRecipes, ['clear-one-a', 'clear-one-b']);
  assert.equal(first.researchCredits, 50);
  assert.equal(store.recordResult(profile.id, 'first-clear', result()).applied, false);
  store.recordResult(profile.id, 'repeat-clear', result());
  assert.deepEqual(store.getProfile(profile.id).unlockedRecipes, first.unlockedRecipes);
  const next = store.recordResult(profile.id, 'second-stage', result({ battlefieldId: 2 })).profile;
  assert.deepEqual(next.unlockedRecipes, ['clear-one-a', 'clear-one-b', 'clear-two']);
  assert.equal(next.researchCredits, 130);
  assert.equal(store.research(profile.id, 'legend').profile.researchCredits, 70);
  assert.ok(store.getProfile(profile.id).unlockedRecipes.includes('legend'));
});

test('automatic recipes cannot be purchased before or after their clear even with malformed positive costs', () => {
  const store = createProgressionStore({ content: { ...progressionContent, recipes: [...progressionContent.recipes,
    { id: 'malformed-auto', unlockBattlefield: 1, unlockType: 'clear', researchCost: 1 }
  ] } }), { profile } = store.createProfile();
  for (const unlocked of [false, true]) {
    if (unlocked) store.recordResult(profile.id, 'clear', result({ researchCredits: 500 }));
    for (const recipe of ['clear-one-a', 'clear-two', 'malformed-auto']) {
      assert.throws(() => store.research(profile.id, recipe), /recipe_not_researchable/);
    }
  }
  assert.equal(store.getProfile(profile.id).researchCredits, 500);
  assert.ok(!store.getProfile(profile.id).unlockedRecipes.includes('malformed-auto'));
});

test('practice and tutorial results cannot grant clear eligibility, recipes, credits or receipts', () => {
  const store = createProgressionStore({ content: progressionContent, now: () => 1000 }), { profile } = store.createProfile();
  for (const flags of [{ practice: true }, { tutorial: true }, { practice: true, tutorial: true }]) {
    assert.equal(store.recordResult(profile.id, 'training', result(flags)).applied, false);
    assert.deepEqual(store.getProfile(profile.id), profile);
  }
  assert.equal(store.recordResult(profile.id, 'training', result()).applied, true,
    'an ignored training result must not consume a normal result receipt');
});

test('legacy clear records restore automatic recipes and preserve paid research, engines and receipts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-legacy-unlocks-')), filePath = join(directory, 'profiles.json');
  t.after(async () => { await rm(filePath, { force: true }); await rmdir(directory); });
  let store = createProgressionStore({ filePath, content: progressionContent, now: () => 1000 });
  const account = store.createProfile(), id = account.profile.id;
  store.recordResult(id, 'one', result({ researchCredits: 100 }));
  store.research(id, 'legend');
  store.consumeEngine(id, 'spent');
  const legacy = JSON.parse(await readFile(filePath, 'utf8'));
  legacy.profiles[id].unlockedRecipes = ['legend'];
  delete legacy.profiles[id].tutorialCompleted;
  await writeFile(filePath, JSON.stringify(legacy));
  store = createProgressionStore({ filePath, content: progressionContent, now: () => 1000 });
  const restored = store.authenticate(account.profileToken);
  assert.deepEqual(restored.unlockedRecipes, ['legend', 'clear-one-a', 'clear-one-b']);
  assert.equal(restored.tutorialCompleted, false);
  assert.equal(restored.researchCredits, 40); assert.equal(restored.engines.count, 4);
  assert.equal(store.recordResult(id, 'one', result()).applied, false);
  assert.equal(store.consumeEngine(id, 'spent').applied, false);
  assert.deepEqual(store.getProfile(id), restored);
});

test('tutorial completion is durable and idempotent without altering rewards, recipes or engines', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-tutorial-')), filePath = join(directory, 'profiles.json');
  t.after(async () => { await rm(filePath, { force: true }); await rmdir(directory); });
  let store = createProgressionStore({ filePath, content: progressionContent, now: () => 1000 });
  const account = store.createProfile(), id = account.profile.id;
  assert.equal(account.profile.tutorialCompleted, false);
  assert.throws(() => store.completeTutorial('missing'), /profile_required/);
  assert.equal(store.completeTutorial(id).applied, true);
  assert.deepEqual(store.getProfile(id), { ...account.profile, tutorialCompleted: true });
  const persisted = await readFile(filePath, 'utf8');
  assert.equal(store.completeTutorial(id).applied, false);
  assert.equal(await readFile(filePath, 'utf8'), persisted);
  store = createProgressionStore({ filePath, content: progressionContent, now: () => 1000 });
  assert.equal(store.authenticate(account.profileToken).tutorialCompleted, true);
  assert.equal(store.completeTutorial(id).applied, false);
  assert.deepEqual(store.getProfile(id), { ...account.profile, tutorialCompleted: true });
});

test('failed durable writes commit neither a stage unlock nor tutorial completion', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-unlock-write-')), filePath = join(directory, 'profiles.json');
  t.after(async () => { await rm(filePath, { force: true }); await rmdir(directory); });
  const store = createProgressionStore({ filePath, content: progressionContent, now: () => 1000 });
  const { profile } = store.createProfile(), backup = filePath + '.backup';
  for (const operation of [() => store.recordResult(profile.id, 'clear', result()), () => store.completeTutorial(profile.id)]) {
    const before = await readFile(filePath, 'utf8');
    await rename(filePath, backup); await mkdir(filePath);
    try { assert.throws(operation); }
    finally { await rmdir(filePath); await rename(backup, filePath); }
    assert.equal(await readFile(filePath, 'utf8'), before);
    assert.deepEqual(store.getProfile(profile.id), profile);
  }
  assert.equal(store.recordResult(profile.id, 'clear', result()).applied, true);
  assert.deepEqual(store.getProfile(profile.id).unlockedRecipes, ['clear-one-a', 'clear-one-b']);
  assert.equal(store.completeTutorial(profile.id).applied, true);
});

test('six-element roster refunds retired research exactly once and preserves campaign, tutorial and engine history', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-roster-migration-')), filePath = join(directory, 'profiles.json');
  t.after(async () => { await rm(filePath, { force: true }); await rmdir(directory); });
  const retired = [['make_liu_bei', 60], ['make_cao_cao', 100], ['make_sun_quan', 160], ['make_orbital_ark', 240]];
  const oldContent = { battlefields: content.battlefields, recipes: retired.map(([id, researchCost]) => ({ id, unlockBattlefield: 1, researchCost })) };
  let store = createProgressionStore({ filePath, content: oldContent, now: () => 1000 });
  const account = store.createProfile(), id = account.profile.id;
  store.recordResult(id, 'first', result({ researchCredits: 1000 }));
  store.recordResult(id, 'second', result({ battlefieldId: 2, researchCredits: 80 }));
  for (const [recipeId] of retired) store.research(id, recipeId);
  store.completeTutorial(id); store.consumeEngine(id, 'spent');
  const before = store.getProfile(id);
  const newContent = { ...content, units: [{ id: 'guardian_s' }], recipes: [
    { id: 'make_fire_2', unlockBattlefield: 0 },
    { id: 'make_fire_3', unlockBattlefield: 2, unlockType: 'clear', researchCost: 0 },
    { id: 'make_fire_4', unlockBattlefield: 6, unlockType: 'future', researchCost: 0 }
  ] };
  store = createProgressionStore({ filePath, content: newContent, now: () => 1000 });
  const beforeMigration = await readFile(filePath, 'utf8'), backup = filePath + '.backup';
  await rename(filePath, backup); await mkdir(filePath);
  try { assert.throws(() => store.migrateRoster()); }
  finally { await rmdir(filePath); await rename(backup, filePath); }
  assert.equal(store.getProfile(id).researchCredits, before.researchCredits, 'failed persistence cannot publish a refund');
  assert.equal(store.getProfile(id).rosterMigration, null);
  assert.equal(await readFile(filePath, 'utf8'), beforeMigration);
  assert.equal(store.migrateRoster(), 1);
  const migrated = store.authenticate(account.profileToken);
  assert.equal(migrated.researchCredits, before.researchCredits + 560);
  assert.deepEqual(migrated.rosterMigration, { version: 'six-elements-v1', refundedCredits: 560 });
  assert.deepEqual(migrated.unlockedRecipes, ['make_fire_3']);
  for (const key of ['tutorialCompleted', 'clearedBattlefields', 'stats', 'engines', 'lastResult']) assert.deepEqual(migrated[key], before[key]);
  assert.equal(store.consumeEngine(id, 'spent').applied, false);
  assert.equal(store.recordResult(id, 'first', result()).applied, false);
  const persisted = await readFile(filePath, 'utf8');
  const archived = JSON.parse(persisted).profiles[id];
  assert.deepEqual(archived.rosterMigration.retiredRecipes.sort(), retired.map(([recipeId]) => recipeId).sort());
  assert.equal(archived.rosterMigration.refundedCredits, 560);
  store = createProgressionStore({ filePath, content: newContent, now: () => 1000 });
  assert.equal(store.migrateRoster(), 0);
  assert.deepEqual(store.getProfile(id), migrated);
  assert.equal(await readFile(filePath, 'utf8'), persisted, 'a repeated load must not reapply or rewrite a completed migration');
});

test('future recipes cannot be loaded or bought even with a forged unlock or positive cost', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-future-recipe-')), filePath = join(directory, 'profiles.json');
  t.after(async () => { await rm(filePath, { force: true }); await rmdir(directory); });
  const futureContent = { ...content, recipes: [...content.recipes, { id: 'future', unlockBattlefield: 2, unlockType: 'future', researchCost: 1 }] };
  let store = createProgressionStore({ filePath, content: futureContent });
  const { profile } = store.createProfile();
  store.recordResult(profile.id, 'one', result()); store.recordResult(profile.id, 'two', result({ battlefieldId: 2 }));
  assert.throws(() => store.research(profile.id, 'future'), /recipe_not_researchable/);
  const raw = JSON.parse(await readFile(filePath, 'utf8')); raw.profiles[profile.id].unlockedRecipes.push('future');
  await writeFile(filePath, JSON.stringify(raw)); store = createProgressionStore({ filePath, content: futureContent });
  assert.ok(!store.getProfile(profile.id).unlockedRecipes.includes('future'));
});
