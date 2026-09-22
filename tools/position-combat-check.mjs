import { chromium } from 'playwright';
import { selectDestination } from './playtest-navigation.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import core from '../dist/server/core/index.js';

// Controlled server fixtures exercise real browser inputs and authoritative rules.
const rooms = [], errors = [], report = { source: 'controlled_position_combat_browser_test', cases: [] };
const server = createDevServer({ automaticTicks: false, onRoomCreated(room) {
  rooms.push(room);
  const game = room.game, player = game.players[0]; player.gold = 1000;
  for (const [definitionId, slot] of [['shu_guard', 26], ['shu_rider', 2], ['wei_guard', 18], ['wei_archer', 5]]) {
    core.applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' });
    Object.assign(player.units.at(-1), { definitionId, slot });
  }
  player.enemies = [.20, .21, .22, .70].map(progress => ({ id: game.nextEntityId++, progress, hp: 5000, maxHp: 5000, boss: false }));
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
try {
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport: size, isMobile: size.width < 1000, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await selectDestination(page);
    await page.evaluate(async () => {
      const { Battlefield } = await import('/battlefield.js'), update = Battlefield.prototype.update;
      Battlefield.prototype.update = function(...args) { update.apply(this, args); window.positionField = this; };
    });
    await page.locator('#quick-start:enabled').tap();
    await page.waitForFunction(() => window.positionField?.units.size === 4);
    const game = rooms.at(-1).game, player = game.players[0], anchor = player.units[0];
    for (let i = 0; i < 11; i++) core.tick(game);
    await page.waitForFunction(() => window.positionField.player.enemies.some(enemy => enemy.slowed));
    const before = { seq: player.lastSeq, units: player.units.length };
    await page.locator('#recipes-tab').tap();
    await page.locator('[data-combine-recipe="make_guan_ping"]').tap();
    await page.locator('#unit-dialog[open]').waitFor();
    assert.equal(player.lastSeq, before.seq, 'codex selects a placement before consuming materials');
    assert.equal(player.units.length, before.units);
    assert.equal(await page.evaluate(id => window.positionField.selected.has(id), anchor.id), true);
    assert.match(await page.locator('#unit-subtitle').innerText(), /화염.*사거리 짧음/);
    await page.waitForTimeout(450);
    const selectedVisible = await page.evaluate(id => {
      const f = window.positionField, v = f.units.get(id), b = f.canvas.getBoundingClientRect();
      const h = f.unitHeight(f.definitions.get(v.unit.definitionId));
      return document.elementFromPoint(b.left + f.ox + v.x * f.scale, b.top + f.oy + (v.y - h * .47) * f.scale) === f.canvas;
    }, anchor.id);
    assert.equal(selectedVisible, true, 'floating inspector leaves the selected robot visible');
    const path = `artifacts/position-combat-${size.width}.png`;
    await page.screenshot({ path });
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/action');
    await page.locator('#unit-dialog [data-evolve-recipe="make_guan_ping"]').tap();
    const response = await responsePromise, packet = response.request().postDataJSON(), result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(packet.unitIds[0], anchor.id);
    const assembled = player.units.find(unit => unit.definitionId === 'guan_ping');
    assert.equal(assembled.slot, 26, 'selected slot wins over lower-numbered ingredient slot');
    assert.equal(player.units.some(unit => unit.slot === 2), false);
    await page.waitForFunction(id => window.positionField.units.has(id), assembled.id);
    const nextSize = size.width === 390 ? { width: 844, height: 390 } : { width: 390, height: 844 };
    await page.setViewportSize(nextSize);
    await page.waitForTimeout(400);
    assert.equal(player.units.find(unit => unit.id === assembled.id).slot, 26);
    assert.equal(await page.evaluate(id => window.positionField.units.get(id).unit.slot, assembled.id), 26);
    report.cases.push({ viewport: size, status: 'passed', anchorSlot: 26, freedSlot: 2, path });
    console.log('PASS selected placement, range display, frost telemetry and rotation', size.width);
    await context.close();
  }
  assert.deepEqual(errors, []);
  report.status = 'passed';
} finally {
  report.errors = errors;
  await writeFile('artifacts/position-combat-browser-report.json', JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
