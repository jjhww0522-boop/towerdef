import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../dist/server/core/index.js';
import { advancePractice, resumePractice } from '../tools/practice-clock.mjs';

test('a request after the wall-clock grace cannot race ahead of the next timer tick', () => {
  const game = core.createGame({ playerIds: ['offline', 'peer'], seed: 1 });
  const room = { game, speed: 6 };
  const session = { playerId: 'offline', lastSeen: 0 };
  advancePractice(room, [session], 122999);
  assert.equal(game.players[0].status, 'active');
  resumePractice(room, session, 123001);
  assert.equal(game.players[0].status, 'left');
  assert.equal(game.players[1].status, 'active');
  assert.equal(session.lastSeen, 123001);
});
