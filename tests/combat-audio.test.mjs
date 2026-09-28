import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatAudio } from '../playtest/combat-audio.js';

// Web Audio nodes are the output boundary. Keep the actual mixer, timing,
// admission limits and cancellation logic under test.
function audioContext() {
  const sources = [], gains = [], panners = [];
  const parameter = () => ({ value: 0, events: [],
    setValueAtTime(value, at) { this.events.push({ value, at }); },
    linearRampToValueAtTime(value, at) { this.events.push({ value, at }); },
    exponentialRampToValueAtTime(value, at) { this.events.push({ value, at }); },
    cancelScheduledValues() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  const source = () => {
    const value = { ...node(), frequency: parameter(), started: null, stops: [],
      start(at) { this.started = at; }, stop(at) { this.stops.push(at); } };
    sources.push(value); return value;
  };
  const context = { currentTime: 10, sampleRate: 48000, state: 'running', destination: node(),
    createOscillator: source, createBufferSource: source,
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createGain() { const value = { ...node(), gain: parameter() }; gains.push(value); return value; },
    createBiquadFilter: () => ({ ...node(), frequency: parameter(), Q: parameter() }),
    createStereoPanner() { const value = { ...node(), pan: parameter() }; panners.push(value); return value; },
  };
  return { context, sources, gains, panners, mixer: createCombatAudio(context) };
}

test('muted contexts schedule nothing and stopping cancels every delayed source', () => {
  const r = audioContext(); r.context.state = 'suspended';
  r.mixer.play('bolt', { element: 'fire' }); assert.equal(r.sources.length, 0);
  r.context.state = 'running'; r.mixer.play('combine', { delay: .3 });
  assert.ok(r.sources.length >= 2);
  assert.ok(r.sources.some(source => source.started > r.context.currentTime));
  r.mixer.stop();
  assert.ok(r.sources.every(source => source.stops.at(-1) === 10));
  const before = r.sources.length;
  r.mixer.play('combine'); assert.ok(r.sources.length > before, 'new session can immediately play a fresh cue');
});

test('dense combat is bounded and a danger cue preempts the bounded mix', () => {
  const r = audioContext();
  for (let index = 0; index < 100; index++) {
    r.context.currentTime += .13;
    r.mixer.play('bolt', { element: ['fire', 'frost', 'wind', 'laser', 'electric'][index % 5] });
  }
  assert.ok(r.sources.length <= 12, 'unended Web Audio sources are bounded');
  const before = r.sources.length;
  r.mixer.play('boss-entry');
  assert.ok(r.sources.length > before, 'a full combat mix cannot mask danger');
  assert.ok(r.sources.slice(0, before).some(source => source.stops.at(-1) === r.context.currentTime));
  const after = r.sources.length;
  r.mixer.play('bolt', { element: 'laser' });
  assert.equal(r.sources.length, after, 'weapons leave a short gap for the warning');
});

test('all elements have distinct layered sound envelopes with bounded pan and delay', () => {
  const profiles = [];
  for (const element of ['fire', 'water', 'frost', 'wind', 'laser', 'electric']) {
    const r = audioContext();
    r.mixer.play('bolt', { element, delay: .1, pan: 20, intensity: 1 });
    assert.ok(r.sources.length >= 2, element + ' has a body and transient');
    assert.ok(r.sources.every(source => source.started >= 10.1 && source.started < 10.5));
    assert.ok(r.panners.every(node => node.pan.value <= 1 && node.pan.value >= -1));
    profiles.push(JSON.stringify(r.sources.map(source => [source.type, source.frequency.events])));
  }
  assert.equal(new Set(profiles).size, 6);
});

test('unknown events are silent and duplicate rapid element shots do not flood the mix', () => {
  const r = audioContext();
  r.mixer.play('not-a-game-event'); assert.equal(r.sources.length, 0);
  r.mixer.play('bolt', { element: 'fire' }); const count = r.sources.length;
  for (let index = 0; index < 10; index++) r.mixer.play('bolt', { element: 'fire' });
  assert.equal(r.sources.length, count);
  for (const source of r.sources) source.onended();
  r.context.currentTime += .2; r.mixer.play('bolt', { element: 'fire' });
  assert.ok(r.sources.length > count, 'finished nodes release their budget');
});

test('water uses its own spray envelope instead of the generic weapon fallback', () => {
  const water = audioContext(), generic = audioContext();
  water.mixer.play('bolt', { element: 'water' }); generic.mixer.play('bolt');
  const envelope = r => r.sources.map(source => [source.type, source.frequency.events, source.stops]);
  assert.notDeepEqual(envelope(water), envelope(generic));
});
