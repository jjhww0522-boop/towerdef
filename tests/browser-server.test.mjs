import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { createDevServer } from '../tools/dev-server.mjs';

test('browser sessions allow only the local same origin and validate practice speed', async t => {
  const server = createDevServer({ automaticTicks: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const join = async (roomId, playerId, speed, origin = base) => fetch(base + '/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ roomId, playerId, speed })
  });
  assert.equal((await join('blocked', 'p', 1, 'https://unrelated.example')).status, 403);
  assert.equal((await join('bad', 'p', 100)).status, 400);
  const response = await join('fast', 'one', 6);
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.equal(session.state.playbackSpeed, 6);
  const second = await (await join('fast', 'two', 1)).json();
  assert.equal(second.state.playbackSpeed, 6, 'new join cannot change existing room speed');
  const wrongHostStatus = await new Promise((resolve, reject) => {
    get(base + '/health', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
  const privateFile = await fetch(base + '/package.json');
  assert.notEqual(privateFile.status, 200, 'static server is an explicit allowlist');
});
