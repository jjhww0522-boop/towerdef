import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, applyAction } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';

const create = (battlefieldId = 2) => createGame({ playerIds: ['owner', 'peer'], seed: 7, battlefieldId, practice: false });
function attacker(game, player, { boss = false, hp = 10000, progress = game.objective.arrivalProgress } = {}) {
  const enemy = { id: game.nextEntityId++, hp, maxHp: hp, progress, boss };
  player.enemies.push(enemy); return enemy;
}

test('enemies stop at the facility and each attacks repeatedly without being consumed', () => {
  const game = create(), [owner, peer] = game.players;
  const a = attacker(game, owner, { progress: game.objective.arrivalProgress - .001 }), b = attacker(game, owner);
  tick(game);
  assert.equal(a.progress, game.objective.arrivalProgress);
  assert.equal(owner.facilityHp, game.objective.facilityHp - 2 * game.objective.damage);
  assert.equal(peer.facilityHp, game.objective.facilityHp);
  for (let i = 0; i < game.objective.attackIntervalTicks - 1; i++) tick(game);
  assert.equal(owner.facilityHp, game.objective.facilityHp - 2 * game.objective.damage);
  tick(game);
  assert.equal(owner.facilityHp, game.objective.facilityHp - 4 * game.objective.damage);
  assert.ok(owner.enemies.includes(a) && owner.enemies.includes(b));
  const view = publicState(game).players[0];
  assert.equal(view.facilityAttackers, 2);
  assert.ok(view.enemies.every(enemy => enemy.attackingFacility));
  assert.equal('siegeCooldownTicks' in view.enemies[0], false);
});

test('cold delays arrival but does not reduce an arrived enemy attack rate', () => {
  const game = create(), owner = game.players[0];
  const enemy = attacker(game, owner, { progress: game.objective.arrivalProgress - game.rules.enemyProgressPerTick * game.rules.frostSlowMultiplier * 1.5 });
  enemy.slowUntilTick = 100;
  tick(game); assert.equal(owner.facilityHp, game.objective.facilityHp);
  tick(game); assert.equal(owner.facilityHp, game.objective.facilityHp - game.objective.damage);
  for (let i = 0; i < game.objective.attackIntervalTicks; i++) tick(game);
  assert.equal(owner.facilityHp, game.objective.facilityHp - 2 * game.objective.damage);
});

test('killing an attacker stops its damage; allies and dispatched robots cannot save this lane', () => {
  const game = create(), [owner, peer] = game.players;
  for (const player of [owner, peer]) {
    applyAction(game, player.id, { seq: 1, type: 'summon' });
    Object.assign(player.units[0], { definitionId: 'shu_guard', slot: 10 });
  }
  const enemy = attacker(game, owner, { hp: 1 });
  owner.units[0].dispatched = true;
  tick(game); assert.equal(enemy.hp, 1); assert.equal(owner.facilityHp, game.objective.facilityHp - game.objective.damage);
  owner.units[0].dispatched = false;
  tick(game); assert.ok(!owner.enemies.includes(enemy));
  const hp = owner.facilityHp;
  for (let i = 0; i < 10; i++) tick(game);
  assert.equal(owner.facilityHp, hp);
});

test('facility destruction is personal, final and precedes completion and story rewards', () => {
  const game = create(), [owner, peer] = game.players;
  game.tick = game.rules.waveTicks * game.rules.totalWaves - 1;
  game.wave = game.rules.totalWaves;
  owner.facilityHp = game.objective.damage; attacker(game, owner);
  game.story = { wave: game.stories[0].wave, hp: 0, maxHp: 1, remainingTicks: 20, status: 'active' };
  const gold = owner.gold;
  tick(game);
  assert.equal(owner.status, 'defeated'); assert.equal(owner.defeatReason, 'facility_destroyed');
  assert.equal(owner.facilityHp, 0); assert.equal(owner.result.reason, 'facility_destroyed');
  assert.equal(owner.gold, gold);
  assert.equal(peer.status, 'cleared');
  const result = JSON.stringify(owner.result); tick(game); assert.equal(JSON.stringify(owner.result), result);
});

test('mining clears at completion without a boss; engine still requires its boss', () => {
  const mining = create(), engine = create(3);
  for (const game of [mining, engine]) { game.tick = game.rules.waveTicks * game.rules.totalWaves - 1; tick(game); }
  assert.ok(mining.players.every(player => player.status === 'cleared' && !player.enemies.some(enemy => enemy.boss)));
  assert.equal(publicState(mining).bossRemainingTicks, null);
  assert.equal(publicState(mining).expedition.remainingTicks, 0);
  assert.equal(engine.players[0].status, 'active');
  assert.equal(engine.players[0].enemies.filter(enemy => enemy.boss).length, 1);
  engine.tick = engine.rules.waveTicks * engine.rules.totalWaves + engine.rules.bossTicks - 1; tick(engine);
  assert.equal(engine.players[0].defeatReason, 'boss_timeout');
});

test('facility stages do not secretly retain the overcrowding defeat condition', () => {
  const game = create(), owner = game.players[0];
  for (let i = 0; i < game.rules.overcrowdCount; i++) attacker(game, owner, { progress: 0 });
  owner.overcrowdedTicks = game.rules.overcrowdTicks - 1; tick(game);
  assert.equal(owner.status, 'active'); assert.equal(owner.overcrowdedTicks, 0);
  const looping = create(1), player = looping.players[0];
  assert.equal(player.facilityHp, null);
  const enemy = attacker(looping, player, { progress: .999 }); tick(looping);
  assert.ok(enemy.progress < .01);
});
