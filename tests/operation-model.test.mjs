import test from 'node:test';
import assert from 'node:assert/strict';
import { missionBeats, debriefAdvice } from '../playtest/operation-model.mjs';

const story = { speaker: '관제', opening: '시작', midpoint: '절반', warning: '접근', victory: '귀환', defeat: '재정비' };
const state = { tick: 100, rules: { totalWaves: 12, waveTicks: 150 }, expedition: { phase: 'mining', miningProgress: .1 } };
test('mission communications follow actual phase and never announce a victory before a clear', () => {
  assert.deepEqual(missionBeats(state, { status: 'active' }, story).map(b => b.key), ['opening']);
  const halfway = { ...state, expedition: { phase: 'mining', miningProgress: .5 } };
  assert.deepEqual(missionBeats(halfway, { status: 'active' }, story).map(b => b.key), ['opening', 'midpoint']);
  const late = { ...state, expedition: { phase: 'evacuation', miningProgress: 1 } };
  assert.equal(missionBeats(late, { status: 'active' }, story).at(-1).key, 'warning');
  assert.equal(missionBeats(late, { status: 'defeated' }, story).at(-1).text, '재정비');
  assert.equal(missionBeats(late, { status: 'cleared' }, story).at(-1).text, '귀환');
});
test('training has no expedition communications and leaving does not fabricate a defeat', () => {
  assert.deepEqual(missionBeats({ ...state, tutorial: {} }, { status: 'active' }, story), []);
  assert.equal(missionBeats(state, { status: 'left' }, story).at(-1).key, 'opening');
});
test('a finished player report stays at their own result while teammates continue', () => {
  const finished = { status: 'defeated', result: { miningProgress: .2, elapsedTicks: 360 } };
  const ongoing = { ...state, tick: 2100, expedition: { phase: 'evacuation', miningProgress: 1 } };
  const beats = missionBeats(ongoing, finished, story);
  assert.deepEqual(beats.map(b => b.key), ['opening', 'result']);
  assert.equal(beats.at(-1).tick, 360);
});
test('communication timestamps match discrete completed-wave milestones', () => {
  const mining = { ...state, tick: 2600, rules: { totalWaves: 15, waveTicks: 200 }, expedition: { miningProgress: 13 / 15 } };
  const beats = missionBeats(mining, { status: 'active' }, story);
  assert.equal(beats.find(beat => beat.key === 'midpoint').tick, 1600);
  assert.equal(beats.find(beat => beat.key === 'warning').tick, 2600);
});
test('debrief prioritizes the actual loss condition over invented play scores', () => {
  assert.match(debriefAdvice({ status: 'defeated', defeatReason: 'facility_destroyed' }), /시설|EMP/);
  assert.match(debriefAdvice({ status: 'defeated', defeatReason: 'boss_timeout' }), /보스|집중/);
  assert.match(debriefAdvice({ status: 'defeated', defeatReason: 'overcrowded' }), /범위|군집/);
  assert.match(debriefAdvice({ status: 'cleared', battleStats: { tacticsUsed: { overdrive: 0, emp: 0 } } }), /전술/);
});
