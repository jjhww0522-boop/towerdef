import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import { selectDestination } from './playtest-navigation.mjs';
import core from '../dist/server/core/index.js';

const report = { source: 'controlled_roster_browser', actualParticipants: 0, checks: [], errors: [] };
const store = createProgressionStore(), rooms = [];
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated(room) {
  rooms.push(room);
  const player = room.game.players[0]; player.gold = 1000;
  for (let i = 0; i < 3; i++) {
    while (room.game.tick < player.nextSummonTick) core.tick(room.game);
    assert.equal(core.applyAction(room.game, player.id, { seq: player.lastSeq + 1, type: 'summon' }).ok, true);
    player.units.at(-1).definitionId = 'fire_3';
  }
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await mkdir('artifacts/six-element-roster', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 667, height: 375 }]) {
    const created = store.createProfile(); store.completeTutorial(created.profile.id);
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    await context.addInitScript(token => localStorage.setItem('td.profile', JSON.stringify({ token })), created.profileToken);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('#research-btn:enabled').click();
    await page.locator('#research-dialog[open]').waitFor();
    assert.equal(await page.locator('[data-research-recipe]').count(), 0, 'future content is never offered as paid research');
    assert.doesNotMatch(await page.locator('#research-list').innerText(), /1-6|0 크레딧/);
    for (const element of ['fire', 'water', 'frost', 'wind', 'electric', 'laser']) {
      const recipeId = 'make_guardian_s_' + element;
      await page.locator(`[data-plan-recipe="${recipeId}"]`).click();
      await page.locator('#blueprint-dialog[open]').waitFor();
      assert.equal(await page.locator('#blueprint-title').innerText(), '만능 수호로봇');
      const nodes = await page.locator('#blueprint-tree strong').allTextContents();
      assert.equal(nodes[1], core.content.units.find(unit => unit.id === element + '_4').name + ' ×3');
      assert.equal(nodes.at(-1), core.content.units.find(unit => unit.id === element + '_1').name + ' ×81');
      if (element === 'water') await page.screenshot({ path: `artifacts/six-element-roster/s-route-${viewport.width}.png` });
      await page.locator('[data-close="blueprint-dialog"]').click();
    }
    report.checks.push(`${viewport.width}: six S routes keep the selected family and future research has no purchase button`);
    await page.locator('[data-close="research-dialog"]').click();
    await selectDestination(page); await page.locator('#quick-start:enabled').click();
    await page.locator('#army-tab').click();
    const anchor = rooms.at(-1).game.players[0].units[0];
    await page.locator(`[data-unit-id="${anchor.id}"]`).click();
    await page.locator('#unit-dialog[open]').waitFor();
    const future = page.locator('[data-evolve-recipe="make_fire_4"]');
    assert.equal(await future.isDisabled(), true, 'three available materials do not unlock future T4');
    assert.match(await page.locator('#evolution-panel .assembly-status').innerText(), /챕터 2 업데이트에서 개방/);
    assert.doesNotMatch(await page.locator('#evolution-panel').innerText(), /1-6|연구 크레딧/);
    await page.screenshot({ path: `artifacts/six-element-roster/future-lock-${viewport.width}.png` });
    report.checks.push(`${viewport.width}: selected unit displays the next locked tier with three owned materials and a disabled combine action`);
    await context.close();
  }
  assert.deepEqual(report.errors, []); report.status = 'passed'; console.log(JSON.stringify(report));
} catch (error) { report.status = 'failed'; report.failure = error.stack; throw error; }
finally {
  await writeFile('artifacts/six-element-roster/browser-report.json', JSON.stringify(report, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
