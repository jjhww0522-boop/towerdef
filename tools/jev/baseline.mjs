// Offline preparation only: scripted Playwright actions are NOT JEV trials.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDevServer } from '../dev-server.mjs';
import { createProgressionStore } from '../progression.mjs';
import { selectDestination, selectRunSpeed } from '../playtest-navigation.mjs';
import core from '../../dist/server/core/index.js';

const config = JSON.parse(await readFile(new URL('./pilot.json', import.meta.url), 'utf8'));
const sourceFiles = ['playtest/index.html', 'playtest/app.js', 'playtest/mobile-game.css'];
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file,
    createHash('sha256').update(await readFile(new URL('../../' + file, import.meta.url))).digest('hex')])));
}

// Keep outcome checks independent of the action driver and any future DONE response.
export async function verifyTrial(task, page, rooms, actions) {
  const ui = await page.evaluate(() => ({
    home: !document.querySelector('#home-screen').hidden && !document.querySelector('#lobby').hidden,
    battle: !document.querySelector('#game').hidden,
    settingsOpen: document.querySelector('#settings-dialog').open,
    settings: JSON.parse(localStorage.getItem('td.settings')),
    reduced: document.querySelector('#reduced-motion').checked,
    sound: document.querySelector('#sound-enabled').checked,
    speed: document.querySelector('#speed-select').value,
    duration: document.querySelector('#expedition-duration').textContent,
    speedChanges: window.__pilotSpeedChanges || [],
  }));
  const checks = [];
  const check = (label, actual, expected) => checks.push({ label, actual, expected, passed: actual === expected });
  if (task === 'settings') {
    check('home visible', ui.home, true);
    check('settings closed', ui.settingsOpen, false);
    check('reduced motion checkbox', ui.reduced, true);
    check('sound checkbox', ui.sound, false);
    check('saved reduced motion', ui.settings?.reduced, true);
    check('saved sound', ui.settings?.sound, false);
    check('no room created', rooms.length, 0);
  } else if (task === 'practice') {
    check('home visible', ui.home, true);
    check('practice selection with no reward notice observed', ui.speedChanges.some(s => s.value === '3' && s.duration.includes('보상 없음')), true);
    check('returned to normal speed', ui.speed, '1');
    check('normal reward notice', ui.duration.includes('보상 저장'), true);
    check('no room created', rooms.length, 0);
  } else if (task === 'summon') {
    const room = rooms[0], player = room?.game.players[0];
    check('battle visible', ui.battle, true);
    check('one room', rooms.length, 1);
    check('normal expedition', room?.game.practice, false);
    check('normal speed', room?.speed, 1);
    check('first planet', room?.game.battlefieldId, 1);
    check('one robot', player?.units.length, 1);
    check('one summon cost deducted', player?.gold, room ? room.game.rules.startingGold - room.game.rules.summonCost : null);
    check('one acknowledged summon sequence', new Set(actions.filter(a => a.type === 'summon' && a.ok).map(a => a.seq)).size, 1);
    check('no other successful action', actions.filter(a => a.type !== 'summon' && a.ok).length, 0);
  } else throw new Error('Unknown pilot task: ' + task);
  return { passed: checks.every(check => check.passed), checks };
}

async function scriptedDriver(task, page) {
  if (task === 'settings') {
    await page.locator('#settings-btn').click();
    await page.locator('#reduced-motion').check();
    await page.locator('#sound-enabled').uncheck();
    await page.locator('[data-close="settings-dialog"]').click();
  } else {
    await selectDestination(page);
    if (task === 'practice') {
      await selectRunSpeed(page, '3');
      await selectRunSpeed(page, '1');
      await page.locator('#stage-back').click();
    } else {
      await page.locator('#quick-start').click();
      await page.locator('#summon-btn:enabled').waitFor();
      const acknowledged = page.waitForResponse(response => new URL(response.url()).pathname === '/action');
      await page.locator('#summon-btn').click();
      await acknowledged;
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
    }
  }
}

async function runBaseline() {
  const report = {
    source: 'scripted_playwright_baseline_for_jev_preparation',
    actualParticipants: 0,
    contentVersion: core.content.version,
    viewport: config.viewport,
    mobileTouchTest: false,
    jevRevision: config.jev.revision,
    jevStatus: 'not_run',
    jevTrialsExecuted: 0,
    modelCalls: 0,
    paidApiCostUsd: 0,
    infrastructureAndHumanCostUsd: null,
    futureJevCost: null,
    failureCategoriesForHumanReview: ['game_defect', 'wording_navigation_candidate', 'jev_support_limit', 'agent_or_service_error'],
    sourceHashesBefore: await sourceHashes(),
    trials: [],
  };
  for (const task of config.tasks) {
    for (let repetition = 1; repetition <= config.repetitions; repetition++) {
      const rooms = [], actions = [], pendingResponses = [], pageErrors = [];
      const server = createDevServer({ progressionStore: createProgressionStore(), automaticTicks: false, onRoomCreated: room => rooms.push(room) });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const trial = { task: task.id, repetition, driver: 'scripted_playwright', status: 'failed', failureCategory: null, pageErrors };
      let browser;
      try {
        // launch() owns a fresh temporary Chrome profile; never connect to the user's browser.
        browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
        const context = await browser.newContext({ viewport: config.viewport, reducedMotion: 'no-preference' });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('response', response => {
          if (new URL(response.url()).pathname !== '/action') return;
          pendingResponses.push((async () => {
            const request = response.request().postDataJSON(), body = await response.json();
            actions.push({ type: request.type, seq: request.seq, ok: body.ok === true });
          })());
        });
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.locator('#home-play:enabled').waitFor();
        await page.evaluate(() => {
          window.__pilotSpeedChanges = [];
          document.querySelector('#speed-select').addEventListener('change', event => {
            window.__pilotSpeedChanges.push({ value: event.target.value, duration: document.querySelector('#expedition-duration').textContent });
          });
        });
        trial.emptyRunRejected = !(await verifyTrial(task.id, page, rooms, actions)).passed;
        await scriptedDriver(task.id, page);
        await Promise.all(pendingResponses);
        trial.verification = await verifyTrial(task.id, page, rooms, actions);
        trial.pageErrors = pageErrors;
        trial.actions = actions;
        trial.status = trial.emptyRunRejected && trial.verification.passed && !pageErrors.length ? 'passed' : 'failed';
        if (trial.status === 'failed') trial.failureCategory = 'unclassified_baseline_failure';
      } catch (error) {
        trial.error = error.message;
        trial.failureCategory = 'unclassified_baseline_failure';
      } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
      }
      report.trials.push(trial);
      console.log(`${trial.status.toUpperCase()} baseline ${task.id} ${repetition}/${config.repetitions} (JEV not run)`);
      if (trial.status === 'failed') console.log(trial.error || JSON.stringify({ checks: trial.verification?.checks.filter(check => !check.passed), pageErrors: trial.pageErrors }));
    }
  }
  report.sourceHashesAfter = await sourceHashes();
  report.sourcesStable = JSON.stringify(report.sourceHashesBefore) === JSON.stringify(report.sourceHashesAfter);
  report.baselineStatus = report.sourcesStable && report.trials.every(trial => trial.status === 'passed') ? 'passed' : 'failed';
  await mkdir('artifacts/jev', { recursive: true });
  await writeFile('artifacts/jev/baseline-report.json', JSON.stringify(report, null, 2) + '\n');
  if (report.baselineStatus !== 'passed') process.exitCode = 1;
}

if (process.argv.includes('--baseline')) await runBaseline();
else if (process.argv[1]?.endsWith('baseline.mjs')) console.log('No JEV calls are made. Run with --baseline to verify nine isolated scripted trials.');
