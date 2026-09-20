import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Return descriptive validation errors; an empty array means valid. Never mutate input. */
export function validateContent(content) {
  const errors = [];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const integer = value => Number.isSafeInteger(value) && value > 0;
  if (!object(content)) return ['content must be an object'];
  if (!text(content.version)) errors.push('version must be a nonempty string');
  for (const section of ['units', 'recipes', 'stories']) {
    if (!Array.isArray(content[section]) || !content[section].length) errors.push(section + ' must be a nonempty array');
  }
  if (!object(content.rules)) errors.push('rules must be an object');
  if (errors.length) return errors;

  const units = new Map();
  const rarities = ['basic', 'elite', 'hero', 'legend'];
  const allowed = { faction: ['shu', 'wei', 'wu'], troop: ['infantry', 'archer', 'cavalry'], trait: ['might', 'strategy', 'command'] };
  for (const [i, unit] of content.units.entries()) {
    const label = 'units[' + i + ']';
    if (!object(unit)) { errors.push(label + ' must be an object'); continue; }
    if (!text(unit.id)) errors.push(label + ' needs id');
    else if (units.has(unit.id)) errors.push('duplicate unit id: ' + unit.id);
    else units.set(unit.id, unit);
    if (!text(unit.name)) errors.push(label + ' needs name');
    if (!rarities.includes(unit.rarity)) errors.push(label + ' has invalid rarity');
    for (const tag of Object.keys(allowed)) if (!allowed[tag].includes(unit[tag])) errors.push(label + ' has invalid ' + tag);
    if (!positive(unit.attack)) errors.push(label + '.attack must be positive and finite');
    if (!integer(unit.attackIntervalTicks)) errors.push(label + '.attackIntervalTicks must be a positive integer');
  }

  const rules = content.rules;
  for (const field of ['ticksPerSecond', 'waveTicks', 'totalWaves', 'bossTicks', 'spawnIntervalTicks', 'overcrowdCount', 'overcrowdTicks', 'disconnectGraceTicks', 'startingGold', 'summonCost', 'killGold', 'waveGold', 'maxUnits', 'maxDispatch', 'maxUpgradeLevel']) {
    if (!integer(rules[field])) errors.push('rules.' + field + ' must be a positive integer');
  }
  for (const field of ['bossHp', 'enemyBaseHp', 'enemyHpPerWave', 'enemyProgressPerTick', 'upgradeBonus']) {
    if (!positive(rules[field])) errors.push('rules.' + field + ' must be positive and finite');
  }
  if (rules.maxDispatch > rules.maxUnits) errors.push('rules.maxDispatch exceeds maxUnits');
  if (!Array.isArray(rules.upgradeCosts) || rules.upgradeCosts.length !== rules.maxUpgradeLevel || rules.upgradeCosts.some(cost => !integer(cost))) {
    errors.push('rules.upgradeCosts must contain one positive integer cost per maxUpgradeLevel');
  }
  if (!Array.isArray(rules.summonWeights) || rules.summonWeights.length !== 3 || rules.summonWeights.some(weight => !Number.isSafeInteger(weight) || weight < 0) || rules.summonWeights.reduce((a, b) => a + b, 0) !== 10000) {
    errors.push('rules.summonWeights must contain three nonnegative integer weights totaling 10000');
  }
  if (JSON.stringify(rules.summonRarities) !== JSON.stringify(['basic', 'elite', 'hero'])) errors.push('rules.summonRarities must be basic, elite, hero in that order; legends are craft-only');
  for (const rarity of ['basic', 'elite', 'hero']) if (![...units.values()].some(unit => unit.rarity === rarity)) errors.push('empty summon pool: ' + rarity);

  const recipes = new Map();
  const resultRecipes = new Map();
  for (const [i, recipe] of content.recipes.entries()) {
    const label = 'recipes[' + i + ']';
    if (!object(recipe)) { errors.push(label + ' must be an object'); continue; }
    if (!text(recipe.id)) errors.push(label + ' needs id');
    else if (recipes.has(recipe.id)) errors.push('duplicate recipe id: ' + recipe.id);
    else recipes.set(recipe.id, recipe);
    const result = units.get(recipe.result);
    if (!result) errors.push(label + ' unknown result: ' + recipe.result);
    if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length < 2 || recipe.ingredients.length > 3) errors.push(label + ' requires 2 or 3 ingredients');
    if (Array.isArray(recipe.ingredients)) for (const id of recipe.ingredients) if (!units.has(id)) errors.push(label + ' unknown ingredient: ' + id);
    if (!Number.isSafeInteger(recipe.unlockBattlefield) || recipe.unlockBattlefield < 0 || recipe.unlockBattlefield > 3) errors.push(label + ' invalid unlockBattlefield (expected 0..3)');
    if (result) {
      if (result.rarity === 'basic') errors.push(label + ' recipe result cannot be basic');
      if ((result.rarity === 'legend') !== (recipe.unlockBattlefield > 0)) errors.push(label + ' legends require unlocks; other recipes must be initially available');
      if (resultRecipes.has(recipe.result)) errors.push('duplicate recipe result: ' + recipe.result);
      resultRecipes.set(recipe.result, recipe);
    }
  }

  // Rare direct summons must not hide circular or missing guaranteed craft paths.
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push('circular recipe dependency (cycle): ' + id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const recipe = resultRecipes.get(id);
    if (recipe && Array.isArray(recipe.ingredients)) for (const ingredient of recipe.ingredients) visit(ingredient);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of units.keys()) visit(id);
  const reachable = new Set([...units.values()].filter(unit => unit.rarity === 'basic').map(unit => unit.id));
  for (let unlock = 0; unlock <= 3; unlock++) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const recipe of recipes.values()) {
        if (recipe.unlockBattlefield <= unlock && Array.isArray(recipe.ingredients) && recipe.ingredients.length >= 2 && recipe.ingredients.every(id => reachable.has(id)) && !reachable.has(recipe.result)) {
          reachable.add(recipe.result); changed = true;
        }
      }
    }
    for (const unit of units.values()) {
      const recipe = resultRecipes.get(unit.id);
      if (unit.rarity !== 'basic' && !recipe) errors.push('missing recipe for ' + unit.id);
      if ((unit.rarity !== 'legend' || (recipe && recipe.unlockBattlefield <= unlock)) && !reachable.has(unit.id)) errors.push(unit.id + ' is not reachable from basic units at unlock ' + unlock);
    }
  }

  const waves = new Set();
  const stories = content.stories.filter(object).slice().sort((a, b) => a.wave - b.wave);
  if (stories.length !== content.stories.length) errors.push('each story must be an object');
  for (const [i, story] of stories.entries()) {
    const label = 'story wave ' + story.wave;
    if (!integer(story.wave) || story.wave < 2 || story.wave > rules.totalWaves) errors.push(label + ' is outside available waves');
    if (waves.has(story.wave)) errors.push('duplicate story wave: ' + story.wave);
    waves.add(story.wave);
    if (!text(story.name)) errors.push(label + ' needs name');
    if (!positive(story.hp)) errors.push(label + '.hp must be positive and finite');
    if (!integer(story.durationTicks)) errors.push(label + '.durationTicks must be a positive integer');
    if (!integer(story.rewardGold)) errors.push(label + '.rewardGold must be a positive integer');
    const nextWave = stories[i + 1]?.wave ?? rules.totalWaves + 1;
    if (story.durationTicks > (nextWave - story.wave) * rules.waveTicks) errors.push(label + '.durationTicks overlaps the next story or boss');
  }
  return [...new Set(errors)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const content = JSON.parse(readFileSync(new URL('../shared/content.json', import.meta.url), 'utf8'));
  const errors = validateContent(content);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Content valid: ' + content.units.length + ' units, ' + content.recipes.length + ' recipes, ' + content.stories.length + ' stories (' + content.version + ')');
}
