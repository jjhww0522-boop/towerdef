import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, mkdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgressionStore, ENGINE_RECOVERY_MS } from '../tools/progression.mjs';
import { createDevServer } from '../tools/dev-server.mjs';
import core from '../dist/server/core/index.js';

const now = () => 1_800_000_000_000;
const result = (overrides = {}) => ({ battlefieldId: 1, status: 'cleared', cleared: true, researchCredits: 10, ...overrides });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-recovery-'));
  const filePath = join(directory, 'profiles.json');
  t.after(async () => { await unlink(filePath).catch(() => {}); await rmdir(directory); });
  return { filePath, open: () => createProgressionStore({ filePath, now }) };
}

test('a previous boot active entry refunds once, never current boot or duplicate admission', async t => {
  const f = await fixture(t), first = f.open(), account = first.createProfile();
  first.consumeEngine(account.profile.id, 'lost');
  assert.equal(first.consumeEngine(account.profile.id, 'lost').applied, false);
  assert.equal(first.getProfile(account.profile.id).engines.count, 4);
  const second = f.open();
  assert.equal(second.getProfile(account.profile.id).engines.count, 4, 'opening a store is read-only');
  assert.equal(second.recoverInterruptedExpeditions(), 1);
  assert.equal(second.getProfile(account.profile.id).engines.count, 5);
  assert.deepEqual(second.getProfile(account.profile.id).lastInterruption, {
    expeditionId: 'lost', reason: 'server_restart', at: now(), enginesRefunded: 1
  });
  second.consumeEngine(account.profile.id, 'current');
  assert.equal(second.recoverInterruptedExpeditions(), 0);
  assert.equal(second.getProfile(account.profile.id).engines.count, 4);
  assert.equal(second.recordResult(account.profile.id, 'lost', result()).applied, false);
  assert.equal(second.getProfile(account.profile.id).researchCredits, 0);
  const saved = JSON.parse(await readFile(f.filePath, 'utf8'));
  assert.equal(saved.profiles[account.profile.id].expeditions.lost.status, 'aborted');
  assert.equal(saved.profiles[account.profile.id].expeditions.current.status, 'active');
});

test('refund respects elapsed recovery, preserves the next deadline below five, and never exceeds five', async t => {
  const f = await fixture(t);
  let timestamp = now();
  const open = () => createProgressionStore({ filePath: f.filePath, now: () => timestamp });
  const first = open(), { profile } = first.createProfile();
  for (let i = 0; i < 4; i++) {
    first.consumeEngine(profile.id, 'spent-' + i);
    if (i < 3) first.recordResult(profile.id, 'spent-' + i, result({ status: 'left', cleared: false, researchCredits: 0 }));
  }
  timestamp += ENGINE_RECOVERY_MS;
  const second = open();
  assert.equal(second.recoverInterruptedExpeditions(), 1);
  assert.equal(second.getProfile(profile.id).engines.count, 3);
  assert.equal(second.getProfile(profile.id).engines.nextRecoveryAt, now() + 2 * ENGINE_RECOVERY_MS);
  second.consumeEngine(profile.id, 'offline-full');
  timestamp += 5 * ENGINE_RECOVERY_MS;
  const third = open();
  assert.equal(third.recoverInterruptedExpeditions(), 1);
  assert.equal(third.getProfile(profile.id).engines.count, 5);
  assert.equal(third.getProfile(profile.id).engines.nextRecoveryAt, null);
  assert.equal(third.getProfile(profile.id).lastInterruption.enginesRefunded, 0);
  assert.equal(open().recoverInterruptedExpeditions(), 0);
});

test('failed result write grants neither rewards nor settled status; successful retry prevents refund', async t => {
  const f = await fixture(t), store = f.open(), { profile } = store.createProfile();
  store.consumeEngine(profile.id, 'ending');
  const saved = await readFile(f.filePath, 'utf8');
  await unlink(f.filePath); await mkdir(f.filePath);
  assert.throws(() => store.recordResult(profile.id, 'ending', result()));
  assert.equal(store.getProfile(profile.id).researchCredits, 0);
  await rmdir(f.filePath); await writeFile(f.filePath, saved);
  assert.equal(store.recordResult(profile.id, 'ending', result()).applied, true);
  const restarted = f.open();
  assert.equal(restarted.recoverInterruptedExpeditions(), 0);
  assert.equal(restarted.getProfile(profile.id).researchCredits, 10);
  assert.equal(restarted.getProfile(profile.id).engines.count, 4);
});

async function serve(t, store, onRoomCreated) {
  const server = createDevServer({ automaticTicks: false, progressionStore: store, onRoomCreated });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = async () => {
    if (!server.listening) return;
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections(); await closed;
  };
  t.after(close);
  return { close, request: async (path, body, token) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  } };
}

test('server startup returns interruption receipts through authenticated profile without recreating old sessions', async t => {
  const f = await fixture(t), firstStore = f.open(), first = await serve(t, firstStore);
  const account = (await first.request('/profile', {})).body;
  const entered = (await first.request('/session', { roomId: 'lost', playerId: 'p', profileToken: account.profileToken })).body;
  assert.equal(entered.profile.engines.count, 4);
  await first.close();
  const second = await serve(t, f.open());
  const recovered = (await second.request('/profile', undefined, account.profileToken)).body.profile;
  assert.equal(recovered.engines.count, 5);
  assert.equal(recovered.lastInterruption.expeditionId, entered.state.expeditionId);
  assert.equal((await second.request('/state', undefined, entered.token)).status, 401);
  await second.close();
  const third = await serve(t, f.open());
  assert.deepEqual((await third.request('/profile', undefined, account.profileToken)).body.profile.lastInterruption, recovered.lastInterruption);
});

test('personal grace departure and practice defeat are settled by HTTP without an engine refund', async t => {
  const f = await fixture(t), store = f.open();
  let room;
  const server = await serve(t, store, created => { room = created; });
  for (const mode of ['grace', 'practice']) {
    const account = (await server.request('/profile', {})).body;
    const entered = (await server.request('/session', { roomId: mode, playerId: mode,
      profileToken: account.profileToken, practice: mode === 'practice' })).body;
    const player = room.game.players[0];
    if (mode === 'grace') {
      core.setConnection(room.game, mode, false);
      room.game.tick = room.game.rules.disconnectGraceTicks + 1;
      core.tick(room.game);
      assert.equal(player.status, 'left');
    } else {
      room.game.tick = room.game.rules.waveTicks * room.game.rules.totalWaves + room.game.rules.bossTicks;
      player.enemies.push({ id: 999, hp: 100, maxHp: 100, progress: 0, boss: true });
      core.tick(room.game);
      assert.equal(player.status, 'defeated');
    }
    await server.request('/state', undefined, entered.token);
    assert.equal(store.getProfile(account.profile.id).engines.count, 4);
  }
  await server.close();
  assert.equal(f.open().recoverInterruptedExpeditions(), 0);
});

test('cleared, defeated, left and practice results settle without restart refund', async t => {
  const f = await fixture(t), store = f.open(), { profile } = store.createProfile();
  for (const status of ['cleared', 'defeated', 'left', 'practice']) {
    store.consumeEngine(profile.id, status);
    store.recordResult(profile.id, status, result({ status: status === 'practice' ? 'cleared' : status,
      cleared: status === 'cleared' || status === 'practice', researchCredits: status === 'left' ? 0 : 10,
      practice: status === 'practice' }));
  }
  const restarted = f.open();
  assert.equal(restarted.recoverInterruptedExpeditions(), 0);
  assert.equal(restarted.getProfile(profile.id).engines.count, 1);
  assert.equal(restarted.getProfile(profile.id).researchCredits, 20);
  const saved = JSON.parse(await readFile(f.filePath, 'utf8'));
  for (const entry of Object.values(saved.profiles[profile.id].expeditions)) assert.equal(entry.status, 'settled');
});

test('legacy entries and empty version-one stores never receive invented refunds', async t => {
  const f = await fixture(t);
  await writeFile(f.filePath, JSON.stringify({ version: 1, profiles: {} }));
  const empty = f.open();
  assert.equal(empty.recoverInterruptedExpeditions(), 0);
  const { profile } = empty.createProfile();
  empty.consumeEngine(profile.id, 'old-charge');
  const legacy = JSON.parse(await readFile(f.filePath, 'utf8'));
  delete legacy.profiles[profile.id].expeditions;
  await writeFile(f.filePath, JSON.stringify(legacy));
  const restarted = f.open();
  assert.equal(restarted.recoverInterruptedExpeditions(), 0);
  assert.equal(restarted.getProfile(profile.id).engines.count, 4);
  assert.equal(restarted.getProfile(profile.id).lastInterruption, null);
});

test('failed recovery write preserves balance and active receipt so retry remains possible', async t => {
  const f = await fixture(t), first = f.open(), { profile } = first.createProfile();
  first.consumeEngine(profile.id, 'interrupted');
  const restarted = f.open(), saved = await readFile(f.filePath, 'utf8');
  await unlink(f.filePath); await mkdir(f.filePath);
  assert.throws(() => restarted.recoverInterruptedExpeditions());
  const blocked = createDevServer({ automaticTicks: false, progressionStore: restarted });
  const failed = new Promise(resolve => blocked.once('error', resolve));
  blocked.listen(0, '127.0.0.1');
  assert.ok(await failed, 'server admission must fail if recovery cannot be committed');
  assert.equal(blocked.listening, false);
  assert.equal(restarted.getProfile(profile.id).engines.count, 4);
  assert.equal(restarted.getProfile(profile.id).lastInterruption, null);
  await rmdir(f.filePath); await writeFile(f.filePath, saved);
  assert.equal(restarted.recoverInterruptedExpeditions(), 1);
  assert.equal(restarted.getProfile(profile.id).engines.count, 5);
});

test('a durable reward receipt wins over an inconsistent active marker without a refund', async t => {
  const f = await fixture(t), store = f.open(), { profile } = store.createProfile();
  store.consumeEngine(profile.id, 'completed');
  store.recordResult(profile.id, 'completed', result());
  const saved = JSON.parse(await readFile(f.filePath, 'utf8'));
  saved.profiles[profile.id].expeditions.completed.status = 'active';
  await writeFile(f.filePath, JSON.stringify(saved));
  const restarted = f.open();
  restarted.recoverInterruptedExpeditions();
  assert.equal(restarted.getProfile(profile.id).engines.count, 4);
  assert.equal(restarted.getProfile(profile.id).researchCredits, 10);
  assert.equal(restarted.getProfile(profile.id).lastInterruption, null);
  assert.equal(JSON.parse(await readFile(f.filePath, 'utf8')).profiles[profile.id].expeditions.completed.status, 'settled');
});
