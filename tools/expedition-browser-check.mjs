import { chromium } from 'playwright';
import { selectDestination, selectRunSpeed } from './playtest-navigation.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import core from '../dist/server/core/index.js';

// Real browser requests and production request handlers. Only authoritative
// in-process fixtures skip the long grind; there are no browser fetch mocks or
// public cheat routes. These checks are not evidence of human fun or balance.
const { content, createGame, applyAction, tick } = core;
const report = { source: 'automated_expedition_browser_test', actualParticipants: 0,
  fixtures: ['Manual server clock', 'Weak enemies and final-boss setup resolved by real core attacks', 'Second core-generated first-stage clear funds research', 'Core-generated stage-two result for stage-three access', 'Owned recipe materials inserted in the isolated server room'],
  checks: [], artifacts: [], errors: [], layoutFailures: [] };
const contexts = [], rooms = [];
const temporary = await mkdtemp(join(tmpdir(), 'towerdef-expedition-browser-'));
const profileFile = join(temporary, 'profiles.json');
let store = createProgressionStore({ filePath: profileFile }), server, browser, base, lastPage;
await mkdir('artifacts', { recursive: true });
const pass = (label, evidence = {}) => { report.checks.push({ label, ...evidence }); console.log('PASS ' + label); };

async function boot(port = 0) {
  server = createDevServer({ automaticTicks: false, progressionStore: store, onRoomCreated: room => rooms.push(room) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  base = 'http://127.0.0.1:' + server.address().port;
}
async function shutdown() {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function newPage(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  contexts.push(context);
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base);
  await selectDestination(page);
  return page;
}
const identity = page => page.evaluate(() => ({
  session: JSON.parse(sessionStorage.getItem('td.session')),
  playerId: JSON.parse(sessionStorage.getItem('td.player')),
  profileToken: JSON.parse(localStorage.getItem('td.profile')).token,
}));
async function profile(page) {
  const { profileToken } = await identity(page);
  const response = await page.request.get(base + '/profile', { headers: { Authorization: 'Bearer ' + profileToken } });
  assert.equal(response.status(), 200, 'profile token authenticates');
  return (await response.json()).profile;
}
async function snapshot(page) {
  const { session, playerId } = await identity(page);
  const response = await page.request.get(base + '/state', { headers: { Authorization: 'Bearer ' + session.token } });
  assert.equal(response.status(), 200, 'session retrieves the authoritative state');
  const state = await response.json(), player = state.players.find(candidate => candidate.id === playerId);
  assert.ok(player);
  return { state, player };
}
async function start(page, speed = '1') {
  await selectDestination(page);
  await selectRunSpeed(page, speed);
  await page.locator('#quick-start').tap();
  await page.locator('#game:not([hidden])').waitFor();
  await page.locator('#summon-btn:enabled').waitFor();
}
async function action(page, selector) {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/action' && response.request().method() === 'POST');
  await page.locator(selector).tap();
  const response = await responsePromise, result = await response.json();
  assert.equal(response.status(), 200);
  assert.equal(result.ok, true, 'server accepts UI action: ' + (result.error || ''));
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
  return { result, packet: response.request().postDataJSON() };
}
async function closeDialog(page, id) {
  if (!await page.locator('#' + id).evaluate(element => element.open)) return;
  await page.locator(`[data-close="${id}"]`).tap();
  await page.waitForFunction(id => !document.getElementById(id).open, id);
}
async function screenshot(page, label, fullPage = false) {
  lastPage = page;
  const path = `artifacts/expedition-${label}.png`;
  await page.screenshot({ path, fullPage }); report.artifacts.push(path);
}
async function usableDialog(page, id, selectors, label) {
  const geometry = await page.evaluate(({ id, selectors }) => {
    const dialog = document.getElementById(id), box = dialog.getBoundingClientRect();
    const targets = selectors.map(selector => {
      const element = document.querySelector(selector), rect = element.getBoundingClientRect();
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
      return { selector, width: rect.width, height: rect.height,
        visibleWidth: Math.max(0, Math.min(right, rect.right) - Math.max(left, rect.left)),
        visibleHeight: Math.max(0, Math.min(bottom, rect.bottom) - Math.max(top, rect.top)) };
    });
    return { width: innerWidth, height: innerHeight, dialogHeight: box.height,
      toolbarHidden: getComputedStyle(document.querySelector('.command-panel')).visibility === 'hidden', targets };
  }, { id, selectors });
  await screenshot(page, label);
  assert.ok(geometry.dialogHeight <= geometry.height * .30 + 1, 'management dialog respects the 30% maximum');
  assert.equal(geometry.toolbarHidden, id !== 'unit-dialog', 'unit selection preserves commands; management replaces them');
  const failures = geometry.targets.flatMap(target => [
    ...(target.width < 43.5 || target.height < 43.5 ? [{ label, issue: 'touch target below 44px', ...target }] : []),
    ...(target.visibleWidth < target.width - 1 || target.visibleHeight < target.height - 1 ? [{ label, issue: 'target clipped before scrolling', ...target }] : []),
  ]);
  report.layoutFailures.push(...failures);
  if (failures.length) console.error('LAYOUT FAIL ' + JSON.stringify(failures));
  else pass(label, geometry);
}
async function compact(page, label) {
  const layout = await page.evaluate(() => {
    const command = document.querySelector('.command-panel').getBoundingClientRect();
    const canvas = document.querySelector('#battlefield').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, dockHeight: command.height, dockTop: command.top,
      canvasTop: canvas.top, canvasBottom: canvas.bottom, canvasHeight: canvas.height,
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      openDialogs: document.querySelectorAll('dialog[open]').length,
      expandedControls: [...document.querySelectorAll('.command-panel [data-tab]')].some(button => button.getAttribute('aria-expanded') === 'true') };
  });
  assert.equal(layout.openDialogs, 0, 'ordinary combat has no automatic blocking dialog');
  assert.equal(layout.expandedControls, false, 'management lists start collapsed');
  assert.ok(layout.dockHeight <= layout.height * .30 + 1, 'bottom controls obey the 30% upper limit');
  assert.ok(layout.dockHeight < layout.height * .20, 'collapsed controls do not permanently occupy the full 30% allowance');
  assert.ok(layout.scrollWidth <= layout.width + 1 && layout.scrollHeight <= layout.height + 1, 'combat fits the viewport without page scrolling');
  assert.ok(layout.canvasHeight >= layout.height * .8 && layout.canvasTop >= -1 && Math.abs(layout.canvasBottom - layout.height) <= 1, 'battlefield fills the viewport behind floating controls');
  pass(label, layout);
}
const roomFor = playerId => {
  const room = rooms.findLast(candidate => candidate.game.players.some(player => player.id === playerId));
  assert.ok(room, 'test-only hook captured the real room'); return room;
};
function give(game, player, definitionIds) {
  player.units = definitionIds.map((definitionId, slot) => ({ id: game.nextEntityId++, definitionId, slot,
    dispatched: false, attackCooldownTicks: 0, lastAttackTick: null, lastTargetId: null, investedGold: game.rules.summonCost }));
}
function finishPlayer(game, playerId) {
  const player = game.players.find(candidate => candidate.id === playerId);
  assert.equal(player.status, 'active');
  while (player.investmentActions < 3) {
    assert.equal(applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' }).ok, true);
  }
  player.enemies = Array.from({ length: Math.max(0, 60 - player.kills) }, () => ({
    id: game.nextEntityId++, hp: 1, maxHp: 1, progress: 0, boss: false,
  }));
  for (let step = 0; step < 1200 && player.kills < 60 && player.status === 'active'; step++) tick(game);
  assert.ok(player.kills >= 60, 'real attacks satisfy the reward contribution gate');
  // Prepare a final-boss encounter, then let real core attacks create the result.
  game.tick = game.rules.waveTicks * game.rules.totalWaves - 1;
  game.wave = game.rules.totalWaves; game.story = null;
  for (const peer of game.players) { peer.enemies = []; peer.overcrowdedTicks = 0; }
  if (!player.units.length) give(game, player, [content.units.find(unit => unit.rarity === 'basic').id]);
  tick(game);
  if (game.objective.kind === 'mining') {
    assert.equal(player.status, 'cleared', 'protected mining completes without a boss');
    return player.result;
  }
  const boss = player.enemies.find(enemy => enemy.boss);
  assert.ok(boss, 'production core spawns the final boss');
  boss.hp = 1;
  for (const unit of player.units) unit.attackCooldownTicks = 0;
  // Random placements need time for the boss to enter a robot's actual range.
  for (let step = 0; step < game.rules.bossTicks && player.status === 'active'; step++) tick(game);
  assert.equal(player.status, 'cleared');
  assert.ok(player.result?.cleared, 'production core freezes the terminal result');
  return player.result;
}
function recipeNames(recipe) {
  const ids = new Set();
  const collect = definitionId => {
    if (ids.has(definitionId)) return;
    ids.add(definitionId);
    const parent = content.recipes.find(candidate => candidate.result === definitionId);
    if (parent) parent.ingredients.forEach(collect);
  };
  collect(recipe.result);
  return [...ids].map(id => content.units.find(unit => unit.id === id).name);
}

try {
  await boot();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const host = await newPage();
  const initialProfile = await profile(host);
  assert.equal(initialProfile.researchCredits, 0);
  assert.deepEqual(initialProfile.unlockedRecipes, []);
  assert.equal(await host.locator('[data-battlefield="1"]').isEnabled(), true);
  assert.equal(await host.locator('[data-battlefield="3"]').isDisabled(), true);
  assert.match(await host.locator('#expedition-duration').textContent(), /8:12/);
  await screenshot(host, 'planet-selection', true);
  pass('fresh profile displays the short first expedition and locks later destinations');
  await start(host);
  await compact(host, 'mobile combat begins with a thin collapsed dock');
  let before = await snapshot(host);
  assert.equal(before.state.battlefieldId, 1);
  assert.equal(before.state.practice, false);
  const shortSeconds = (before.state.rules.waveTicks * before.state.rules.totalWaves + before.state.rules.bossTicks) / before.state.rules.ticksPerSecond;
  assert.equal(shortSeconds, 492);
  await action(host, '#summon-btn');
  let after = await snapshot(host);
  assert.equal(after.player.units.length, before.player.units.length + 1);
  assert.equal(after.player.gold, before.player.gold - after.state.rules.summonCost);

  await host.locator('#upgrades-tab').tap();
  await host.locator('#command-dialog[open]').waitFor();
  before = await snapshot(host);
  const upgrade = host.locator('[data-upgrade-tag]').first(), tag = await upgrade.getAttribute('data-upgrade-tag');
  const spent = before.state.rules.upgradeCosts[before.player.upgrades[tag]];
  await upgrade.tap();
  await host.locator('#upgrade-inspection:not([hidden])').waitFor();
  after = await snapshot(host);
  assert.equal(after.player.gold, before.player.gold, 'inspection does not spend scrap');
  assert.deepEqual(after.player.upgrades, before.player.upgrades);
  assert.equal(after.player.lastSeq, before.player.lastSeq, 'inspection submits no combat action');
  assert.match(await host.locator('#upgrade-buy').textContent(), new RegExp(String(spent)));
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 667, height: 375 }]) {
    await host.setViewportSize(viewport);
    await usableDialog(host, 'command-dialog', ['#upgrade-buy', '#upgrade-back', '[data-close="command-dialog"]'],
      `upgrade-inspection-${viewport.width}x${viewport.height}`);
  }
  await host.setViewportSize({ width: 390, height: 844 });
  await action(host, '#upgrade-buy');
  after = await snapshot(host);
  assert.equal(after.player.upgrades[tag], before.player.upgrades[tag] + 1);
  assert.equal(after.player.gold, before.player.gold - spent);
  await closeDialog(host, 'command-dialog');
  pass('upgrade inspection is free and only the explicit purchase spends the displayed cost');

  const researchRecipe = content.recipes.find(recipe => recipe.unlockBattlefield === 1);
  await host.locator('#recipes-tab').tap();
  await host.locator(`#recipe-list [data-plan-recipe="${researchRecipe.id}"]`).tap();
  await host.locator('#blueprint-dialog[open]').waitFor();
  const blueprint = await host.locator('#blueprint-dialog').textContent();
  for (const name of recipeNames(researchRecipe)) assert.ok(blueprint.includes(name), 'preview includes recursive material: ' + name);
  await screenshot(host, 'blueprint');
  await closeDialog(host, 'blueprint-dialog'); await closeDialog(host, 'command-dialog');
  pass('locked endgame recipe remains previewable down to its basic materials');

  const { session: hostSession, playerId: hostId } = await identity(host);
  const peers = [];
  for (let index = 0; index < 3; index++) {
    const peer = await newPage(); peers.push(peer);
    await peer.locator('#join-open').tap();
    await peer.fill('#room-input', hostSession.roomId);
    await peer.locator('#join-form button[type="submit"]').tap();
    await peer.locator('#game:not([hidden])').waitFor();
  }
  const shared = await snapshot(host);
  assert.equal(shared.state.players.length, 4);
  const peerBefore = await snapshot(peers[0]);
  await action(peers[0], '#summon-btn');
  const sharedAfter = await snapshot(host);
  assert.equal(sharedAfter.player.units.length, shared.player.units.length, 'peer summons do not change my lane units');
  assert.equal(sharedAfter.player.gold, shared.player.gold, 'peer spending does not consume my scrap');
  assert.equal(sharedAfter.state.players.find(player => player.id === peerBefore.player.id).units.length, 1);
  for (const page of [host, ...peers]) {
    const own = await snapshot(page);
    assert.equal(own.state.battlefieldId, 1);
    assert.equal(own.state.rules.waveTicks, shared.state.rules.waveTicks);
    assert.deepEqual(own.state.players.map(player => player.id), shared.state.players.map(player => player.id));
  }
  pass('four real browser contexts share the same planet while owning independent lanes');
  lastPage = host;

  const hostRoom = roomFor(hostId), result = finishPlayer(hostRoom.game, hostId);
  assert.ok(result.researchCredits > 0);
  await host.locator('#result-dialog[open]').waitFor();
  const paidProfile = await profile(host);
  assert.equal(paidProfile.researchCredits, initialProfile.researchCredits + result.researchCredits);
  assert.equal(paidProfile.stats.expeditions, 1); assert.equal(paidProfile.stats.clears, 1);
  assert.ok(paidProfile.clearedBattlefields.includes(1));
  assert.match(await host.locator('#result-research').textContent(), new RegExp(String(result.researchCredits)));
  for (let repeat = 0; repeat < 3; repeat++) await snapshot(host);
  assert.equal((await profile(host)).researchCredits, paidProfile.researchCredits, 'repeated state reads cannot pay the same result twice');
  assert.ok((await snapshot(peers[0])).player.status === 'active', 'one completed lane does not terminate the others');
  await screenshot(host, 'result');
  await host.locator('#result-lobby').tap();
  await host.locator('#lobby:not([hidden])').waitFor();
  await closeDialog(host, 'research-dialog');
  for (const peer of peers) await peer.context().close();
  pass('core-generated final-boss result reaches the UI and pays research credits exactly once', { credits: result.researchCredits, terminalFixture: true });

  // The first recipe costs more than a single first-stage clear. Earn its
  // remainder through a second core-generated clear, never a client balance edit.
  await start(host);
  const secondResult = finishPlayer(roomFor(hostId).game, hostId);
  await host.locator('#result-dialog[open]').waitFor();
  const researchFunds = await profile(host);
  assert.equal(researchFunds.researchCredits, paidProfile.researchCredits + secondResult.researchCredits);
  await host.locator('#result-lobby').tap();
  await host.locator('#lobby:not([hidden])').waitFor();
  await closeDialog(host, 'research-dialog');
  assert.ok(researchFunds.researchCredits >= researchRecipe.researchCost, 'two real result settlements fund the first blueprint');
  await host.locator('#research-btn').tap();
  const purchaseResponse = host.waitForResponse(response => new URL(response.url()).pathname === '/research' && response.request().method() === 'POST');
  await host.locator(`[data-research-recipe="${researchRecipe.id}"]`).tap();
  const purchase = await purchaseResponse, researched = await purchase.json();
  assert.equal(purchase.status(), 200); assert.equal(researched.ok, true);
  assert.ok(researched.profile.unlockedRecipes.includes(researchRecipe.id));
  assert.equal(researched.profile.researchCredits, researchFunds.researchCredits - researchRecipe.researchCost);
  await closeDialog(host, 'research-dialog');
  await host.reload(); await host.locator('#home-play:enabled').waitFor();
  assert.equal((await profile(host)).id, initialProfile.id);
  assert.equal((await profile(host)).researchCredits, researched.profile.researchCredits);
  assert.ok((await profile(host)).unlockedRecipes.includes(researchRecipe.id));
  pass('research UI spends persistent credits and keeps the unlocked recipe after reload');

  // Generate a legitimate core result in a separate fixture game to prepare the
  // late-planet menu; this intentionally does not claim a full 28-minute run.
  const stageTwo = createGame({ playerIds: ['fixture'], seed: 7, battlefieldId: 2, practice: false });
  const stageTwoResult = finishPlayer(stageTwo, 'fixture');
  store.recordResult(initialProfile.id, 'qa-stage-two-fixture', stageTwoResult);
  const persisted = store.getProfile(initialProfile.id), port = server.address().port;
  await shutdown(); rooms.length = 0;
  store = createProgressionStore({ filePath: profileFile });
  await boot(port);
  await host.reload(); await selectDestination(host);
  const restored = await profile(host);
  assert.equal(restored.id, persisted.id);
  assert.equal(restored.researchCredits, persisted.researchCredits);
  assert.deepEqual(restored.unlockedRecipes, persisted.unlockedRecipes);
  assert.deepEqual(restored.clearedBattlefields, persisted.clearedBattlefields);
  assert.equal(await host.locator('[data-battlefield="3"]').isEnabled(), true);
  await host.locator('[data-battlefield="3"]').tap();
  assert.equal(await host.locator('[data-battlefield="3"]').getAttribute('aria-pressed'), 'true');
  assert.match(await host.locator('#expedition-duration').textContent(), /30:06/);
  await start(host);
  const long = await snapshot(host);
  assert.equal(long.state.battlefieldId, 3);
  assert.equal((long.state.rules.waveTicks * long.state.rules.totalWaves + long.state.rules.bossTicks) / long.state.rules.ticksPerSecond, 1806);
  assert.ok(long.player.unlockedRecipes.includes(researchRecipe.id));
  await compact(host, 'thirty-minute planet also starts with collapsed mobile controls');
  await screenshot(host, 'long-planet-mobile');
  for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }]) {
    await host.setViewportSize(viewport);
    await compact(host, `landscape ${viewport.width}x${viewport.height} preserves the compact dock and visible battlefield`);
    await screenshot(host, `long-planet-${viewport.width}x${viewport.height}`);
  }
  await host.setViewportSize({ width: 390, height: 844 });
  pass('profile survives a real server/store restart and selects the thirty-minute planet', { configuredSeconds: 1806, stageTwoFixture: true });

  const evolvedRoom = roomFor(hostId), owner = evolvedRoom.game.players.find(player => player.id === hostId);
  give(evolvedRoom.game, owner, researchRecipe.ingredients);
  const materialIds = owner.units.map(unit => unit.id);
  await host.locator('#army-tab').tap();
  await host.locator(`[data-unit-id="${materialIds[0]}"]`).waitFor();
  await host.locator(`[data-unit-id="${materialIds[0]}"]`).tap();
  await host.locator('#unit-dialog[open]').waitFor();
  await host.locator(`[data-evolve-recipe="${researchRecipe.id}"]:enabled`).waitFor();
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 667, height: 375 }]) {
    await host.setViewportSize(viewport);
    await usableDialog(host, 'unit-dialog', [`[data-evolve-recipe="${researchRecipe.id}"]`, '#queue-dispatch', '[data-close="unit-dialog"]'],
      `researched-evolution-${viewport.width}x${viewport.height}`);
  }
  await host.setViewportSize({ width: 390, height: 844 });
  const combined = await action(host, `[data-evolve-recipe="${researchRecipe.id}"]`);
  const combinedPlayer = combined.result.state.players.find(player => player.id === hostId);
  assert.deepEqual([...combined.packet.unitIds].sort((a, b) => a - b), [...materialIds].sort((a, b) => a - b));
  assert.equal(combinedPlayer.units.length, 1);
  assert.equal(combinedPlayer.units[0].definitionId, researchRecipe.result);
  assert.ok(!materialIds.includes(combinedPlayer.units[0].id));
  pass('researched recipe evolves through the UI using exactly the authoritative owned materials', { recipeId: researchRecipe.id, materialFixture: true });

  const practice = await newPage(); await start(practice, '6');
  const practiceId = (await identity(practice)).playerId, practiceRoom = roomFor(practiceId);
  assert.equal((await snapshot(practice)).state.practice, true);
  finishPlayer(practiceRoom.game, practiceId);
  await practice.locator('#result-dialog[open]').waitFor();
  const practiceProfile = await profile(practice);
  assert.equal(practiceProfile.researchCredits, 0);
  assert.deepEqual(practiceProfile.unlockedRecipes, []);
  assert.deepEqual(practiceProfile.clearedBattlefields, []);
  pass('accelerated practice completion does not grant persistent credits or planet access');
  assert.deepEqual(report.errors, [], 'no uncaught browser exceptions');
  assert.deepEqual(report.layoutFailures, [], 'all management dialogs have visible 44px controls');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1; console.error(error);
  if (lastPage && !lastPage.isClosed()) await screenshot(lastPage, 'failure').catch(() => {});
} finally {
  await writeFile('artifacts/expedition-browser-report.json', JSON.stringify(report, null, 2));
  for (const context of contexts) await context.close().catch(() => {});
  if (browser) await browser.close();
  await shutdown();
  await rm(profileFile, { force: true });
  await rmdir(temporary);
}
