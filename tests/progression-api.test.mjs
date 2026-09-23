import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import core from '../dist/server/core/index.js';
import { createDevServer } from '../tools/dev-server.mjs';
import { createProgressionStore } from '../tools/progression.mjs';

async function serve(t, options = {}) {
  const server = createDevServer({ automaticTicks: false, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.listening ? new Promise(resolve => server.close(resolve)) : undefined);
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    server,
    async request(path, body, token, origin = base) {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
  };
}

// A bounded in-process fixture advances the actual authoritative core to its
// last boss hit. No HTTP route can set kills, results, credits or unlocks.
function finish(room) {
  const game = room.game, player = game.players[0];
  game.tick = game.rules.waveTicks * game.rules.totalWaves + 1;
  game.wave = game.rules.totalWaves;
  player.investmentActions = 3; player.kills = 80;
  player.units = [{ id: game.nextEntityId++, definitionId: 'shu_guard', slot: 0, dispatched: false,
    attackCooldownTicks: 0, lastAttackTick: null, lastTargetId: null, investedGold: game.rules.summonCost }];
  player.enemies = [{ id: game.nextEntityId++, hp: 1, maxHp: game.rules.bossHp, progress: 0, boss: true }];
  core.tick(game);
  assert.equal(player.status, 'cleared');
}

test('profile and research endpoints authenticate authority and never accept client balances', async t => {
  const { request } = await serve(t);
  assert.equal((await request('/profile')).status, 401);
  assert.equal((await request('/research', { recipeId: 'make_liu_bei' })).status, 401);
  assert.equal((await request('/profile', {}, undefined, 'https://elsewhere.example')).status, 403);
  const created = await request('/profile', { researchCredits: 9000, unlockedRecipes: ['make_liu_bei'], clearedBattlefields: [1, 2, 3], tutorialCompleted: true });
  assert.equal(created.status, 200);
  assert.equal(created.body.profile.researchCredits, 0);
  assert.equal(created.body.profile.tutorialCompleted, false);
  assert.deepEqual(created.body.profile.unlockedRecipes, []);
  assert.deepEqual(created.body.profile.unlockedBattlefields, [1]);
  const token = created.body.profileToken;
  const automatic = core.content.recipes.find(recipe => recipe.unlockType === 'clear');
  assert.equal((await request('/research', { recipeId: automatic.id }, token)).body.error, 'recipe_not_researchable');
  assert.equal((await request('/research', { recipeId: 'make_liu_bei', researchCredits: 9000 }, token)).body.error, 'research_prerequisite');
  assert.equal((await request('/research', { recipeId: 'not-a-recipe' }, token)).status, 400);
  const current = (await request('/profile', undefined, token)).body.profile;
  assert.equal(current.researchCredits, 0);
  assert.equal(current.tokenHash, undefined);
  assert.equal(current.rewards, undefined);
});

test('stage gates use server profiles and existing room stage; reward accounts cannot occupy duplicate seats', async t => {
  const { request } = await serve(t);
  const one = (await request('/profile', {})).body, two = (await request('/profile', {})).body;
  assert.equal((await request('/session', { roomId: 'locked', playerId: 'one', battlefieldId: 2, profileToken: one.profileToken })).body.error, 'battlefield_locked');
  assert.equal((await request('/session', { roomId: 'invalid', playerId: 'one', battlefieldId: 0, profileToken: one.profileToken })).body.error, 'invalid_battlefield');
  const first = (await request('/session', { roomId: 'home', playerId: 'one', battlefieldId: 1,
    profileToken: one.profileToken, unlockedRecipes: ['make_liu_bei'], researchCredits: 9000 })).body;
  assert.equal(first.state.practice, false);
  assert.deepEqual(first.state.players[0].unlockedRecipes, []);
  assert.equal((await request('/session', { roomId: 'home', playerId: 'duplicate', profileToken: one.profileToken })).body.error, 'profile_already_in_room');
  assert.equal((await request('/session', { roomId: 'other', playerId: 'duplicate', profileToken: one.profileToken })).body.error, 'profile_in_active_expedition');
  assert.equal((await request('/session', { roomId: 'home', playerId: 'one', profileToken: two.profileToken })).body.error, 'player_already_claimed');
  assert.equal((await request('/session', { roomId: 'home', playerId: 'one', profileToken: two.profileToken }, first.token)).body.error, 'profile_mismatch');
  const invited = await request('/session', { roomId: 'home', playerId: 'two', battlefieldId: 3, profileToken: two.profileToken });
  assert.equal(invited.status, 200);
  assert.equal(invited.body.state.battlefieldId, 1, 'room invitation overrides a stale lobby selection');
  assert.equal(invited.body.state.players.length, 2);
  assert.equal(invited.body.state.profile.id, two.profile.id);
  const recovered = await request('/session', { roomId: 'home', playerId: 'one', profileToken: one.profileToken });
  assert.equal(recovered.status, 200, 'persisted profile recovers its own seat after a lost session token');
  assert.equal((await request('/state', undefined, first.token)).status, 401, 'recovering a seat revokes its old session');
});

test('real stage clears grant recipes, paid research deploys once, and receipts survive profile-server restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'towerdef-progression-api-'));
  const filePath = join(directory, 'profiles.json');
  t.after(async () => { await rm(filePath, { force: true }); await rmdir(directory); });
  const store = createProgressionStore({ filePath });
  let room;
  const running = await serve(t, { progressionStore: store, onRoomCreated: created => { room = created; } });
  const { request } = running;
  const account = (await request('/profile', {})).body;
  const automaticThrough = stage => core.content.recipes.filter(recipe => recipe.unlockType === 'clear' && recipe.unlockBattlefield <= stage).map(recipe => recipe.id);
  let session, firstState;
  for (const battlefieldId of [1, 2, 3]) {
    const expectedCredits = [40, 120, 240][battlefieldId - 1];
    const joined = await request('/session', { roomId: 'stage-' + battlefieldId, playerId: 'one', battlefieldId,
      profileToken: account.profileToken, speed: 1 });
    assert.equal(joined.status, 200);
    session = joined.body;
    assert.deepEqual(session.state.players[0].unlockedRecipes, automaticThrough(battlefieldId - 1));
    finish(room);
    const state = (await request('/state', undefined, session.token)).body;
    if (battlefieldId === 1) firstState = state;
    assert.equal(state.players[0].result.researchCredits, 40 * battlefieldId);
    assert.equal(state.profile.researchCredits, expectedCredits);
    assert.equal(state.profile.stats.clears, battlefieldId);
    assert.deepEqual(state.profile.unlockedBattlefields, Array.from({ length: battlefieldId + 1 }, (_, index) => index + 1));
    assert.deepEqual(state.profile.unlockedRecipes, automaticThrough(battlefieldId));
    assert.equal(new Set(state.profile.unlockedRecipes).size, state.profile.unlockedRecipes.length);
    for (let index = 0; index < 3; index++) assert.equal((await request('/state', undefined, session.token)).body.profile.researchCredits, expectedCredits);
    const resumed = await request('/session', { roomId: 'stage-' + battlefieldId, playerId: 'one', profileToken: account.profileToken }, session.token);
    assert.equal(resumed.body.profile.researchCredits, expectedCredits);
    assert.equal((await request('/profile', undefined, account.profileToken)).body.profile.researchCredits, expectedCredits);
    assert.equal((await request('/research', { recipeId: automaticThrough(battlefieldId)[0] }, account.profileToken)).body.error, 'recipe_not_researchable');
    if (battlefieldId < 3) assert.equal((await request('/research', { recipeId: 'make_liu_bei' }, account.profileToken)).body.error, 'research_prerequisite');
  }
  const purchases = await Promise.all(Array.from({ length: 4 }, () => request('/research', { recipeId: 'make_liu_bei' }, account.profileToken)));
  assert.ok(purchases.every(response => response.status === 200));
  assert.equal(purchases.filter(response => !response.body.alreadyUnlocked).length, 1);
  assert.ok(purchases.every(response => response.body.profile.researchCredits === 180));
  const expectedRecipes = [...automaticThrough(3), 'make_liu_bei'];
  const deployed = (await request('/session', { roomId: 'deployed', playerId: 'one', battlefieldId: 4, profileToken: account.profileToken })).body;
  assert.equal(deployed.state.battlefieldId, 4);
  assert.deepEqual(deployed.state.players[0].unlockedRecipes, expectedRecipes);
  assert.equal(deployed.state.rules.totalWaves, core.content.battlefields[3].rules.totalWaves);
  await new Promise(resolve => running.server.close(resolve));
  const restartedStore = createProgressionStore({ filePath });
  const restarted = await serve(t, { progressionStore: restartedStore });
  assert.equal((await restarted.request('/state', undefined, deployed.token)).status, 401, 'active rooms are explicitly ephemeral');
  const profile = (await restarted.request('/profile', undefined, account.profileToken)).body.profile;
  assert.equal(profile.researchCredits, 180);
  assert.equal(profile.stats.clears, 3);
  assert.deepEqual(profile.unlockedRecipes, expectedRecipes);
  assert.equal(restartedStore.recordResult(profile.id, firstState.expeditionId, firstState.players[0].result).applied, false);
  assert.equal((await restarted.request('/research', { recipeId: 'make_liu_bei' }, account.profileToken)).body.profile.researchCredits, 180);
});
test('accelerated and explicitly marked practice cannot grant credits or planet eligibility', async t => {
  let room;
  const { request } = await serve(t, { onRoomCreated: created => { room = created; } });
  for (const [roomId, speed, practice] of [['fast', 6, false], ['practice', 1, true]]) {
    const account = (await request('/profile', {})).body;
    const session = (await request('/session', { roomId, playerId: roomId, profileToken: account.profileToken, speed, practice })).body;
    assert.equal(session.state.practice, true);
    finish(room);
    const state = (await request('/state', undefined, session.token)).body;
    assert.equal(state.players[0].result.researchCredits, 0);
    assert.equal(state.profile.researchCredits, 0);
    assert.deepEqual(state.profile.unlockedBattlefields, [1]);
    assert.deepEqual(state.profile.unlockedRecipes, []);
    assert.equal(state.profile.tutorialCompleted, false);
    assert.deepEqual(state.profile.stats, { expeditions: 0, clears: 0 });
  }
});
