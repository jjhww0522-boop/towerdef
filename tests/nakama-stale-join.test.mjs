import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('an expired join cannot occupy a replacement seat or overwrite a live session', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync('dist/nakama/index.js', 'utf8'), context);
  let handler;
  context.InitModule({}, { info() {} }, {}, {
    registerMatch(name, value) { handler = value; }, registerRpc() {}, registerMatchmakerMatched() {}
  });
  const kicked = [];
  const dispatcher = { broadcastMessage() {}, matchKick(presences) { kicked.push(...presences); } };
  const state = handler.matchInit({}, {}, {}, {}).state;
  const metadata = { protocolVersion: '1', contentVersion: state.contentVersion };
  const stale = { userId: 'stale', sessionId: 'old' };
  assert.equal(handler.matchJoinAttempt({}, {}, {}, dispatcher, 0, state, stale, metadata).accept, true);
  handler.matchLoop({}, {}, {}, dispatcher, 51, state, []);
  const fresh = Array.from({ length: 4 }, (_, i) => ({ userId: 'p' + i, sessionId: 's' + i }));
  for (const presence of fresh) handler.matchJoinAttempt({}, {}, {}, dispatcher, 52, state, presence, metadata);
  handler.matchJoin({}, {}, {}, dispatcher, 52, state, fresh);
  handler.matchJoin({}, {}, {}, dispatcher, 53, state, [stale, { userId: 'p0', sessionId: 'wrong' }]);
  assert.equal(Object.keys(state.presences).length, 4);
  assert.equal(state.presences.p0.sessionId, 's0');
  assert.equal(kicked.length, 2);
});
