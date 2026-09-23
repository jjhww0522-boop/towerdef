import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { applianceKind, elementPalette, unitSpriteUrl, enemySpriteUrl } from '../playtest/casual-art.js';

const content = JSON.parse(readFileSync('shared/content.json', 'utf8'));
const elements = ['fire', 'frost', 'wind', 'laser', 'electric'];
const chassis = { id: 'palette-fixture', faction: 'shu', troop: 'infantry', trait: 'might', rarity: 'elite', attackPattern: 'blast' };
const artwork = (definition, pose = 'idle') => decodeURIComponent(unitSpriteUrl(definition, pose).split(',')[1]);
const geometry = svg => [...svg.matchAll(/<(?:path|rect|ellipse|circle|g)\b[^>]*>/g)].map(([shape]) =>
  shape.replace(/\s(?:fill|stroke|stroke-opacity)="[^"]*"/g, '')).join('');
const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
const luminance = hex => rgb(hex).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);

test('elements have their requested hue families with darker bodies and bright working parts', () => {
  const hues = {
    fire: ([r, g, b]) => r > g * 1.3 && g >= b,
    frost: ([r, g, b]) => b >= g && g > r * 1.3,
    wind: ([r, g, b]) => g > b && b > r,
    laser: ([r, g, b]) => b > r && r > g,
    electric: ([r, g, b]) => r > g && g > b * 1.5 && g / r > .75
  };
  for (const element of elements) {
    const palette = elementPalette(element);
    assert.ok(Object.isFrozen(palette));
    assert.ok(hues[element](rgb(palette.main)), element + ' body hue');
    assert.ok(hues[element](rgb(palette.accent)), element + ' UI hue');
    assert.ok(luminance(palette.dark) < luminance(palette.main));
    assert.ok(luminance(palette.main) < luminance(palette.glow));
  }
  assert.equal(elementPalette(undefined), elementPalette('unrecognized'));
  assert.equal(elementPalette('toString'), elementPalette(undefined), 'object prototype names cannot become palettes');
});

test('the sprite cache distinguishes attack elements even when chassis and faction are identical', () => {
  const urls = elements.map(element => unitSpriteUrl({ ...chassis, element }, 'strike'));
  assert.equal(new Set(urls).size, 5);
  const shapes = elements.map(element => geometry(artwork({ ...chassis, element }, 'strike')));
  assert.equal(new Set(shapes).size, 1, 'element recoloring preserves the recognizable chassis and weapon');
  for (const element of elements) {
    const definition = { ...chassis, element };
    assert.equal(unitSpriteUrl(definition, 'strike'), unitSpriteUrl({ ...definition }, 'strike'));
  }
});

test('every actual robot uses its element body and attack highlight in all combat poses', () => {
  for (const definition of content.units) {
    const palette = elementPalette(definition.element);
    for (const pose of ['idle', 'windup', 'strike']) {
      const svg = artwork(definition, pose);
      assert.ok(svg.startsWith('<svg '));
      assert.ok(!/undefined|NaN/.test(svg));
      assert.ok(svg.includes(palette.main), definition.id + ' ' + pose + ': body follows element');
      assert.ok(svg.includes(palette.dark), definition.id + ' ' + pose + ': shaded element parts');
      if (pose === 'strike') assert.ok(svg.includes(palette.glow), definition.id + ': weapon/core follows element');
    }
  }
});

test('faction changes the salvage silhouette while element colors and neutral metal stay consistent', () => {
  for (const element of elements) {
    const sprites = ['shu', 'wei', 'wu'].map(faction => artwork({ ...chassis, faction, element }));
    for (const svg of sprites) {
      assert.ok(svg.includes(elementPalette(element).main));
      assert.ok(svg.includes('id="metal"'));
      assert.ok(svg.includes('#a8b5ba'), 'feet, housings and muzzle metal retain a neutral color');
    }
    assert.equal(new Set(sprites.map(geometry)).size, 3, 'existing faction chassis shapes remain distinct');
  }
});

test('appliance recoloring preserves individual silhouettes, attack poses and the lighter recovery', () => {
  for (const id of ['shu_archer', 'wu_archer', 'wei_archer']) {
    const definition = content.units.find(unit => unit.id === id);
    assert.ok(applianceKind(definition));
    const shapeVariants = elements.map(element => geometry(artwork({ ...definition, element }, 'strike')));
    assert.equal(new Set(shapeVariants).size, 1, id + ': recoloring does not alter appliance geometry');
    const poses = ['idle', 'windup', 'strike'].map(pose => artwork(definition, pose));
    assert.equal(new Set(poses).size, 3);
    if (id === 'wu_archer') {
      assert.ok(!poses.includes(artwork(definition, 'recovery')));
      assert.ok(artwork(definition, 'recovery').includes(elementPalette('fire').main));
    }
  }
});

test('home crew frames use the exact same element sprite URLs as their content-defined combat portraits', () => {
  const node = () => ({ dataset: {}, children: [], append(child) { this.children.push(child); } });
  const context = vm.createContext({ unitSpriteUrl, Image: class {}, document: { createElement: node } });
  const source = readFileSync('playtest/home-crew.js', 'utf8')
    .replace(/^import .*casual-art.js';/m, '').replace('export function ', 'function ');
  vm.runInContext(source + '\nglobalThis.mount = mountHomeCrew;', context);
  const container = node(); context.mount(container);
  assert.equal(container.children.length, 3);
  for (const robot of container.children) {
    const definition = content.units.find(unit => applianceKind(unit) === robot.dataset.device);
    assert.equal(robot.dataset.element, definition.element);
    for (const frame of robot.children) {
      assert.equal(frame.src, unitSpriteUrl(definition, frame.className.replace('pose-', '')));
    }
  }
});

test('enemy robots retain a muted palette separate from bright ally element highlights', () => {
  for (const kind of [0, 1, 2]) for (const pose of [0, 1, 2, 3]) {
    const svg = decodeURIComponent(enemySpriteUrl(kind, pose));
    for (const element of elements) {
      assert.ok(!svg.includes(elementPalette(element).accent));
      assert.ok(!svg.includes(elementPalette(element).glow));
    }
  }
});
