import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, tick, content, getUnitAttack } from '../dist/server/core/index.js';
import { publicState, publicContent } from '../dist/server/protocol.js';
import { validateContent } from '../tools/validate-content.mjs';

const create = (battlefieldId = 1) => createGame({ playerIds: ['p', 'peer'], seed: 27, battlefieldId });
const view = game => publicState(game).players[0].fieldMod;
const choose = (game, modId, offerId = 'survey') => applyAction(game, 'p', { seq: game.players[0].lastSeq + 1, type: 'choose_mod', offerId, modId });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function setup(definitionId = 'laser_1') {
  const game = create(), player = game.players[0];
  game.rules.spawnIntervalTicks = game.rules.minSpawnIntervalTicks = 99999;
  assert.equal(applyAction(game, 'p', { seq: 1, type: 'summon' }).ok, true);
  const unit = player.units[0]; Object.assign(unit, { definitionId, slot: 2 });
  game.tick = 400; game.wave = 5;
  return { game, player, unit };
}
function enemy(game, player, hp = 10000, progress = .2) {
  const target = { id: game.nextEntityId++, hp, maxHp: hp, progress, boss: false };
  player.enemies.push(target); return target;
}

test('field mod opportunities use thirds of each resolved stage and latest opportunity only', () => {
  for (const battlefieldId of [1, 2, 3, 4, 5]) {
    const game = create(battlefieldId), duration = game.rules.waveTicks * game.rules.totalWaves;
    const first = Math.floor(duration / 3), second = Math.floor(duration * 2 / 3);
    assert.equal(view(game)?.nextOfferTick, first);
    assert.equal(view(game).offerId, null); assert.equal(view(game).available, false);
    game.tick = first - 1; assert.equal(choose(game, 'opener').ok, false);
    game.tick = first; assert.equal(view(game).offerId, 'survey'); assert.equal(view(game).available, true);
    assert.equal(view(game).nextOfferTick, second);
    game.tick = second; assert.equal(view(game).offerId, 'retune'); assert.equal(view(game).nextOfferTick, null);
    assert.equal(choose(game, 'opener').error, 'STALE_MOD_OFFER');
    assert.equal(choose(game, 'opener', 'retune').ok, true);
    assert.deepEqual(view(game).history, [{ offerId: 'retune', modId: 'opener', tick: second }]);
  }
});

test('confirmed choice replays across checkpoint, rejects altered payload, and retune replaces or keeps one effect', () => {
  for (const modId of ['tracker', 'opener']) {
    const game = create(); game.tick = 400;
    const action = { seq: 1, type: 'choose_mod', offerId: 'survey', modId: 'tracker' };
    assert.equal(applyAction(game, 'p', action).ok, true);
    game.tick = 800;
    assert.equal(applyAction(game, 'p', action).ok, true);
    assert.equal(applyAction(game, 'p', { ...action, modId: 'scatter' }).error, 'SEQUENCE_REUSED');
    assert.equal(applyAction(game, 'p', { ...action, offerId: 'retune' }).error, 'SEQUENCE_REUSED');
    assert.equal(choose(game, 'opener', 'survey').error, 'STALE_MOD_OFFER');
    assert.equal(choose(game, modId, 'retune').ok, true);
    assert.equal(view(game).activeId, modId); assert.equal(view(game).history.length, 2);
    assert.equal(choose(game, 'scatter', 'retune').error, 'MOD_ALREADY_CHOSEN');
    assert.equal(view(game).available, false);
  }
});

test('selection changes no random, gold, investment, units or peers; tutorial and terminal players cannot choose', () => {
  const game = create(), p = game.players[0], peer = JSON.stringify(game.players[1]); game.tick = 400;
  const before = [game.rngState, game.placementRngState, p.gold, p.investmentActions, p.nextSummonTick, game.nextEntityId];
  assert.equal(choose(game, 'unknown').error, 'UNKNOWN_FIELD_MOD');
  assert.equal(choose(game, 'opener').ok, true);
  assert.deepEqual([game.rngState, game.placementRngState, p.gold, p.investmentActions, p.nextSummonTick, game.nextEntityId], before);
  assert.equal(JSON.stringify(game.players[1]), peer); assert.deepEqual(p.units, []);
  const tutorial = createGame({ playerIds: ['p'], seed: 27, tutorial: true });
  assert.equal(view(tutorial), null); assert.equal(choose(tutorial, 'tracker').error, 'TUTORIAL_ACTION_REQUIRED');
  applyAction(game, 'p', { seq: p.lastSeq + 1, type: 'leave' });
  assert.equal(view(game).available, false); assert.equal(choose(game, 'tracker', 'retune').error, 'NOT_ACTIVE');
});

test('opener tests pre-hit eighty percent health, includes overdrive, and measures clipped extra damage', () => {
  for (const ratio of [.8, .799]) {
    const { game, player, unit } = setup(); choose(game, 'opener');
    const target = enemy(game, player); target.hp = target.maxHp * ratio; const hp = target.hp;
    player.overdriveUntilTick = game.tick + 60; tick(game);
    const base = getUnitAttack(player, unit) * 1.5;
    close(hp - target.hp, base * (ratio === .8 ? 1.1 : 1));
    const stats = view(game).stats.find(row => row.modId === 'opener');
    assert.equal(stats.hits, ratio === .8 ? 1 : 0); close(stats.bonusDamage, ratio === .8 ? base * .1 : 0);
    close(unit.lastAttackHits[0].damage, hp - target.hp);
  }
  for (const fraction of [.5, 1.05]) {
    const { game, player, unit } = setup(); choose(game, 'opener');
    const base = getUnitAttack(player, unit), target = enemy(game, player, base * fraction); tick(game);
    assert.equal(target.hp, 0);
    const stats = view(game).stats.find(row => row.modId === 'opener');
    assert.equal(stats.hits, fraction < 1 ? 0 : 1); close(stats.bonusDamage, fraction < 1 ? 0 : base * .05);
  }
});

test('tracker uses pre-hit control: first frost hit is ordinary, later slowed and stunned hits gain fifteen percent', () => {
  const frost = content.units.find(unit => unit.element === 'frost' && unit.attackPattern !== 'blast' && unit.attackPattern !== 'arc');
  const { game, player, unit } = setup(frost.id); choose(game, 'tracker');
  const target = enemy(game, player); const base = getUnitAttack(player, unit);
  tick(game); close(target.maxHp - target.hp, base); assert.equal(view(game).stats.find(s => s.modId === 'tracker').hits, 0);
  unit.attackCooldownTicks = 0; const hp = target.hp; tick(game); close(hp - target.hp, base * 1.15);
  target.slowUntilTick = 0; target.stunnedUntilTick = game.tick + 10; unit.attackCooldownTicks = 0;
  const stunnedHp = target.hp; tick(game); close(stunnedHp - target.hp, base * 1.15);
  target.slowUntilTick = target.stunnedUntilTick = game.tick - 1; unit.attackCooldownTicks = 0;
  const expiredHp = target.hp; tick(game); close(expiredHp - target.hp, base);
});

test('retuning replaces rather than stacking damage and keeping the current choice never doubles it', () => {
  for (const second of ['tracker', 'opener']) {
    const { game, player, unit } = setup(); choose(game, 'tracker'); game.tick = 800;
    assert.equal(choose(game, second, 'retune').ok, true);
    const target = enemy(game, player); target.stunnedUntilTick = game.tick + 100;
    tick(game);
    close(target.maxHp - target.hp, getUnitAttack(player, unit) * (second === 'tracker' ? 1.15 : 1.1));
    assert.equal(view(game).stats.reduce((total, stat) => total + stat.hits, 0), 1);
  }
});

test('scatter boosts only secondary blast and arc hits and does not add targets', () => {
  for (const definitionId of ['wind_2', 'electric_2', 'laser_1']) {
    const { game, player, unit } = setup(definitionId); choose(game, 'scatter');
    const targets = [.2, .21, .22].map(at => enemy(game, player, 10000, at));
    const plain = structuredClone(game); plain.players[0].fieldMod.activeId = null;
    tick(game); tick(plain);
    const regular = plain.players[0].units[0].lastAttackHits;
    assert.equal(unit.lastAttackHits.length, regular.length);
    unit.lastAttackHits.forEach((hit, index) => close(hit.damage, regular[index].damage * (index ? 1.2 : 1)));
    assert.equal(view(game).stats.find(s => s.modId === 'scatter').hits, regular.length - 1);
    assert.equal(targets[0].hp, plain.players[0].enemies[0].hp);
  }
});

test('mods do not affect dispatch or other lanes, survive serialization, and personal result freezes history and stats', () => {
  const { game, player, unit } = setup(); choose(game, 'opener');
  unit.dispatched = true;
  game.story = { wave: 5, hp: 10000, maxHp: 10000, remainingTicks: 200, status: 'active' };
  const peer = game.players[1]; peer.units = [{ ...unit, id: game.nextEntityId++, dispatched: false }];
  const target = enemy(game, peer);
  const replica = structuredClone(game); tick(game); tick(replica); assert.deepEqual(game, replica);
  close(game.story.maxHp - game.story.hp, getUnitAttack(player, unit));
  close(target.maxHp - target.hp, getUnitAttack(peer, peer.units[0]));
  assert.equal(view(game).stats.find(s => s.modId === 'opener').hits, 0);
  unit.dispatched = false; unit.attackCooldownTicks = 0; enemy(game, player); tick(game);
  applyAction(game, 'p', { seq: player.lastSeq + 1, type: 'leave' });
  const result = JSON.stringify(player.result.fieldMod);
  assert.equal(player.result.fieldMod.available, false);
  player.fieldMod.history[0].modId = 'tracker'; player.fieldMod.stats[0].bonusDamage = 999;
  game.tick = 800; tick(game);
  assert.equal(JSON.stringify(player.result.fieldMod), result);
});

test('unselected modifier data leaves ordinary damage and RNG intact; field content has validated known conditions', () => {
  const { game, player, unit } = setup(); const target = enemy(game, player);
  const random = [game.rngState, game.placementRngState]; tick(game);
  close(target.maxHp - target.hp, getUnitAttack(player, unit)); assert.deepEqual([game.rngState, game.placementRngState], random);
  assert.equal(view(game).activeId, null); assert.deepEqual(view(game).history, []);
  assert.deepEqual(publicContent().fieldMods.map(mod => mod.id), ['tracker', 'scatter', 'opener']);
  for (const mutate of [c => c.fieldMods[0].bonus = -1, c => c.fieldMods[0].condition = 'made_up', c => c.fieldMods.push({ ...c.fieldMods[0] })]) {
    const changed = structuredClone(content); mutate(changed);
    assert.ok(validateContent(changed).some(error => error.includes('fieldMods')));
  }
});
