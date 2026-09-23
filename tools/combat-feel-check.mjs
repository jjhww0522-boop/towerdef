import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { selectDestination } from './playtest-navigation.mjs';
import { createDevServer } from './dev-server.mjs';
import core from '../dist/server/core/index.js';

// Isolated authoritative combat fixtures shorten the setup. Browser rendering,
// audio nodes, requests and combat rules are real; no user profiles are opened.
const { content, applyAction, tick } = core;
const rooms = [], errors = [], contexts = [];
const report = { source: 'automated_combat_feel_check', actualParticipants: 0,
  fixtures: ['Manual server clock', 'Owned robots and clustered enemies', 'Final boss phase'], checks: [], artifacts: [] };
const pass = (label, evidence = {}) => { report.checks.push({ label, ...evidence }); console.log('PASS ' + label); };
const server = createDevServer({ automaticTicks: false, onRoomCreated: room => rooms.push(room) });
await mkdir('artifacts/combat-video', { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser, page;

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const captureVideo = process.env.COMBAT_VIDEO === '1';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    ...(captureVideo ? { recordVideo: { dir: 'artifacts/combat-video', size: { width: 390, height: 844 } } } : {}) });
  contexts.push(context);
  await context.addInitScript(() => {
    window.audioObservation = { starts: 0, contexts: [] };
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args) { super(...args); window.audioObservation.contexts.push(this); }
      createOscillator() {
        const oscillator = super.createOscillator(), start = oscillator.start.bind(oscillator);
        oscillator.start = (...args) => { window.audioObservation.starts++; return start(...args); };
        return oscillator;
      }
    };
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await selectDestination(page);
  await page.screenshot({ path: 'artifacts/combat-lobby.png', fullPage: true });
  await page.locator('#quick-start').tap(); await page.locator('#summon-btn:enabled').waitFor();
  await page.locator('#summon-btn').tap();
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
  const room = rooms[0], game = room.game, player = game.players[0];
  const patternUnits = ['bolt', 'blast', 'arc'].map(pattern => content.units.find(u => u.rarity === 'elite' && u.attackPattern === pattern));
  assert.ok(patternUnits.every(Boolean));
  player.gold = 2000;
  while (player.units.length < 8) applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' });
  player.units.forEach((unit, i) => { unit.definitionId = patternUnits[i % 3].id; });
  player.enemies = Array.from({ length: 20 }, (_, i) => ({ id: game.nextEntityId++, progress: .02 + i * .043,
    hp: 6000, maxHp: 6000, boss: false }));
  await page.waitForFunction(() => document.querySelectorAll('#roster [data-unit-id]').length === 8);
  await page.waitForTimeout(900);
  tick(game);
  assert.ok(player.units.some(unit => unit.lastAttackHits.length === 3), 'authoritative attacks include several real targets');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/combat-action-390.png' });
  pass('all three weapon roles reach the real browser from authoritative attacks');
  const soundStarts = await page.evaluate(() => window.audioObservation.starts);
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => window.audioObservation.starts), soundStarts, 'same attack stamps do not replay sounds');
  assert.ok(soundStarts > 0, 'user gesture enables real Web Audio nodes');
  pass('combat audio starts after a user gesture and duplicate snapshots do not replay it');

  while (player.units.length < game.rules.maxUnits) applyAction(game, player.id, { seq: player.lastSeq + 1, type: 'summon' });
  player.units.forEach((unit, i) => { unit.definitionId = patternUnits[i % 3].id; });
  player.enemies = Array.from({ length: 65 }, (_, i) => ({ id: game.nextEntityId++, progress: i / 65,
    hp: 6000, maxHp: 6000, boss: false }));
  await page.waitForFunction(() => document.querySelectorAll('#roster [data-unit-id]').length === 30);
  await page.waitForTimeout(900);
  await page.evaluate(async () => {
    const { Battlefield } = await import('/battlefield.js'), original = Battlefield.prototype.draw;
    window.drawCosts = [];
    Battlefield.prototype.draw = function(now) {
      const start = performance.now(); original.call(this, now);
      window.drawCosts.push(performance.now() - start);
    };
  });
  const frames = page.evaluate(() => new Promise(resolve => {
    const times = []; let last;
    function frame(now) { if (last) times.push(now - last); last = now; if (times.length < 100) requestAnimationFrame(frame); else resolve(times); }
    requestAnimationFrame(frame);
  }));
  for (let i = 0; i < 24; i++) { tick(game); await page.waitForTimeout(100); }
  const deltas = (await frames).sort((a, b) => a - b);
  const drawCosts = await page.evaluate(() => window.drawCosts.sort((a, b) => a - b));
  pass('animated combat completes without browser errors', { desktopHeadlessOnly: true, captureVideo,
    robotCount: player.units.length, enemyCount: player.enemies.length,
    medianFrameMs: deltas[50], p95FrameMs: deltas[95], medianDrawMs: drawCosts[Math.floor(drawCosts.length / 2)], p95DrawMs: drawCosts[Math.floor(drawCosts.length * .95)] });
  for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(200);
    await page.screenshot({ path: `artifacts/combat-action-${viewport.width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  pass('live combat renders in portrait, two landscape sizes and desktop');
  await page.setViewportSize({ width: 390, height: 844 });

  // Real recipe submission, including consumption and a visible arrival cue.
  const recipe = content.recipes.find(r => r.unlockBattlefield === 0 && r.ingredients.length === 2);
  player.units.slice(0, 2).forEach((unit, i) => { unit.definitionId = recipe.ingredients[i]; });
  const beforeAssembly = player.units.map(unit => unit.id), anchorSlot = player.units[0].slot;
  await page.evaluate(async () => {
    const { Battlefield } = await import('/battlefield.js');
    window.assemblyObservation = { acknowledgements: [], effects: [] };
    const markArrival = Battlefield.prototype.markArrival, addEffect = Battlefield.prototype.addEffect;
    Battlefield.prototype.markArrival = function(id, kind) {
      window.assemblyObservation.acknowledgements.push({ id, kind });
      return markArrival.call(this, id, kind);
    };
    Battlefield.prototype.addEffect = function(effect) {
      if (effect.type === 'assembly') window.assemblyObservation.effects.push({ life: effect.life, x: effect.x, y: effect.y });
      return addEffect.call(this, effect);
    };
  });
  await page.waitForTimeout(250);
  await page.locator('#recipes-tab').tap();
  await page.locator(`[data-combine-recipe="${recipe.id}"]:enabled`).tap();
  await page.locator('#unit-dialog[open]').waitFor();
  assert.deepEqual(player.units.map(unit => unit.id), beforeAssembly, 'choosing a location does not consume materials');
  await page.locator(`#unit-dialog [data-evolve-recipe="${recipe.id}"]:enabled`).tap();
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
  const assembled = player.units.find(unit => !beforeAssembly.includes(unit.id));
  assert.equal(assembled.definitionId, recipe.result);
  assert.equal(assembled.slot, anchorSlot);
  if (await page.locator('#unit-dialog[open]').count()) await page.locator('[data-close="unit-dialog"]').tap();
  const assemblyCue = await page.evaluate(() => window.assemblyObservation);
  assert.deepEqual(assemblyCue.acknowledgements, [{ id: assembled.id, kind: 'combine' }]);
  assert.equal(assemblyCue.effects.length, 1);
  assert.equal(assemblyCue.effects[0].life, 400);
  await page.screenshot({ path: 'artifacts/combat-assembly.png' });
  pass('UI assembly consumes materials at the selected slot and triggers one 400ms field assembly cue');
  await page.locator('#combat-alert').waitFor({ state: 'hidden' });

  game.tick = game.rules.waveTicks - 1; tick(game);
  await page.waitForFunction(() => document.querySelector('#combat-alert-title').textContent === '2 웨이브');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  pass('new waves announce themselves without opening a dialog');
  game.tick = game.rules.waveTicks * game.rules.totalWaves - 1;
  player.enemies = []; tick(game);
  await page.locator('#boss-hud:not([hidden])').waitFor();
  await page.waitForFunction(() => document.querySelector('#combat-alert-title').textContent === '마지막 위협 접근');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.screenshot({ path: 'artifacts/combat-boss.png' });
  pass('evacuation boss health and entrance warning use real server phase');

  await page.locator('#battle-settings-btn').tap();
  await page.locator('#sound-enabled').uncheck(); await page.locator('#reduced-motion').check();
  await page.locator('[data-close="settings-dialog"]').tap();
  await page.waitForFunction(() => window.audioObservation.contexts[0].state === 'suspended');
  const mutedStarts = await page.evaluate(() => window.audioObservation.starts);
  for (let i = 0; i < 20; i++) tick(game);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.audioObservation.starts), mutedStarts);
  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('reduce-motion')), true);
  assert.ok(await page.locator('#boss-hud').isVisible());
  pass('mute stops audio while reduced motion preserves the boss HUD');
  assert.deepEqual(errors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error);
  if (page) await page.screenshot({ path: 'artifacts/combat-failure.png' }).catch(() => {});
} finally {
  for (const context of contexts) await context.close();
  if (page) { const path = await page.video()?.path(); if (path) report.artifacts.push(path); }
  if (browser) await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  report.errors = errors; await writeFile('artifacts/combat-feel-report.json', JSON.stringify(report, null, 2));
}
