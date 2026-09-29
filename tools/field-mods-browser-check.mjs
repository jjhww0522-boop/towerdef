import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import { selectDestination } from './playtest-navigation.mjs';
import core from '../dist/server/core/index.js';

// Isolated, manually clocked authoritative fixtures; no live profiles or human participants.
const rooms = [], store = createProgressionStore();
const report = { source: 'automated-field-mod-browser', actualParticipants: 0, cases: [], errors: [] };
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated: room => rooms.push(room) });
await mkdir('artifacts/field-mods', { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const settled = page => page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
async function usable(page, selector) {
  const rect = await page.locator(selector).evaluate(element => {
    const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { width: r.width, height: r.height, visible: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      tappable: hit === element || element.contains(hit), blocker: hit?.id || hit?.className };
  });
  assert.ok(rect.visible && rect.tappable && rect.width >= 44 && rect.height >= 44, selector + ': ' + JSON.stringify(rect));
}
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const profile = store.createProfile(); store.completeTutorial(profile.profile.id);
    await context.addInitScript(token => localStorage.setItem('td.profile', JSON.stringify({ token })), profile.profileToken);
    const page = await context.newPage(), checks = [];
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) report.errors.push('HTTP ' + response.status()); });
    try {
      await page.goto(base); await selectDestination(page, { mode: 'coop' });
      await page.evaluate(async () => {
        const { Battlefield } = await import('/battlefield.js'), update = Battlefield.prototype.update;
        Battlefield.prototype.update = function(...args) { update.apply(this, args); window.modField = this; };
      });
      await page.locator('#quick-start:enabled').tap(); await page.locator('#summon-btn:enabled').waitFor();
      await page.locator('#summon-btn').tap(); await settled(page);
      const game = rooms.at(-1).game, player = game.players[0];
      const unit = player.units[0]; unit.definitionId = 'laser_1';
      player.enemies = [{ id: game.nextEntityId++, archetype: 'grunt', hp: 10000, maxHp: 10000, progress: .4, routeIndex: 0, boss: false }];
      await page.waitForFunction(id => window.modField?.units.get(id)?.unit.definitionId === 'laser_1', unit.id);
      await usable(page, '#field-mod-toggle');
      await page.locator('#army-tab').tap(); await page.locator(`[data-unit-id="${unit.id}"]`).tap();
      await page.locator('#unit-dialog[open]').waitFor();
      const title = await page.locator('#unit-title').innerText();
      await page.locator('#unit-manage').tap();
      await page.locator('#queue-dispatch').tap();
      await page.locator('[data-close="unit-inspection-dialog"]').tap();
      await page.locator('#field-mod-toggle').tap();
      assert.equal(await page.locator('#unit-dialog').evaluate(dialog => dialog.open), false);
      assert.equal(await page.locator('#field-mod-dialog').evaluate(dialog => dialog.matches(':modal')), false);
      assert.equal(await page.locator('[data-choose-mod]:disabled').count(), 3);
      await page.locator('[data-close="field-mod-dialog"]').tap();
      assert.equal(await page.locator('#unit-dialog').evaluate(dialog => dialog.open), true);
      assert.equal(await page.locator('#unit-title').innerText(), title);
      assert.equal(await page.evaluate(id => window.modField.selected.has(id), unit.id), true);
      assert.match(await page.locator('#roster').innerText(), /파견 대기/);
      await page.locator('[data-close="unit-dialog"]').tap();
      checks.push('preview before opportunity; nonmodal shared dock preserves selected robot');

      game.tick = Math.floor(game.rules.waveTicks * game.rules.totalWaves / 3);
      await page.locator('#field-mod-toggle[data-available="true"]').waitFor();
      assert.equal(await page.locator('#field-mod-dialog').evaluate(dialog => dialog.open), false, 'no automatic popup');
      await page.locator('#field-mod-toggle').tap();
      for (const selector of ['#field-mod-toggle', '#operation-toggle', '#tactic-overdrive', '#tactic-emp', '#summon-btn', '[data-close="field-mod-dialog"]']) await usable(page, selector);
      const choice = page.locator('[data-choose-mod="opener"]');
      await choice.scrollIntoViewIfNeeded(); await usable(page, '[data-choose-mod="opener"]');
      await page.screenshot({ path: `artifacts/field-mods/${viewport.width}-choices.png` });
      await choice.tap(); await settled(page);
      assert.equal(player.fieldMod.activeId, 'opener'); assert.equal(player.fieldMod.history.length, 1);
      assert.match(await page.locator('#field-mod-current').innerText(), /선제 센서/);
      unit.attackCooldownTicks = 0; core.tick(game);
      assert.ok(player.fieldMod.stats.find(stat => stat.modId === 'opener').bonusDamage > 0);
      await page.waitForFunction(() => document.querySelector('#field-mod-stats').textContent.includes('선제 센서'));
      checks.push('survey authoritative choice and measured real hit contribution; 44px support/threat/summon access');

      game.tick = Math.floor(game.rules.waveTicks * game.rules.totalWaves * 2 / 3);
      await page.locator('[data-choose-mod="scatter"][data-offer-id="retune"]:enabled').waitFor();
      assert.equal(await page.locator('[data-choose-mod="opener"]').innerText(), '유지');
      await page.locator('[data-choose-mod="scatter"]').scrollIntoViewIfNeeded();
      // Drop an actual successful action response. Retry must reuse exactly the same packet.
      let firstPacket, drop = true, blockState = false;
      // Keep polling healthy until the intended choice request begins.
      await page.route('**/state', route => blockState ? route.abort() : route.continue());
      await page.route('**/action', async route => {
        if (drop && route.request().postDataJSON().type === 'choose_mod') {
          drop = false; blockState = true; firstPacket = route.request().postDataJSON();
          await route.fetch(); await route.abort();
        } else await route.continue();
      });
      await page.locator('[data-choose-mod="scatter"]').tap();
      await page.locator('#retry-action:enabled').waitFor();
      assert.equal(player.fieldMod.activeId, 'scatter');
      assert.match(await page.locator('#field-mod-current').innerText(), /선제 센서/, 'lost response must not optimistically confirm new effect');
      const retryResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/action');
      await page.locator('#retry-action').tap();
      const retried = await retryResponse;
      assert.deepEqual(retried.request().postDataJSON(), firstPacket);
      await settled(page); await page.unroute('**/state'); await page.unroute('**/action');
      assert.equal(player.fieldMod.history.length, 2); assert.equal(player.fieldMod.activeId, 'scatter');
      assert.match(await page.locator('#field-mod-current').innerText(), /분산 노즐/);
      checks.push('retune replaces one active effect; lost response retry is identical and counted once');
      await page.locator('[data-close="field-mod-dialog"]').tap();

      // A terminal server result must retain the contribution snapshot even if live data changes.
      player.enemies = []; game.tick = game.rules.waveTicks * game.rules.totalWaves - 1; core.tick(game);
      await page.locator('#boss-hud:not([hidden])').waitFor();
      await usable(page, '#field-mod-toggle');
      const bossReadable = await page.locator('#boss-hud').evaluate(element => {
        const r = element.getBoundingClientRect(), button = document.querySelector('#field-mod-toggle').getBoundingClientRect();
        return !(r.left < button.right && r.right > button.left && r.top < button.bottom && r.bottom > button.top);
      });
      assert.equal(bossReadable, true, 'field mod entry must not cover boss HP/deadline');
      await page.screenshot({ path: `artifacts/field-mods/${viewport.width}-boss.png` });
      const boss = player.enemies.find(enemy => enemy.boss); boss.hp = 1; boss.progress = .4;
      unit.definitionId = 'laser_2'; unit.attackCooldownTicks = 0;
      for (let tick = 0; tick < 30 && player.status === 'active'; tick++) core.tick(game);
      assert.equal(player.status, 'cleared');
      await page.locator('#result-dialog[open]').waitFor();
      assert.match(await page.locator('#result-field-mod').innerText(), /선제 센서.*분산 노즐/s);
      const recap = await page.locator('#result-field-mod').innerText();
      player.fieldMod.stats[2].bonusDamage = 999999;
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#result-field-mod').innerText(), recap);
      await page.screenshot({ path: `artifacts/field-mods/${viewport.width}-result.png` });
      checks.push('result shows ordered choices and immutable server contribution snapshot');
      report.cases.push({ viewport, status: 'passed', checks });
      console.log(`PASS field mods ${viewport.width}x${viewport.height}: ${checks.length} flows`);
    } catch (error) {
      await page.screenshot({ path: `artifacts/field-mods/${viewport.width}-failure.png` }).catch(() => {});
      report.cases.push({ viewport, status: 'failed', checks, failure: error.stack }); throw error;
    } finally { await context.close(); }
  }
  // An in-flight first-offer action must never spend the later opportunity.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const profile = store.createProfile(); store.completeTutorial(profile.profile.id);
    await context.addInitScript(token => localStorage.setItem('td.profile', JSON.stringify({ token })), profile.profileToken);
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(base); await selectDestination(page); await page.locator('#quick-start:enabled').tap();
    await page.locator('#summon-btn:enabled').waitFor();
    const game = rooms.at(-1).game, player = game.players[0];
    game.tick = Math.floor(game.rules.waveTicks * game.rules.totalWaves / 3);
    await page.locator('#field-mod-toggle[data-available="true"]').waitFor(); await page.locator('#field-mod-toggle').tap();
    await page.locator('[data-choose-mod="tracker"]').scrollIntoViewIfNeeded();
    await page.route('**/action', async route => {
      game.tick = Math.floor(game.rules.waveTicks * game.rules.totalWaves * 2 / 3);
      await route.continue();
    });
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/action');
    await page.locator('[data-choose-mod="tracker"]').tap();
    assert.equal((await (await responsePromise).json()).error, 'STALE_MOD_OFFER');
    await settled(page); await page.unroute('**/action');
    assert.equal(player.fieldMod.activeId, null); assert.equal(player.fieldMod.history.length, 0);
    await page.locator('[data-choose-mod="tracker"][data-offer-id="retune"]:enabled').waitFor();
    await page.locator('[data-choose-mod="tracker"]').tap(); await settled(page);
    assert.equal(player.fieldMod.history.length, 1); assert.equal(player.fieldMod.history[0].offerId, 'retune');
    // Resolve an authoritative overcrowding defeat, then reopen only the nonmodal recap.
    player.enemies = Array.from({ length: game.rules.overcrowdCount }, (_, index) => ({ id: game.nextEntityId++, hp: 1000, maxHp: 1000, progress: .2 + index * .001, routeIndex: 0, boss: false }));
    player.overcrowdedTicks = game.rules.overcrowdTicks - 1; core.tick(game);
    assert.equal(player.status, 'defeated'); await page.locator('#result-dialog[open]').waitFor();
    assert.match(await page.locator('#result-field-mod').innerText(), /추적 회로.*추가 피해 0/s);
    await page.keyboard.press('Escape'); await page.locator('#field-mod-toggle').tap();
    assert.match(await page.locator('#field-mod-schedule').innerText(), /원정 종료/);
    assert.equal(await page.locator('[data-choose-mod]:enabled').count(), 0);
    report.cases.push({ status: 'passed', checks: ['in-flight stale offer rejected; later opportunity preserved without a first choice', 'defeat recap records zero contribution; terminal panel offers no countdown or actions'] });
    console.log('PASS stale offer, missed first choice, zero contribution and ended panel');
  } finally { await context.close(); }
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; console.error(error); process.exitCode = 1; }
finally {
  await writeFile('artifacts/field-mods/browser-report.json', JSON.stringify(report, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
