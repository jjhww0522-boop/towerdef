import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('Nakama bundle registers and waits for four authenticated seats; disconnect preserves match', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync('dist/nakama/index.js', 'utf8'), context);
  const registered = {};
  context.InitModule({}, { info() {} }, {}, {
    registerMatch(name, handler) { registered.handler = handler; },
    registerRpc(name, handler) { registered[name] = handler; },
    registerMatchmakerMatched(handler) { registered.matchmaker = handler; }
  });
  const handler = registered.handler;
  const nk = { binaryToString: data => data, matchCreate: () => 'match-id' };
  const dispatcher = { broadcastMessage() {}, matchLabelUpdate() {} };
  let { state } = handler.matchInit({}, {}, nk, {});
  assert.equal(state.game, null);
  const seats = Array.from({ length: 4 }, (_, i) => ({ userId: 'p' + i, sessionId: 's' + i }));
  for (const presence of seats) {
    const result = handler.matchJoinAttempt({}, {}, nk, dispatcher, 0, state, presence, { protocolVersion: '1', contentVersion: state.contentVersion });
    assert.equal(result.accept, true);
    state = handler.matchJoin({}, {}, nk, dispatcher, 0, state, [presence]).state;
  }
  assert.equal(state.game.players.length, 4);
  assert.equal(handler.matchJoinAttempt({}, {}, nk, dispatcher, 0, state, { userId: 'p5', sessionId: 's5' }, { protocolVersion: '1', contentVersion: state.contentVersion }).accept, false);
  handler.matchLoop({}, {}, nk, dispatcher, 1, state, [{ sender: seats[0], opCode: 1, data: JSON.stringify({ seq: 1, type: 'summon' }) }]);
  assert.equal(state.game.players[0].units.length, 1);
  handler.matchLeave({}, {}, nk, dispatcher, 2, state, [seats[0]]);
  handler.matchLoop({}, {}, nk, dispatcher, 3, state, []);
  assert.equal(state.game.players[0].connected, false);
  assert.equal(state.game.players[1].status, 'active');
  const invalid = handler.matchJoinAttempt({}, {}, nk, dispatcher, 3, state, seats[0], { protocolVersion: 'wrong' });
  assert.equal(invalid.accept, false);
});
