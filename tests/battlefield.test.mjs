import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

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
  const draws = [], labels = [], rasterizations = [], combat = [], selections = [], listeners = {}, canvasContext = new Proxy({}, { get: (object, key) => object[key] ?? (() => {}), set: (object, key, value) => (object[key] = value, true) });
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
    getBoundingClientRect: () => ({ left: 0, top: 0, width: portrait ? 390 : 1000, height: portrait ? 455 : 440, ...bounds }) }, id => selections.push(id), event => combat.push(event));
  const activeDefinitions = new Map([['archer', { ...definitions.get('archer'), attackPattern: pattern }]]);
  return {
    view, draws, labels, definitions: activeDefinitions, rasterizations, combat, selections, listeners, resize(value) { portrait = value; },
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
  assert.ok(mobile.view.position(6).y > mobile.view.position(0).y);
  assert.equal(mobile.view.position(6).x, mobile.view.position(0).x);
  const desktop = renderer(false);
  desktop.update(lane(null));
  assert.equal(desktop.view.worldWidth, 1000);
  assert.equal(desktop.view.position(10).x, desktop.view.position(0).x);
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

test('tall portrait and wide landscape canvases use their space and keep sprites selectable', () => {
  const r = renderer(true);
  r.bounds({ width: 390, height: 693 }); r.update(lane(null)); r.view.draw(1400);
  assert.equal(r.view.worldHeight, Math.round(600 * 693 / 390));
  assert.ok(r.view.position(9).y > 750);
  const unit = r.view.units.get(1), x = unit.x * r.view.scale + r.view.ox, y = (unit.y - 49) * r.view.scale + r.view.oy;
  r.listeners.click({ clientX: x, clientY: y });
  assert.deepEqual(r.selections, [1]);
  r.resize(false); r.bounds({ width: 667, height: 217 }); r.view.draw(1450);
  assert.equal(r.view.worldHeight, Math.round(1000 * 217 / 667));
  assert.ok(r.view.position(20).y < r.view.path(.6).y);
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
    r.definitions.get('archer').rarity = rarity;
    const snapshot = lane(null, { alive: false });
    snapshot.units = Array.from({ length: 30 }, (_, index) => ({ ...snapshot.units[0], id: index + 1, slot: index }));
    r.update(snapshot); r.labels.length = 0;
    for (const unit of r.view.units.values()) r.view.soldier(unit, 1450, 16);
    assert.deepEqual(r.labels, []);
    assert.equal(r.draws.length, 30, 'rank markers do not remove any robot sprites');
  }
});
