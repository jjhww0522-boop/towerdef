import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import { selectDestination, selectBattlefield } from './playtest-navigation.mjs';
import core from '../dist/server/core/index.js';

// Controlled server-clock fixtures. Real UI, requests, audio and rules; no user saves.
const report = { source: 'automated-operation-browser', actualParticipants: 0,
  fixtures: ['manual server clock', 'known robot/enemy formation', 'near-end boss'], cases: [], errors: [] };
const rooms = [], store = createProgressionStore();
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated: room => rooms.push(room) });
await mkdir('artifacts/reignition', { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
const views = [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 1440, height: 900 }];
const settled = page => page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
async function usable(page, selector) {
  const geometry = await page.locator(selector).evaluate(element => {
    const r = element.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { width: r.width, height: r.height, inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, unblocked: element === top || element.contains(top), blocker: top?.id || top?.className };
  });
  assert.ok(geometry.inside && geometry.unblocked && geometry.width >= 44 && geometry.height >= 44, selector + ': ' + JSON.stringify(geometry));
}
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  for (const viewport of views) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: true });
    const profile = store.createProfile();
    await context.addInitScript(token => localStorage.setItem('td.profile', JSON.stringify({ token })), profile.profileToken);
    await context.addInitScript(() => {
      localStorage.setItem('td.settings', JSON.stringify({ sound: false, reduced: false, guide: true }));
      window.audioStarts = 0;
      const Original = window.AudioContext;
      window.AudioContext = class extends Original {
        createOscillator() { const oscillator = super.createOscillator(), start = oscillator.start.bind(oscillator); oscillator.start = (...args) => { window.audioStarts++; return start(...args); }; return oscillator; }
      };
    });
    const page = await context.newPage(), checks = [];
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) report.errors.push('HTTP ' + response.status()); });
    const capture = async name => page.screenshot({ path: `artifacts/reignition/${viewport.width}-${name}.png` });
    try {
      await page.goto(base); await page.locator('#home-play:enabled').waitFor();
      await capture('home');
      await page.locator('#settings-btn').tap(); await page.locator('#sound-enabled').check();
      await page.waitForFunction(() => window.audioStarts > 0);
      await page.locator('[data-close="settings-dialog"]').tap();
      checks.push('first-load mute can be enabled and creates real audio sources');
      await selectDestination(page);
      assert.ok((await page.locator('#mission-title').innerText()).length > 0);
      await usable(page, '#quick-start'); await capture('briefing');
      await page.locator('#quick-start').tap(); await page.locator('#summon-btn:enabled').waitFor();
      assert.equal(await page.locator('#tactic-overdrive').isDisabled(), true);
      assert.equal(await page.locator('#tactic-emp').isDisabled(), true);
      await page.locator('#summon-btn').tap(); await settled(page);
      const game = rooms.at(-1).game, player = game.players[0];
      // Build a known formation through authoritative summon actions, then equip fixture bots.
      player.gold = 500;
      while (player.units.length < 6) {
        for (let t = 0; t < game.rules.summonCooldownTicks; t++) core.tick(game);
        assert.equal(core.applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' }).ok, true);
      }
      player.units.forEach((unit, i) => { unit.definitionId = ['laser_2', 'frost_2', 'water_2'][i % 3]; });
      player.enemies = ['grunt', 'runner', 'plated', 'swarm'].map((archetype, i) => ({ id: game.nextEntityId++, archetype,
        hp: 400, maxHp: 400, progress: .05 + i * .12, routeIndex: 0, boss: false, stunnedUntilTick: 0 }));
      await page.waitForFunction(() => document.querySelectorAll('#roster [data-unit-id]').length === 6);
      for (const selector of ['#operation-toggle', '#tactic-overdrive', '#tactic-emp', '#summon-btn', '#army-tab']) await usable(page, selector);
      const utilitiesOverlap = await page.evaluate(() => {
        const a = document.querySelector('.side-column').getBoundingClientRect(), b = document.querySelector('#operation-toggle').getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      });
      assert.equal(utilitiesOverlap, false, 'intel must not overlap cooperative controls');
      await capture('battle'); checks.push('mission brief, four enemy roles, controls visible and tappable');

      await page.locator('#operation-toggle').tap(); await page.locator('#operation-dialog[open]').waitFor();
      assert.equal(await page.locator('#enemy-guide article').count(), 5);
      assert.match(await page.locator('#support-rules').innerText(), /40초/);
      assert.match(await page.locator('#emp-help').innerText(), /보스는 1초/);
      const beforeHelp = player.lastSeq; await page.keyboard.press('q'); assert.equal(player.lastSeq, beforeHelp);
      await capture('intel'); await page.keyboard.press('Escape');
      checks.push('enemy guide and actual support rules; keyboard does not fire behind dialog');

      await page.locator('#tactic-overdrive').tap(); await settled(page);
      assert.equal(player.battleStats.tacticsUsed.overdrive, 1);
      assert.equal(await page.locator('#tactic-emp').isDisabled(), true);
      assert.match(await page.locator('#tactical-status').innerText(), /과부하 6초/);
      await capture('overdrive');
      for (let t = 0; t < game.rules.tacticCooldownTicks; t++) core.tick(game);
      assert.equal(player.status, 'active');
      player.enemies = [{ id: game.nextEntityId++, archetype: 'runner', hp: 1000, maxHp: 1000, progress: .3, routeIndex: 0, boss: false }];
      await page.locator('#tactic-emp:enabled').waitFor();
      await page.locator('#tactic-emp').tap(); await settled(page);
      assert.equal(player.battleStats.tacticsUsed.emp, 1);
      assert.ok(player.enemies[0].stunnedUntilTick > game.tick);
      assert.equal(await page.locator('#tactic-overdrive').isDisabled(), true);
      await capture('emp'); checks.push('real Overdrive and EMP actions, shared cooldown, authoritative stun');

      await page.locator('#battle-settings-btn').tap(); await page.locator('#settings-dialog[open]').waitFor();
      await page.locator('#sound-enabled').uncheck(); await page.locator('#reduced-motion').check();
      await page.locator('[data-close="settings-dialog"]').tap();
      assert.equal(await page.locator('body').evaluate(el => el.classList.contains('reduce-motion')), true);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('td.settings')).sound), false);
      await capture('reduced-motion'); checks.push('sound and reduced-motion settings persist');

      // Advance a controlled fixture to a real boss and finish it by an actual attack.
      game.tick = game.rules.waveTicks * game.rules.totalWaves - 1;
      player.enemies = []; core.tick(game);
      await page.locator('#boss-hud:not([hidden])').waitFor();
      assert.equal(await page.locator('#boss-label').innerText(), '거대 회수기');
      await capture('boss');
      const boss = player.enemies.find(enemy => enemy.boss); boss.hp = 1; boss.progress = .4;
      player.units.forEach(unit => { unit.definitionId = 'laser_2'; unit.cooldown = 0; });
      for (let t = 0; t < 300 && player.status === 'active'; t++) core.tick(game);
      assert.equal(player.status, 'cleared');
      await page.locator('#result-dialog[open]').waitFor();
      assert.equal(await page.locator('#result-stats>div').count(), 6);
      assert.match(await page.locator('#result-tactics').innerText(), /과부하 1회 \/ EMP 1회/);
      assert.ok((await page.locator('#result-story').innerText()).length > 0);
      await page.locator('#result-lobby').scrollIntoViewIfNeeded(); await usable(page, '#result-lobby');
      await capture('report');
      await page.locator('#result-lobby').tap(); await page.locator('#home-screen:not([hidden])').waitFor();
      checks.push('canonical boss, actual kill, frozen battle report, return to home');
      if (viewport.width === 360) {
        await page.locator('[data-close="research-dialog"]').tap();
        await selectBattlefield(page, 2); await page.locator('#quick-start').tap();
        await page.locator('#summon-btn:enabled').waitFor();
        await page.evaluate(async () => {
          const { Battlefield } = await import('/battlefield.js'), update = Battlefield.prototype.update;
          Battlefield.prototype.update = function (...args) { window.operationField = this; return update.apply(this, args); };
        });
        const miningGame = rooms.at(-1).game, miner = miningGame.players[0]; miner.gold = 1000;
        while (miner.units.length < miningGame.rules.maxUnits) {
          for (let t = 0; t < miningGame.rules.summonCooldownTicks; t++) core.tick(miningGame);
          assert.equal(core.applyAction(miningGame, miner.id, { seq: miner.lastSeq + 1, type: 'summon' }).ok, true);
        }
        miner.units.forEach(unit => { unit.definitionId = 'laser_2'; });
        const target = miner.units.find(unit => unit.slot === 11);
        await page.waitForFunction(id => window.operationField?.units.has(id), target.id);
        const point = await page.evaluate(id => {
          const field = window.operationField, view = field.units.get(id), r = field.canvas.getBoundingClientRect();
          const h = field.unitHeight(field.definitions.get(view.unit.definitionId));
          const x = r.x + field.ox + view.x * field.scale, y = r.y + field.oy + (view.y - h * .47) * field.scale;
          return { x, y, target: document.elementFromPoint(x, y)?.id };
        }, target.id);
        assert.equal(point.target, 'battlefield', 'passive tactical status must not intercept map 2 slot 11');
        await page.mouse.click(point.x, point.y); await page.locator('#unit-dialog[open]').waitFor();
        assert.equal(await page.locator('#unit-title').innerText(), '렌즈아이');
        await capture('mining-slot-selection');
        checks.push('map 2 bottom robot remains directly selectable through passive tactical status');
      }
      report.cases.push({ viewport, status: 'passed', checks });
      console.log(`PASS ${viewport.width}×${viewport.height}: ${checks.length} operation flows`);
    } catch (error) {
      await capture('failure').catch(() => {});
      report.cases.push({ viewport, status: 'failed', checks, failure: error.stack });
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; console.error(error); process.exitCode = 1; }
finally {
  await writeFile('artifacts/reignition/browser-report.json', JSON.stringify(report, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
