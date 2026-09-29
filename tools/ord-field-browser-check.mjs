import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import { selectBattlefield } from './playtest-navigation.mjs';
import { getBattlefieldLayout } from '../shared/battle-geometry.js';
import core from '../dist/server/core/index.js';

// Isolated, manually ticked server fixtures. S robots are visual stress fixtures,
// not a claim that future-locked recipes are available to current players.
const directory = 'artifacts/ord-field';
const viewportFilter = process.env.ORD_VIEWPORT, stageFilter = Number(process.env.ORD_STAGE) || null;
const suffix = viewportFilter || stageFilter ? '-' + (viewportFilter || 'all') + '-stage' + (stageFilter || 'all') : '';
const store = createProgressionStore(), rooms = [];
const report = { source: 'controlled_ord_field_browser', actualParticipants: 0, cases: [], failures: [], errors: [] };
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated(room) {
  rooms.push(room);
  const game = room.game, player = game.players[0], layout = getBattlefieldLayout(game.battlefieldId);
  player.gold = 5000; game.rules.spawnIntervalTicks = game.rules.minSpawnIntervalTicks = 99999;
  for (let slot = 0; slot < layout.slots.length; slot++) {
    while (game.tick < player.nextSummonTick) core.tick(game);
    assert.equal(core.applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' }).ok, true);
    player.units.at(-1).slot = slot;
  }
  player.enemies = Array.from({ length: 40 }, (_, index) => ({ id: game.nextEntityId++, hp: 5000, maxHp: 5000,
    progress: .06 + index % 20 * .044, routeIndex: index % layout.routes.length, archetype: 'grunt', boss: false }));
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
try {
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }].filter(size => !viewportFilter || `${size.width}x${size.height}` === viewportFilter)) {
    for (const stage of [1, 3, 5].filter(id => !stageFilter || stageFilter === id)) {
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      const created = store.createProfile(); store.completeTutorial(created.profile.id);
      for (let id = 1; id < stage; id++) store.recordResult(created.profile.id, 'field-' + id,
        { status: 'cleared', cleared: true, battlefieldId: id, researchCredits: 0 });
      await context.addInitScript(token => localStorage.setItem('td.profile', JSON.stringify({ token })), created.profileToken);
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => report.errors.push({ viewport, stage, message: error.message }));
      await page.goto('http://127.0.0.1:' + server.address().port); await selectBattlefield(page, stage);
      await page.evaluate(async () => {
        const { Battlefield } = await import('/battlefield.js'), update = Battlefield.prototype.update, range = Battlefield.prototype.drawRange;
        Battlefield.prototype.update = function(...args) { update.apply(this, args); window.ordField = this; };
        Battlefield.prototype.drawRange = function(...args) {
          const ellipse = this.ctx.ellipse, arcs = [];
          this.ctx.ellipse = function(x, y, rx, ry, ...rest) { arcs.push({ x, y, rx, ry }); return ellipse.call(this, x, y, rx, ry, ...rest); };
          try { const result = range.apply(this, args); if (arcs.length) this.observedRanges = arcs; return result; }
          finally { this.ctx.ellipse = ellipse; }
        };
      });
      await page.locator('#quick-start:enabled').click(); await page.waitForFunction(() => window.ordField?.units.size > 0);
      const player = rooms.at(-1).game.players[0];
      for (const tier of ['basic', 'S']) {
        for (const unit of player.units) unit.definitionId = tier === 'S' ? 'guardian_s' : ['fire', 'water', 'frost', 'wind', 'electric', 'laser'][unit.slot % 6] + '_1';
        await page.waitForFunction(tier => [...window.ordField.units.values()].every(view => tier === 'S' ? view.unit.definitionId === 'guardian_s' : view.unit.definitionId.endsWith('_1')), tier);
        await page.waitForTimeout(450);
        const metrics = await page.evaluate(() => {
          const f = window.ordField, bounds = f.canvas.getBoundingClientRect();
          const units = [...f.units.values()].map(view => {
            const height = f.unitHeight(f.definitions.get(view.unit.definitionId)) * f.scale;
            return { id: view.unit.id, slot: view.unit.slot, height,
              x: bounds.left + f.ox + view.x * f.scale, y: bounds.top + f.oy + (view.y - f.unitHeight(f.definitions.get(view.unit.definitionId)) * .47) * f.scale,
              hitWidth: Math.max(height * .86, 44), hitHeight: Math.max(height * .94, 44) };
          });
          const distances = units.flatMap((unit, index) => units.slice(index + 1).map(other => Math.hypot(unit.x - other.x, unit.y - other.y)));
          return { canvas: bounds.toJSON(), minimumGap: Math.min(...distances), units };
        });
        const artifact = `${directory}/${viewport.width}x${viewport.height}-stage${stage}-${tier}.png`;
        await page.screenshot({ path: artifact });
        const result = { viewport, stage, tier, artifact, ...metrics, taps: [], ranges: [] };
        for (const unit of metrics.units) {
          if (await page.locator('#unit-dialog').evaluate(dialog => dialog.open)) await page.locator('[data-close="unit-dialog"]').click();
          const hit = await page.evaluate(point => { const element = document.elementFromPoint(point.x, point.y); return { canvas: element?.id === 'battlefield', blocker: element?.id || element?.className }; }, unit);
          if (!hit.canvas) {
            report.failures.push({ viewport, stage, tier, slot: unit.slot, reason: 'blocked', ...hit }); result.taps.push({ slot: unit.slot, passed: false, ...hit }); continue;
          }
          await page.touchscreen.tap(unit.x, unit.y);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const selected = await page.evaluate(id => window.ordField.selected.has(id), unit.id);
          const selectedVisible = await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.id === 'battlefield', unit);
          if (!selectedVisible) report.failures.push({ viewport, stage, tier, slot: unit.slot, reason: 'selected robot is obscured' });
          const popup = await page.locator('#unit-dialog').boundingBox();
          if (popup && popup.height > viewport.height * .3 + 1) report.failures.push({ viewport, stage, tier, slot: unit.slot, reason: 'popup exceeds 30%', popup });
          const selectedBodyOverlap = popup ? Math.max(0, Math.min(popup.x + popup.width, unit.x + unit.height * .45) - Math.max(popup.x, unit.x - unit.height * .45)) * Math.max(0, Math.min(popup.y + popup.height, unit.y + unit.height * .5) - Math.max(popup.y, unit.y - unit.height * .5)) : 0;
          result.taps.push({ slot: unit.slot, passed: selected, selectedVisible, selectedBodyOverlap, popup });
          if (selectedBodyOverlap > (result.maximumBodyOverlap || 0) + .1) {
            result.maximumBodyOverlap = selectedBodyOverlap;
            result.maximumOverlapArtifact = `${directory}/${viewport.width}x${viewport.height}-stage${stage}-${tier}-overlap.png`;
            await page.screenshot({ path: result.maximumOverlapArtifact });
          }
          if (unit.slot === ({ 1: 2, 3: 4, 5: 14 })[stage]) {
            result.selectedArtifact = `${directory}/${viewport.width}x${viewport.height}-stage${stage}-${tier}-selected.png`;
            await page.screenshot({ path: result.selectedArtifact });
          }
          if (!selected) report.failures.push({ viewport, stage, tier, slot: unit.slot, reason: 'wrong robot selected' });
          if (selected) {
            const ranges = await page.evaluate(() => (window.ordField.observedRanges || []).map(range => ({ rx: range.rx * window.ordField.scale, ry: range.ry * window.ordField.scale })));
            result.ranges.push({ slot: unit.slot, ranges });
            if (!ranges.length || ranges.some(range => Math.abs(range.rx - range.ry) > .1)) report.failures.push({ viewport, stage, tier, slot: unit.slot, reason: 'missing or distorted range', ranges });
          }
        }
        if (await page.locator('#unit-dialog').evaluate(dialog => dialog.open)) await page.locator('[data-close="unit-dialog"]').click();
        report.cases.push(result);
        console.log(JSON.stringify({ viewport, stage, tier, gap: metrics.minimumGap, body: metrics.units[0].height, taps: result.taps.filter(tap => tap.passed).length + '/' + result.taps.length }));
      }
      await context.close();
    }
  }
} finally {
  report.status = report.failures.length || report.errors.length ? 'failed' : 'passed';
  await writeFile(directory + '/report' + suffix + '.json', JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
assert.deepEqual(report.errors, [], 'no browser errors');
assert.deepEqual(report.failures, [], 'every robot is directly selectable and has an undistorted range');