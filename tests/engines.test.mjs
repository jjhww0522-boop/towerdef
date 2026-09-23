import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgressionStore, ENGINE_MAX, ENGINE_RECOVERY_MS } from '../tools/progression.mjs';

const START = 1_800_000_000_000;
const purchaseFor = (profileId, overrides = {}) => ({ platform: 'apple', transactionId: 'verified-transaction',
  productId: 'engine_refill', profileId, status: 'purchased', ...overrides });
function clockStore(options = {}) {
  let time = START;
  const now = () => time;
  return { store: createProgressionStore({ ...options, now }), now, setTime: value => { time = value; } };
}
async function storage(t) {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-engines-'));
  const filePath = join(directory, 'profiles.json');
  t.after(async () => { await rm(filePath, { force: true }); await rmdir(directory); });
  return filePath;
}

test('engines start full, expose the authoritative clock and do not expose mutable storage', () => {
  const { store } = clockStore(), account = store.createProfile();
  assert.deepEqual(account.profile.engines, { count: 5, max: 5, nextRecoveryAt: null,
    recoveryIntervalMs: 1_800_000, serverTime: START });
  assert.equal(ENGINE_MAX, 5); assert.equal(ENGINE_RECOVERY_MS, 1_800_000);
  account.profile.engines.count = 9000;
  assert.equal(store.getProfile(account.profile.id).engines.count, 5);
  for (const key of ['engineEntries', 'enginePurchases', 'tokenHash', 'rewards']) {
    assert.equal(store.getProfile(account.profile.id)[key], undefined);
  }
});

test('subsequent spending preserves the first recovery deadline and exact recovery boundaries', () => {
  const { store, setTime } = clockStore(), { profile } = store.createProfile();
  assert.equal(store.consumeEngine(profile.id, 'first').profile.engines.count, 4);
  setTime(START + 600_000);
  const second = store.consumeEngine(profile.id, 'second').profile.engines;
  assert.equal(second.count, 3);
  assert.equal(second.nextRecoveryAt, START + ENGINE_RECOVERY_MS);
  setTime(START + ENGINE_RECOVERY_MS - 1);
  assert.equal(store.getProfile(profile.id).engines.count, 3);
  setTime(START + ENGINE_RECOVERY_MS);
  assert.equal(store.getProfile(profile.id).engines.count, 4);
  assert.equal(store.getProfile(profile.id).engines.nextRecoveryAt, START + 2 * ENGINE_RECOVERY_MS);
  assert.equal(store.consumeEngine(profile.id, 'on-deadline').profile.engines.count, 3);
  assert.equal(store.getProfile(profile.id).engines.nextRecoveryAt, START + 2 * ENGINE_RECOVERY_MS);
});

test('offline recovery caps at five and does not bank time for the next spend', () => {
  const { store, setTime } = clockStore(), { profile } = store.createProfile();
  for (let i = 0; i < 5; i++) store.consumeEngine(profile.id, 'entry-' + i);
  setTime(START + 2 * ENGINE_RECOVERY_MS + 1234);
  let engines = store.getProfile(profile.id).engines;
  assert.equal(engines.count, 2);
  assert.equal(engines.nextRecoveryAt, START + 3 * ENGINE_RECOVERY_MS);
  const later = START + 20 * ENGINE_RECOVERY_MS;
  setTime(later);
  engines = store.getProfile(profile.id).engines;
  assert.equal(engines.count, 5); assert.equal(engines.nextRecoveryAt, null);
  engines = store.consumeEngine(profile.id, 'after-idle').profile.engines;
  assert.equal(engines.count, 4);
  assert.equal(engines.nextRecoveryAt, later + ENGINE_RECOVERY_MS);
  setTime(later + ENGINE_RECOVERY_MS - 1);
  assert.equal(store.getProfile(profile.id).engines.count, 4);
});

test('entry receipts work at zero, after recovery and independently of terminal rewards', () => {
  const { store, setTime } = clockStore(), { profile } = store.createProfile();
  for (let i = 0; i < 5; i++) store.consumeEngine(profile.id, 'entry-' + i);
  assert.equal(store.consumeEngine(profile.id, 'entry-0').applied, false);
  assert.throws(() => store.consumeEngine(profile.id, 'new-entry'), /insufficient_engines/);
  assert.throws(() => store.consumeEngine(profile.id, '../invalid'), /Invalid authoritative expedition/);
  assert.equal(store.getProfile(profile.id).engines.count, 0);
  const left = { battlefieldId: 1, status: 'left', cleared: false, researchCredits: 0 };
  assert.equal(store.recordResult(profile.id, 'entry-0', left).applied, true);
  assert.equal(store.recordResult(profile.id, 'entry-0', left).applied, false);
  assert.equal(store.getProfile(profile.id).stats.expeditions, 1);
  assert.equal(store.consumeEngine(profile.id, 'entry-0').applied, false);
  setTime(START + ENGINE_RECOVERY_MS);
  assert.equal(store.consumeEngine(profile.id, 'entry-0').profile.engines.count, 1);
  assert.equal(store.consumeEngine(profile.id, 'new-entry').applied, true, 'an earlier failed entry did not create a receipt');
  assert.equal(store.getProfile(profile.id).engines.count, 0);
});

test('verified refill caps at five, clears recovery and cannot be replayed after spending', () => {
  const { store } = clockStore(), { profile } = store.createProfile(), other = store.createProfile().profile;
  store.consumeEngine(profile.id, 'before-purchase');
  const purchase = purchaseFor(profile.id);
  const refill = store.refillEngines(profile.id, purchase);
  assert.equal(refill.applied, true);
  assert.equal(refill.profile.engines.count, 5); assert.equal(refill.profile.engines.nextRecoveryAt, null);
  store.consumeEngine(profile.id, 'after-purchase');
  assert.equal(store.refillEngines(profile.id, purchase).applied, false);
  assert.equal(store.getProfile(profile.id).engines.count, 4);
  assert.throws(() => store.refillEngines(other.id, purchaseFor(other.id)), /purchase_already_claimed/);
  assert.equal(store.getProfile(other.id).engines.count, 5);
  assert.equal(store.refillEngines(profile.id, purchaseFor(profile.id, { platform: 'google' })).applied, true,
    'transaction IDs are scoped to their verified store');
  assert.equal(store.refillEngines(profile.id, purchaseFor(profile.id, { transactionId: 'already-full' })).profile.engines.count, 5);
  store.consumeEngine(profile.id, 'after-full-purchase');
  assert.equal(store.refillEngines(profile.id, purchaseFor(profile.id, { transactionId: 'already-full' })).applied, false);
  assert.equal(store.getProfile(profile.id).engines.count, 4);
});

test('unverified purchase shapes never alter the balance or claim their transaction', () => {
  const { store } = clockStore(), { profile } = store.createProfile();
  store.consumeEngine(profile.id, 'spent');
  for (const overrides of [{ platform: 'web' }, { transactionId: '' }, { transactionId: 'a'.repeat(513) },
    { productId: 'different-product' }, { profileId: 'someone-else' }, { status: 'pending' }, { status: 'refunded' }]) {
    assert.throws(() => store.refillEngines(profile.id, purchaseFor(profile.id, overrides)), /purchase_not_verified/);
    assert.equal(store.getProfile(profile.id).engines.count, 4);
  }
  assert.throws(() => store.refillEngines(profile.id, null), /purchase_not_verified/);
  assert.equal(store.refillEngines(profile.id, purchaseFor(profile.id)).applied, true);
});

test('engine balances and both receipt types survive restart without resetting zero', async t => {
  const filePath = await storage(t), clock = clockStore({ filePath });
  let store = clock.store;
  const account = store.createProfile(), id = account.profile.id;
  store.consumeEngine(id, 'before-refill');
  store.refillEngines(id, purchaseFor(id));
  for (let i = 0; i < 5; i++) store.consumeEngine(id, 'after-refill-' + i);
  const persisted = await readFile(filePath, 'utf8');
  assert.ok(!persisted.includes(account.profileToken));
  store = createProgressionStore({ filePath, now: clock.now });
  assert.equal(store.authenticate(account.profileToken).engines.count, 0);
  assert.equal(store.consumeEngine(id, 'after-refill-0').applied, false);
  assert.equal(store.refillEngines(id, purchaseFor(id)).applied, false);
  assert.equal(store.getProfile(id).engines.count, 0);
  clock.setTime(START + ENGINE_RECOVERY_MS);
  assert.equal(store.getProfile(id).engines.count, 1);
  assert.equal(store.consumeEngine(id, 'new-after-restart').profile.engines.count, 0);
});

test('legacy profiles receive engines without losing credits, unlocks, results or authentication', async t => {
  const filePath = await storage(t), clock = clockStore({ filePath });
  const account = clock.store.createProfile(), id = account.profile.id;
  clock.store.recordResult(id, 'legacy-clear', { battlefieldId: 1, status: 'cleared', cleared: true, researchCredits: 73 });
  const old = JSON.parse(await readFile(filePath, 'utf8'));
  delete old.profiles[id].engines; delete old.profiles[id].engineEntries;
  const prior = clock.store.getProfile(id);
  await writeFile(filePath, JSON.stringify(old));
  let store = createProgressionStore({ filePath, now: clock.now });
  const restored = store.authenticate(account.profileToken);
  assert.equal(restored.engines.count, 5);
  for (const key of ['researchCredits', 'unlockedRecipes', 'clearedBattlefields', 'stats', 'lastResult']) {
    assert.deepEqual(restored[key], prior[key]);
  }
  assert.equal(store.recordResult(id, 'legacy-clear', prior.lastResult).applied, false);
  store.consumeEngine(id, 'migrated-entry');
  store = createProgressionStore({ filePath, now: clock.now });
  assert.equal(store.getProfile(id).engines.count, 4);
  assert.equal(store.consumeEngine(id, 'migrated-entry').applied, false);
});

test('a failed atomic file replacement commits neither the balance nor its entry or purchase receipt', async t => {
  const filePath = await storage(t), { store } = clockStore({ filePath });
  const { profile } = store.createProfile(), backup = filePath + '.backup';
  // A directory at the destination makes rename fail on supported platforms,
  // without relying on OS permissions or mocking the production persistence.
  const failReplacement = async operation => {
    const before = await readFile(filePath, 'utf8');
    await rename(filePath, backup); await mkdir(filePath);
    try { assert.throws(operation); }
    finally { await rmdir(filePath); await rename(backup, filePath); }
    assert.equal(await readFile(filePath, 'utf8'), before);
  };
  await failReplacement(() => store.consumeEngine(profile.id, 'retry-entry'));
  assert.equal(store.getProfile(profile.id).engines.count, 5);
  assert.equal(store.consumeEngine(profile.id, 'retry-entry').applied, true);
  assert.equal(store.getProfile(profile.id).engines.count, 4);
  const purchase = purchaseFor(profile.id);
  await failReplacement(() => store.refillEngines(profile.id, purchase));
  assert.equal(store.getProfile(profile.id).engines.count, 4);
  assert.equal(store.refillEngines(profile.id, purchase).applied, true);
  assert.equal(store.getProfile(profile.id).engines.count, 5);
});
