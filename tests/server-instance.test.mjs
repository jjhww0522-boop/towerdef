import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createDevServer } from '../tools/dev-server.mjs';
import { createProgressionStore } from '../tools/progression.mjs';

async function serve(t, options = {}) {
  const server = createDevServer({ automaticTicks: false, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = async () => {
    if (!server.listening) return;
    const done = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await done;
  };
  t.after(close);
  return { close, request: (path, body, token) => new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path,
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
  }) };
}

test('instance identity stays stable in content and stale admission fails before profile or room creation', async t => {
  const store = createProgressionStore(), rooms = [];
  let profilesCreated = 0;
  const first = await serve(t, { progressionStore: { ...store, createProfile() { profilesCreated++; return store.createProfile(); } },
    onRoomCreated: room => rooms.push(room) });
  const content = (await first.request('/content')).body;
  assert.match(content.serverInstanceId || '', /^[0-9a-f-]{36}$/);
  assert.equal((await first.request('/content')).body.serverInstanceId, content.serverInstanceId);
  const second = await serve(t);
  assert.notEqual((await second.request('/content')).body.serverInstanceId, content.serverInstanceId);
  const rejected = await first.request('/session', { roomId: 'stale', playerId: 'p', expectedServerInstanceId: 'old-server' });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, 'server_restarted');
  assert.equal(rooms.length, 0);
  assert.equal(profilesCreated, 0);
  assert.equal((await first.request('/session', { roomId: 'legacy', playerId: 'p' })).status, 200);
});

test('lost admission response retries once on the same boot but cannot charge a new expedition after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-instance-')), filePath = join(directory, 'profiles.json');
  t.after(async () => { await unlink(filePath); await rmdir(directory); });
  const first = await serve(t, { progressionStore: createProgressionStore({ filePath }) });
  const content = (await first.request('/content')).body;
  const account = (await first.request('/profile', {})).body;
  const pendingEntry = { roomId: 'lost-response', playerId: 'p', profileToken: account.profileToken,
    contentVersion: content.version, expectedServerInstanceId: content.serverInstanceId };
  // Client does not persist this first response; its only recovery input is pendingEntry.
  const original = (await first.request('/session', pendingEntry)).body;
  assert.equal(original.profile.engines.count, 4);
  const sameBoot = (await first.request('/session', pendingEntry)).body;
  assert.equal(sameBoot.state.expeditionId, original.state.expeditionId);
  assert.equal(sameBoot.profile.engines.count, 4);
  await first.close();
  const rooms = [];
  const second = await serve(t, { progressionStore: createProgressionStore({ filePath }), onRoomCreated: room => rooms.push(room) });
  const before = await readFile(filePath, 'utf8');
  const resumed = await second.request('/session', pendingEntry);
  assert.equal(resumed.status, 409);
  assert.equal(resumed.body.error, 'server_restarted');
  assert.equal(rooms.length, 0);
  assert.equal(await readFile(filePath, 'utf8'), before);
  const profile = (await second.request('/profile', undefined, account.profileToken)).body.profile;
  assert.equal(profile.engines.count, 5);
  assert.equal(profile.lastInterruption.expeditionId, original.state.expeditionId);
  const freshContent = (await second.request('/content')).body;
  const explicitNew = await second.request('/session', { ...pendingEntry, expectedServerInstanceId: freshContent.serverInstanceId });
  assert.equal(explicitNew.status, 200);
  assert.equal(explicitNew.body.profile.engines.count, 4);
  assert.notEqual(explicitNew.body.state.expeditionId, original.state.expeditionId);
});
