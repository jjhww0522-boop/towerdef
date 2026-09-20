import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevServer } from '../tools/dev-server.mjs';

test('four sessions share authority, reject takeover, preserve idempotency and resume', async t => {
  const server = createDevServer({ automaticTicks: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (path, body, token) => {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  };
  const sessions = [];
  for (let i = 0; i < 4; i++) {
    const response = await request('/session', { roomId: 'test', playerId: 'p' + i });
    assert.equal(response.status, 200);
    sessions.push(response.body);
  }
  assert.equal((await request('/session', { roomId: 'test', playerId: 'p4' })).status, 409);
  assert.equal((await request('/session', { roomId: 'test', playerId: 'p0' })).status, 409);
  assert.equal((await request('/state')).status, 401);
  const first = await request('/action', { seq: 1, type: 'summon' }, sessions[0].token);
  assert.equal(first.body.ok, true);
  const replay = await request('/action', { seq: 1, type: 'summon' }, sessions[0].token);
  assert.equal(replay.body.state.players[0].units.length, 1);
  assert.equal(first.body.state.players[0].gold, replay.body.state.players[0].gold);
  const other = await request('/state', undefined, sessions[1].token);
  assert.equal(other.body.players.length, 4);
  assert.equal(other.body.players[0].units.length, 1);
  assert.equal(other.body.players[1].units.length, 0);
  assert.equal(other.body.rngState, undefined);
  const resume = await request('/session', { roomId: 'test', playerId: 'p0' }, sessions[0].token);
  assert.equal(resume.body.state.players[0].lastSeq, 1);
  assert.equal((await request('/action', { seq: 2, type: 'dispatch', unitIds: [999] }, sessions[1].token)).body.ok, false);
  assert.equal((await request('/session', { roomId: 'bad', playerId: 'p', protocolVersion: 'invalid' })).status, 409);
});
