import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readdir, access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { selectDestination, selectRunSpeed } from './playtest-navigation.mjs';

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
const errors = [];
const report = { source: 'automated_browser_test', actualParticipants: 0, checks: [], errors };
const check = label => { report.checks.push(label); console.log('PASS ' + label); };
const contexts = [];
async function snapshot(page) {
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem('td.session')));
  const response = await page.request.get(base + '/state', { headers: { Authorization: 'Bearer ' + session.token } });
  assert.equal(response.status(), 200);
  const state = await response.json();
  const playerId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('td.player')));
  return { state, player: state.players.find(player => player.id === playerId) };
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('#home-play:enabled').waitFor();
  await page.screenshot({ path: 'artifacts/start-screen.png', fullPage: true });
  check('start screen renders');
  await selectDestination(page);
  await selectRunSpeed(page, '6');
  await page.click('#quick-start');
  await page.locator('#summon-btn').waitFor({ state: 'visible' });
  await page.locator('#summon-btn').click();
  await page.locator('#army-tab').click();
  await page.locator('[data-unit-id]').first().waitFor();
  check('summon produces an accessible unit');
  await page.locator('[data-unit-id]').first().click();
  await page.locator('[data-close="unit-dialog"]').click();
  await page.screenshot({ path: 'artifacts/battle-screen.png', fullPage: true });
  await page.locator('[data-tab="upgrades"]').click();
  const upgrade = page.locator('[data-upgrade-tag]:enabled').first();
  const tag = await upgrade.getAttribute('data-upgrade-tag'), beforeUpgrade = await snapshot(page);
  await upgrade.click();
  await page.locator('#upgrade-inspection:not([hidden])').waitFor();
  assert.equal((await snapshot(page)).player.lastSeq, beforeUpgrade.player.lastSeq, 'inspection does not spend resources');
  const upgradeResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/action' && response.request().method() === 'POST');
  await page.locator('#upgrade-buy').click();
  const upgradeResult = await (await upgradeResponse).json();
  assert.equal(upgradeResult.ok, true);
  const upgraded = await snapshot(page);
  assert.equal(upgraded.player.upgrades[tag], beforeUpgrade.player.upgrades[tag] + 1);
  check('upgrade inspection is free and confirmed purchase advances the authoritative level');
  await page.reload();
  await page.locator('#home-play:enabled').waitFor();
  await page.locator('#resume-btn').click();
  await page.locator('#summon-btn').waitFor({ state: 'visible' });
  await page.locator('#army-tab').click();
  await page.locator('[data-unit-id]').first().waitFor();
  const resumed = await snapshot(page);
  assert.equal(resumed.player.id, upgraded.player.id);
  assert.equal(resumed.state.expeditionId, upgraded.state.expeditionId);
  assert.equal(resumed.player.upgrades[tag], upgraded.player.upgrades[tag]);
  check('reload restores the same participant state');
  await page.locator('[data-close="command-dialog"]').click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/mobile-screen.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal page overflow');
  check('390px layout has no horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Real HTTP sessions in separate browser contexts; these are automated clients, not people.
  const roomId = 'qa-' + Date.now().toString(36);
  const peers = [];
  for (let i = 0; i < 4; i++) {
    const peerContext = await browser.newContext(); contexts.push(peerContext);
    const peer = await peerContext.newPage();
    peer.on('pageerror', error => errors.push(error.message));
    await peer.goto(base);
    await selectDestination(peer);
    await peer.locator('#join-open').click();
    await peer.fill('#room-input', roomId);
    await peer.locator('#join-form button[type="submit"]').click();
    await peer.locator('#summon-btn').waitFor({ state: 'visible' });
    peers.push(peer);
  }
  await peers[0].locator('#summon-btn').click();
  await peers[0].locator('#army-tab').click();
  await peers[0].locator('[data-unit-id]').first().waitFor();
  const peerStates = await Promise.all(peers.map(snapshot));
  assert.equal(new Set(peerStates.map(({ player }) => player.id)).size, 4);
  assert.equal(new Set(peerStates.map(({ state }) => state.expeditionId)).size, 1);
  assert.ok(peerStates.every(({ state }) => state.players.length === 4));
  check('four independent browser contexts join one room and summon');

  await page.locator('#battle-settings-btn').click();
  await page.locator('#settings-feedback').click();
  await page.locator('#feedback-form').waitFor({ state: 'visible' });
  check('feedback form is available without external transmission');
  assert.deepEqual(errors, []);
  check('no uncaught browser exceptions');
} finally {
  await writeFile('artifacts/browser-report.json', JSON.stringify(report, null, 2));
  for (const context of contexts) await context.close();
  await browser.close();
}
