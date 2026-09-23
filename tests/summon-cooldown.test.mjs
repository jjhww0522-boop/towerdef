import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, setConnection, content } from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';
import { advancePractice } from '../tools/practice-clock.mjs';

const create = (options = {}) => createGame({ playerIds: ['owner', 'peer'], seed: 29, ...options });
const step = (game, count) => { for (let i = 0; i < count; i++) tick(game); };
const summon = (game, player = game.players[0], seq = player.lastSeq + 1) => applyAction(game, player.id, { seq, type: 'summon' });
const remaining = (game, id = 'owner') => publicState(game).players.find(player => player.id === id).summonCooldownRemainingTicks;
const resources = (game, player = game.players[0]) => ({ gold: player.gold, units: JSON.stringify(player.units),
  rngState: game.rngState, placementRngState: game.placementRngState, nextEntityId: game.nextEntityId,
  nextSummonTick: player.nextSummonTick, investmentActions: player.investmentActions });
function give(game, player, definitionId, slot = player.units.length) {
  const unit = { id: game.nextEntityId++, definitionId, slot, dispatched: false, attackCooldownTicks: 0,
    lastAttackTick: null, lastTargetId: null, lastAttackHits: [], investedGold: game.rules.summonCost };
  player.units.push(unit); return unit;
}

test('first summon is immediate and exactly seven authoritative ticks unlock the next summon', () => {
  const game = create(), player = game.players[0];
  assert.equal(game.rules.summonCooldownTicks, 7);
  assert.equal(game.rules.summonCooldownTicks / game.rules.ticksPerSecond, .7);
  assert.equal(remaining(game), 0);
  assert.deepEqual(summon(game), { ok: true });
  assert.equal(player.nextSummonTick, 7); assert.equal(remaining(game), 7);
  for (let elapsed = 0; elapsed < 7; elapsed++) {
    assert.equal(remaining(game), 7 - elapsed);
    const before = resources(game);
    assert.deepEqual(summon(game), { ok: false, error: 'SUMMON_COOLDOWN' });
    assert.deepEqual(resources(game), before);
    tick(game);
  }
  assert.equal(remaining(game), 0);
  assert.deepEqual(summon(game), { ok: true });
  assert.equal(player.nextSummonTick, 14);
});

test('gold and unit-cap failures do not start or postpone the summon cooldown', () => {
  for (const reason of ['INSUFFICIENT_GOLD', 'UNIT_CAP']) {
    const game = create(), player = game.players[0];
    if (reason === 'INSUFFICIENT_GOLD') player.gold = 0;
    else for (let i = 0; i < game.rules.maxUnits; i++) give(game, player, content.units[0].id);
    let before = resources(game);
    assert.equal(summon(game).error, reason);
    assert.deepEqual(resources(game), before); assert.equal(player.nextSummonTick, 0);
    if (reason === 'INSUFFICIENT_GOLD') player.gold = 1000;
    else player.units.pop();
    assert.equal(summon(game).ok, true);
    step(game, 2);
    if (reason === 'INSUFFICIENT_GOLD') player.gold = 0;
    before = resources(game);
    assert.equal(summon(game).error, reason);
    assert.deepEqual(resources(game), before); assert.equal(player.nextSummonTick, 7);
  }
});

test('rejected attempts consume neither draw randomness nor placement randomness', () => {
  const clean = create(), noisy = create();
  for (const game of [clean, noisy]) assert.equal(summon(game).ok, true);
  for (let elapsed = 0; elapsed < 7; elapsed++) {
    for (let retry = 0; retry < 3; retry++) assert.equal(summon(noisy).error, 'SUMMON_COOLDOWN');
    tick(clean); tick(noisy);
  }
  assert.equal(summon(clean).ok, true); assert.equal(summon(noisy).ok, true);
  assert.deepEqual(resources(noisy), resources(clean));
});

test('successful and rejected sequence replays retain their original result without extending the deadline', () => {
  const game = create(), player = game.players[0], accepted = { seq: 1, type: 'summon' };
  assert.equal(applyAction(game, player.id, accepted).ok, true);
  step(game, 3);
  let before = resources(game);
  assert.equal(applyAction(game, player.id, accepted).ok, true);
  assert.deepEqual(resources(game), before);
  assert.equal(applyAction(game, player.id, { seq: 1, type: 'upgrade', tag: 'shu' }).error, 'SEQUENCE_REUSED');
  const rejected = { seq: 2, type: 'summon' };
  assert.equal(applyAction(game, player.id, rejected).error, 'SUMMON_COOLDOWN');
  step(game, 4); before = resources(game);
  assert.equal(applyAction(game, player.id, rejected).error, 'SUMMON_COOLDOWN', 'replay cannot turn a rejected request into a later purchase');
  assert.deepEqual(resources(game), before);
  assert.equal(applyAction(game, player.id, accepted).error, 'STALE_SEQUENCE');
  assert.equal(summon(game).ok, true); assert.equal(player.units.length, 2);
});

test('combine, upgrade and sale work during cooldown without resetting or clearing it', () => {
  const game = create(), player = game.players[0], recipe = content.recipes.find(item => item.unlockBattlefield === 0);
  player.gold = 1000;
  const materials = recipe.ingredients.map(id => give(game, player, id));
  assert.equal(summon(game).ok, true); step(game, 3);
  const deadline = player.nextSummonTick;
  assert.equal(applyAction(game, player.id, { seq: 2, type: 'combine', recipeId: recipe.id, unitIds: materials.map(unit => unit.id) }).ok, true);
  assert.equal(player.nextSummonTick, deadline);
  const assembled = player.units.find(unit => unit.definitionId === recipe.result && !materials.some(material => material.id === unit.id));
  assert.ok(assembled);
  assert.equal(applyAction(game, player.id, { seq: 3, type: 'upgrade', tag: 'shu' }).ok, true);
  assert.equal(player.nextSummonTick, deadline);
  assert.equal(applyAction(game, player.id, { seq: 4, type: 'salvage', unitIds: [assembled.id] }).ok, true);
  assert.equal(player.nextSummonTick, deadline);
  assert.equal(summon(game).error, 'SUMMON_COOLDOWN');
  step(game, 4); assert.equal(summon(game).ok, true);
});

test('each player owns an independent cooldown and public snapshots show only the remaining ticks', () => {
  const game = create(), [owner, peer] = game.players;
  assert.equal(summon(game, owner).ok, true);
  assert.equal(remaining(game, peer.id), 0);
  step(game, 3); assert.equal(summon(game, peer).ok, true);
  assert.equal(owner.nextSummonTick, 7); assert.equal(peer.nextSummonTick, 10);
  step(game, 4);
  assert.equal(remaining(game, owner.id), 0); assert.equal(remaining(game, peer.id), 3);
  assert.equal(summon(game, owner).ok, true);
  assert.equal(summon(game, peer).error, 'SUMMON_COOLDOWN');
  step(game, 3); assert.equal(summon(game, peer).ok, true);
  const snapshot = publicState(game);
  assert.equal(snapshot.players[0].nextSummonTick, undefined);
  assert.equal(snapshot.rngState, undefined);
});

test('disconnecting and restoring serialized match state cannot bypass the deadline', () => {
  let game = create(), player = game.players[0];
  assert.equal(summon(game).ok, true); setConnection(game, player.id, false);
  const before = resources(game);
  assert.equal(summon(game).error, 'DISCONNECTED'); assert.deepEqual(resources(game), before);
  step(game, 6);
  game = JSON.parse(JSON.stringify(game)); player = game.players[0];
  setConnection(game, player.id, true);
  assert.equal(remaining(game), 1); assert.equal(summon(game).error, 'SUMMON_COOLDOWN');
  tick(game); assert.equal(summon(game).ok, true);
});

test('one-, three- and six-speed practice all advance cooldown through simulation ticks', () => {
  for (const speed of [1, 3, 6]) {
    const game = create({ practice: speed !== 1 }), room = { game, speed };
    assert.equal(summon(game).ok, true);
    const sessions = [{ playerId: 'owner', lastSeen: 0 }];
    for (let update = 0; update < 6 / speed; update++) advancePractice(room, sessions, 100);
    assert.equal(game.tick, 6); assert.equal(remaining(game), 1);
    assert.equal(summon(game).error, 'SUMMON_COOLDOWN');
    advancePractice(room, sessions, 200);
    assert.equal(game.tick, 6 + speed); assert.equal(remaining(game), 0);
    assert.equal(summon(game).ok, true);
    assert.equal(game.players[0].nextSummonTick, game.tick + 7);
  }
});
