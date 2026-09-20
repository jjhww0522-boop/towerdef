import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../dist/server/core/index.js';
import { advancePractice } from '../tools/practice-clock.mjs';

test('fast practice accelerates combat but preserves wall-clock reconnect grace', () => {
  const game = core.createGame({ playerIds: ['offline', 'online'], seed: 9 });
  const room = { game, speed: 6 };
  advancePractice(room, [{ playerId: 'offline', lastSeen: 0 }], 4000);
  assert.equal(game.tick, 6);
  assert.equal(game.players[0].connected, false);
  game.tick = 1300;
  advancePractice(room, [{ playerId: 'offline', lastSeen: 0 }], 122999);
  assert.equal(game.players[0].status, 'active');
  advancePractice(room, [{ playerId: 'offline', lastSeen: 0 }], 123001);
  assert.equal(game.players[0].status, 'left');
  assert.equal(game.players[1].status, 'active');
});
