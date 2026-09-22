import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import { selectDestination } from './playtest-navigation.mjs';
import core from '../dist/server/core/index.js';

const store = createProgressionStore(), rooms = [], errors = [], checks = [];
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated: room => rooms.push(room) });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const pass = label => { checks.push(label); console.log('PASS ' + label); };
try {
  for (const size of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: size.width < 1000 });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator('#home-play:enabled').waitFor();
    assert.equal(await page.locator('#stage-screen').isVisible(), false);
    assert.equal(await page.locator('#game').isVisible(), false);
    await page.screenshot({ path: `artifacts/mobile-flow-${size.width}-home.png` });
    await page.locator('#research-btn').tap(); await page.locator('#research-dialog[open]').waitFor();
    await page.locator('[data-close="research-dialog"]').tap();
    await selectDestination(page);
    assert.equal(await page.locator('[data-battlefield="2"]').isDisabled(), true);
    await page.locator('#stage-back').tap(); await page.locator('#home-screen:not([hidden])').waitFor();
    assert.equal(rooms.length, checks.length, 'navigation alone never starts an expedition');
    await selectDestination(page);
    await page.screenshot({ path: `artifacts/mobile-flow-${size.width}-stages.png` });
    const stageGeometry = await page.evaluate(() => {
      const box = document.querySelector('#quick-start').getBoundingClientRect();
      return { bottom: box.bottom, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight };
    });
    assert.ok(stageGeometry.bottom <= size.height && stageGeometry.scrollWidth <= size.width && stageGeometry.scrollHeight <= size.height);
    await page.locator('#quick-start').tap(); await page.locator('#summon-btn:enabled').waitFor();
    const room = rooms.at(-1), player = room.game.players[0];
    await page.locator('#summon-btn').tap(); await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
    assert.equal(player.units.length, 1);
    const geometry = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      return { canvas: box('#battlefield'), summon: box('#summon-btn'), management: box('.command-panel'), targets: [...document.querySelectorAll('.command-panel button,#summon-btn')].map(e => ({ width: e.offsetWidth, height: e.offsetHeight })) };
    });
    assert.ok(Math.abs(geometry.canvas.bottom - size.height) <= 1);
    assert.ok(geometry.canvas.height >= size.height * .8);
    assert.ok(geometry.summon.top > geometry.canvas.top && geometry.summon.bottom < geometry.canvas.bottom);
    assert.ok(geometry.management.right < geometry.summon.left);
    assert.ok(geometry.targets.every(target => target.width >= 44 && target.height >= 44));
    await page.locator('#army-tab').tap(); await page.locator('[data-unit-id]').first().tap();
    await page.locator('#unit-dialog[open]').waitFor();
    const after = await page.locator('#battlefield').boundingBox();
    assert.equal(after.height, geometry.canvas.height);
    await page.screenshot({ path: `artifacts/mobile-flow-${size.width}-battle.png` });
    await page.locator('[data-close="unit-dialog"]').tap();
    await page.reload(); await page.locator('#home-play:enabled').waitFor();
    await page.locator('#resume-btn').tap(); await page.locator('#summon-btn:enabled').waitFor();
    assert.equal(rooms.at(-1), room);
    await page.locator('#leave-btn').tap(); await page.locator('#home-screen:not([hidden])').waitFor();
    pass(`${size.width}x${size.height}: home, research, destination, battle, resume and return`);
    await context.close();
  }
  // Explicit server fixtures unlock later planets; no real account or progress is modified.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.locator('#home-play:enabled').waitFor();
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('td.profile')).token);
  const profile = store.authenticate(token);
  for (const battlefieldId of [1, 2]) store.recordResult(profile.id, 'fixture-' + battlefieldId, { battlefieldId, status: 'cleared', cleared: true, researchCredits: 0 });
  for (const battlefieldId of [2, 3]) {
    await page.reload(); await selectDestination(page);
    await page.locator(`[data-battlefield="${battlefieldId}"]`).click();
    assert.match(await page.locator('#destination-win').textContent(), battlefieldId === 2 ? /채굴기/ : /엔진/);
    await page.locator('#quick-start').click(); await page.locator('#summon-btn:enabled').waitFor();
    const game = rooms.at(-1).game, player = game.players[0];
    player.enemies = [1, 2, 3].map(() => ({ id: game.nextEntityId++, hp: 10000, maxHp: 10000, progress: game.objective.arrivalProgress, boss: false }));
    core.tick(game);
    await page.waitForFunction(() => document.querySelector('#enemy-count').textContent.includes('공격 3기'));
    await page.screenshot({ path: `artifacts/mobile-flow-facility-${battlefieldId}.png` });
    player.facilityHp = game.objective.damage;
    for (let i = 0; i < 10; i++) core.tick(game);
    await page.locator('#result-dialog[open]').waitFor();
    assert.match(await page.locator('#result-description').textContent(), /파괴/);
    await page.locator('#result-lobby').click(); await page.locator('[data-close="research-dialog"]').click();
    pass(`planet ${battlefieldId}: objective, repeated attackers, facility health and defeat reach the browser`);
  }
  await context.close();
  assert.deepEqual(errors, []);
} finally {
  await writeFile('artifacts/mobile-flow-report.json', JSON.stringify({ source: 'controlled_browser_checks', actualParticipants: 0, checks, errors }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
