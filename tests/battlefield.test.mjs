import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { getBattlefieldLayout, unitPoint, enemyPoint, projectPoint } from '../shared/battle-geometry.js';

const artSource = readFileSync('playtest/casual-art.js', 'utf8').replaceAll('export function ', 'function ');
const geometrySource = readFileSync('shared/battle-geometry.js', 'utf8').replaceAll('export ', '');
const source = geometrySource + '\n' + artSource + '\n' + readFileSync('playtest/battlefield.js', 'utf8')
  .replace(/^import .*casual-art.js';/m, '')
  .replace(/^import .*battle-geometry.js';/m, '')
  .replace('export class Battlefield', 'class Battlefield') + '\nglobalThis.Battlefield = Battlefield;';
const definitions = new Map([['archer', {
  id: 'archer', name: '궁수', faction: 'shu', troop: 'archer', rarity: 'basic', attackIntervalTicks: 10
}]]);
const lane = (stamp, { id = 'p', progress = 0, hp = 20, alive = true, target = 2 } = {}) => ({
  id, status: 'active',
  units: [{ id: 1, slot: 0, definitionId: 'archer', dispatched: false, lastAttackTick: stamp, lastTargetId: target }],
  enemies: alive ? [{ id: 2, progress, hp, maxHp: 20, boss: false }] : []
});
function renderer(portrait = false, pattern = 'bolt', rasterize = false) {
  let clock = 1000, bounds = null;
  const draws = [], labels = [], rasterizations = [], combat = [], selections = [], selectedSlots = [], listeners = {}, canvasContext = new Proxy({}, { get: (object, key) => object[key] ?? (() => {}), set: (object, key, value) => (object[key] = value, true) });
  canvasContext.drawImage = frame => draws.push(frame);
  canvasContext.strokeText = label => labels.push(label);
  canvasContext.createLinearGradient = canvasContext.createRadialGradient = () => ({ addColorStop() {} });
  // SVG decoding and animation scheduling are browser boundaries. State transitions
  // below run the production renderer unchanged; asset/raster quality is browser-tested.
  class ImageStub { constructor(width = 96, height = 96) {
    this.width = width; this.height = height; this.naturalWidth = width; this.complete = true;
    if (rasterize) this.decode = () => Promise.resolve();
  } }
  class CanvasStub {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return new Proxy({ drawImage: frame => rasterizations.push(frame),
      createLinearGradient: canvasContext.createLinearGradient, createRadialGradient: canvasContext.createRadialGradient },
    { get: (object, key) => object[key] ?? (() => {}) }); }
  }
  const context = vm.createContext({
    devicePixelRatio: 1, performance: { now: () => clock }, requestAnimationFrame() {}, Image: ImageStub,
    ...(rasterize ? { OffscreenCanvas: CanvasStub } : {}), Map, Set, Math, matchMedia: () => ({ matches: portrait })
  });
  vm.runInContext(source, context);
  const view = new context.Battlefield({ getContext: () => canvasContext, addEventListener(type, listener) { listeners[type] = listener; }, closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: portrait ? 390 : 1000, height: portrait ? 455 : 440, ...bounds }) }, (id, slot) => { selections.push(id); selectedSlots.push(slot); }, event => combat.push(event));
  const activeDefinitions = new Map([['archer', { ...definitions.get('archer'), attackPattern: pattern }]]);
  return {
    view, draws, labels, definitions: activeDefinitions, rasterizations, combat, selections, selectedSlots, listeners, resize(value) { portrait = value; },
    bounds(value) { bounds = value; },
    update(snapshot, { at = clock + 200, reduced = false } = {}) {
      clock = at;
      view.update(snapshot, activeDefinitions, new Set(), 1, reduced);
    }
  };
}

test('initial and newly watched lanes do not replay historical server attacks', () => {
  const r = renderer();
  r.update(lane(40));
  assert.equal(r.view.effects.length, 0);
  assert.ok(r.view.units.get(1).attackAt < 0);
  r.update(lane(45));
  assert.equal(r.view.effects.filter(effect => effect.type === 'bolt').length, 1);
  r.update(lane(120, { id: 'other-player' }));
  assert.equal(r.view.effects.length, 0);
  assert.ok(r.view.units.get(1).attackAt < 0);
});

test('a new authoritative attack starts once and identical snapshots do not restart it', () => {
  const r = renderer();
  r.update(lane(null));
  r.update(lane(2), { at: 1600 });
  assert.equal(r.view.units.get(1).attackAt, 1600);
  assert.equal(r.view.effects.filter(effect => effect.type === 'bolt').length, 1);
  r.update(lane(2), { at: 1800 });
  assert.equal(r.view.units.get(1).attackAt, 1600);
  assert.equal(r.view.effects.filter(effect => effect.type === 'bolt').length, 1);
  r.update(lane(12), { at: 2000 });
  assert.equal(r.view.units.get(1).attackAt, 2000);
  assert.equal(r.view.effects.filter(effect => effect.type === 'bolt').length, 2);
});

test('health loss and removed targets produce hit and death effects without changing server data', () => {
  const r = renderer();
  r.update(lane(null));
  const damaged = lane(2, { hp: 7 }), original = JSON.stringify(damaged);
  r.update(damaged);
  assert.equal(JSON.stringify(damaged), original);
  assert.equal(r.view.effects.filter(effect => effect.type === 'damage')[0].label, '13');
  r.update(lane(12, { alive: false }));
  assert.equal(r.view.enemies.size, 0);
  assert.equal(r.view.effects.filter(effect => effect.type === 'death').length, 1);
  assert.equal(r.view.effects.filter(effect => effect.type === 'bolt').length, 2);
});

test('burst combat never exceeds the total 120 effect bound', () => {
  const r = renderer();
  r.update(lane(null));
  for (let stamp = 1; stamp <= 300; stamp++) r.update(lane(stamp));
  assert.equal(r.view.effects.length, 120);
});

test('reduced motion clears old particles and suppresses new hit or projectile effects', () => {
  const r = renderer();
  r.update(lane(null)); r.update(lane(2));
  assert.ok(r.view.effects.length > 0);
  r.update(lane(12, { hp: 3 }), { reduced: true });
  assert.equal(r.view.effects.length, 0);
  r.update(lane(22, { alive: false }), { reduced: true });
  assert.equal(r.view.effects.length, 0);
});

test('successive entrance crossings interpolate forward instead of jumping backward', () => {
  const r = renderer();
  r.update(lane(null, { progress: .98 }), { at: 1000 });
  r.update(lane(null, { progress: .02 }), { at: 1200 });
  assert.ok(r.view.enemies.get(2).to >= 1);
  assert.ok(r.view.enemies.get(2).to > r.view.enemies.get(2).from);
  r.update(lane(null, { progress: .40 }), { at: 1400 });
  r.update(lane(null, { progress: .80 }), { at: 1600 });
  r.update(lane(null, { progress: .98 }), { at: 1800 });
  r.update(lane(null, { progress: .02 }), { at: 2000 });
  assert.ok(r.view.enemies.get(2).to >= 1);
  assert.ok(r.view.enemies.get(2).to > r.view.enemies.get(2).from);
});

test('portrait rotates the shared board while desktop keeps its slot topology', () => {
  const mobile = renderer(true);
  mobile.update(lane(null));
  assert.equal(mobile.view.worldWidth, 600);
  assert.equal(mobile.view.worldHeight, 700);
  assert.ok(mobile.view.position(4).y > mobile.view.position(0).y);
  assert.equal(mobile.view.position(4).x, mobile.view.position(0).x);
  const desktop = renderer(false);
  desktop.update(lane(null));
  assert.equal(desktop.view.worldWidth, 1000);
  assert.equal(desktop.view.position(5).x, desktop.view.position(0).x);
});
test('articulated walk and attack poses share original vectors and reduced motion holds idle', () => {
  const r = renderer(true);
  r.update(lane(null));
  const walkUrls = r.view.walkFrames.slice(0, 4).map(frame => frame.src);
  assert.equal(new Set(walkUrls).size, 3, 'robot walk cycle has distinct left, neutral, and right poses');
  assert.ok(walkUrls.every(url => url.startsWith('data:image/svg+xml;')));
  const drawnPoses = new Set();
  for (const now of [1320, 1430, 1540, 1650]) {
    r.view.draw(now);
    drawnPoses.add(r.view.enemyFrameIndex(r.view.enemies.get(2).enemy, now));
  }
  assert.deepEqual(drawnPoses, new Set([0, 1, 2, 3]));
  const definition = definitions.get('archer');
  const idle = r.view.unitFrame(definition, 'idle');
  assert.ok(r.draws.includes(idle));
  r.update(lane(2), { at: 1700 });
  r.draws.length = 0; r.view.draw(1730);
  assert.ok(r.draws.includes(r.view.unitFrame(definition, 'windup')));
  r.draws.length = 0; r.view.draw(1810);
  assert.ok(r.draws.includes(r.view.unitFrame(definition, 'strike')));
  assert.notEqual(r.view.unitFrame(definition, 'strike').src, idle.src);
  r.draws.length = 0;
  r.update(lane(12), { at: 1900, reduced: true });
  for (const now of [1910, 2020, 2130]) {
    r.view.draw(now);
    assert.equal(r.view.enemyFrameIndex(r.view.enemies.get(2).enemy, now), 0);
  }
  assert.ok(r.draws.includes(idle));
  assert.ok(!r.draws.includes(r.view.unitFrame(definition, 'strike')));
});

test('viewport rotation remaps units but preserves enemy progress and clears old coordinate effects', () => {
  const r = renderer();
  r.update(lane(null, { progress: .3 }));
  r.update(lane(2, { progress: .4 }));
  assert.ok(r.view.effects.length > 0);
  const before = r.view.progress(r.view.enemies.get(2), 1400);
  r.resize(true); r.view.draw(1400);
  assert.equal(r.view.worldWidth, 600);
  assert.equal(r.view.units.get(1).x, r.view.position(0).x);
  assert.equal(r.view.units.get(1).y, r.view.position(0).y);
  assert.equal(r.view.progress(r.view.enemies.get(2), 1400), before);
  assert.equal(r.view.effects.length, 0);
});

test('all weapon effects use actual hit positions and damage even when targets died between polls', () => {
  for (const pattern of ['bolt', 'blast', 'arc']) {
    const r = renderer(false, pattern);
    r.update(lane(null, { alive: false }));
    const snapshot = lane(20, { alive: false });
    snapshot.units[0].lastAttackHits = [
      { targetId: 8, progress: .23, damage: 17 },
      ...(pattern === 'bolt' ? [] : [{ targetId: 9, progress: .25, damage: 9 }, { targetId: 10, progress: .27, damage: 5 }])
    ];
    const original = JSON.stringify(snapshot);
    r.update(snapshot);
    assert.equal(JSON.stringify(snapshot), original);
    assert.equal(r.view.effects.filter(effect => effect.type === pattern).length, 1);
    const position = r.view.path(.23), weapon = r.view.effects.find(effect => effect.type === pattern);
    if (pattern === 'arc') {
      assert.equal(weapon.points.length, 4);
      assert.equal(weapon.points[1].x, position.x);
    } else {
      assert.equal(weapon.tx, position.x);
      assert.equal(weapon.ty, position.y - 18);
    }
    assert.equal(r.view.effects.filter(effect => effect.type === 'death').length, snapshot.units[0].lastAttackHits.length);
    assert.equal(r.view.effects.find(effect => effect.type === 'damage').label, '17');
    assert.equal(r.combat[0].type, pattern);
    r.view.draw(1510); r.view.draw(1660); r.view.draw(1810);
  }
});

test('hit telemetry does not double count health-delta numbers and idle records never fire', () => {
  const r = renderer();
  r.update(lane(null));
  const hit = lane(12, { hp: 7 });
  hit.units[0].lastAttackHits = [{ targetId: 2, progress: .1, damage: 13 }];
  r.update(hit);
  assert.equal(r.view.effects.filter(effect => effect.type === 'damage').length, 1);
  const before = r.combat.length, attackAt = r.view.units.get(1).attackAt;
  const idle = lane(22, { hp: 7 }); idle.units[0].lastAttackHits = [];
  r.update(idle);
  assert.equal(r.view.units.get(1).attackAt, attackAt);
  assert.equal(r.combat.length, before);
});

test('reconnection baselines history without attack, landing, or destroy sounds', () => {
  const r = renderer();
  r.update(lane(20)); r.update(lane(30));
  const before = r.combat.length;
  r.update(lane(120, { alive: false }), { at: 5000 });
  assert.equal(r.view.effects.length, 0);
  assert.ok(r.view.units.get(1).attackAt < 0);
  assert.equal(r.combat.length, before);
  r.update(lane(130), { at: 5200 });
  assert.equal(r.combat.at(-1).type, 'bolt');
});

test('reduced motion retains confirmed targeting without moving effects or weapon poses', () => {
  const r = renderer(false, 'arc');
  r.update(lane(null));
  const snapshot = lane(12);
  snapshot.units[0].lastAttackHits = [{ targetId: 2, progress: .3, damage: 5 }];
  r.update(snapshot, { reduced: true });
  assert.equal(r.view.effects.length, 0);
  assert.equal(r.view.units.get(1).hitPositions.length, 1);
  assert.equal(r.combat[0].type, 'arc');
  r.view.draw(1430);
});

test('tall portrait and wide landscape canvases use their space and keep every robot selectable', () => {
  const r = renderer(true), snapshot = lane(null, { alive: false });
  snapshot.units = getBattlefieldLayout(1).slots.map((_, slot) => ({ ...snapshot.units[0], id: slot + 1, slot }));
  for (const [portrait, bounds] of [[true, { width: 390, height: 693 }], [false, { width: 667, height: 217 }]]) {
    r.resize(portrait); r.bounds(bounds); r.update(snapshot); r.view.draw(1600);
    assert.equal(r.view.worldHeight, Math.round((portrait ? 600 : 1000) * bounds.height / bounds.width));
    const height = r.view.unitHeight(r.definitions.get('archer'));
    for (const unit of r.view.units.values()) {
      const x = unit.x * r.view.scale + r.view.ox, y = (unit.y - height * .47) * r.view.scale + r.view.oy;
      assert.ok(x > 0 && x < bounds.width && y > 0 && y < bounds.height);
      r.listeners.click({ clientX: x, clientY: y });
      assert.equal(r.selections.at(-1), unit.unit.id, `slot ${unit.unit.slot} remains selectable in ${bounds.width}x${bounds.height}`);
    }
    if (portrait) assert.ok(r.view.position(4).y > 750);
    else assert.ok(r.view.position(5).y < r.view.path(.6).y);
  }
});
test('tapping empty battlefield reports a cleared selection without moving units', () => {
  const r = renderer(true);
  r.bounds({ width: 390, height: 693 }); r.update(lane(null)); r.view.draw(1400);
  const unit = r.view.units.get(1), before = { x: unit.x, y: unit.y, scale: r.view.scale };
  r.listeners.click({ clientX: unit.x * r.view.scale + r.view.ox, clientY: (unit.y - 30) * r.view.scale + r.view.oy });
  r.listeners.click({ clientX: 4, clientY: 4 });
  assert.deepEqual(r.selections, [1, null]);
  assert.deepEqual({ x: unit.x, y: unit.y, scale: r.view.scale }, before);
});

test('weapon artwork includes the actual pattern in its cache key and has distinct fire tools', () => {
  const r = renderer();
  const sprites = ['bolt', 'blast', 'arc'].map(attackPattern => r.view.unitFrame({ ...definitions.get('archer'), id: attackPattern, attackPattern }, 'strike').src);
  assert.equal(new Set(sprites).size, 3);
  assert.ok(sprites.every(url => decodeURIComponent(url).includes('linearGradient')));
});

test('decoded unit and enemy poses are rasterized once and animated frames reuse those pixels', async () => {
  const r = renderer(false, 'bolt', true);
  r.update(lane(null));
  await Promise.resolve();
  const idle = r.view.unitFrame(definitions.get('archer'), 'idle'), enemy = r.view.walkFrames[0];
  assert.equal(idle.raster.width, 192);
  assert.equal(enemy.raster.height, 192);
  assert.equal(r.rasterizations.length, 15, 'twelve walk and three owned-unit poses are prepared once');
  idle.onload(); enemy.onload();
  r.view.draw(1400); r.view.draw(1450); r.view.draw(1500);
  assert.ok(r.draws.includes(idle.raster));
  assert.ok(!r.draws.includes(idle));
  assert.equal(r.rasterizations.length, 15, 'onload, decode and repeated draws share one raster per pose');
});

test('a full high-tier formation draws rank markers without per-unit text rasterization', () => {
  for (const rarity of ['elite', 'hero', 'legend']) {
    const r = renderer();
    r.definitions.get('archer').rarity = rarity; r.view.battlefieldId = 5;
    const snapshot = lane(null, { alive: false });
    snapshot.units = Array.from({ length: getBattlefieldLayout(5).slots.length }, (_, index) => ({ ...snapshot.units[0], id: index + 1, slot: index }));
    r.update(snapshot); r.labels.length = 0;
    for (const unit of r.view.units.values()) r.view.soldier(unit, 1450, 16);
    assert.deepEqual(r.labels, []);
    assert.equal(r.draws.length, getBattlefieldLayout(5).slots.length, 'rank markers do not remove any robot sprites');
  }
});

test('the lighter extinguishes into an open recovery pose between confirmed shots, then rests', () => {
  const r = renderer();
  const lighter = { ...r.definitions.get('archer'), id: 'wu_archer', element: 'fire' };
  r.definitions.set('archer', lighter);
  r.update(lane(null));
  r.update(lane(2), { at: 1600 });
  const unit = r.view.units.get(1), recovery = r.view.unitFrame(lighter, 'recovery');
  const drawPose = now => { r.draws.length = 0; r.view.soldier(unit, now, 16); return r.draws.at(-1); };
  assert.equal(drawPose(1630), r.view.unitFrame(lighter, 'windup'));
  assert.equal(drawPose(1710), r.view.unitFrame(lighter, 'strike'));
  assert.equal(drawPose(1840), recovery);
  assert.equal(drawPose(2320), recovery, 'the lid stays open while waiting for another shot');
  assert.notEqual(recovery.src, r.view.unitFrame(lighter, 'idle').src);
  assert.notEqual(recovery.src, r.view.unitFrame(lighter, 'strike').src, 'recovery has its own extinguished artwork');
  r.update(lane(10), { at: 2400 });
  assert.equal(drawPose(2430), recovery, 'a consecutive shot does not close and reopen the lid');
  assert.equal(drawPose(2510), r.view.unitFrame(lighter, 'strike'));
  assert.equal(drawPose(3650), r.view.unitFrame(lighter, 'idle'));
  assert.equal(r.combat.length, 2, 'drawing recovery never emits another shot');
  r.update(lane(20), { at: 3800, reduced: true });
  assert.equal(drawPose(3910), r.view.unitFrame(lighter, 'idle'));
  assert.equal(r.view.effects.length, 0);
});

test('only the representative lighter adds a cached recovery frame', async () => {
  const r = renderer(false, 'bolt', true);
  const lighter = { ...r.definitions.get('archer'), id: 'wu_archer', element: 'fire' };
  r.definitions.set('archer', lighter); r.update(lane(null));
  await Promise.resolve();
  assert.equal(r.rasterizations.length, 16, 'twelve enemy frames plus four lighter poses');
  r.update(lane(2));
  for (const now of [1430, 1510, 1640, 2020]) r.view.draw(now);
  await Promise.resolve();
  assert.equal(r.rasterizations.length, 16, 'recovery drawing reuses its cached pixels');
});

test('acknowledged summons land while combines stay at the selected slot and both finish promptly', () => {
  for (const kind of ['summon', 'combine']) {
    const r = renderer();
    r.definitions.set('archer', { ...r.definitions.get('archer'), id: 'wu_archer', element: 'fire' });
    r.update(lane(null));
    const snapshot = lane(null), result = { ...snapshot.units[0], id: 3, slot: 7 };
    snapshot.units = [result];
    const before = JSON.stringify(snapshot);
    r.view.markArrival(3, kind); r.update(snapshot, { at: 1600 });
    const view = r.view.units.get(3), origin = r.view.position(7), positions = [];
    r.view.drawSprite = (_frame, x, y) => positions.push({ x, y });
    r.view.soldier(view, 1600, 16);
    assert.equal(positions[0].x, origin.x);
    assert.equal(positions[0].y, kind === 'combine' ? origin.y : origin.y - 55);
    assert.ok(r.view.effects.some(effect => effect.type === (kind === 'combine' ? 'assembly' : 'landing')));
    assert.equal(r.view.arrivals.size, 0, 'the acknowledgement is consumed once');
    r.view.drawEffects(1600 + (kind === 'combine' ? 401 : 301));
    assert.equal(r.view.effects.length, 0, 'arrival effects do not outlive their short presentation');
    assert.equal(JSON.stringify(snapshot), before, 'presentation never rewrites authoritative units or slots');
  }
});

test('arrival acknowledgements cannot leak into later snapshots, watched lanes or reconnections', () => {
  const r = renderer();
  r.view.markArrival(1, 'combine'); r.update(lane(null));
  assert.equal(r.view.effects.length, 0, 'initial connection does not replay an arrival');
  r.view.markArrival(3, 'combine'); r.update(lane(null));
  const added = lane(null); added.units.push({ ...added.units[0], id: 3, slot: 1 });
  r.update(added);
  assert.equal(r.view.units.get(3).arrivalKind, 'summon', 'an unobserved result cannot remain queued');
  r.view.markArrival(1, 'combine'); r.update(lane(null, { id: 'other-player' }));
  assert.equal(r.view.effects.length, 0, 'switching watched lanes clears queued arrivals');
  r.view.markArrival(3, 'combine'); r.update(added, { at: 6000 });
  assert.equal(r.view.effects.length, 0, 'reconnecting does not replay acknowledged results');
  r.view.markArrival(4, 'combine');
  added.units.push({ ...added.units[0], id: 4, slot: 2 });
  r.update(added, { reduced: true });
  assert.equal(r.view.effects.length, 0, 'motion reduction shows the result without arrival effects');
});

test('all five maps project the authoritative path and slots in both orientations', () => {
  for (const portrait of [false, true]) for (const battlefieldId of [1, 2, 3, 4, 5]) {
    const r = renderer(portrait), layout = getBattlefieldLayout(battlefieldId);
    r.view.battlefieldId = battlefieldId;
    const snapshot = lane(null); snapshot.units[0].slot = layout.slots.length - 1;
    r.update(snapshot);
    const w = r.view.worldWidth, h = r.view.worldHeight;
    const road = { left: w * .12, right: w * .84, top: h * (portrait ? .22 : .27), bottom: h * .8 };
    for (let index = 0; index < layout.slots.length; index++) {
      const expected = projectPoint(unitPoint(index, battlefieldId), road, portrait, battlefieldId), actual = r.view.position(index);
      assert.ok(Math.abs(actual.x - expected.x) < 1e-8 && Math.abs(actual.y - expected.y) < 1e-8);
    }
    for (let routeIndex = 0; routeIndex < layout.routes.length; routeIndex++) for (const progress of [0, .12, .37, .61, .85, .999, 1, 1.1]) {
      const expected = projectPoint(enemyPoint(progress, battlefieldId, routeIndex), road, portrait, battlefieldId), actual = r.view.path(progress, routeIndex);
      assert.ok(Math.abs(actual.x - expected.x) < 1e-8 && Math.abs(actual.y - expected.y) < 1e-8);
    }
    const slotsDrawn = [], position = r.view.position.bind(r.view);
    r.view.position = index => { slotsDrawn.push(index); return position(index); };
    r.view.drawDeck();
    assert.deepEqual(slotsDrawn, Array.from({ length: layout.slots.length }, (_, index) => index));
  }
});

test('switching maps discards old slots and effects before adopting a smaller map', () => {
  const r = renderer(), first = lane(null);
  r.view.battlefieldId = 5;
  first.units[0].slot = getBattlefieldLayout(5).slots.length - 1; r.update(first);
  const attack = lane(2); attack.units[0].slot = first.units[0].slot;
  r.update(attack, { at: 1600 });
  assert.ok(r.view.effects.length > 0, 'the old map has an active attack effect');
  r.view.markArrival(1, 'combine');
  r.view.battlefieldId = 1;
  const lastSlot = getBattlefieldLayout(1).slots.length - 1;
  const next = lane(20); next.units[0].slot = lastSlot;
  r.update(next, { at: 1800 });
  assert.equal(r.view.units.size, 1);
  assert.equal(r.view.units.get(1).unit.slot, lastSlot);
  assert.equal(r.view.units.get(1).x, r.view.position(lastSlot).x);
  assert.equal(r.view.effects.length, 0);
  assert.equal(r.view.arrivals.size, 0);
  assert.ok(r.view.units.get(1).attackAt < 0, 'the next map is an initial snapshot');
});

test('enemies on each open route stay at their arrival point across snapshots', () => {
  for (const battlefieldId of [2, 3, 4, 5]) for (let routeIndex = 0; routeIndex < getBattlefieldLayout(battlefieldId).routes.length; routeIndex++) {
    const r = renderer(true); r.view.battlefieldId = battlefieldId;
    const snapshot = progress => { const state = lane(null, { progress }); state.enemies[0].routeIndex = routeIndex; return state; };
    r.update(snapshot(.98), { at: 1000 });
    r.update(snapshot(1), { at: 1200 });
    r.update(snapshot(1), { at: 1400 });
    const view = r.view.enemies.get(2);
    assert.equal(view.from, 1); assert.equal(view.to, 1);
    const actual = r.view.path(r.view.progress(view, 2000), routeIndex), arrival = r.view.path(1, routeIndex);
    assert.equal(actual.x, arrival.x); assert.equal(actual.y, arrival.y);
    assert.notDeepEqual(actual, r.view.path(0, routeIndex), 'arrival never wraps to the entrance');
  }
});

test('hit telemetry keeps impact and death effects on the target route after the enemy is removed', () => {
  const r = renderer(); r.view.battlefieldId = 5;
  r.update(lane(null, { alive: false }));
  const snapshot = lane(2, { alive: false });
  snapshot.units[0].lastAttackHits = [{ targetId: 50, damage: 20, progress: .62, routeIndex: 3, boss: false }];
  r.update(snapshot, { at: 1600 });
  const target = r.view.path(.62, 3), wrongRoute = r.view.path(.62, 0);
  const impact = r.view.effects.find(effect => effect.type === 'impact');
  const death = r.view.effects.find(effect => effect.type === 'death');
  assert.equal(impact.x, target.x); assert.equal(impact.y, target.y - 18);
  assert.equal(death.x, target.x); assert.equal(death.y, target.y);
  assert.notEqual(impact.x, wrongRoute.x);
});

test('placement preview marks only free slots and an empty-pad click never selects a unit', () => {
  const r = renderer(); r.view.battlefieldId = 2;
  const snapshot = lane(null, { alive: false });
  snapshot.units.push({ ...snapshot.units[0], id: 3, slot: 2, dispatched: true });
  r.update(snapshot);
  const highlighted = [];
  r.view.rect = (x, y) => highlighted.push({ x: x + 24, y: y + 12 });
  r.view.previewPlacement(); r.view.drawPlacementPreview(1250);
  assert.equal(highlighted.length, getBattlefieldLayout(2).slots.length - 2);
  for (const occupied of [0, 2]) assert.ok(!highlighted.some(point => {
    const target = r.view.position(occupied); return point.x === target.x && point.y === target.y;
  }), 'a dispatched robot still reserves its slot');
  const freeSlot = getBattlefieldLayout(2).slots.length - 1, free = r.view.position(freeSlot);
  r.listeners.click({ clientX: free.x * r.view.scale + r.view.ox, clientY: free.y * r.view.scale + r.view.oy });
  assert.equal(r.selections.at(-1), null); assert.equal(r.selectedSlots.at(-1), freeSlot);
  assert.equal(snapshot.units.length, 2); assert.equal(snapshot.units[1].slot, 2);
  highlighted.length = 0; r.view.drawPlacementPreview(2400);
  assert.equal(highlighted.length, 0, 'the preview disappears without persistent clutter');
});

test('crowded open maps keep each robot selectable in short landscape viewports', () => {
  for (const size of [{ width: 667, height: 331 }, { width: 844, height: 346 }]) for (const battlefieldId of [2, 3, 4, 5]) {
    const r = renderer(); r.bounds(size); r.view.battlefieldId = battlefieldId;
    const snapshot = lane(null, { alive: false });
    snapshot.units = getBattlefieldLayout(battlefieldId).slots.map((_, slot) => ({ ...snapshot.units[0], id: slot + 1, slot }));
    for (const rarity of ['basic', 'legend']) {
      r.definitions.get('archer').rarity = rarity; r.view.battlefieldId = 5; r.update(snapshot); r.view.draw(2000);
      const height = r.view.unitHeight(r.definitions.get('archer'));
      for (const view of r.view.units.values()) {
        r.listeners.click({ clientX: view.x * r.view.scale + r.view.ox, clientY: (view.y - height * .47) * r.view.scale + r.view.oy });
        assert.equal(r.selections.at(-1), view.unit.id, `map ${battlefieldId} slot ${view.unit.slot} ${rarity} remains selectable`);
      }
    }
  }
});
