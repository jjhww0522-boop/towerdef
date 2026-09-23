import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore, ENGINE_RECOVERY_MS } from './progression.mjs';
import { selectDestination, selectBattlefield } from './playtest-navigation.mjs';
import { getBattlefieldLayout } from '../shared/battle-geometry.js';
import core from '../dist/server/core/index.js';

// Isolated in-memory profiles, manual core ticks, and an injected server energy clock.
// Fixtures never expose HTTP cheats or verify an actual store purchase.
const report = { source: 'controlled_engine_chapter_browser_checks', actualParticipants: 0,
  contentVersion: core.content.version, status: 'failed', checks: [], maps: [], errors: [], artifacts: [] };
const sizes = [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 667, height: 375 }];
const pass = label => { report.checks.push(label); console.log('PASS ' + label); };
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });

async function fixture() {
  let now = Date.UTC(2026, 8, 23), mapMode = false;
  const store = createProgressionStore({ now: () => now }), rooms = [];
  const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated(room) {
    rooms.push(room);
    if (mapMode) {
      const game = room.game, player = game.players[0];
      player.gold = 1000;
      player.enemies = [.08, .22, .4, .6, .78, .85].map((progress, index) => ({
        id: game.nextEntityId++, hp: 10000, maxHp: 10000, progress, boss: false,
        routeIndex: index % getBattlefieldLayout(game.battlefieldId).routes.length
      }));
    }
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { store, rooms, base: 'http://127.0.0.1:' + server.address().port,
    advance() { now += ENGINE_RECOVERY_MS; return now; }, maps() { mapMode = true; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
async function openPage(base, size) {
  const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push({ viewport: size, message: error.message }));
  await page.goto(base); await page.locator('#home-play:enabled').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}
async function account(page, store) {
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('td.profile')).token);
  const profile = store.authenticate(token); assert.ok(profile); return profile;
}
async function screenshot(page, name) {
  const path = 'artifacts/' + name + '.png';
  await page.screenshot({ path }); report.artifacts.push(path); return path;
}
async function viewportFits(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  assert.ok(dimensions.scrollWidth <= dimensions.width && dimensions.scrollHeight <= dimensions.height,
    label + ': viewport overflow ' + JSON.stringify(dimensions));
}
async function readable(page, selector, minimum) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const value = await page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element), range = document.createRange(); range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const box = parent.getBoundingClientRect(), css = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
    }
    return { text: element.textContent, visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      fontSize: parseFloat(style.fontSize), contained: text.left >= left - 1 && text.right <= right + 1 && text.top >= top - 1 && text.bottom <= bottom + 1 };
  });
  assert.ok(value.visible && value.contained && value.fontSize >= minimum, selector + ': ' + JSON.stringify(value));
}
async function leave(page) {
  await page.locator('#leave-btn:enabled').tap();
  await page.locator('#home-screen:not([hidden])').waitFor();
  assert.equal(await page.locator('#game').isVisible(), false);
}
async function enter(page) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/session');
  await page.locator('#quick-start:enabled').tap();
  const result = await response; assert.equal(result.status(), 200);
  const body = await result.json(); await page.locator('#summon-btn:enabled').waitFor(); return body;
}
async function engineFlow(f, size) {
  const { context, page } = await openPage(f.base, size);
  try {
    const profile = await account(page, f.store), sessionRequests = [], purchases = [];
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      const path = new URL(request.url()).pathname;
      if (path === '/session') sessionRequests.push(path);
      if (path === '/engine/refill') purchases.push(path);
    });
    assert.equal(await page.locator('#home-screen [data-engine-open] strong').innerText(), '5/5');
    await viewportFits(page, 'home');
    await screenshot(page, `engine-chapter-${size.width}-home`);
    const availability = page.waitForResponse(response => new URL(response.url()).pathname === '/engine/store');
    await page.locator('#home-screen [data-engine-open]').tap();
    await page.locator('#engine-dialog[open]').waitFor();
    const storeResponse = await availability; assert.equal(storeResponse.status(), 200);
    assert.equal((await storeResponse.json()).available, false, 'payment is genuinely unconnected on the test server');
    assert.equal(await page.locator('#engine-balance').innerText(), '5 / 5');
    assert.match(await page.locator('#engine-next').innerText(), /가득/);
    assert.match(await page.locator('.engine-help').innerText(), /30분마다 1개 회복/);
    assert.equal(await page.locator('#engine-buy').isDisabled(), true);
    assert.match(await page.locator('#engine-store-note').innerText(), /테스트.*결제할 수 없/);
    await readable(page, '#engine-balance', 32); await readable(page, '#engine-next', 18);
    await screenshot(page, `engine-chapter-${size.width}-engine`);
    await readable(page, '#engine-buy', 18); await readable(page, '#engine-store-note', 14);
    await viewportFits(page, 'engine dialog');
    await page.locator('[data-close="engine-dialog"]').tap();
    const firstRoom = f.rooms.length;
    for (let spent = 1; spent <= 5; spent++) {
      await selectDestination(page); await viewportFits(page, 'stages');
      assert.match(await page.locator('#quick-start').innerText(), /엔진 1/);
      const response = await enter(page);
      assert.equal(response.profile.engines.count, 5 - spent);
      assert.equal(f.store.getProfile(profile.id).engines.count, 5 - spent);
      assert.equal(f.rooms.length, firstRoom + spent);
      assert.equal(response.state.practice, false, 'normal expedition spends one engine');
      await leave(page);
      assert.equal(await page.locator('#home-screen [data-engine-open] strong').innerText(), (5 - spent) + '/5');
      if (spent === 1) {
        await page.locator('#home-screen [data-engine-open]').tap();
        await page.locator('#engine-dialog[open]').waitFor();
        assert.match(await page.locator('#engine-next').innerText(), /다음 엔진까지 (30:00|29:\d\d)/);
        assert.equal(await page.locator('#engine-balance').innerText(), '4 / 5');
        await page.locator('[data-close="engine-dialog"]').tap();
      }
    }
    await selectDestination(page);
    assert.equal(await page.locator('#quick-start').innerText(), '엔진 충전');
    const before = { rooms: f.rooms.length, requests: sessionRequests.length };
    await page.locator('#quick-start').tap(); await page.locator('#engine-dialog[open]').waitFor();
    await page.waitForFunction(() => document.querySelector('#engine-balance').textContent === '0 / 5');
    assert.equal(f.rooms.length, before.rooms, 'empty energy must not create a room');
    assert.equal(sessionRequests.length, before.requests, 'empty energy opens recharge before a session request');
    await screenshot(page, `engine-chapter-${size.width}-empty`);
    await page.locator('[data-close="engine-dialog"]').tap();
    const serverTime = f.advance();
    const recovery = page.waitForResponse(response => new URL(response.url()).pathname === '/profile' && response.request().method() === 'GET');
    await page.locator('#stage-screen [data-engine-open]').tap();
    const recovered = await (await recovery).json();
    assert.equal(recovered.profile.engines.serverTime, serverTime);
    assert.equal(recovered.profile.engines.count, 1);
    await page.waitForFunction(() => document.querySelector('#engine-balance').textContent === '1 / 5');
    await page.locator('[data-close="engine-dialog"]').tap();
    const resumed = await enter(page);
    assert.equal(resumed.profile.engines.count, 0);
    assert.equal(f.rooms.length, before.rooms + 1);
    await leave(page); assert.deepEqual(purchases, [], 'disabled purchase never sends a refill request');
    pass(`${size.width}x${size.height}: five real entries, empty guard, no purchase, server-clock recovery and re-entry`);
  } finally { await context.close(); }
}
async function observeRenderer(page) {
  await page.evaluate(async () => {
    const { Battlefield } = await import('/battlefield.js');
    const update = Battlefield.prototype.update, drawDeck = Battlefield.prototype.drawDeck, facility = Battlefield.prototype.facility;
    Battlefield.prototype.update = function(...args) { update.apply(this, args); window.chapterField = this; };
    Battlefield.prototype.facility = function(...args) {
      const originals = { rect: this.rect, ellipse: this.ellipse, text: this.text }, parts = [];
      this.rect = function(x, y, width, height, ...rest) {
        parts.push({ type: 'rect', left: x, top: y, right: x + width, bottom: y + height });
        return originals.rect.call(this, x, y, width, height, ...rest);
      };
      this.ellipse = function(x, y, rx, ry, ...rest) {
        parts.push({ type: 'ellipse', left: x - rx, top: y - ry, right: x + rx, bottom: y + ry });
        return originals.ellipse.call(this, x, y, rx, ry, ...rest);
      };
      this.text = function(value, x, y, size, ...rest) {
        const result = originals.text.call(this, value, x, y, size, ...rest), metrics = this.ctx.measureText(value);
        parts.push({ type: 'text', value, left: x - metrics.width / 2 - 1.5, right: x + metrics.width / 2 + 1.5,
          top: y - metrics.actualBoundingBoxAscent - 1.5, bottom: y + metrics.actualBoundingBoxDescent + 1.5 });
        return result;
      };
      try { return facility.apply(this, args); }
      finally { Object.assign(this, originals); this.observedFacility = parts; }
    };
    Battlefield.prototype.drawDeck = function(...args) {
      const position = this.position, slots = [];
      this.position = function(index) { slots.push(index); return position.call(this, index); };
      try { return drawDeck.apply(this, args); }
      finally { this.position = position; this.observedSlots = slots; }
    };
  });
}
async function mapFlow(f, size) {
  f.maps();
  const { context, page } = await openPage(f.base, size);
  try {
    const profile = await account(page, f.store);
    for (const battlefieldId of [1, 2, 3, 4]) f.store.recordResult(profile.id, 'fixture-unlock-' + battlefieldId,
      { battlefieldId, status: 'cleared', cleared: true, researchCredits: 0 });
    assert.deepEqual(f.store.getProfile(profile.id).unlockedBattlefields, [1, 2, 3, 4, 5]);
    await page.reload(); await page.locator('#home-play:enabled').waitFor();
    await observeRenderer(page);
    for (const stage of core.content.battlefields) {
      await selectBattlefield(page, stage.id);
      assert.match(await page.locator('#planet-index').innerText(), new RegExp('1-' + stage.id));
      assert.equal(await page.locator('#destination-name').innerText(), stage.name);
      if (stage.id === 1) await screenshot(page, `engine-chapter-${size.width}-stages`);
      const beforeRooms = f.rooms.length, response = await enter(page), room = f.rooms.at(-1), player = room.game.players[0];
      assert.equal(f.rooms.length, beforeRooms + 1); assert.equal(response.state.battlefieldId, stage.id);
      assert.equal(response.state.rules.maxUnits, getBattlefieldLayout(stage.id).slots.length);
      const restingCanvas = await page.locator('#battlefield').boundingBox();
      const summonCount = size.width > size.height && stage.id === 2 ? room.game.rules.maxUnits : 5;
      for (let count = 1; count <= summonCount; count++) {
        const action = page.waitForResponse(response => new URL(response.url()).pathname === '/action');
        await page.locator('#summon-btn:enabled').tap();
        const result = await action, packet = result.request().postDataJSON(), body = await result.json();
        assert.equal(packet.type, 'summon'); assert.equal(body.ok, true);
        assert.equal(player.units.length, count);
        await page.waitForFunction(count => window.chapterField?.units.size === count && JSON.parse(sessionStorage.getItem('td.pending')) === null, count);
      }
      assert.equal(new Set(player.units.map(unit => unit.slot)).size, summonCount);
      assert.ok(player.units.every(unit => unit.slot >= 0 && unit.slot < room.game.rules.maxUnits));
      assert.equal(player.gold, 1000 - room.game.rules.summonCost * summonCount);
      assert.deepEqual(await page.locator('#battlefield').boundingBox(), restingCanvas, 'summoning never resizes the canvas');
      await page.locator('#army-tab').tap(); await page.locator('[data-unit-id]').first().tap();
      await page.locator('#unit-dialog[open]').waitFor();
      assert.deepEqual(await page.locator('#battlefield').boundingBox(), restingCanvas, 'unit summary stays over the canvas');
      await page.locator('[data-close="unit-dialog"]').tap();
      await page.waitForTimeout(450);
      await viewportFits(page, 'stage ' + stage.id);
      const geometry = await page.evaluate(() => {
        const f = window.chapterField, bounds = f.canvas.getBoundingClientRect();
        const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const controls = [...document.querySelectorAll('.command-panel button,#summon-btn')].filter(element => element.checkVisibility()).map(element => ({ id: element.id, ...box(element) }));
        const facilityParts = f.objective.kind === 'overcrowd' ? [] : (f.observedFacility || []).map(part => ({
          type: part.type, value: part.value,
          left: bounds.left + f.ox + part.left * f.scale, right: bounds.left + f.ox + part.right * f.scale,
          top: bounds.top + f.oy + part.top * f.scale, bottom: bounds.top + f.oy + part.bottom * f.scale
        }));
        return { battlefieldId: f.battlefieldId, slots: f.observedSlots, enemies: [...f.enemies.values()].map(v => ({ routeIndex: v.enemy.routeIndex, progress: v.progress, ...f.path(v.progress, v.enemy.routeIndex) })), canvas: box(f.canvas), controls, facilityParts,
          units: [...f.units.values()].map(v => ({ id: v.unit.id, slot: v.unit.slot, x: v.x, y: v.y,
            target: f.position(v.unit.slot) })) };
      });
      assert.equal(geometry.battlefieldId, stage.id);
      assert.equal(new Set(geometry.enemies.map(enemy => enemy.routeIndex)).size, getBattlefieldLayout(stage.id).routes.length, 'all entrances contain observed enemies');
      assert.deepEqual(geometry.slots, Array.from({ length: room.game.rules.maxUnits }, (_, i) => i));
      assert.ok(geometry.controls.every(button => button.width >= 44 && button.height >= 44));
      assert.ok(Math.abs(geometry.canvas.bottom - size.height) <= 1 && geometry.canvas.height >= size.height * .8);
      for (const unit of geometry.units) {
        assert.equal(player.units.find(item => item.id === unit.id).slot, unit.slot);
        assert.ok(Math.abs(unit.x - unit.target.x) < 1 && Math.abs(unit.y - unit.target.y) < 1);
      }
      if (stage.objective.kind !== 'overcrowd') assert.ok(geometry.facilityParts.length > 0, 'facility drawing was observed');
      const overlaps = geometry.controls.filter(button => geometry.facilityParts.some(part =>
        button.left < part.right && button.right > part.left && button.top < part.bottom && button.bottom > part.top)).map(button => button.id);
      const path = await screenshot(page, `engine-chapter-${size.width}-map-${stage.id}`);
      report.maps.push({ viewport: size, battlefieldId: stage.id, slotCount: room.game.rules.maxUnits,
        summonedSlots: player.units.map(unit => unit.slot), geometry, facilityControlOverlaps: overlaps, path });
      assert.deepEqual(overlaps, [], 'facility and its health label remain clear of battle action buttons');
      await leave(page);
      pass(`${size.width}x${size.height}: map ${stage.id}, real summon, ${room.game.rules.maxUnits} drawn slots and stable canvas`);
    }
  } finally { await context.close(); }
}
try {
  for (const size of sizes) {
    const f = await fixture();
    try { await engineFlow(f, size); await mapFlow(f, size); }
    finally { await f.close(); }
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }; throw error;
} finally {
  await writeFile('artifacts/engine-chapter-report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
