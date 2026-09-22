import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateContent } from '../tools/validate-content.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('../shared/content.json', import.meta.url), 'utf8'));
const invalid = (mutate, match) => {
  const data = fixture();
  mutate(data);
  assert.ok(validateContent(data).some(error => match.test(error)), 'Expected validation error matching ' + match);
};

test('current content passes validation without mutation', () => {
  const data = fixture(), before = JSON.stringify(data);
  assert.deepEqual(validateContent(data), []);
  assert.equal(JSON.stringify(data), before);
});

test('validator rejects absent sections without throwing incidental TypeErrors', () => {
  assert.ok(validateContent(null).length);
  assert.ok(validateContent({ version: 'x' }).length);
});

test('validator rejects duplicate IDs, unknown tags, rarity and nonpositive stats', () => {
  invalid(c => { c.units[1].id = c.units[0].id; }, /duplicate unit/i);
  invalid(c => { c.units[0].faction = 'other'; }, /faction/i);
  invalid(c => { c.units[0].troop = 'navy'; }, /troop/i);
  invalid(c => { c.units[0].trait = 'luck'; }, /trait/i);
  invalid(c => { c.units[0].rarity = 'mythic'; }, /rarity/i);
  invalid(c => { c.units[0].attack = Infinity; }, /attack/i);
  invalid(c => { c.units[0].attackIntervalTicks = 0; }, /attackIntervalTicks/i);
  invalid(c => { c.units[0].attackPattern = 'freeze'; }, /attackPattern/i);
  invalid(c => { c.units[0].attackPattern = null; }, /attackPattern/i);
  invalid(c => { c.units[0].attackRange = 0; }, /attackRange/i);
  invalid(c => { c.units[0].element = 'unknown'; }, /element/i);
  invalid(c => { c.rules.frostSlowMultiplier = 0; }, /frostSlowMultiplier/i);
  invalid(c => { c.rules.frostSlowTicks = 0; }, /frostSlowTicks/i);
  invalid(c => { c.rules.bossSlowMultiplier = 0.1; }, /boss slow/i);
  invalid(c => { c.rules.maxUnits = 31; }, /battlefield slots/i);
});

test('validator rejects dangling recipe references and malformed recipes', () => {
  invalid(c => { c.recipes[0].ingredients[0] = 'missing'; }, /unknown ingredient/i);
  invalid(c => { c.recipes[0].result = 'missing'; }, /unknown result/i);
  invalid(c => { c.recipes[0].ingredients = []; }, /2 or 3 ingredients/i);
  invalid(c => { c.recipes[1].id = c.recipes[0].id; }, /duplicate recipe/i);
});

test('validator detects self/circular requirements despite rare direct summons', () => {
  invalid(c => { c.recipes[0].ingredients[0] = c.recipes[0].result; }, /cycle|circular/i);
  invalid(c => {
    c.recipes[0].ingredients[0] = c.recipes[1].result;
    c.recipes[1].ingredients[0] = c.recipes[0].result;
  }, /cycle|circular/i);
});

test('validator requires initially available craft paths and valid legend unlocks', () => {
  invalid(c => { c.recipes[0].unlockBattlefield = 1; }, /unlock|initial/i);
  invalid(c => { c.recipes[15].unlockBattlefield = 0; }, /unlock|legend/i);
  invalid(c => { c.recipes[15].unlockBattlefield = 4; }, /unlock/i);
  invalid(c => { c.recipes.splice(0, 1); }, /reachable|recipe/i);
  invalid(c => { c.recipes[0].ingredients[0] = 'liu_bei'; }, /initial|reachable|cycle/i);
});

test('validator rejects malformed probabilities, missing summon pools and upgrade costs', () => {
  invalid(c => { c.rules.summonWeights[0] = 9301; }, /10000/i);
  invalid(c => { c.rules.summonWeights[1] = -1; }, /weight/i);
  invalid(c => { c.rules.summonRarities[2] = 'legend'; }, /summonRarities/i);
  invalid(c => { c.units = c.units.filter(u => u.rarity !== 'elite'); }, /summon pool/i);
  invalid(c => { c.rules.upgradeCosts.pop(); }, /upgradeCosts/i);
  invalid(c => { c.rules.upgradeCosts[0] = -2; }, /upgradeCosts/i);
  invalid(c => { c.rules.waveTicks = 0; }, /waveTicks/i);
  invalid(c => { c.rules.maxDispatch = 99; }, /maxDispatch/i);
});

test('validator catches impossible/duplicate story timing and invalid health', () => {
  invalid(c => { c.stories[0].wave = 25; }, /wave/i);
  invalid(c => { c.stories[1].wave = c.stories[0].wave; }, /duplicate story/i);
  invalid(c => { c.stories[0].hp = NaN; }, /hp/i);
  invalid(c => { c.stories[0].durationTicks = 0; }, /durationTicks/i);
  invalid(c => { c.stories[0].durationTicks = 99999; }, /overlap|durationTicks/i);
});

test('validator checks merged planet rules and every planet story schedule', () => {
  invalid(c => { c.battlefields[1].id = 1; }, /battlefield.*unique|stages/i);
  invalid(c => { c.battlefields[0].rules.waveTicks = 0; }, /battlefield.*waveTicks/i);
  invalid(c => { c.battlefields[0].rules.enemyHpAcceleration = -1; }, /battlefield.*Acceleration/i);
  invalid(c => { c.battlefields[0].rules.typo = 1; }, /unknown rule/i);
  invalid(c => { c.battlefields[2].stories[2].wave = 99; }, /battlefield.*wave/i);
  invalid(c => { c.battlefields[1].stories[0].durationTicks = 99999; }, /battlefield.*overlap/i);
  invalid(c => { c.rules.salvageRefundRatio = 1; }, /salvageRefundRatio/i);
});

test('free high-tier recipes remain valid while researched recipes require a positive cost', () => {
  assert.deepEqual(validateContent(fixture()), []);
  invalid(c => { c.recipes.find(r => r.unlockBattlefield > 0).researchCost = 0; }, /researchCost/i);
  invalid(c => { c.recipes.find(r => r.result === 'salvage_colossus').researchCost = 1; }, /initial.*unlock cost/i);
  invalid(c => { c.units[0].tier = 'ultimate'; }, /invalid tier/i);
});
