import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import { selectBattlefield } from './playtest-navigation.mjs';
import core from '../dist/server/core/index.js';

const before = process.argv.includes('--before'), label = before ? 'before' : 'after';
const report = { source: 'controlled_stage_two_readability', actualParticipants: 0, label, cases: [], rotations: [], errors: [] };
const store = createProgressionStore(), rooms = [];
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated(room) {
  rooms.push(room); const { game } = room, player = game.players[0]; player.gold = 10000;
  for (let i = 0; i < 12; i++) {
    while (game.tick < player.nextSummonTick) core.tick(game);
    assert.equal(core.applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' }).ok, true);
    Object.assign(player.units.at(-1), { slot: i, definitionId: ['fire_1', 'water_1', 'frost_1', 'wind_1', 'electric_1', 'laser_1'][i % 6] });
  }
  player.enemies = Array.from({ length: 18 }, (_, i) => ({ id: game.nextEntityId++, progress: .08 + i * .043,
    routeIndex: 0, hp: 900, maxHp: 1000, boss: false, archetype: ['grunt', 'runner', 'plated'][i % 3] }));
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await mkdir('artifacts/stage-two-readability', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
async function readMetrics(page) {
  return page.evaluate(() => {
    const field = window.readabilityField, rect = field.canvas.getBoundingClientRect();
    return { canvas: { width: rect.width, height: rect.height }, worldWidth: field.worldWidth,
      supportButtons: [...document.querySelectorAll('#tactical-controls button')].map(button => {
        const b = button.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return { id: button.id, left: b.left, right: b.right, top: b.top, bottom: b.bottom,
          accessible: b.width >= 44 && b.height >= 44 && (hit === button || button.contains(hit)) };
      }),
      enemies: [...field.enemies.values()].map(view => ({ id: view.enemy.id, hp: view.enemy.hp, progress: view.enemy.progress })),
      units: [...field.units.values()].map(view => {
        const height = field.unitHeight(field.definitions.get(view.unit.definitionId));
        const x = rect.left + field.ox + view.x * field.scale, y = rect.top + field.oy + (view.y - height * .47) * field.scale;
        return { id: view.unit.id, slot: view.unit.slot, x, y, height: height * field.scale,
          blocker: document.elementFromPoint(x, y) === field.canvas ? null : document.elementFromPoint(x, y)?.className };
      }) };
  });
}
async function tapEveryUnit(page, metrics, viewport) {
  for (const button of metrics.supportButtons) assert.ok(button.accessible, button.id + ' remains accessible');
  for (const unit of metrics.units) {
    assert.equal(unit.blocker, null, `slot ${unit.slot} blocked at ${viewport.width}: ${unit.blocker}`);
    assert.ok(unit.height >= 42 - .001, `robot too small: ${unit.height}`);
    for (const button of metrics.supportButtons) assert.ok(
      unit.x + unit.height * .3 <= button.left || unit.x - unit.height * .3 >= button.right ||
      unit.y + unit.height * .47 <= button.top || unit.y - unit.height * .53 >= button.bottom,
      `slot ${unit.slot} sprite overlaps ${button.id} at ${viewport.width}`);
    await page.touchscreen.tap(unit.x, unit.y); await page.locator('#unit-dialog[open]').waitFor();
    assert.equal(await page.evaluate(id => window.readabilityField.selected.has(id), unit.id), true, 'every slot selects its own unit');
    await page.locator('[data-close="unit-dialog"]').click();
  }
}
try {
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 568, height: 320 }, { width: 667, height: 375 }, { width: 1280, height: 720 }]) {
    const created = store.createProfile(); store.completeTutorial(created.profile.id);
    store.recordResult(created.profile.id, 'unlock-1', { battlefieldId: 1, status: 'cleared', cleared: true, researchCredits: 40 });
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 1000 });
    await context.addInitScript(token => localStorage.setItem('td.profile', JSON.stringify({ token })), created.profileToken);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.evaluate(async () => {
      const { Battlefield } = await import('/battlefield.js'), original = Battlefield.prototype.update;
      Battlefield.prototype.update = function(...args) { original.apply(this, args); window.readabilityField = this; };
    });
    await selectBattlefield(page, 2); await page.locator('#quick-start:enabled').click();
    await page.waitForFunction(() => window.readabilityField?.units.size === 12);
    await page.waitForTimeout(600);
    const metrics = await readMetrics(page);
    await page.screenshot({ path: `artifacts/stage-two-readability/${label}-${viewport.width}.png` });
    if (!before) await tapEveryUnit(page, metrics, viewport);
    if (!before && viewport.width === 390) for (const rotated of [{ width: 568, height: 320 }, viewport]) {
      await page.setViewportSize(rotated); await page.waitForTimeout(450);
      const next = await readMetrics(page);
      assert.equal(next.worldWidth, rotated.width > rotated.height ? 1000 : 600);
      assert.deepEqual(next.units.map(({ id, slot }) => ({ id, slot })), metrics.units.map(({ id, slot }) => ({ id, slot })));
      assert.deepEqual(next.enemies, metrics.enemies, 'rotation preserves every authoritative enemy and its progress');
      await tapEveryUnit(page, next, rotated);
      await page.screenshot({ path: `artifacts/stage-two-readability/rotation-${rotated.width}.png` });
      report.rotations.push({ viewport: rotated, ...next });
    }
    report.cases.push({ viewport, ...metrics }); await context.close();
  }
  assert.deepEqual(report.errors, []); report.status = 'passed'; console.log(JSON.stringify(report));
} catch (error) { report.status = 'failed'; report.failure = error.stack; throw error; }
finally {
  await writeFile(`artifacts/stage-two-readability/${label}-report.json`, JSON.stringify(report, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
