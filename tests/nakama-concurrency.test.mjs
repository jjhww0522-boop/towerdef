import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('concurrent Nakama join attempts reserve at most four seats and start once', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync('dist/nakama/index.js', 'utf8'), context);
  let handler;
  context.InitModule({}, { info() {} }, {}, {
    registerMatch(name, value) { handler = value; }, registerRpc() {}, registerMatchmakerMatched() {}
  });
  const dispatcher = { broadcastMessage() {}, matchKick() {} };
  const state = handler.matchInit({}, {}, {}, {}).state;
  const presences = Array.from({ length: 5 }, (_, i) => ({ userId: 'p' + i, sessionId: 's' + i }));
  const results = presences.map(presence => handler.matchJoinAttempt({}, {}, {}, dispatcher, 0, state, presence,
    { protocolVersion: '1', contentVersion: state.contentVersion }));
  assert.deepEqual(results.map(result => result.accept), [true, true, true, true, false]);
  handler.matchJoin({}, {}, {}, dispatcher, 0, state, presences.slice(0, 4));
  assert.equal(state.game.players.length, 4);
});
