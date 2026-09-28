import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const content = JSON.parse(readFileSync(new URL('../shared/content.json', import.meta.url), 'utf8'));
const families = {
  fire: ['라이터', '가스레인지', '화염방사기', '소각로'],
  water: ['물총', '세차 호스', '고압세척기', '소방차'],
  frost: ['소형 냉장고', '제빙기', '급속냉동고', '냉동창고'],
  wind: ['휴대용 선풍기', '선풍기', '산업용 송풍기', '제트엔진'],
  electric: ['건전지', '전기모기채', '고압변압기', '발전소'],
  laser: ['레이저 포인터', '레이저 조각기', '레이저 절단기', '레이저포'],
};

test('approved appliance roster has four stages per family and one common final robot', () => {
  assert.equal(content.units.length, 25);
  assert.equal(new Set(content.units.map(unit => unit.id)).size, 25);
  for (const [element, names] of Object.entries(families)) {
    names.forEach((name, index) => {
      const unit = content.units.find(unit => unit.id === `${element}_${index + 1}`);
      assert.equal(unit?.name, name);
      assert.equal(unit.element, element);
      assert.equal(unit.rarity, ['basic', 'elite', 'hero', 'legend'][index]);
    });
  }
  const finals = content.units.filter(unit => unit.tier === 'ultimate');
  assert.deepEqual(finals.map(unit => [unit.id, unit.name]), [['guardian_s', '만능 수호로봇']]);
});

test('every family assembles identical triples all the way into the same final unit', () => {
  assert.equal(content.recipes.length, 24);
  for (const element of Object.keys(families)) {
    for (let stage = 1; stage <= 4; stage++) {
      const id = stage === 4 ? `make_guardian_s_${element}` : `make_${element}_${stage + 1}`;
      const recipe = content.recipes.find(recipe => recipe.id === id);
      assert.ok(recipe, id);
      assert.deepEqual(recipe.ingredients, Array(3).fill(`${element}_${stage}`));
      assert.equal(recipe.result, stage === 4 ? 'guardian_s' : `${element}_${stage + 1}`);
      if (stage === 1) assert.equal(recipe.unlockBattlefield, 0);
      if (stage === 2) {
        assert.equal(recipe.unlockType, 'clear');
        assert.equal(recipe.unlockBattlefield, 2);
        assert.equal(recipe.researchCost, 0);
      }
      if (stage >= 3) {
        assert.equal(recipe.unlockType, 'future');
        assert.ok(recipe.unlockLabel);
      }
    }
  }
});

test('ordinary summon pool contains only six equally selected basic appliances', () => {
  assert.deepEqual(content.rules.summonWeights, [10000, 0, 0]);
  const basic = content.units.filter(unit => unit.rarity === 'basic');
  assert.deepEqual(basic.map(unit => unit.element).sort(), Object.keys(families).sort());
});

test('opening budget buys three units while early stage time and difficulty targets stay short', () => {
  const stage1 = content.battlefields.find(stage => stage.id === 1);
  const stage2 = content.battlefields.find(stage => stage.id === 2);
  const first = { ...content.rules, ...stage1.rules };
  const second = { ...content.rules, ...stage2.rules };
  assert.equal(first.startingGold, 60);
  assert.equal(first.summonCost, 20);
  assert.equal(Math.floor(first.startingGold / first.summonCost), 3);
  assert.equal((first.waveTicks * first.totalWaves + first.bossTicks) / first.ticksPerSecond, 180);
  assert.equal(second.waveTicks * second.totalWaves / second.ticksPerSecond, 240);
  assert.equal(stage1.difficulty, 1);
  assert.equal(stage2.difficulty, 1.5);
});

test('assembly raises primary damage beyond its three consumed units without shrinking range', () => {
  for (const recipe of content.recipes) {
    const materials = recipe.ingredients.map(id => content.units.find(unit => unit.id === id));
    const result = content.units.find(unit => unit.id === recipe.result);
    const primary = unit => unit.attack * (unit.attackPattern === 'blast' ? 0.8 : 1) / unit.attackIntervalTicks;
    assert.ok(primary(result) > materials.reduce((sum, unit) => sum + primary(unit), 0), recipe.id);
    assert.ok(result.attackRange >= Math.max(...materials.map(unit => unit.attackRange)), recipe.id);
  }
});
