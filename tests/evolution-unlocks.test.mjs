import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recipeMaterials, evolutionOptions } from '../playtest/evolution-model.mjs';

const content = JSON.parse(readFileSync('shared/content.json', 'utf8'));
const recipe = content.recipes.find(candidate => candidate.unlockBattlefield > 0 && candidate.unlockType !== 'clear');
const materials = () => recipe.ingredients.map((definitionId, index) => ({ id: index + 1, definitionId, dispatched: false }));

test('researched evolution unlocks only the purchased recipe and still consumes the selected instance', () => {
  const units = materials();
  units.push({ id: 99, definitionId: recipe.ingredients[0], dispatched: false });
  const before = JSON.stringify(units);
  assert.equal(recipeMaterials(recipe, units, 99).ready, false, 'sufficient materials do not bypass research');
  assert.equal(recipeMaterials(recipe, units, 99, ['a-different-recipe']).ready, false, 'research is specific to the recipe ID');
  const unlocked = recipeMaterials(recipe, units, 99, [recipe.id]);
  assert.equal(unlocked.ready, true);
  assert.ok(unlocked.ids.includes(99), 'the tapped duplicate is consumed');
  assert.equal(new Set(unlocked.ids).size, recipe.ingredients.length);
  assert.deepEqual(unlocked.ids.map(id => units.find(unit => unit.id === id).definitionId).sort(), [...recipe.ingredients].sort());
  assert.equal(JSON.stringify(units), before, 'preview does not mutate owned units');
});

test('research never substitutes for unavailable materials or an eligible focused unit', () => {
  const units = materials(), unlocked = [recipe.id];
  assert.equal(recipeMaterials(recipe, units.slice(1), null, unlocked).ready, false);
  assert.equal(recipeMaterials(recipe, units.map((unit, index) => ({ ...unit, dispatched: index === 0 })), null, unlocked).ready, false);
  assert.equal(recipeMaterials(recipe, units, 999, unlocked).ready, false);
  assert.equal(recipeMaterials(recipe, [...units, { id: 999, definitionId: 'unrelated-definition', dispatched: false }], 999, unlocked).ready, false);
});

test('evolution paths read the current player unlocks without changing which branches are previewable', () => {
  const lockedPlayer = { units: materials(), unlockedRecipes: [] };
  const researchedPlayer = { ...lockedPlayer, unlockedRecipes: [recipe.id] };
  const before = JSON.stringify({ lockedPlayer, researchedPlayer });
  const locked = evolutionOptions(content, lockedPlayer, 1);
  const researched = evolutionOptions(content, researchedPlayer, 1);
  assert.deepEqual(researched.map(option => option.recipe.id), locked.map(option => option.recipe.id));
  assert.equal(locked.find(option => option.recipe.id === recipe.id).materials.ready, false);
  assert.equal(researched.find(option => option.recipe.id === recipe.id).materials.ready, true);
  assert.equal(evolutionOptions(content, lockedPlayer, 1).find(option => option.recipe.id === recipe.id).materials.ready, false,
    'one player research does not leak into another player preview');
  assert.equal(JSON.stringify({ lockedPlayer, researchedPlayer }), before);
});

test('clear rewards also require their exact recipe grant before materials become combinable', () => {
  const clearRecipe = content.recipes.find(recipe => recipe.unlockType === 'clear');
  const units = clearRecipe.ingredients.map((definitionId, index) => ({ id: index + 1, definitionId, dispatched: false }));
  const player = { units, unlockedRecipes: [] };
  assert.equal(recipeMaterials(clearRecipe, units, 1, player.unlockedRecipes).ready, false);
  player.unlockedRecipes.push(clearRecipe.id);
  assert.equal(recipeMaterials(clearRecipe, units, 1, player.unlockedRecipes).ready, true);
  assert.equal(evolutionOptions(content, player, 1).find(option => option.recipe.id === clearRecipe.id).materials.ready, true);
});