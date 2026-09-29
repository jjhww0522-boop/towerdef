import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content, setConnection } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';

const action = (game, player, type, fields = {}) => applyAction(game, player.id, { seq: player.lastSeq + 1, type, ...fields });
const advance = (game, ticks) => { for (let index = 0; index < ticks; index++) tick(game); };
const robot = (game, player, slot, definitionId = 'laser_1') => {
  const unit = { id: game.nextEntityId++, definitionId, slot, dispatched: false, attackCooldownTicks: 0,
    lastAttackTick: null, lastTargetId: null, lastAttackHits: [], investedGold: game.rules.summonCost };
  player.units.push(unit); return unit;
};

test('mode is explicit and stable; legacy rooms remain cooperative and tutorials are always solo', () => {
  const options = { playerIds: ['p'], seed: 7 };
  assert.equal(createGame(options).mode, 'coop');
  assert.equal(createGame({ ...options, mode: 'solo' }).mode, 'solo');
  assert.equal(createGame({ ...options, mode: 'coop', tutorial: true }).mode, 'solo');
  assert.throws(() => createGame({ ...options, mode: 'invalid' }), /Unknown game mode/);
  assert.throws(() => createGame({ ...options, mode: 'solo', playerIds: ['p', 'q'] }), /Solo requires one player/);
  assert.equal(createGame({ ...options, mode: 'coop', playerIds: ['p', 'q'] }).players.length, 2);
});

test('solo has no shared stories at any configured story wave and refuses dispatch', () => {
  for (const stage of content.battlefields) {
    const game = createGame({ playerIds: ['p'], seed: 7, mode: 'solo', battlefieldId: stage.id });
    const player = game.players[0];
    assert.deepEqual(game.stories, []);
    assert.deepEqual(game.rules, { ...content.rules, ...stage.rules }, 'mode never changes stage difficulty or economy');
    for (const mission of stage.stories) {
      game.tick = (mission.wave - 1) * game.rules.waveTicks - 1;
      game.wave = mission.wave - 1;
      tick(game);
      const state = publicState(game);
      assert.equal(state.mode, 'solo'); assert.equal(state.story, null); assert.deepEqual(state.stories, []);
    }
    robot(game, player, 0);
    assert.deepEqual(action(game, player, 'dispatch', { unitIds: [player.units[0].id] }), { ok: false, error: 'SOLO_NO_STORY' });
    assert.equal(player.units[0].dispatched, false);
  }
});

test('cooperative stories remain available with one player and survive disconnect/reconnect', () => {
  const game = createGame({ playerIds: ['p'], seed: 7, mode: 'coop' });
  const mission = game.stories[0];
  game.tick = (mission.wave - 1) * game.rules.waveTicks - 1;
  tick(game);
  assert.equal(game.story.wave, mission.wave);
  assert.equal(game.story.status, 'active');
  setConnection(game, 'p', false); advance(game, 5); setConnection(game, 'p', true);
  assert.equal(publicState(game).mode, 'coop');
  assert.equal(game.story.status, 'active'); assert.deepEqual(game.stories, content.battlefields[0].stories);
});

test('teammate robots and EMP cannot attack, slow or stop another personal lane', () => {
  const game = createGame({ playerIds: ['p', 'q'], seed: 7, mode: 'coop', battlefieldId: 2 });
  const [local, peer] = game.players;
  game.rules.spawnIntervalTicks = game.rules.minSpawnIntervalTicks = 99999;
  robot(game, local, 0, 'guardian_s');
  const enemy = { id: game.nextEntityId++, hp: 1000, maxHp: 1000, progress: 0, routeIndex: 0, boss: false, archetype: 'grunt' };
  peer.enemies.push(enemy);
  const ownEnemy = { ...enemy, id: game.nextEntityId++ };
  local.enemies.push(ownEnemy);
  assert.equal(action(game, local, 'tactic', { tactic: 'emp' }).ok, true);
  tick(game);
  assert.equal(enemy.hp, 1000);
  assert.equal(enemy.slowUntilTick, undefined); assert.equal(enemy.stunnedUntilTick, undefined);
  assert.equal(enemy.progress, game.rules.enemyProgressPerTick);
  assert.equal(local.units[0].lastTargetId, ownEnemy.id);
  assert.ok(ownEnemy.stunnedUntilTick > game.tick);
  enemy.progress = game.objective.arrivalProgress;
  tick(game);
  assert.equal(local.facilityHp, game.objective.facilityHp);
  assert.equal(peer.facilityHp, game.objective.facilityHp - game.objective.damage);
});

test('dispatch reserves the robot slot and story success rewards each active player once', () => {
  const game = createGame({ playerIds: ['p', 'q'], seed: 7, mode: 'coop' });
  const [local, peer] = game.players, mission = game.stories[0];
  game.rules.spawnIntervalTicks = game.rules.minSpawnIntervalTicks = 99999;
  game.rules.summonCooldownTicks = 0;
  game.tick = (mission.wave - 1) * game.rules.waveTicks - 1;
  tick(game);
  const support = robot(game, local, 0, 'laser_4');
  assert.equal(action(game, local, 'dispatch', { unitIds: [support.id] }).ok, true);
  local.gold = 10000;
  for (let index = 1; index < game.rules.maxUnits; index++) assert.equal(action(game, local, 'summon').ok, true);
  assert.equal(local.units.filter(unit => unit.slot === support.slot).length, 1);
  assert.equal(action(game, local, 'summon').error, 'UNIT_CAP');
  const balances = game.players.map(player => player.gold);
  for (let index = 0; index < 30 && game.story.status === 'active'; index++) tick(game);
  assert.equal(game.story.status, 'success');
  assert.deepEqual(game.players.map(player => player.gold), balances.map(gold => gold + mission.rewardGold));
  assert.equal(support.slot, 0); assert.equal(support.dispatched, false);
  const rewarded = game.players.map(player => player.gold);
  advance(game, 3);
  assert.deepEqual(game.players.map(player => player.gold), rewarded);
  assert.equal(peer.units.length, 0, 'shared reward requires no control of a teammate roster');
});

test('retired players and public results retain their original mode', () => {
  for (const mode of ['solo', 'coop']) {
    const game = createGame({ playerIds: ['p'], seed: 7, mode });
    assert.equal(action(game, game.players[0], 'leave').ok, true);
    const state = publicState(game);
    assert.equal(state.mode, mode); assert.equal(state.players[0].result.mode, mode);
  }
});
