import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content, getUnitAttack } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { scriptedMatch } from '../tools/simulate.mjs';

const create = (battlefieldId = 1) => createGame({ playerIds: ['p', 'peer'], seed: 19, battlefieldId });
const step = (game, ticks) => { for (let i = 0; i < ticks; i++) tick(game); };
function target(game, player, { boss = false, archetype = boss ? 'boss' : 'grunt', progress = .2, hp = 100000 } = {}) {
  const enemy = { id: game.nextEntityId++, hp, maxHp: hp, boss, archetype, progress };
  player.enemies.push(enemy); return enemy;
}
function robot(game, player, definitionId = 'laser_1') {
  const unit = { id: game.nextEntityId++, definitionId, slot: 2, dispatched: false, attackCooldownTicks: 0, lastAttackHits: [] };
  player.units.push(unit); return unit;
}
const act = (game, player, tactic) => applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'tactic', tactic });

test('encounter forecasts match actual deterministic roles and exact counts without consuming draw RNG', () => {
  for (const battlefieldId of [1, 2, 4, 5]) {
    const game = create(battlefieldId), player = game.players[0], roles = [];
    const random = game.rngState, placement = game.placementRngState;
    for (let wave = 1; wave <= 6; wave++) {
      const forecast = publicState(game).encounter;
      assert.equal(forecast.current.wave, wave);
      assert.equal(forecast.current.startTick, (wave - 1) * game.rules.waveTicks);
      const before = player.enemySpawnCount;
      while (game.tick < wave * game.rules.waveTicks - 1) {
        player.enemies = []; game.players[1].enemies = []; tick(game);
        for (const enemy of player.enemies) assert.equal(enemy.archetype, forecast.current.archetype);
      }
      assert.equal(player.enemySpawnCount - before, forecast.current.count);
      roles.push(forecast.current.archetype);
      player.enemies = []; game.players[1].enemies = []; tick(game);
      assert.deepEqual(publicState(game).encounter.current, forecast.next);
    }
    assert.deepEqual(roles.slice(0, 2), ['grunt', 'grunt']);
    assert.ok(['runner', 'plated', 'swarm'].every(role => roles.includes(role)));
    assert.equal(game.rngState, random); assert.equal(game.placementRngState, placement);
  }
});

test('last wave forecasts a real boss except mining; tutorial exposes no encounters or tactics', () => {
  for (const battlefieldId of [1, 2, 3]) {
    const game = create(battlefieldId);
    game.tick = (game.rules.totalWaves - 1) * game.rules.waveTicks; game.wave = game.rules.totalWaves;
    const forecast = publicState(game).encounter;
    assert.equal(forecast.next?.archetype ?? null, battlefieldId === 2 ? null : 'boss');
    game.tick = game.rules.totalWaves * game.rules.waveTicks - 1; tick(game);
    if (battlefieldId !== 2) {
      assert.equal(publicState(game).encounter.current.archetype, 'boss');
      assert.equal(game.players[0].enemies.filter(enemy => enemy.archetype === 'boss').length, 1);
    }
  }
  const tutorial = createGame({ playerIds: ['p'], seed: 1, tutorial: true });
  assert.equal(publicState(tutorial).encounter, null);
  assert.equal(act(tutorial, tutorial.players[0], 'emp').error, 'TUTORIAL_ACTION_REQUIRED');
  assert.equal(tutorial.players[0].battleStats.tacticsUsed.emp, 0);
});

test('enemy roles change real speed and siege damage without hidden element resistance', () => {
  const game = create(2), player = game.players[0];
  const enemies = ['grunt', 'runner', 'plated', 'swarm'].map(archetype => target(game, player, { archetype, progress: .2 }));
  tick(game);
  assert.ok(enemies[1].progress > enemies[0].progress);
  assert.ok(enemies[2].progress < enemies[0].progress);
  const plated = enemies[2]; player.enemies = [plated]; plated.progress = 1;
  const hp = player.facilityHp; tick(game);
  assert.equal(hp - player.facilityHp, game.objective.damage * 2);
  const gun = robot(game, player); gun.slot = 10; const before = plated.hp; tick(game);
  assert.equal(before - plated.hp, getUnitAttack(player, gun));
});

test('overdrive boosts only home damage for exactly sixty ticks, shares cooldown and replays once', () => {
  const game = create(), [player, peer] = game.players;
  const gun = robot(game, player), friend = robot(game, peer);
  const enemy = target(game, player), other = target(game, peer);
  const dispatched = robot(game, player); dispatched.dispatched = true;
  game.story = { wave: 4, hp: 100000, maxHp: 100000, remainingTicks: 200, status: 'active' };
  const investment = player.investmentActions, gold = player.gold;
  const action = { seq: 1, type: 'tactic', tactic: 'overdrive' };
  assert.deepEqual(applyAction(game, player.id, action), { ok: true });
  assert.deepEqual(applyAction(game, player.id, action), { ok: true });
  assert.equal(applyAction(game, player.id, { ...action, tactic: 'emp' }).error, 'SEQUENCE_REUSED');
  assert.equal(act(game, player, 'emp').error, 'TACTIC_COOLDOWN');
  assert.equal(player.investmentActions, investment); assert.equal(player.gold, gold);
  assert.deepEqual(publicState(game).players[0].tactical, { cooldownRemainingTicks: 400, overdriveRemainingTicks: 60, lastUseTick: 0, lastKind: 'overdrive' });
  tick(game);
  assert.equal(enemy.maxHp - enemy.hp, getUnitAttack(player, gun) * 1.5);
  assert.equal(other.maxHp - other.hp, getUnitAttack(peer, friend));
  assert.equal(game.story.maxHp - game.story.hp, getUnitAttack(player, dispatched));
  for (let i = 1; i < 60; i++) { gun.attackCooldownTicks = 0; tick(game); }
  assert.equal(publicState(game).players[0].tactical.overdriveRemainingTicks, 0);
  gun.attackCooldownTicks = 0; const before = enemy.hp; tick(game);
  assert.equal(before - enemy.hp, getUnitAttack(player, gun));
  assert.equal(player.battleStats.tacticsUsed.overdrive, 1);
});

test('EMP freezes travel and siege for thirty ticks, bosses for ten, only on the owning lane', () => {
  const game = create(2), [player, peer] = game.players;
  const moving = target(game, player), arrived = target(game, player, { progress: 1 });
  const boss = target(game, player, { boss: true, progress: 1 });
  target(game, peer, { progress: 1 });
  assert.equal(act(game, player, 'emp').ok, true);
  assert.ok(publicState(game).players[0].enemies.every(enemy => enemy.stunned));
  const start = moving.progress, hp = player.facilityHp;
  step(game, 10); assert.equal(moving.progress, start); assert.equal(player.facilityHp, hp);
  assert.ok(peer.facilityHp < hp);
  tick(game); assert.equal(player.facilityHp, hp - game.objective.damage * 6);
  player.enemies = [moving, arrived]; step(game, 19);
  assert.equal(moving.progress, start);
  assert.equal(publicState(game).players[0].enemies[0].stunned, false);
  tick(game); assert.ok(moving.progress > start);
  assert.equal(player.facilityHp, hp - game.objective.damage * 7);
  assert.equal(boss.archetype, 'boss');
});

test('tactic validation and cooldown survive serialization, reject empty use and never extend on failure', () => {
  const game = create(), player = game.players[0];
  assert.equal(act(game, player, 'unknown').error, 'UNKNOWN_TACTIC');
  assert.equal(act(game, player, 'overdrive').error, 'NO_HOME_UNITS');
  assert.equal(act(game, player, 'emp').error, 'NO_ENEMIES');
  target(game, player); act(game, player, 'emp');
  const restored = JSON.parse(JSON.stringify(game));
  assert.equal(act(restored, restored.players[0], 'emp').error, 'TACTIC_COOLDOWN');
  game.tick = 399; assert.equal(act(game, player, 'emp').error, 'TACTIC_COOLDOWN');
  game.tick = 400; assert.equal(act(game, player, 'emp').ok, true);
  assert.equal(player.battleStats.tacticsUsed.emp, 2);
});

test('battle stats count clamped home damage, peak threats and frozen result without story inflation', () => {
  const game = create(), player = game.players[0];
  robot(game, player); target(game, player, { hp: 3 }); target(game, player, { hp: 4 });
  tick(game); assert.equal(player.battleStats.damageDealt, 3);
  assert.equal(player.battleStats.biggestHit, 3); assert.equal(player.battleStats.peakEnemies, 2);
  assert.equal(publicState(game).players[0].battleStats.kills, 1);
  applyAction(game, player.id, { seq: 1, type: 'leave' });
  assert.deepEqual(player.result.battleStats, player.battleStats);
  player.battleStats.damageDealt = 999;
  assert.equal(player.result.battleStats.damageDealt, 3);
});

test('swarm pairs share an entrance and pay one normal enemy bounty between them', () => {
  const game = create(4), player = game.players[0];
  game.tick = 3 * game.rules.waveTicks; game.wave = 4;
  const forecast = publicState(game).encounter.current;
  step(game, forecast.spawnIntervalTicks);
  assert.equal(player.enemies.length, 2);
  assert.ok(player.enemies.every(enemy => enemy.archetype === 'swarm'));
  assert.equal(player.enemies[0].routeIndex, player.enemies[1].routeIndex);
  assert.equal(player.enemies[0].progress, player.enemies[1].progress);
  const gun = robot(game, player, 'wind_2'); gun.slot = 0;
  for (const enemy of player.enemies) { enemy.hp = 1; enemy.progress = 0; }
  const before = player.gold; tick(game);
  assert.equal(player.enemies.length, 0);
  assert.equal(player.gold - before, game.rules.killGold);
});

test('support preserves an idle weapon cooldown and EMP cannot stun enemies arriving later', () => {
  const game = create(), player = game.players[0], gun = robot(game, player);
  gun.attackCooldownTicks = 7;
  act(game, player, 'overdrive');
  assert.equal(gun.attackCooldownTicks, 7);
  assert.equal(gun.lastAttackTick, undefined);
  game.tick = 400;
  const old = target(game, player); act(game, player, 'emp');
  const fresh = target(game, player); tick(game);
  assert.equal(old.progress, .2); assert.ok(fresh.progress > .2);
  assert.equal(player.battleStats.tacticsUsed.emp, 1);
});

test('scripted support policies use real replay-safe actions and preserve no-input behavior', () => {
  const idle = scriptedMatch(1, 3, 'no-input', false, { supportPolicy: 'overdrive' });
  assert.equal(idle.successfulActions.tactic, 0);
  const boosted = scriptedMatch(1, 3, 'dispatch', false, { supportPolicy: 'overdrive' });
  assert.ok(boosted.successfulActions.tactic > 0);
  assert.equal(boosted.players[0].battleStats.tacticsUsed.overdrive, boosted.successfulActions.tactic);
  const repeat = scriptedMatch(1, 3, 'dispatch', false, { supportPolicy: 'overdrive' });
  assert.deepEqual(boosted.players, repeat.players);
  assert.ok(scriptedMatch(1, 3, 'dispatch', false).cleared > 0, 'A clear must remain possible without support or research');
});
