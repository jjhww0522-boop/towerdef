import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick } from '../dist/server/core/index.js';

test('stage one opening enemies survive a three-basic opening volley and reward only their eventual defeat', () => {
  const game = createGame({ playerIds: ['opening'], seed: 1, battlefieldId: 1 });
  const player = game.players[0];
  // Long-range basics cover the entrance, reproducing the instant deletion problem.
  player.units = [0, 1, 2].map(slot => ({ id: game.nextEntityId++, definitionId: 'laser_1', slot,
    dispatched: false, attackCooldownTicks: 0, lastAttackTick: null, lastTargetId: null,
    lastAttackHits: [], investedGold: game.rules.summonCost }));
  const startingGold = player.gold;
  while (player.enemySpawnCount === 0) tick(game);
  assert.equal(player.enemies.length, 1, 'first enemy remains visible after synchronized opening hits');
  const first = player.enemies[0], id = first.id;
  assert.ok(first.hp > 0 && first.hp < first.maxHp, 'a damaged survivor shows attack feedback');
  assert.equal(player.kills, 0);
  assert.equal(player.gold, startingGold);
  const spawnedAt = game.tick;
  while (game.tick - spawnedAt < 100 && player.enemies.some(enemy => enemy.id === id)) tick(game);
  assert.ok(game.tick - spawnedAt >= game.rules.ticksPerSecond, 'opening enemy survives more than a single attack cycle');
  assert.ok(!player.enemies.some(enemy => enemy.id === id), 'basic units still defeat the opening enemy');
  assert.ok(player.kills > 0);
  assert.equal(player.gold, startingGold + player.kills * game.rules.killGold);
});
