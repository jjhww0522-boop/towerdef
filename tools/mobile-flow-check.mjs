import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import { selectDestination, selectBattlefield, openUnitInspection, closeUnitInspection } from './playtest-navigation.mjs';
import core from '../dist/server/core/index.js';

const store = createProgressionStore(), rooms = [], errors = [], checks = [];
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated: room => rooms.push(room) });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const pass = label => { checks.push(label); console.log('PASS ' + label); };
let completed = false;
async function readableText(page, selector, minimumFontSize) {
  const reading = await page.locator(selector).evaluate(element => {
    const r = element.getBoundingClientRect(), style = getComputedStyle(element);
    const range = document.createRange(); range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const bounds = parent.getBoundingClientRect(), parentStyle = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(parentStyle.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
      if (/(auto|scroll|hidden|clip)/.test(parentStyle.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    }
    return { text: element.textContent, visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      fontSize: parseFloat(style.fontSize), width: r.width, height: r.height, clip: style.clip, clipPath: style.clipPath,
      contained: text.left >= left - 1 && text.right <= right + 1 && text.top >= top - 1 && text.bottom <= bottom + 1 };
  });
  assert.ok(reading.visible && reading.width > 20 && reading.height >= minimumFontSize && reading.contained,
    selector + ' must be genuinely readable, not merely present in the DOM: ' + JSON.stringify(reading));
  assert.ok(reading.fontSize >= minimumFontSize, selector + ' font size: ' + reading.fontSize);
  assert.equal(reading.clip, 'auto'); assert.equal(reading.clipPath, 'none');
}
try {
  for (const size of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: size.width < 1000 });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator('#home-play:enabled').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const typography = await page.evaluate(async () => {
      const faces = await document.fonts.load('400 28px "Do Hyeon"', '행성 선택');
      const style = getComputedStyle(document.querySelector('#home-play'));
      return { loaded: faces.some(face => face.family.replaceAll('"', '') === 'Do Hyeon' && face.status === 'loaded'),
        family: style.fontFamily, weight: style.fontWeight };
    });
    assert.equal(typography.loaded, true, 'bundled Do Hyeon face loads, rather than silently falling back');
    assert.ok(typography.family.includes('Do Hyeon'), 'main action uses the display font');
    assert.equal(typography.weight, '400', 'display font is not synthetically emboldened');
    assert.equal(await page.locator('#stage-screen').isVisible(), false);
    assert.equal(await page.locator('#game').isVisible(), false);
    await page.screenshot({ path: `artifacts/mobile-flow-${size.width}-home.png` });
    await page.locator('#research-btn').tap(); await page.locator('#research-dialog[open]').waitFor();
    await page.locator('[data-close="research-dialog"]').tap();
    const roomsBeforeNavigation = rooms.length;
    await selectDestination(page);
    await page.locator('#planet-next').tap();
    assert.equal(await page.locator('#quick-start').isDisabled(), true, 'locked planet preview cannot launch');
    assert.ok((await page.locator('#destination-lock').innerText()).trim());
    await page.locator('#planet-prev').tap();
    assert.equal(await page.locator('#quick-start').isEnabled(), true);
    await selectBattlefield(page, 2);
    assert.equal(await page.locator('#quick-start').isDisabled(), true, 'list selection also honors lock');
    await selectBattlefield(page, 1);
    await page.locator('#stage-back').tap(); await page.locator('#home-screen:not([hidden])').waitFor();
    assert.equal(rooms.length, roomsBeforeNavigation, 'navigation alone never starts an expedition');
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
    assert.equal(await page.locator('#army-count').isVisible(), false, 'robot count is not duplicated in the action toolbar');
    assert.equal(await page.locator('#unit-value').isVisible(), true, 'current deployment count remains visible');
    if (size.width === 390) {
      await readableText(page, '#unit-title', 20);
      await readableText(page, '#summon-cost', 16);
      assert.ok(await page.locator('#summon-cost').evaluate(element => getComputedStyle(element).fontFamily.includes('Pretendard')),
        'cost remains in the reading font');
    }
    const beforeManagement = player.lastSeq;
    await openUnitInspection(page);
    assert.equal(player.lastSeq, beforeManagement, 'opening management does not execute an action');
    await closeUnitInspection(page);
    assert.equal(await page.locator('#unit-dialog').isVisible(), true, 'closing management returns to the selected summary');
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
    await selectBattlefield(page, battlefieldId);
    assert.match(await page.locator('#destination-win').textContent(), battlefieldId === 2 ? /채굴기/ : /엔진/);
    await page.locator('#quick-start').click(); await page.locator('#summon-btn:enabled').waitFor();
    const game = rooms.at(-1).game, player = game.players[0];
    player.enemies = [1, 2, 3].map(() => ({ id: game.nextEntityId++, hp: 10000, maxHp: 10000, progress: game.objective.arrivalProgress, boss: false }));
    core.tick(game);
    await page.waitForFunction(() => document.querySelector('#enemy-count').textContent.includes('공격 3기'));
    player.facilityHp = Math.floor(game.objective.facilityHp * .2);
    core.tick(game);
    await page.waitForFunction(() => !document.querySelector('#threat-label').hidden && document.querySelector('#threat-label').textContent.includes('위험'));
    await page.waitForTimeout(3100);
    await readableText(page, '#threat-label', 24);
    await page.screenshot({ path: `artifacts/mobile-flow-facility-${battlefieldId}.png` });
    player.facilityHp = game.objective.damage;
    for (let i = 0; i < 10; i++) core.tick(game);
    await page.locator('#result-dialog[open]').waitFor();
    assert.match(await page.locator('#result-description').textContent(), /파괴/);
    await page.locator('#result-lobby').click(); await page.locator('[data-close="research-dialog"]').click();
    pass(`planet ${battlefieldId}: objective, repeated attackers, facility health and defeat reach the browser`);
  }
  await context.close();

  for (const size of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
    const riskContext = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true });
    const riskPage = await riskContext.newPage();
    riskPage.on('pageerror', error => errors.push(error.message));
    await riskPage.goto(base); await selectDestination(riskPage);
    await riskPage.locator('#quick-start').tap(); await riskPage.locator('#summon-btn:enabled').waitFor();
    const game = rooms.at(-1).game, player = game.players[0], r = game.rules;
    const restingCanvas = await riskPage.locator('#battlefield').boundingBox();
    const enemies = count => Array.from({ length: count }, () => ({ id: game.nextEntityId++, hp: 1000000, maxHp: 1000000, progress: 0, boss: false }));
    player.enemies = enemies(r.overcrowdCount - 1); core.tick(game);
    await riskPage.waitForFunction(count => document.querySelector('#enemy-count').textContent.includes(`적 ${count} /`), player.enemies.length);
    assert.equal(await riskPage.locator('#threat-label').isVisible(), false, 'below threshold does not show a defeat countdown');
    player.enemies = enemies(r.overcrowdCount); core.tick(game);
    const firstSeconds = ((r.overcrowdTicks - player.overcrowdedTicks) / r.ticksPerSecond).toFixed(1);
    await riskPage.waitForFunction(seconds => document.querySelector('#threat-label').textContent.includes(seconds + '초'), firstSeconds);
    await riskPage.waitForTimeout(3100);
    assert.equal(await riskPage.locator('#combat-alert').isVisible(), false, 'transient entrance alert has expired');
    await readableText(riskPage, '#threat-label', 24);
    assert.deepEqual(await riskPage.locator('#battlefield').boundingBox(), restingCanvas, 'persistent warning does not resize the battlefield');
    for (let i = 0; i < r.ticksPerSecond; i++) core.tick(game);
    const nextSeconds = ((r.overcrowdTicks - player.overcrowdedTicks) / r.ticksPerSecond).toFixed(1);
    assert.notEqual(nextSeconds, firstSeconds);
    await riskPage.waitForFunction(seconds => document.querySelector('#threat-label').textContent.includes(seconds + '초'), nextSeconds);
    await readableText(riskPage, '#threat-label', 24);
    player.enemies = []; core.tick(game);
    await riskPage.waitForFunction(() => document.querySelector('#threat-label').hidden);
    assert.equal(player.overcrowdedTicks, 0);
    // Real core transition spawns the boss; the empty army cannot accidentally kill it.
    game.tick = r.waveTicks * r.totalWaves - 1; player.enemies = []; core.tick(game);
    await riskPage.locator('#boss-hud:not([hidden])').waitFor();
    await riskPage.waitForFunction(seconds => document.querySelector('#boss-deadline').textContent.includes(seconds + '초'), (r.bossTicks / r.ticksPerSecond).toFixed(1));
    await riskPage.waitForTimeout(3100);
    await readableText(riskPage, '#boss-deadline', 18);
    for (let i = 0; i < r.ticksPerSecond; i++) core.tick(game);
    await riskPage.waitForFunction(seconds => document.querySelector('#boss-deadline').textContent.includes(seconds + '초'), ((r.bossTicks - r.ticksPerSecond) / r.ticksPerSecond).toFixed(1));
    await riskPage.locator('#battle-settings-btn').tap();
    await riskPage.locator('#reduced-motion').check(); await riskPage.locator('#sound-enabled').uncheck();
    await riskPage.locator('[data-close="settings-dialog"]').tap();
    await readableText(riskPage, '#boss-deadline', 18);
    game.tick = r.waveTicks * r.totalWaves + r.bossTicks - 1; core.tick(game);
    await riskPage.locator('#result-dialog[open]').waitFor();
    assert.equal(player.defeatReason, 'boss_timeout');
    await riskContext.close();
    pass(`${size.width}x${size.height}: visible persistent overcrowding countdown, recovery, boss deadline and reduced-motion warning`);
  }
  assert.deepEqual(errors, []);
  completed = true;
} finally {
  await writeFile('artifacts/mobile-flow-report.json', JSON.stringify({ source: 'controlled_browser_checks', actualParticipants: 0, status: completed ? 'passed' : 'failed', checks, errors }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
