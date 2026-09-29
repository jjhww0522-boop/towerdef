import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import { selectDestination } from './playtest-navigation.mjs';
import core from '../dist/server/core/index.js';

// Controlled server inventory and a manual clock isolate input/authority checks.
// Real browser/API flows; no external profiles and no claim of human playtesting.
const store = createProgressionStore(), rooms = [];
const report = { source: 'automated-mode-assembly-browser', actualParticipants: 0,
  fixtures: ['Manual server clock', 'Three server-owned opening robots and 1000 test scrap', 'Fourth assembly material inserted through the server summon action'],
  cases: [], errors: [] };
const artifactDirectory = 'artifacts/ord-mode';
await mkdir(artifactDirectory, { recursive: true });
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated(room) {
  rooms.push(room);
  const game = room.game, player = game.players[0];
  player.gold = 1000;
  for (const definitionId of ['fire_1', 'fire_1', 'water_1']) {
    while (game.tick < player.nextSummonTick) core.tick(game);
    assert.equal(core.applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' }).ok, true);
    player.units.at(-1).definitionId = definitionId;
  }
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const contexts = [];
let browser, lastPage;
const responseFor = (page, path) => page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST');
async function newPage(viewport) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  contexts.push(context);
  const account = store.createProfile(); store.completeTutorial(account.profile.id);
  await context.addInitScript(token => localStorage.setItem('td.profile', JSON.stringify({ token })), account.profileToken);
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base);
  return page;
}
async function hitTarget(page, selector) {
  const bounds = await page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { ...rect.toJSON(), valid: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth &&
      rect.width >= 44 && rect.height >= 44 && (hit === element || element.contains(hit)) };
  });
  assert.ok(bounds.valid, selector + ': ' + JSON.stringify(bounds));
}
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const page = await newPage(viewport), checks = [];
    await page.locator('#home-coop:enabled').waitFor();
    for (const selector of ['#home-play', '#home-coop', '#tutorial-start']) await hitTarget(page, selector);
    await page.screenshot({ path: `${artifactDirectory}/${viewport.width}-home.png` });
    await selectDestination(page, { mode: 'coop' });
    assert.match(await page.locator('#quick-start').innerText(), /방 만들기/);
    assert.equal(await page.locator('#stage-join').isVisible(), true);
    assert.ok(await page.locator('#stage-screen').evaluate(element => element.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${artifactDirectory}/${viewport.width}-coop-stage.png` });
    await selectDestination(page, { mode: 'solo' });
    assert.equal(await page.locator('#stage-join').isVisible(), false);
    checks.push('home targets at least 44px; separate solo/cooperative stage entry');

    const soloResponse = responseFor(page, '/session');
    await page.locator('#quick-start').tap();
    const soloPacket = await soloResponse, solo = await soloPacket.json();
    assert.equal(soloPacket.request().postDataJSON().mode, 'solo'); assert.equal(solo.state.mode, 'solo');
    await page.waitForFunction(() => document.querySelector('#assembly-progress').textContent.includes('2/3'));
    assert.equal(await page.locator('#story-toggle').isVisible(), false);
    assert.equal(await page.locator('#team-toggle').isVisible(), false);
    checks.push('solo sends explicit mode and hides cooperative controls');

    const game = rooms.at(-1).game, player = game.players[0], sequence = player.lastSeq, anchor = player.units[0];
    await page.locator('#recipes-tab').tap();
    await page.locator('[data-combine-recipe="make_fire_2"]').tap();
    await page.locator('#unit-dialog[open]').waitFor();
    assert.equal(player.lastSeq, sequence); assert.equal(player.units.length, 3);
    assert.equal(await page.locator('[data-evolve-recipe="make_fire_2"]').isDisabled(), true);
    await page.locator('#unit-manage').tap();
    assert.equal(await page.locator('#queue-dispatch').isVisible(), false);
    await page.locator('[data-close="unit-inspection-dialog"]').tap();
    await page.locator('[data-close="unit-dialog"]').tap();
    checks.push('2/3 recipe inspects materials for free; no premature combine or solo dispatch');

    while (game.tick < player.nextSummonTick) core.tick(game);
    core.applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' });
    player.units.at(-1).definitionId = 'fire_1';
    await page.waitForFunction(() => document.querySelector('#ready-count').textContent === '1');
    await page.locator('#recipes-tab').tap();
    await page.locator('[data-combine-recipe="make_fire_2"]').tap();
    const combineResponse = responseFor(page, '/action');
    await page.locator('[data-evolve-recipe="make_fire_2"]').tap();
    assert.equal((await (await combineResponse).json()).ok, true);
    assert.equal(player.units.find(unit => unit.definitionId === 'fire_2').slot, anchor.slot);
    assert.equal(player.units.filter(unit => unit.definitionId === 'fire_1').length, 0);
    checks.push('3/3 confirms exact assembly while preserving selected material position');

    // Legacy local session data may omit mode. Resume must use authoritative room mode.
    await page.evaluate(() => { const saved = JSON.parse(sessionStorage.getItem('td.session')); delete saved.mode; sessionStorage.setItem('td.session', JSON.stringify(saved)); });
    await page.reload(); await page.locator('#resume-btn').tap();
    await page.waitForFunction(() => document.querySelector('#game').dataset.mode === 'solo');
    assert.equal(JSON.parse(await page.evaluate(() => sessionStorage.getItem('td.session'))).mode, 'solo');
    assert.equal(rooms.at(-1).game, game);
    checks.push('resume restores solo mode from the same server room');
    await page.locator('#leave-btn').tap();

    await selectDestination(page, { mode: 'coop' });
    const coopResponse = responseFor(page, '/session');
    await page.locator('#quick-start').tap();
    const coopPacket = await coopResponse, coop = await coopPacket.json();
    assert.equal(coopPacket.request().postDataJSON().mode, 'coop'); assert.equal(coop.state.mode, 'coop');
    await page.locator('#story-toggle').waitFor();
    const roomId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('td.session')).roomId);
    const guest = await newPage(viewport);
    await selectDestination(guest, { mode: 'coop' });
    await guest.locator('#stage-join').tap(); await guest.locator('#room-input').fill(roomId);
    const guestResponse = responseFor(guest, '/session');
    await guest.locator('#join-form button[type="submit"]').tap();
    const guestState = (await (await guestResponse).json()).state;
    assert.equal(guestState.mode, 'coop'); assert.equal(guestState.expeditionId, coop.state.expeditionId);
    assert.equal(guestState.players.length, 2);
    await page.locator('#team-toggle').tap();
    assert.match(await page.locator('#story-contribution').innerText(), /내 지원 0기.*전체 지원 0기/);
    checks.push('cooperative host and invite share one authoritative room and support status');
    report.cases.push({ viewport, status: 'passed', checks });
    console.log(`PASS mode/assembly ${viewport.width}x${viewport.height}: ${checks.length} flows`);
    await guest.context().close(); await page.context().close();
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error);
  if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: `${artifactDirectory}/failure.png` }).catch(() => {});
} finally {
  await writeFile(`${artifactDirectory}/browser-report.json`, JSON.stringify(report, null, 2));
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
