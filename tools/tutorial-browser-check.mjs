import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDevServer } from './dev-server.mjs';
import { createProgressionStore } from './progression.mjs';
import core from '../dist/server/core/index.js';

const report = { source: 'automated_tutorial_browser', actualParticipants: 0, status: 'failed', checks: [], errors: [] };
const rooms = [], store = createProgressionStore({ now: () => 1800000000000 });
const server = createDevServer({ progressionStore: store, automaticTicks: false, onRoomCreated: room => rooms.push(room) });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
await mkdir('artifacts', { recursive: true });
const pass = label => { report.checks.push(label); console.log('PASS ' + label); };
const tick = (room, count) => { for (let i = 0; i < count; i++) core.tick(room.game); };
async function stable(page, before, label) {
  const after = await page.locator('#battlefield').boundingBox(); assert.deepEqual(after, before, label + ' does not resize field');
  const dimensions = await page.evaluate(() => ({ w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight }));
  assert.ok(dimensions.sw <= dimensions.w && dimensions.sh <= dimensions.h, JSON.stringify(dimensions));
}
async function action(page, selector) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/action' && r.request().method() === 'POST');
  await page.locator(selector).tap();
  const result = await (await response).json(); assert.equal(result.ok, true, JSON.stringify(result)); return result;
}
async function visibleText(page, selector) {
  const metric = await page.locator(selector).evaluate(el => {
    const r = document.createRange(); r.selectNodeContents(el); const b=r.getBoundingClientRect(), css=getComputedStyle(el);
    return { text:el.textContent,font:parseFloat(css.fontSize),left:b.left,top:b.top,right:b.right,bottom:b.bottom,w:innerWidth,h:innerHeight };
  });
  assert.ok(metric.font >= 16 && metric.left >= 0 && metric.top >= 0 && metric.right <= metric.w && metric.bottom <= metric.h, JSON.stringify(metric));
}
async function trackField(page) {
  await page.evaluate(async () => {
    const { Battlefield } = await import('/battlefield.js'), update = Battlefield.prototype.update;
    Battlefield.prototype.update = function(...args) { update.apply(this, args); window.tutorialField = this; };
  });
}
async function tapRobot(page, id) {
  await page.waitForTimeout(400);
  const target = await page.evaluate(id => {
    const f=window.tutorialField,v=f.units.get(id),b=f.canvas.getBoundingClientRect(),h=f.unitHeight(f.definitions.get(v.unit.definitionId));
    const x=b.left+f.ox+v.x*f.scale,y=b.top+f.oy+(v.y-h*.47)*f.scale;
    const blocker=document.elementFromPoint(x,y);
    return {x,y,visible:blocker===f.canvas,blocker:blocker?.id||blocker?.className};
  },id);
  assert.ok(target.visible,'guided robot must be directly tappable: '+JSON.stringify(target));
  await page.touchscreen.tap(target.x,target.y);
}

try {
  for (const viewport of [{width:390,height:844},{width:360,height:640},{width:667,height:375}]) {
    const context = await browser.newContext({ viewport, isMobile:true,hasTouch:true });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(base); await page.locator('#tutorial-start:enabled').waitFor();
    await page.evaluate(() => document.fonts.ready); await trackField(page);
    await page.screenshot({path:`artifacts/tutorial-${viewport.width}-home.png`});
    await page.locator('#tutorial-start').tap();
    await page.locator('#tutorial-guide[data-step=intro]').waitFor();
    const room = rooms.at(-1), before = await page.locator('#battlefield').boundingBox();
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('td.profile')).token);
    const account = store.authenticate(token), initial = store.getProfile(account.id);
    assert.equal(initial.engines.count,5); assert.equal(room.game.rules.maxUnits,3);
    tick(room,2000); await page.waitForTimeout(250);
    assert.equal(room.game.players[0].enemies.length,0);
    await visibleText(page,'#tutorial-title'); await visibleText(page,'#tutorial-description');
    await page.screenshot({path:`artifacts/tutorial-${viewport.width}-intro.png`});
    await action(page,'#tutorial-next'); await page.locator('#summon-btn:enabled').waitFor();
    await action(page,'#summon-btn'); await page.locator('#tutorial-guide[data-step=inspect]').waitFor();
    const anchor = room.game.players[0].units[0];
    assert.equal(anchor.definitionId,'wei_archer');
    await tapRobot(page,anchor.id);
    await page.locator('#unit-dialog[open]').waitFor();
    assert.match(await page.locator('.assembly-status').first().innerText(),/코일봇.*부족/);
    await stable(page,before,'unit inspection'); await tapRobot(page,anchor.id);
    await page.screenshot({path:`artifacts/tutorial-${viewport.width}-inspect.png`});
    await action(page,'#tutorial-next');
    assert.equal(await page.locator('#summon-btn').isDisabled(),true);
    tick(room,6); await page.waitForTimeout(350);
    assert.equal(await page.locator('#summon-btn').isDisabled(),true);
    tick(room,1); await page.locator('#summon-btn:enabled').waitFor();
    await action(page,'#summon-btn'); tick(room,7);
    await page.locator('#summon-btn:enabled').waitFor(); await action(page,'#summon-btn');
    await page.locator('#tutorial-guide[data-step=sell]').waitFor();
    assert.equal(room.game.players[0].units.length,3);
    assert.equal(await page.locator('#summon-btn').isDisabled(),true);
    pass(`${viewport.width}: free entry, fixed draws, full board and 0.7s cooldown`);
    // Reload must resume the same mandatory sale, with no extra engine or reroll.
    await page.reload(); await page.locator('#home-play:enabled').waitFor(); await trackField(page);
    await page.locator('#resume-btn').tap(); await page.locator('#tutorial-guide[data-step=sell]').waitFor();
    assert.equal(store.getProfile(account.id).engines.count,5);
    await page.locator('#tutorial-next').tap();
    await page.locator('#unit-manage').tap(); await page.locator('#unit-inspection-dialog[open]').waitFor();
    await page.locator('#sell-unit').tap(); await visibleText(page,'#confirm-sale');
    await page.screenshot({path:`artifacts/tutorial-${viewport.width}-sale.png`});
    await action(page,'#confirm-sale'); await page.locator('#tutorial-guide[data-step=replacement]').waitFor();
    tick(room,7); await page.locator('#summon-btn:enabled').waitFor(); await action(page,'#summon-btn');
    await page.locator('#tutorial-guide[data-step=combine]').waitFor();
    const coil = room.game.players[0].units.find(u=>u.definitionId==='wu_guard');
    await tapRobot(page,coil.id);
    assert.equal(await page.locator('[data-evolve-recipe=make_cheng_yu]').isDisabled(),true,'tutorial must not offer a rejected non-anchor combination');
    assert.match(await page.locator('#evolution-panel .assembly-status').innerText(),/처음 렌즈봇/);
    await page.locator('[data-close=unit-dialog]').tap();
    await tapRobot(page,anchor.id);
    await page.locator('[data-evolve-recipe=make_cheng_yu]:enabled').waitFor(); await tapRobot(page,anchor.id);
    await page.screenshot({path:`artifacts/tutorial-${viewport.width}-combine.png`});
    await action(page,'[data-evolve-recipe=make_cheng_yu]');
    await page.locator('#tutorial-guide[data-step=boss_ready]').waitFor();
    assert.equal(room.game.players[0].units.find(u=>u.definitionId==='cheng_yu').slot,anchor.slot);
    await stable(page,before,'sale and combination');
    pass(`${viewport.width}: resume, actual sale and anchored combination`);
    await action(page,'#tutorial-next'); assert.equal(room.game.tutorial.bossAtTick,room.game.tick+80);
    tick(room,79); await page.waitForTimeout(300);
    assert.equal(room.game.players[0].enemies.length,0);
    tick(room,1); await page.locator('#boss-hud:not([hidden])').waitFor();
    await page.screenshot({path:`artifacts/tutorial-${viewport.width}-boss.png`});
    let count=0; while(room.game.status==='playing'&&count++<60) tick(room,10);
    assert.equal(room.game.players[0].status,'cleared');
    await page.locator('#result-dialog[open]').waitFor();
    assert.deepEqual(store.getProfile(account.id),{...initial,tutorialCompleted:true});
    await page.screenshot({path:`artifacts/tutorial-${viewport.width}-complete.png`});
    await page.locator('#result-lobby').tap(); await page.locator('#stage-screen:not([hidden])').waitFor();
    await page.locator('#stage-back').tap(); assert.match(await page.locator('#tutorial-start').innerText(),/다시/);
    await page.locator('#research-btn').tap();
    assert.equal(await page.locator('[data-research-recipe]').count(),4);
    assert.equal(await page.locator('.unlock-state').count(),11);
    await page.locator('[data-close=research-dialog]').tap();
    await page.locator('#tutorial-start').tap(); await page.locator('#tutorial-guide[data-step=intro]').waitFor();
    await page.locator('#leave-btn').tap(); await page.locator('#home-screen:not([hidden])').waitFor();
    assert.equal(store.getProfile(account.id).engines.count,5);
    pass(`${viewport.width}: timed boss, real victory, isolated rewards and repeat/skip`);
    await context.close();
  }
  assert.deepEqual(report.errors,[]); report.status='passed';
} catch(error) { report.failure=error.stack; throw error; }
finally { await writeFile('artifacts/tutorial-browser-report.json',JSON.stringify(report,null,2)); await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
