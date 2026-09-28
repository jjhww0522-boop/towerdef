import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import { selectDestination } from './playtest-navigation.mjs';
import core from '../dist/server/core/index.js';

// Controlled formation and clock; purchases, attacks, snapshots and displayed DPS use production code.
const report = { source: 'controlled_element_upgrade_browser', actualParticipants: 0, cases: [], errors: [] };
const store = createProgressionStore(), rooms = [];
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated(room) {
  rooms.push(room);
  const player = room.game.players[0]; player.gold = 1000;
  for (const definitionId of ['fire_1', 'water_1', 'guardian_s']) {
    while (room.game.tick < player.nextSummonTick) core.tick(room.game);
    assert.equal(core.applyAction(room.game, player.id, { seq: player.lastSeq + 1, type: 'summon' }).ok, true);
    Object.assign(player.units.at(-1), { definitionId, slot: player.units.length - 1 });
  }
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await mkdir('artifacts/element-upgrades', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const legacyNames = /리사이클|오비탈|스파크|보행|포탑|궤도|동력|연산|제어/;
function attack(game) {
  const player = game.players[0];
  player.enemies = [{ id: game.nextEntityId++, progress: 0, hp: 10000000, maxHp: 10000000, boss: true }];
  player.units.forEach(unit => { unit.attackCooldownTicks = 0; }); core.tick(game);
  return player.units.map(unit => {
    assert.equal(unit.lastAttackTick, game.tick);
    return unit.lastAttackHits[0].damage;
  });
}
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 667, height: 375 }]) {
    const created = store.createProfile(); store.completeTutorial(created.profile.id);
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    await context.addInitScript(token => localStorage.setItem('td.profile', JSON.stringify({ token })), created.profileToken);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await selectDestination(page); await page.locator('#quick-start:enabled').click();
    await page.locator('#upgrades-tab').click();
    const keys = await page.locator('[data-upgrade-tag]').evaluateAll(buttons => buttons.map(button => button.dataset.upgradeTag));
    assert.deepEqual(keys, ['fire', 'water', 'frost', 'wind', 'electric', 'laser']);
    const labels = await page.locator('#upgrade-list').innerText();
    for (const label of ['화염 강화', '물 강화', '냉기 강화', '바람 강화', '전기 강화', '레이저 강화']) assert.ok(labels.includes(label));
    assert.doesNotMatch(labels, legacyNames);
    await page.screenshot({ path: `artifacts/element-upgrades/menu-${viewport.width}.png` });
    const game = rooms.at(-1).game, player = game.players[0], before = attack(game), gold = player.gold;
    await page.locator('[data-upgrade-tag="fire"]').click();
    assert.match(await page.locator('#upgrade-applies').innerText(), /지금 2기 강화/);
    assert.match(await page.locator('#upgrade-applies').innerText(), /새로 뽑거나 조립한 화염/);
    const response = page.waitForResponse(res => new URL(res.url()).pathname === '/action' && res.request().method() === 'POST');
    await page.locator('#upgrade-buy:enabled').click();
    assert.equal((await (await response).json()).ok, true);
    assert.equal(player.upgrades.fire, 1); assert.equal(player.upgrades.water, 0);
    assert.equal(player.gold, gold - game.rules.upgradeCosts[0]);
    const after = attack(game);
    assert.ok(Math.abs(after[0] - before[0] * 1.1) < 1e-8);
    assert.equal(after[1], before[1]);
    assert.ok(Math.abs(after[2] - before[2] * 1.1) < 1e-8);
    await page.screenshot({ path: `artifacts/element-upgrades/purchase-${viewport.width}.png` });
    await page.locator('[data-close="command-dialog"]').click();
    for (const [index, unit] of player.units.entries()) {
      await page.locator('#army-tab').click(); await page.locator(`[data-unit-id="${unit.id}"]`).click();
      await page.locator('#unit-manage').click();
      const definition = core.content.units.find(def => def.id === unit.definitionId);
      const dps = after[index] * game.rules.ticksPerSecond / definition.attackIntervalTicks;
      await page.waitForFunction(expected => document.querySelector('#unit-inspection-content').textContent.includes(expected), `주 대상 ${dps.toFixed(1)} /초`);
      const detail = await page.locator('#unit-inspection-content').innerText();
      assert.doesNotMatch(detail, legacyNames);
      if (unit.definitionId === 'guardian_s') {
        assert.match(detail, /가장 높은 속성 강화 1개만 적용 \(합산 안 함\)/);
        await page.screenshot({ path: `artifacts/element-upgrades/common-s-${viewport.width}.png` });
      }
      await page.locator('[data-close="unit-inspection-dialog"]').click();
      await page.locator('[data-close="unit-dialog"]').click();
    }
    // Buying a lower family to match the strongest level must not stack on common S.
    await page.locator('#upgrades-tab').click(); await page.locator('[data-upgrade-tag="water"]').click();
    assert.match(await page.locator('#upgrade-applies').innerText(), /지금 1기 강화/);
    const waterResponse = page.waitForResponse(res => new URL(res.url()).pathname === '/action' && res.request().method() === 'POST');
    await page.locator('#upgrade-buy:enabled').click(); assert.equal((await (await waterResponse).json()).ok, true);
    const matched = attack(game); assert.equal(matched[2], after[2]);
    assert.ok(Math.abs(matched[1] - before[1] * 1.1) < 1e-8);
    report.cases.push({ viewport, status: 'passed', keys, beforeDamage: before, fireUpgradeDamage: after, waterUpgradeDamage: matched });
    await context.close();
  }
  assert.deepEqual(report.errors, []); report.status = 'passed'; console.log(JSON.stringify(report));
} catch (error) { report.status = 'failed'; report.failure = error.stack; throw error; }
finally {
  await writeFile('artifacts/element-upgrades/browser-report.json', JSON.stringify(report, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
