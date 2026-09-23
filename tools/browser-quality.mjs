import { chromium } from 'playwright';
import { selectDestination, selectRunSpeed, openUnitInspection, closeUnitInspection } from './playtest-navigation.mjs';
import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Independent synthetic verification. No persistent user browser profile is opened.
const base = process.env.PLAYTEST_URL || 'http://127.0.0.1:7351';
let executablePath = process.env.CHROME_PATH;
if (!executablePath && process.platform === 'win32') {
  const cache = join(homedir(), '.agent-browser', 'browsers');
  for (const directory of (await readdir(cache)).filter(name => name.startsWith('chrome-')).sort().reverse()) {
    const candidate = join(cache, directory, 'chrome.exe');
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
}
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const contexts = [], errors = [];
let lastPage;
const report = { source: 'automated_browser_quality_test', actualParticipants: 0, syntheticFeedback: true, checks: [], inconclusive: [], errors };
const pass = (label, evidence = {}) => { report.checks.push({ label, ...evidence }); console.log('PASS ' + label); };
const credentials = page => page.evaluate(() => ({ session: JSON.parse(sessionStorage.getItem('td.session')), playerId: JSON.parse(sessionStorage.getItem('td.player')) }));
async function publicPlayer(page) {
  const { session, playerId } = await credentials(page);
  const response = await page.request.get(base + '/state', { headers: { Authorization: 'Bearer ' + session.token } });
  assert.equal(response.status(), 200, 'authenticated public snapshot is available');
  const state = await response.json();
  return { state, player: state.players.find(player => player.id === playerId) };
}
async function setupPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options }); contexts.push(context);
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await selectDestination(page);
  return page;
}
async function startPractice(page, speed = '1') {
  await selectDestination(page);
  await selectRunSpeed(page, speed); await page.locator('#quick-start').click();
  await page.locator('#game:not([hidden])').waitFor();
  await page.waitForFunction(() => !document.querySelector('#summon-btn').disabled);
}
async function actionThroughUI(page, selector) {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/action' && response.request().method() === 'POST');
  await page.locator(selector).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const result = await response.json();
  assert.equal(result.ok, true, 'UI action is accepted: ' + (result.error || ''));
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
  return { result, packet: response.request().postDataJSON() };
}
async function touchTarget(page, selector, label) {
  const locator = page.locator(selector).first();
  await page.evaluate(selector => document.querySelector(selector).scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
  await page.waitForFunction(selector => {
    const element = document.querySelector(selector), r = element.getBoundingClientRect();
    const atCenter = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return r.top >= 0 && r.bottom <= innerHeight && atCenter && element.contains(atCenter);
  }, selector);
  const geometry = await locator.evaluate(element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; });
  assert.ok(geometry.width >= 44 && geometry.height >= 44, `${label}: at least 44px touch target, got ${JSON.stringify(geometry)}`);
  pass('mobile touch target is visible and unobscured: ' + label, geometry);
}

try {
  const page = await setupPage(); await startPractice(page);
  const content = await (await page.request.get(base + '/content')).json();
  const assets = await page.evaluate(async definitions => {
    const art = await import('/casual-art.js');
    const evolution = await import('/evolution-model.mjs');
    if (typeof evolution.recipeMaterials !== 'function' || typeof evolution.evolutionOptions !== 'function') throw new Error('Evolution display model did not load');
    return Promise.all(definitions.map(definition => new Promise(resolve => {
      const image = new Image(), src = art.unitSpriteUrl(definition);
      image.onload = () => resolve({ definitionId: definition.id, width: image.naturalWidth, height: image.naturalHeight, vector: src.startsWith('data:image/svg+xml') });
      image.onerror = () => resolve({ definitionId: definition.id, width: 0, height: 0, vector: false });
      image.src = src;
    })));
  }, content.units);
  for (const asset of assets) assert.ok(asset.vector && asset.width > 0 && asset.height > 0, 'decoded casual vector: ' + asset.definitionId);
  pass('casual art and evolution modules load and all unit vector sprites decode', { unitCount: assets.length, assets });
  // The first summon is processed by the real server, then its response is lost.
  // Block state polling so it cannot clear the ambiguous request before Retry is tested.
  const before = await publicPlayer(page), observedActions = [], observedResults = [];
  let blockState = false, loseFirstResponse = true;
  const stateRoute = route => blockState ? route.abort('failed') : route.continue();
  const actionRoute = async route => {
    // Keep normal polling healthy until the intended action actually starts.
    if (loseFirstResponse) blockState = true;
    observedActions.push(route.request().postDataJSON());
    const response = await route.fetch(); observedResults.push(await response.json());
    if (loseFirstResponse) { loseFirstResponse = false; await route.abort('failed'); }
    else await route.fulfill({ response });
  };
  await page.route('**/state', stateRoute); await page.route('**/action', actionRoute);
  await page.locator('#summon-btn').click();
  await page.locator('#retry-action:not([hidden]):enabled').waitFor();
  assert.equal(observedResults.length, 1, 'server completed the first request before the response was discarded');
  assert.equal(observedResults[0].ok, true);
  const { playerId } = await credentials(page);
  const once = observedResults[0].state.players.find(player => player.id === playerId);
  assert.equal(once.units.length, before.player.units.length + 1);
  assert.equal(observedResults[0].state.wave, before.state.wave, 'no wave income interferes with the initial transaction');
  assert.equal(once.gold, before.player.gold - before.state.rules.summonCost, 'first summon spends its cost once');
  const preserved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('td.pending')));
  assert.deepEqual(preserved, observedActions[0], 'ambiguous request is retained unchanged');
  await page.locator('#retry-action').click();
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
  assert.equal(observedActions.length, 2, 'one explicit retry was transmitted');
  assert.deepEqual(observedActions[1], observedActions[0], 'retry uses the identical sequence and payload');
  assert.equal(observedResults[1].ok, true, 'duplicate request returns the original accepted result');
  const twice = observedResults[1].state.players.find(player => player.id === playerId);
  assert.equal(twice.lastSeq, once.lastSeq);
  assert.deepEqual(twice.units.map(unit => unit.id), once.units.map(unit => unit.id), 'retry creates no extra unit');
  const authoritative = await publicPlayer(page);
  assert.equal(authoritative.player.lastSeq, observedActions[0].seq);
  assert.deepEqual(authoritative.player.units.map(unit => unit.id), once.units.map(unit => unit.id));
  blockState = false; await page.unroute('**/state', stateRoute); await page.unroute('**/action', actionRoute);
  pass('lost action response retries the same sequence and creates exactly one authoritative unit', { sequence: observedActions[0].seq, attempts: observedActions.length, resultingUnitCount: once.units.length });

  const firstUnit = authoritative.player.units[0];
  await page.locator('#army-tab').click();
  await page.locator(`[data-unit-id="${firstUnit.id}"]`).click();
  await page.locator('#unit-dialog[open]').waitFor();
  const expectedPaths = content.recipes.filter(recipe => recipe.ingredients.includes(firstUnit.definitionId)).map(recipe => recipe.id).sort();
  const displayedPaths = await page.locator('#unit-dialog [data-evolve-recipe]').evaluateAll(buttons => buttons.map(button => button.dataset.evolveRecipe).sort());
  assert.deepEqual(displayedPaths, expectedPaths, 'selected unit shows exactly its own evolution branches');
  assert.ok(expectedPaths.length > 0);
  assert.equal(await page.locator('#unit-dialog [data-evolve-recipe]:enabled').count(), 0, 'a single unit cannot meet any multi-unit recipe');
  for (const recipe of content.recipes.filter(recipe => expectedPaths.includes(recipe.id))) {
    const status = await page.locator(`[data-evolution-result="${recipe.result}"] .assembly-status`).textContent();
    let missingTypes = 0;
    for (const ingredient of new Set(recipe.ingredients)) {
      const required = recipe.ingredients.filter(id => id === ingredient).length;
      const owned = authoritative.player.units.filter(unit => !unit.dispatched && unit.definitionId === ingredient).length;
      if (owned >= required) continue;
      const definition = content.units.find(unit => unit.id === ingredient);
      assert.ok(status.includes(`${definition.name} ${required - owned}기`), `${recipe.id}: missing ${definition.name} count matches content and owned units`);
      missingTypes++;
    }
    assert.ok(missingTypes > 0, `${recipe.id}: the single-unit fixture is missing a required material`);
    assert.equal(status.includes('설계도 연구 필요'), recipe.unlockBattlefield !== 0 && !authoritative.player.unlockedRecipes.includes(recipe.id), `${recipe.id}: research requirement matches unlocked recipes`);
  }
  pass('selected unit shows exact missing material names and quantities with disabled execution');
  await openUnitInspection(page);
  assert.equal(await page.locator('#queue-dispatch').getAttribute('aria-pressed'), 'false', 'opening detail does not queue a unit');
  await page.locator('#queue-dispatch').click();
  assert.equal(await page.locator('#queue-dispatch').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator(`[data-unit-id="${firstUnit.id}"]`).textContent(), /파견 대기/);
  const queued = await publicPlayer(page);
  assert.equal(queued.player.lastSeq, authoritative.player.lastSeq, 'local dispatch queue issues no combat action');
  assert.equal(queued.player.units.find(unit => unit.id === firstUnit.id).dispatched, false, 'queue is separate from actual dispatch');
  await page.locator('#queue-dispatch').click();
  assert.equal(await page.locator('#queue-dispatch').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator(`[data-unit-id="${firstUnit.id}"]`).getAttribute('aria-pressed'), 'true', 'queue changes do not change the focused unit');
  await closeUnitInspection(page);
  assert.equal(await page.locator('#unit-dialog').isVisible(), true, 'closing management preserves the selected robot summary');
  await page.locator('[data-close="unit-dialog"]').click();
  pass('evolution focus and local dispatch queue remain independent');
  // Real random draws, never injected units or a client-side outcome. Try a small
  // number of fresh rooms if the opening hand has no craftable pair. Report an
  // inconclusive draw instead of pretending the game guarantees a recipe.
  let combined = false;
  for (let roomAttempt = 0; roomAttempt < 4 && !combined; roomAttempt++) {
    if (roomAttempt) {
      await page.locator('#leave-btn').click(); await page.locator('#lobby:not([hidden])').waitFor();
      await startPractice(page);
    }
    const opening = await publicPlayer(page);
    const budget = Math.floor(opening.player.gold / opening.state.rules.summonCost);
    for (let summon = 0; summon <= budget && !combined; summon++) {
      const preCombine = await publicPlayer(page);
      const available = preCombine.player.units.filter(unit => !unit.dispatched);
      const recipe = content.recipes.find(candidate => {
        if (candidate.unlockBattlefield !== 0 && !preCombine.player.unlockedRecipes.includes(candidate.id)) return false;
        const remaining = available.map(unit => unit.definitionId);
        return candidate.ingredients.every(id => { const index = remaining.indexOf(id); if (index < 0) return false; remaining.splice(index, 1); return true; });
      });
      if (recipe) {
        const recipeId = recipe.id;
        // If duplicate definitions exist, choose the last instance to detect a UI
        // that silently consumes the first matching unit instead of the clicked one.
        const anchor = available.filter(unit => unit.definitionId === recipe.ingredients[0]).at(-1);
        await page.locator('[data-tab="army"]').click();
        await page.locator(`[data-unit-id="${anchor.id}"]`).click();
        await page.locator('#unit-dialog[open]').waitFor();
        const { result, packet } = await actionThroughUI(page, `#unit-dialog [data-evolve-recipe="${recipeId}"]`);
        const postCombine = result.state.players.find(player => player.id === preCombine.player.id);
        assert.ok(packet.unitIds.includes(anchor.id), 'clicked instance is an actual consumed ingredient');
        assert.equal(new Set(packet.unitIds).size, recipe.ingredients.length, 'each material is a distinct owned unit');
        const actual = packet.unitIds.map(unitId => preCombine.player.units.find(unit => unit.id === unitId)?.definitionId).sort();
        assert.deepEqual(actual, [...recipe.ingredients].sort(), 'UI sends the exact ingredient multiset');
        assert.equal(postCombine.units.length, preCombine.player.units.length - recipe.ingredients.length + 1);
        assert.ok(packet.unitIds.every(unitId => !postCombine.units.some(unit => unit.id === unitId)), 'materials are consumed');
        const previousIds = new Set(preCombine.player.units.map(unit => unit.id));
        assert.ok(postCombine.units.some(unit => unit.definitionId === recipe.result && !previousIds.has(unit.id)), 'result unit is new');
        const resultUnit = postCombine.units.find(unit => !previousIds.has(unit.id));
        assert.equal(packet.unitIds[0], anchor.id, 'chosen robot is first in the ordered materials');
        assert.equal(resultUnit.slot, anchor.slot, 'assembled robot stays at the selected material position');
        await page.waitForFunction(() => !document.querySelector('#unit-dialog').open);
        pass('selected-unit evolution consumes the clicked owned instance and closes after server acceptance', { recipeId, clickedUnitId: anchor.id, roomAttempt: roomAttempt + 1 }); combined = true; break;
      }      if (summon === budget || !(await page.locator('#summon-btn').isEnabled())) break;
      await actionThroughUI(page, '#summon-btn');
    }
  }
  if (!combined) { report.inconclusive.push('Four random opening armies had no observed craftable recipe; UI combine remains unverified on this run.'); console.log('INCONCLUSIVE random opening hands had no craftable recipe'); }
  for (let extra = 0; extra < 6; extra++) {
    if ((await publicPlayer(page)).player.units.length >= 6 || !(await page.locator('#summon-btn').isEnabled())) break;
    await actionThroughUI(page, '#summon-btn');
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  // Populated live combat screenshots are captured after functional assertions below.

  const mobile = await setupPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await startPractice(mobile);
  const fieldHeight = await mobile.locator('#battlefield').evaluate(element => element.getBoundingClientRect().height);
  assert.ok(fieldHeight >= 350, `mobile battlefield stays readable: ${fieldHeight}px high`);
  pass('mobile battlefield occupies at least 350px of height', { height: fieldHeight });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow at 390px');
  pass('390x844 mobile viewport has no horizontal page overflow');
  for (const [selector, label] of [['#summon-btn', 'summon'], ['[data-tab="army"]', 'army tab'], ['[data-tab="recipes"]', 'recipe tab'], ['[data-tab="upgrades"]', 'upgrade tab']]) await touchTarget(mobile, selector, label);
  await actionThroughUI(mobile, '#summon-btn');
  await mobile.locator('[data-tab="army"]').tap();
  await mobile.locator('[data-unit-id]').first().waitFor();
  await touchTarget(mobile, '[data-unit-id]', 'unit details');
  await mobile.locator('[data-unit-id]').first().tap();
  await mobile.locator('#unit-dialog[open]').waitFor();
  await mobile.screenshot({ path: 'artifacts/evolution-mobile.jpg', type: 'jpeg', quality: 70, fullPage: false });
  pass('mobile selected-unit evolution panel is captured', { artifact: 'artifacts/evolution-mobile.jpg' });
  await touchTarget(mobile, '#unit-dialog [data-evolve-recipe]', 'evolution path');
  await touchTarget(mobile, '#unit-manage', 'unit management entry');
  await openUnitInspection(mobile);
  await touchTarget(mobile, '#queue-dispatch', 'dispatch queue');
  await touchTarget(mobile, '#sell-unit', 'sale preview entry');
  await closeUnitInspection(mobile);
  await mobile.locator('[data-close="unit-dialog"]').tap();
  await mobile.waitForFunction(() => !document.querySelector('#unit-dialog').open);
  await mobile.locator('[data-tab="recipes"]').tap();
  await mobile.waitForFunction(() => { const r = document.querySelector('#recipes-panel').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight - 90; });
  if (await mobile.locator('#codex-toggle').getAttribute('aria-expanded') !== 'true') await mobile.locator('#codex-toggle').tap();
  await mobile.locator('#codex-content:not([hidden])').waitFor();
  const codexSnapshot = await publicPlayer(mobile);
  const codexButtons = await mobile.locator('#codex-content [data-combine-recipe]').evaluateAll(buttons => buttons.map(button => ({ id: button.dataset.combineRecipe, enabled: !button.disabled })));
  assert.equal(codexButtons.length, content.recipes.length, 'codex contains every configured recipe');
  for (const button of codexButtons) {
    const recipe = content.recipes.find(recipe => recipe.id === button.id);
    const remaining = codexSnapshot.player.units.filter(unit => !unit.dispatched).map(unit => unit.definitionId);
    const unlocked = recipe.unlockBattlefield === 0 || codexSnapshot.player.unlockedRecipes.includes(recipe.id);
    const ready = unlocked && recipe.ingredients.every(id => { const index = remaining.indexOf(id); if (index < 0) return false; remaining.splice(index, 1); return true; });
    assert.equal(button.enabled, ready, 'codex enforces owned materials and recipe research: ' + button.id);
  }
  pass('expanded codex enables assembly only for researched recipes with distinct owned materials');
  await touchTarget(mobile, '#codex-content [data-pin]', 'recipe goal pin');
  const focusedPin = await mobile.locator('#codex-content [data-pin]').first().getAttribute('data-pin');
  await mobile.locator('#codex-content [data-pin]').first().focus();
  await mobile.waitForTimeout(750);
  assert.equal(await mobile.evaluate(() => document.activeElement?.dataset.pin), focusedPin, 'unchanged polling preserves focused codex controls');
  pass('recipe goal focus survives multiple unchanged server snapshots');
  await mobile.locator('[data-close="command-dialog"]').tap();
  await mobile.locator('[data-tab="upgrades"]').tap();
  await touchTarget(mobile, '[data-upgrade-tag]', 'upgrade');
  const upgrade = mobile.locator('[data-upgrade-tag]').first();
  const tag = await upgrade.getAttribute('data-upgrade-tag'), beforeUpgrade = await publicPlayer(mobile);
  await upgrade.tap();
  await mobile.locator('#upgrade-inspection:not([hidden])').waitFor();
  assert.equal((await publicPlayer(mobile)).player.lastSeq, beforeUpgrade.player.lastSeq, 'opening upgrade detail sends no action');
  await touchTarget(mobile, '#upgrade-buy', 'upgrade purchase');
  const { result: upgradeResult, packet: upgradePacket } = await actionThroughUI(mobile, '#upgrade-buy');
  assert.equal(upgradePacket.tag, tag);
  assert.equal(upgradeResult.state.players.find(player => player.id === beforeUpgrade.player.id).upgrades[tag], beforeUpgrade.player.upgrades[tag] + 1);
  await mobile.locator('#upgrade-back').tap();
  await mobile.locator('#upgrade-list:not([hidden])').waitFor();
  pass('mobile upgrade inspection sends no action, purchase increases its server level, and Back returns to tag choices');
  await mobile.locator('[data-close="command-dialog"]').tap();
  await mobile.locator('#story-toggle').tap();
  await mobile.locator('#co-op-dialog[open]').waitFor();
  await touchTarget(mobile, '#dispatch-btn', 'dispatch');
  await mobile.locator('[data-close="co-op-dialog"]').tap();
  await mobile.waitForFunction(() => !document.querySelector('#co-op-dialog').open);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow after tab navigation');
  for (let extra = 0; extra < 5; extra++) {
    if (!(await mobile.locator('#summon-btn').isEnabled())) break;
    await actionThroughUI(mobile, '#summon-btn');
  }
  await mobile.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  // Keep visual evidence separate from the one-unit touch test scene.

  // The form payload is explicitly synthetic and lives only in this temporary
  // browser context and a clearly named automated-test artifact.
  await page.locator('#battle-settings-btn').click();
  await page.locator('#settings-feedback').click();
  await page.selectOption('#feedback-form [name="fun"]', '3');
  await page.selectOption('#feedback-form [name="clarity"]', '3');
  await page.selectOption('#feedback-form [name="retry"]', 'maybe');
  await page.fill('#feedback-form [name="comment"]', '[AUTOMATED UI TEST — NOT CONSUMER FEEDBACK] Verifies local save and anonymous export only.');
  await page.locator('#feedback-form button[type="submit"]').click();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-feedback').click();
  const download = await downloadPromise, exportPath = 'artifacts/browser-quality-feedback-synthetic.json';
  await download.saveAs(exportPath); const exported = JSON.parse(await readFile(exportPath, 'utf8'));
  assert.equal(exported.source, 'local-form-entry-unverified'); assert.equal(exported.records.length, 1);
  assert.ok(exported.records[0].comment.startsWith('[AUTOMATED UI TEST — NOT CONSUMER FEEDBACK]'));
  const serialized = JSON.stringify(exported), privateSession = await credentials(page);
  const privateProfile = await page.evaluate(() => JSON.parse(localStorage.getItem('td.profile')));
  for (const secret of [privateSession.session.token, privateSession.playerId, privateSession.session.roomId, privateProfile.token, (await publicPlayer(page)).state.profile.id]) assert.equal(serialized.includes(secret), false, 'export excludes session/profile identity and bearer tokens');
  pass('synthetic feedback saves locally and exports without credentials or human-participant claims', { artifact: exportPath });
  await page.locator('[data-close="feedback-dialog"]').click();
  await Promise.all([[page, 'desktop'], [mobile, 'mobile']].map(async ([capture, label]) => {
    await capture.locator('#leave-btn').click(); await capture.locator('#lobby:not([hidden])').waitFor();
    await startPractice(capture, '6');
    for (let count = 0; count < 6; count++) await actionThroughUI(capture, '#summon-btn');
    const captureState = await publicPlayer(capture);
    const captureTimeout = Math.ceil(captureState.state.rules.waveTicks * 5 / captureState.state.rules.ticksPerSecond / captureState.state.playbackSpeed * 1000) + 10000;
    await capture.waitForFunction(() => Number(document.querySelector('#game').dataset.wave) >= 4 && Number(document.querySelector('#enemy-count').textContent.match(/적\s+(\d+)/)?.[1]) >= 3, null, { timeout: captureTimeout });
    assert.equal(await capture.locator('dialog[open]').count(), 0, 'live combat is visible without a management dialog');
    await capture.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const evidence = await publicPlayer(capture);
    await capture.screenshot({ path: `artifacts/quality-${label}.jpg`, type: 'jpeg', quality: 65, fullPage: false });
    pass('live populated combat screenshot: ' + label, { units: evidence.player.units.length, enemies: evidence.player.enemies.length, wave: evidence.state.wave, playbackSpeed: evidence.state.playbackSpeed });
  }));
  assert.deepEqual(errors, [], 'no uncaught browser exceptions'); pass('no uncaught browser exceptions');
  report.status = report.inconclusive.length ? 'partial' : 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error);
  if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: 'artifacts/quality-failure.jpg', type: 'jpeg', quality: 65, fullPage: false }).catch(() => {});
} finally {
  await writeFile('artifacts/browser-quality-report.json', JSON.stringify(report, null, 2));
  for (const context of contexts) await context.close();
  await browser.close();
}
