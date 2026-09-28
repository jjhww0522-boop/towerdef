import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http from 'node:http';
import { createDevServer } from '../tools/dev-server.mjs';
import * as serverModule from '../tools/dev-server.mjs';
import * as configModule from '../tools/mobile-server-config.mjs';
import { createProgressionStore } from '../tools/progression.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-startup-'));
  const filePath = join(directory, 'profiles.json');
  t.after(async () => {
    await unlink(filePath).catch(() => {}); await unlink(filePath + '.lock').catch(() => {}); await rmdir(directory);
  });
  return filePath;
}
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
const requestJson = (server, path, body, token) => new Promise((resolve, reject) => {
  const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path,
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, response => {
    let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
    response.on('end', () => resolve(JSON.parse(text)));
  });
  request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
});

test('LAN defaults to separate mobile data while loopback preserves the original location', () => {
  assert.equal(configModule.progressionFilePath({}, '/project'), resolve('/project', '.towerdef-data', 'profiles.json'));
  assert.equal(configModule.progressionFilePath({ TOWERDEF_LAN_HOST: '192.168.1.2' }, '/project'), resolve('/project', '.towerdef-data', 'mobile', 'profiles.json'));
  assert.equal(configModule.progressionFilePath({ TOWERDEF_DATA_DIR: 'isolated' }, '/project'), resolve('/project', 'isolated', 'profiles.json'));
});

test('constructing a server or failing to bind cannot recover and refund an active expedition', async t => {
  const filePath = await fixture(t), original = createProgressionStore({ filePath });
  const account = original.createProfile(); original.consumeEngine(account.profile.id, 'live');
  const saved = await readFile(filePath, 'utf8');
  const occupied = createDevServer({ automaticTicks: false });
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => close(occupied));
  const second = createDevServer({ automaticTicks: false, progressionStore: createProgressionStore({ filePath }) });
  assert.equal(await readFile(filePath, 'utf8'), saved);
  const error = await new Promise(resolve => {
    second.once('error', resolve); second.listen(occupied.address().port, '127.0.0.1');
  });
  assert.equal(error.code, 'EADDRINUSE');
  assert.equal(await readFile(filePath, 'utf8'), saved);
});

test('CLI startup owns the data file across ports and releases its lock after shutdown', async t => {
  const filePath = await fixture(t), config = { ...configModule.mobileServerConfig({}), port: 0 };
  const first = await serverModule.startDevServer({ config, filePath, automaticTicks: false });
  t.after(async () => { if (first.listening) await close(first); });
  const account = await requestJson(first, '/profile', {});
  const original = await readFile(filePath, 'utf8');
  const lock = JSON.parse(await readFile(filePath + '.lock', 'utf8'));
  assert.deepEqual(Object.keys(lock).sort(), ['pid', 'startedAt']);
  assert.equal(lock.pid, process.pid);
  await assert.rejects(serverModule.startDevServer({ config, filePath, automaticTicks: false }), /already in use/);
  assert.equal(await readFile(filePath, 'utf8'), original);
  await close(first);
  const second = await serverModule.startDevServer({ config, filePath, automaticTicks: false });
  t.after(async () => { if (second.listening) await close(second); });
  const profile = await requestJson(second, '/profile', undefined, account.profileToken);
  assert.equal(profile.profile.id, account.profile.id);
  await close(second);
});

test('CLI bind failure removes only its lock and leaves prior active expedition data unchanged', async t => {
  const filePath = await fixture(t), store = createProgressionStore({ filePath });
  const account = store.createProfile(); store.consumeEngine(account.profile.id, 'interrupted');
  const original = await readFile(filePath, 'utf8');
  const occupied = createDevServer({ automaticTicks: false });
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => close(occupied));
  const config = { ...configModule.mobileServerConfig({}), port: occupied.address().port };
  await assert.rejects(serverModule.startDevServer({ config, filePath, automaticTicks: false }), { code: 'EADDRINUSE' });
  assert.equal(await readFile(filePath, 'utf8'), original);
  await assert.rejects(readFile(filePath + '.lock'), { code: 'ENOENT' });
});

test('legacy research migration waits for a successful server bind and refunds once after startup', async t => {
  const filePath = await fixture(t), store = createProgressionStore({ filePath });
  const account = store.createProfile(), raw = JSON.parse(await readFile(filePath, 'utf8'));
  delete raw.profiles[account.profile.id].rosterMigration;
  raw.profiles[account.profile.id].unlockedRecipes = ['make_liu_bei', 'make_cao_cao'];
  raw.profiles[account.profile.id].researchCredits = 17;
  await writeFile(filePath, JSON.stringify(raw));
  const original = await readFile(filePath, 'utf8');
  const occupied = createDevServer({ automaticTicks: false });
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => close(occupied));
  const config = { ...configModule.mobileServerConfig({}), port: occupied.address().port };
  await assert.rejects(serverModule.startDevServer({ config, filePath, automaticTicks: false }), { code: 'EADDRINUSE' });
  assert.equal(await readFile(filePath, 'utf8'), original);
  const running = await serverModule.startDevServer({ config: { ...config, port: 0 }, filePath, automaticTicks: false });
  t.after(async () => { if (running.listening) await close(running); });
  const restored = (await requestJson(running, '/profile', undefined, account.profileToken)).profile;
  assert.equal(restored.researchCredits, 177);
  assert.deepEqual(restored.rosterMigration, { version: 'six-elements-v1', refundedCredits: 160 });
  await close(running);
});

test('a crash-left lock blocks automatic recovery until the stopped owner lock is explicitly removed', async t => {
  const filePath = await fixture(t), store = createProgressionStore({ filePath });
  const account = store.createProfile(); store.consumeEngine(account.profile.id, 'crashed');
  const original = await readFile(filePath, 'utf8');
  await writeFile(filePath + '.lock', JSON.stringify({ pid: 2147483647, startedAt: 1 }));
  const config = { ...configModule.mobileServerConfig({}), port: 0 };
  await assert.rejects(serverModule.startDevServer({ config, filePath, automaticTicks: false }), /confirm it has stopped/);
  assert.equal(await readFile(filePath, 'utf8'), original);
  // This isolated fixture has no owner. Production removal requires checking the owner first.
  await unlink(filePath + '.lock');
  const resumed = await serverModule.startDevServer({ config, filePath, automaticTicks: false });
  t.after(async () => { if (resumed.listening) await close(resumed); });
  const saved = JSON.parse(await readFile(filePath, 'utf8')).profiles[account.profile.id];
  assert.equal(saved.engines.count, 5);
  assert.equal(saved.expeditions.crashed.status, 'aborted');
  await close(resumed);
});
