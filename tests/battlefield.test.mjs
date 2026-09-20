import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const artSource = readFileSync('playtest/casual-art.js', 'utf8').replaceAll('export function ', 'function ');
const source = artSource + '\n' + readFileSync('playtest/battlefield.js', 'utf8')
  .replace(/^import .*casual-art.js';/m, '')
  .replace('export class Battlefield', 'class Battlefield') + '\nglobalThis.Battlefield = Battlefield;';
const definitions = new Map([['archer', {
  id: 'archer', name: '궁수', faction: 'shu', troop: 'archer', rarity: 'basic', attackIntervalTicks: 10
}]]);
const lane = (stamp, { id = 'p', progress = 0, hp = 20, alive = true, target = 2 } = {}) => ({
  id, status: 'active',
  units: [{ id: 1, slot: 0, definitionId: 'archer', dispatched: false, lastAttackTick: stamp, lastTargetId: target }],
  enemies: alive ? [{ id: 2, progress, hp, maxHp: 20, boss: false }] : []
});
function renderer(portrait = false) {
  let clock = 1000;
  const draws = [], canvasContext = new Proxy({}, { get: (object, key) => object[key] ?? (() => {}), set: (object, key, value) => (object[key] = value, true) });
  canvasContext.drawImage = frame => draws.push(frame);
  // SVG decoding and animation scheduling are browser boundaries. State transitions
  // below run the production renderer unchanged; asset/raster quality is browser-tested.
  class ImageStub { constructor(width = 96, height = 96) { this.width = width; this.height = height; this.naturalWidth = width; this.complete = true; } }
  const context = vm.createContext({
    devicePixelRatio: 1, performance: { now: () => clock }, requestAnimationFrame() {}, Image: ImageStub, Map, Set, Math, matchMedia: () => ({ matches: portrait })
  });
  vm.runInContext(source, context);
  const view = new context.Battlefield({ getContext: () => canvasContext, addEventListener() {}, closest: () => null,
    getBoundingClientRect: () => ({ width: portrait ? 390 : 1000, height: portrait ? 455 : 440 }) }, () => {});
  return {
    view, draws, resize(value) { portrait = value; },
    update(snapshot, { at = clock + 200, reduced = false } = {}) {
      clock = at;
      view.update(snapshot, definitions, new Set(), 1, reduced);
    }
  };
}

test('initial and newly watched lanes do not replay historical server attacks', () => {
  const r = renderer();
  r.update(lane(40));
  assert.equal(r.view.effects.length, 0);
  assert.ok(r.view.units.get(1).attackAt < 0);
  r.update(lane(45));
  assert.equal(r.view.effects.filter(effect => effect.type === 'arrow').length, 1);
  r.update(lane(120, { id: 'other-player' }));
  assert.equal(r.view.effects.length, 0);
  assert.ok(r.view.units.get(1).attackAt < 0);
});

test('a new authoritative attack starts once and identical snapshots do not restart it', () => {
  const r = renderer();
  r.update(lane(null));
  r.update(lane(2), { at: 1600 });
  assert.equal(r.view.units.get(1).attackAt, 1600);
  assert.equal(r.view.effects.filter(effect => effect.type === 'arrow').length, 1);
  r.update(lane(2), { at: 1800 });
  assert.equal(r.view.units.get(1).attackAt, 1600);
  assert.equal(r.view.effects.filter(effect => effect.type === 'arrow').length, 1);
  r.update(lane(12), { at: 2000 });
  assert.equal(r.view.units.get(1).attackAt, 2000);
  assert.equal(r.view.effects.filter(effect => effect.type === 'arrow').length, 2);
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
  assert.equal(r.view.effects.filter(effect => effect.type === 'arrow').length, 2);
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

test('portrait view uses a taller six-column battlefield while desktop keeps its coordinates', () => {
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
  assert.equal(new Set(walkUrls).size, 3, 'opposite strides and a shared neutral foot pose');
  assert.ok(walkUrls.every(url => url.startsWith('data:image/svg+xml;')));
  assert.match(decodeURIComponent(walkUrls[0]), /L45 83/);
  assert.match(decodeURIComponent(walkUrls[2]), /L27 83/);
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