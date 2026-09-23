import { chromium } from 'playwright';
import { selectDestination, selectRunSpeed, openUnitInspection, closeUnitInspection, openEvolutionDetail } from './playtest-navigation.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Uses isolated synthetic players against the real development server.
// This checks browser geometry and interactions, not physical iPhone performance.
const base = process.env.PLAYTEST_URL || 'http://127.0.0.1:7351';
const viewports = [
  { width: 390, height: 844 }, { width: 375, height: 667 }, { width: 360, height: 640 },
  { width: 844, height: 390 }, { width: 667, height: 375 }, { width: 932, height: 430 },
];
const viewportFilter = process.env.MOBILE_LAYOUT_VIEWPORT;
const selectedViewports = viewports.filter(size => !viewportFilter || `${size.width}x${size.height}` === viewportFilter);
assert.ok(selectedViewports.length, 'MOBILE_LAYOUT_VIEWPORT must match one of the six supported viewports');
const report = { source: 'automated_mobile_layout_test', actualParticipants: 0, cases: [], errors: [] };
await mkdir('artifacts', { recursive: true });
let browser;

function pass(test, label, evidence = {}) {
  test.checks.push({ label, ...evidence });
  console.log(`PASS ${test.viewport} ${label}`);
}

async function snapshot(page) {
  const { token, playerId } = await page.evaluate(() => ({
    token: JSON.parse(sessionStorage.getItem('td.session')).token,
    playerId: JSON.parse(sessionStorage.getItem('td.player')),
  }));
  const response = await page.request.get(base + '/state', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(response.status(), 200, 'authenticated server state is available');
  const state = await response.json();
  const player = state.players.find(candidate => candidate.id === playerId);
  assert.ok(player, 'the synthetic player exists in authoritative state');
  return { state, player };
}

async function summon(page) {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/action' && response.request().method() === 'POST');
  await page.locator('#summon-btn').tap();
  const response = await responsePromise;
  assert.equal(response.status(), 200, 'summon reaches the development server');
  const result = await response.json();
  assert.equal(result.ok, true, 'server accepts summon: ' + (result.error || ''));
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
}

async function geometry(page, test, label, { detail = false, cooperative = false, inspection = false } = {}) {
  const dimensions = await page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect(), style = getComputedStyle(element);
      const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight
        && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0
        && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, visible };
    };
    return {
      width: innerWidth, height: innerHeight, scrollX, scrollY,
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      canvas: rect('#battlefield'), command: rect('.command-panel'), commandDialog: rect('#command-dialog[open]'), detail: rect('#unit-dialog[open]'),
      cooperativeStrip: rect('.side-column'), summon: rect('#summon-btn'), unitModal: document.querySelector('#unit-dialog').matches(':modal'),
      cooperative: rect('#co-op-dialog[open]'),
      inspection: rect('#unit-inspection-dialog[open]'),
    };
  });
  const { width, height } = test.size;
  assert.equal(dimensions.width, width, `${label}: mobile viewport width is honored`);
  assert.equal(dimensions.height, height, `${label}: mobile viewport height is honored`);
  assert.ok(dimensions.scrollWidth <= width + 1, `${label}: horizontal page overflow (${dimensions.scrollWidth}px > ${width}px)`);
  assert.ok(dimensions.scrollHeight <= height + 1, `${label}: page must not scroll vertically (${dimensions.scrollHeight}px > ${height}px)`);
  assert.ok(Math.abs(dimensions.scrollX) <= 1 && Math.abs(dimensions.scrollY) <= 1, `${label}: page remains at its origin`);
  if (inspection) {
    const panel = dimensions.inspection;
    assert.ok(panel?.visible && panel.left >= -1 && panel.right <= width + 1 && panel.top >= -1 && panel.bottom <= height + 1,
      `${label}: explicit robot inspection fits the viewport`);
    for (const key of ['top', 'bottom', 'left', 'right', 'width', 'height']) {
      assert.ok(Math.abs(dimensions.canvas[key] - test.restingCanvas[key]) <= 1, `${label}: inspection must not change canvas ${key}`);
    }
  } else if (!cooperative) {
    const active = detail ? dimensions.detail : dimensions.commandDialog?.visible ? dimensions.commandDialog : dimensions.command;
    assert.ok(active?.visible, `${label}: active bottom panel is visible`);
    assert.ok(active.height <= height * 0.30 + 1, `${label}: active bottom panel ${active.height.toFixed(2)}px exceeds 30% of ${height}px`);
    assert.ok(active.left >= -1 && active.right <= width + 1 && active.top >= -1 && active.bottom <= height + 1, `${label}: panel stays inside viewport`);
    if (detail) {
      assert.equal(dimensions.unitModal, false, `${label}: selection does not block the battlefield`);
      assert.ok(dimensions.command.visible, `${label}: command buttons stay available`);
      assert.ok(active.right <= width - 5 && active.left >= 5, `${label}: selection is a floating box with side space`);
      assert.ok(active.top >= dimensions.cooperativeStrip.bottom - 1 && active.bottom <= dimensions.command.top + 1, `${label}: selection leaves cooperative and command controls uncovered`);
      for (const key of ['top', 'bottom', 'left', 'right', 'width', 'height']) {
        assert.ok(Math.abs(dimensions.canvas[key] - test.restingCanvas[key]) <= 1, `${label}: selection must not change canvas ${key}`);
      }
    } else assert.ok(active.bottom <= height - 5, `${label}: controls float inside the field with bottom breathing room`);
    if (label === 'initial battlefield') {
      assert.equal(dimensions.commandDialog, null, `${label}: management content starts closed`);
      assert.equal(dimensions.detail, null, `${label}: unit details start closed`);
      assert.ok(active.height < height * 0.20, `${label}: resting controls ${active.height.toFixed(2)}px must occupy less than 20% of ${height}px`);
    }
    const bottomPanels = [dimensions.command, dimensions.commandDialog].filter(panel => panel?.visible);
    for (const panel of bottomPanels) assert.ok(panel.height <= height * 0.30 + 1, `${label}: each visible bottom panel obeys the 30% cap`);
    const canvas = dimensions.canvas;
    assert.ok(canvas?.visible && canvas.width > 0 && canvas.height > 0, `${label}: battlefield is visible`);
    assert.ok(canvas.left >= -1 && canvas.right <= width + 1 && canvas.top >= -1 && Math.abs(canvas.bottom - height) <= 1, `${label}: battlefield extends to the viewport bottom`);
    assert.ok(canvas.height >= height * .8, `${label}: battlefield owns at least 80% of the screen`);
    const summon = dimensions.summon;
    assert.ok(summon?.visible && summon.top >= canvas.top && summon.bottom <= canvas.bottom && summon.right <= canvas.right, `${label}: summon floats inside the battlefield`);
    assert.ok(dimensions.command.right + 4 <= summon.left, `${label}: summon and management buttons do not overlap`);
    if (label === 'populated battlefield keeps management closed') test.restingCanvas = canvas;
  } else {
    const panel = dimensions.cooperative;
    assert.ok(panel?.visible, `${label}: cooperative overview is open`);
    assert.ok(panel.left >= -1 && panel.right <= width + 1 && panel.top >= -1 && panel.bottom <= height + 1, `${label}: cooperative overview fits viewport`);
    assert.equal(dimensions.detail, null, `${label}: cooperative overview does not stack over unit details`);
  }
  pass(test, label, dimensions);
}

async function target(page, test, selector, label) {
  const control = page.locator(selector).first();
  await control.waitFor({ state: 'visible' });
  // Internal panel scrolling is allowed. Page scrolling is checked separately.
  await control.scrollIntoViewIfNeeded();
  // A live server snapshot can replace buttons when their enabled state changes.
  // Query and measure in one browser task instead of retaining a detached node.
  const bounds = await page.evaluate(selector => {
    const element = document.querySelector(selector);
    const r = element.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const clipping = { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), a = ancestor.getBoundingClientRect();
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
        clipping.top = Math.max(clipping.top, a.top + ancestor.clientTop);
        clipping.bottom = Math.min(clipping.bottom, a.top + ancestor.clientTop + ancestor.clientHeight);
      }
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
        clipping.left = Math.max(clipping.left, a.left + ancestor.clientLeft);
        clipping.right = Math.min(clipping.right, a.left + ancestor.clientLeft + ancestor.clientWidth);
      }
    }
    return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      unobscured: Boolean(hit && (hit === element || element.contains(hit))), hit: hit ? { tag: hit.tagName, id: hit.id, className: hit.className } : null,
      clipping, viewportWidth: innerWidth, viewportHeight: innerHeight, scrollX, scrollY };
  }, selector);
  assert.ok(bounds.width >= 44 && bounds.height >= 44, `${label}: expected 44px touch target, got ${bounds.width}×${bounds.height}`);
  assert.ok(bounds.top >= -1 && bounds.bottom <= bounds.viewportHeight + 1 && bounds.left >= -1 && bounds.right <= bounds.viewportWidth + 1, `${label}: target fits viewport`);
  assert.ok(bounds.top >= bounds.clipping.top - 1 && bounds.bottom <= bounds.clipping.bottom + 1
    && bounds.left >= bounds.clipping.left - 1 && bounds.right <= bounds.clipping.right + 1,
  `${label}: full target is clipped by a scroll container (${JSON.stringify(bounds)})`);
  assert.ok(bounds.unobscured, `${label}: target center is covered by another element (${JSON.stringify(bounds)})`);
  assert.ok(Math.abs(bounds.scrollX) <= 1 && Math.abs(bounds.scrollY) <= 1, `${label}: reaching target must not scroll the page`);
  pass(test, 'touch target: ' + label, bounds);
  return control;
}

async function capture(page, test, state) {
  const path = `artifacts/mobile-layout-${test.viewport}-${state}.png`;
  await page.screenshot({ path, fullPage: false });
  test.artifacts.push(path);
}

async function closeCommand(page, test, label) {
  const close = await target(page, test, '[data-close="command-dialog"]', label + ' close');
  await close.tap();
  await page.waitForFunction(() => !document.querySelector('#command-dialog').open
    && !document.querySelector('[data-tab][aria-expanded="true"]'));
  assert.equal(await page.locator('[data-tab][aria-expanded="true"]').count(), 0, 'closing management clears its expanded state');
  await geometry(page, test, label + ' returns to compact controls');
}

async function checkViewport(size, { bottomInset = 0, compactOnly = false } = {}) {
  const test = { viewport: `${size.width}x${size.height}${bottomInset ? '-inset' + bottomInset : ''}`, size,
    simulatedSafeAreaBottom: bottomInset, checks: [], artifacts: [], errors: [], allowances: [] };
  report.cases.push(test);
  const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => test.errors.push(error.message));
  try {
    await page.goto(base);
    await selectDestination(page);
    // Observe the real renderer; interaction below still uses physical canvas taps.
    await page.evaluate(async () => {
      const { Battlefield } = await import('/battlefield.js'), update = Battlefield.prototype.update;
      Battlefield.prototype.update = function(...args) { update.apply(this, args); window.layoutField = this; };
    });
    await selectRunSpeed(page, '1');
    await page.locator('#quick-start').tap();
    await page.locator('#game:not([hidden])').waitFor();
    await page.waitForFunction(() => !document.querySelector('#summon-btn').disabled);
    if (bottomInset) {
      // Simulates CSS safe-area padding only; it does not emulate iOS hardware or Safari.
      await page.evaluate(inset => {
        for (const element of document.querySelectorAll('.command-panel, #summon-btn')) element.style.bottom = Math.max(14, inset) + 'px';
        document.querySelector('#command-dialog').style.bottom = (88 + inset) + 'px';
      }, bottomInset);
    }
    await geometry(page, test, 'initial battlefield');
    await target(page, test, '#summon-btn', 'summon');
    const before = await snapshot(page);
    // Reserve the first upgrade cost so confirmation can be exercised without a time-based reward fixture.
    for (let count = 0; count < 5 && await page.locator('#summon-btn').isEnabled(); count++) await summon(page);
    const after = await snapshot(page);
    assert.ok(after.player.units.length > before.player.units.length, 'summoning creates server-owned units');
    assert.ok(after.player.lastSeq > before.player.lastSeq, 'real server action sequence advances');
    pass(test, 'summon UI updates authoritative state', { unitsBefore: before.player.units.length, unitsAfter: after.player.units.length });
    await geometry(page, test, 'populated battlefield keeps management closed');
    await capture(page, test, 'resting');

    for (const tab of compactOnly ? ['army'] : ['recipes', 'upgrades', 'army']) {
      const button = await target(page, test, `[data-tab="${tab}"]`, tab + ' tab');
      await button.tap();
      await page.locator('#command-dialog[open]').waitFor();
      await page.locator(`#${tab}-panel:not([hidden])`).waitFor();
      assert.equal(await button.getAttribute('aria-expanded'), 'true', `${tab}: open management is reflected`);
      if (tab === 'recipes') {
        const toggle = await target(page, test, '#codex-toggle', 'codex expansion');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.tap();
        await page.locator('#codex-content:not([hidden])').waitFor();
        await target(page, test, '#codex-content [data-pin]', 'recipe goal');
      }
      if (tab === 'upgrades') {
        const upgrade = await target(page, test, '[data-upgrade-tag]', 'upgrade inspection');
        const tag = await upgrade.getAttribute('data-upgrade-tag'), beforeInspection = await snapshot(page);
        await upgrade.tap();
        await page.locator('#upgrade-inspection:not([hidden])').waitFor();
        assert.equal(await page.locator('#upgrade-effect').textContent() !== '', true, 'upgrade inspection explains its effect');
        const inspected = await snapshot(page);
        assert.equal(inspected.player.lastSeq, beforeInspection.player.lastSeq, 'inspecting upgrade does not send a purchase');
        assert.equal(inspected.player.upgrades[tag], beforeInspection.player.upgrades[tag], 'inspection cannot change upgrade level');
        await geometry(page, test, 'upgrade inspection layout');
        const buy = await target(page, test, '#upgrade-buy', 'upgrade confirmation');
        assert.equal(await buy.isEnabled(), true, 'reserved funds make the first upgrade available');
        const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/action' && response.request().method() === 'POST');
        await buy.tap();
        const response = await responsePromise, result = await response.json();
        assert.equal(response.status(), 200, 'upgrade confirmation reaches the server');
        assert.equal(result.ok, true, 'server accepts the confirmed upgrade');
        assert.equal(response.request().postDataJSON().type, 'upgrade');
        await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('td.pending')) === null);
        const purchased = await snapshot(page);
        assert.equal(purchased.player.upgrades[tag], inspected.player.upgrades[tag] + 1, 'only confirmation increases the selected upgrade');
        assert.equal(purchased.player.lastSeq, inspected.player.lastSeq + 1, 'confirmation sends exactly one action');
        pass(test, 'upgrade effect inspection and explicit purchase remain separate', { tag, before: inspected.player.upgrades[tag], after: purchased.player.upgrades[tag] });
      }
      await geometry(page, test, tab + ' tab layout');
      await capture(page, test, tab);
      if (tab !== 'army') await closeCommand(page, test, tab + ' management');
    }

    const commonUnitSelector = '[data-unit-id][data-rarity="basic"], [data-unit-id][data-rarity="elite"]';
    const hasCommonUnit = await page.locator(commonUnitSelector).count() > 0;
    const unit = await target(page, test, hasCommonUnit ? commonUnitSelector : '[data-unit-id]', 'unit card');
    await unit.tap();
    await page.locator('#unit-dialog[open]').waitFor();
    await geometry(page, test, 'unit details float over the unchanged battlefield', { detail: true });
    if (hasCommonUnit) {
      const consumption = await page.locator('#unit-dialog .evolution-card .assembly-consumption').first().evaluate(element => {
        const r = element.getBoundingClientRect(), panel = document.querySelector('#evolution-panel'), p = panel.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, panelTop: p.top, panelBottom: p.bottom, scrollTop: panel.scrollTop, viewportHeight: innerHeight };
      });
      assert.equal(consumption.scrollTop, 0, 'first recipe consumption is checked before internal detail scrolling');
      assert.ok(consumption.top >= consumption.panelTop - 1 && consumption.bottom <= Math.min(consumption.panelBottom, size.height - bottomInset) + 1,
        `first basic/elite recipe consumption must be fully visible without scrolling: ${JSON.stringify(consumption)}`);
      assert.ok((await page.locator('#unit-dialog .assembly-status').first().innerText()).trim(), 'summary preserves the assembly availability or missing materials');
      pass(test, 'first recipe consumption and assembly status are visible in the summary', consumption);
    } else {
      test.allowances.push('All actual opening draws were heroes: long legend recipes may wrap and require internal scrolling; no units were injected.');
    }
    await target(page, test, '#unit-dialog [data-evolve-recipe]', 'evolution action');
    const firstRecipeId = await page.locator('#unit-dialog [data-evolution-detail]').first().getAttribute('data-evolution-detail');
    const beforeDetail = await snapshot(page);
    await target(page, test, '#unit-dialog [data-evolution-detail]', 'assembly detail entry');
    await openEvolutionDetail(page, firstRecipeId);
    await geometry(page, test, 'explicit assembly details fit the viewport', { inspection: true });
    await target(page, test, '[data-close="unit-inspection-dialog"]', 'assembly detail close');
    await page.locator('#unit-inspection-content .materials').first().scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#unit-inspection-content .materials').first().isVisible(), true, 'tap reveals material quantities without hover');
    assert.equal((await snapshot(page)).player.lastSeq, beforeDetail.player.lastSeq, 'reading assembly details sends no action');
    await closeUnitInspection(page);
    assert.equal(await page.locator('#unit-dialog').isVisible(), true, 'closing detailed information preserves summary');
    await target(page, test, '#unit-manage', 'robot management entry');
    await openUnitInspection(page);
    const queue = await target(page, test, '#queue-dispatch', 'dispatch queue');
    assert.equal(await queue.getAttribute('aria-pressed'), 'false', 'opening details does not queue the unit');
    const preQueue = await snapshot(page);
    await queue.tap();
    await page.waitForFunction(() => document.querySelector('#queue-dispatch').getAttribute('aria-pressed') === 'true');
    const postQueue = await snapshot(page);
    assert.equal(postQueue.player.lastSeq, preQueue.player.lastSeq, 'queue selection remains local until actual story dispatch');
    assert.equal(postQueue.player.units.filter(candidate => candidate.dispatched).length, preQueue.player.units.filter(candidate => candidate.dispatched).length, 'queue selection does not prematurely dispatch units');
    await closeUnitInspection(page);
    await geometry(page, test, 'queued unit summary remains compact', { detail: true });
    await capture(page, test, 'unit');
    const close = await target(page, test, '[data-close="unit-dialog"]', 'unit detail close');
    await close.tap();
    await page.waitForFunction(() => !document.querySelector('#unit-dialog').open);
    await geometry(page, test, 'commands return after closing details');

    const fieldGeometry = () => page.evaluate(() => {
      const field = window.layoutField;
      return { width: field.worldWidth, height: field.worldHeight, scale: field.scale, ox: field.ox, oy: field.oy,
        units: [...field.units].map(([id, view]) => ({ id, x: view.x, y: view.y })) };
    });
    const exposedRobotPoint = candidateIds => page.evaluate(ids => {
      const field = window.layoutField, bounds = field.canvas.getBoundingClientRect();
      for (const id of ids) {
        const view = field.units.get(id), height = field.unitHeight(field.definitions.get(view.unit.definitionId));
        // A floating panel may hide the sprite center while its upper or lower
        // body is still visible and inside the renderer's selection ellipse.
        for (const fraction of [.47, .20, .74]) {
          const x = bounds.left + field.ox + view.x * field.scale;
          const y = bounds.top + field.oy + (view.y - height * fraction) * field.scale;
          if (document.elementFromPoint(x, y) === field.canvas
            && document.elementFromPoint(x, y - 5) === field.canvas
            && document.elementFromPoint(x, y + 5) === field.canvas) return { id, x, y };
        }
      }
      return null;
    }, candidateIds);
    const tapRobot = async unitId => {
      const point = await exposedRobotPoint([unitId]);
      assert.ok(point, 'the requested robot has a visible body area for a real canvas tap');
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForFunction(id => document.querySelector('#unit-dialog').open && window.layoutField.selected.has(id), unitId);
    };
    const stableField = await fieldGeometry();
    // Prefer the same side, then choose an actually exposed robot. A world-half
    // threshold alone doesn't account for inspector width or safe-area padding.
    const upper = stableField.units.filter(unit => unit.y <= stableField.height * .55);
    const lower = stableField.units.filter(unit => unit.y > stableField.height * .55);
    const candidates = (upper.length >= 2 ? upper : lower).map(unit => unit.id);
    assert.ok(candidates.length >= 2, 'actual summoned robots are available for canvas selection');
    const ids = [candidates[0]];
    await tapRobot(ids[0]);
    assert.deepEqual(await fieldGeometry(), stableField, 'opening selection preserves the camera and every robot position');
    const nextPoint = await exposedRobotPoint([...candidates.slice(1), ...stableField.units.filter(unit => !candidates.includes(unit.id)).map(unit => unit.id)]);
    assert.ok(nextPoint, 'another robot remains directly selectable outside the inspector');
    ids.push(nextPoint.id);
    await tapRobot(ids[1]);
    assert.deepEqual(await fieldGeometry(), stableField, 'another canvas tap replaces selection without moving the field');
    assert.equal(await page.locator('#unit-dialog:modal').count(), 0);
    await geometry(page, test, 'direct canvas selection remains an overlay', { detail: true });
    await target(page, test, '#summon-btn', 'summon remains unobscured during selection');
    await target(page, test, '#story-toggle', 'story remains unobscured during selection');
    await capture(page, test, 'floating-unit');
    const canvasBounds = await page.locator('#battlefield').boundingBox();
    await page.touchscreen.tap(canvasBounds.x + 3, canvasBounds.y + canvasBounds.height * .5);
    await page.waitForFunction(() => !document.querySelector('#unit-dialog').open && window.layoutField.selected.size === 0);
    assert.deepEqual(await fieldGeometry(), stableField, 'empty battlefield closes selection without a camera or robot jump');
    await tapRobot(ids[0]); await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#unit-dialog').open && window.layoutField.selected.size === 0);
    pass(test, 'canvas taps replace selection; empty ground and Escape close without changing camera or units');

    await tapRobot(ids[0]);
    const beforePreview = await snapshot(page);
    await openUnitInspection(page);
    const sale = await target(page, test, '#sell-unit', 'sale preview');
    await sale.tap();
    await page.locator('#sale-inspection:not([hidden])').waitFor();
    await geometry(page, test, 'sale confirmation fits the explicit inspection', { inspection: true });
    assert.deepEqual(await fieldGeometry(), stableField, 'sale inspection does not move the camera or units');
    await target(page, test, '#confirm-sale', 'sale confirmation');
    assert.match(await page.locator('#confirm-sale').innerText(), /판매 · \+\d+ 고철/);
    await capture(page, test, 'sale');
    await sale.tap();
    assert.equal(await page.locator('#sale-inspection').isVisible(), false);
    assert.equal((await snapshot(page)).player.lastSeq, beforePreview.player.lastSeq, 'opening or cancelling sale sends no server action');
    await sale.tap(); await closeUnitInspection(page); await tapRobot(ids[1]);
    assert.equal(await page.locator('#unit-inspection-dialog').isVisible(), false, 'changing selected robot does not reopen old management');
    await openUnitInspection(page);
    assert.equal(await page.locator('#sale-inspection').isVisible(), false, 'another robot never inherits the previous sale confirmation');
    pass(test, 'sale preview can be cancelled and changing the robot requires new confirmation');
    await sale.tap();
    const beforeSale = await snapshot(page), sold = beforeSale.player.units.find(unit => unit.id === ids[1]);
    assert.ok(sold);
    assert.ok((await page.locator('#confirm-sale').innerText()).includes(`+${sold.salvageGold} 고철`), 'refund is the server-provided value');
    const saleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/action' && response.request().method() === 'POST');
    await page.locator('#confirm-sale').tap();
    const response = await saleResponse, result = await response.json(), packet = response.request().postDataJSON();
    assert.equal(result.ok, true);
    assert.equal(packet.type, 'salvage'); assert.deepEqual(packet.unitIds, [sold.id]);
    const afterSale = result.state.players.find(player => player.id === beforeSale.player.id);
    assert.deepEqual(afterSale.units.map(unit => unit.id), beforeSale.player.units.filter(unit => unit.id !== sold.id).map(unit => unit.id));
    assert.ok(afterSale.gold >= beforeSale.player.gold + sold.salvageGold, 'refund is credited; live enemy kills may also award gold');
    await page.waitForFunction(() => !document.querySelector('#unit-dialog').open && !document.querySelector('#unit-inspection-dialog').open && window.layoutField.selected.size === 0);
    pass(test, 'confirmed sale removes only the chosen robot, credits its refund and closes selection');
    await geometry(page, test, 'selling returns to the unchanged battlefield');

    for (const view of compactOnly ? [] : ['story', 'team']) {
      const toggle = await target(page, test, `#${view}-toggle`, view + ' overview');
      await toggle.tap();
      await page.locator('#co-op-dialog[open]').waitFor();
      await geometry(page, test, view + ' overview fits expanded viewport', { cooperative: true });
      if (view === 'team') {
        const roomMatches = await page.evaluate(() => document.querySelector('#invite-room').textContent === JSON.parse(sessionStorage.getItem('td.session')).roomId);
        assert.equal(roomMatches, true, 'mobile invite code matches the actual joined room');
        pass(test, 'team overview exposes the actual invite code');
        await target(page, test, '#copy-room', 'invite code copy');
      }
      await capture(page, test, view);
      const closeCoop = await target(page, test, '[data-close="co-op-dialog"]', view + ' overview close');
      await closeCoop.tap();
      await page.waitForFunction(() => !document.querySelector('#co-op-dialog').open);
      await geometry(page, test, view + ' overview returns to compact controls');
    }
    if (!compactOnly) {
      const settings = await target(page, test, '#battle-settings-btn', 'battle settings');
      await settings.tap();
      await page.locator('#settings-dialog[open]').waitFor();
      const closeSettings = await target(page, test, '[data-close="settings-dialog"]', 'battle settings close');
      await capture(page, test, 'settings');
      await closeSettings.tap();
      await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
      await geometry(page, test, 'battle settings return to compact controls');
    }
    assert.deepEqual(test.errors, [], 'no uncaught browser exceptions');
    test.status = 'passed';
  } catch (error) {
    test.status = 'failed';
    test.failure = { message: error.message, stack: error.stack };
    console.error(`FAIL ${test.viewport}: ${error.message}`);
    await capture(page, test, 'failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  for (const size of selectedViewports) await checkViewport(size);
  if (!viewportFilter || viewportFilter === '667x375') await checkViewport({ width: 667, height: 375 }, { bottomInset: 21, compactOnly: true });
  report.status = report.cases.every(test => test.status === 'passed') ? 'passed' : 'failed';
} catch (error) {
  report.status = 'failed'; report.errors.push(error.message); process.exitCode = 1; console.error(error);
} finally {
  await writeFile(`artifacts/mobile-layout-report${viewportFilter ? '-' + viewportFilter : ''}.json`, JSON.stringify(report, null, 2));
  if (browser) await browser.close();
}
