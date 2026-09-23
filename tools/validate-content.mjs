import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SLOT_COUNT, getBattlefieldLayout } from '../shared/battle-geometry.js';

/** Return descriptive validation errors; an empty array means valid. Never mutate input. */
function validateDefinition(content, validateStages = true) {
  const errors = [];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const integer = value => Number.isSafeInteger(value) && value > 0;
  if (!object(content)) return ['content must be an object'];
  if (!text(content.version)) errors.push('version must be a nonempty string');
  for (const section of ['units', 'recipes', 'stories', ...(validateStages ? ['battlefields'] : [])]) {
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
    if (unit.tier !== undefined && (unit.rarity !== 'legend' || !['legend', 'ultimate'].includes(unit.tier))) errors.push(label + ' has invalid tier');
    for (const tag of Object.keys(allowed)) if (!allowed[tag].includes(unit[tag])) errors.push(label + ' has invalid ' + tag);
    if (!positive(unit.attack)) errors.push(label + '.attack must be positive and finite');
    if (!positive(unit.attackRange)) errors.push(label + '.attackRange must be positive and finite');
    if (!['fire', 'wind', 'frost', 'laser', 'electric'].includes(unit.element)) errors.push(label + ' has invalid element');
    if (!integer(unit.attackIntervalTicks)) errors.push(label + '.attackIntervalTicks must be a positive integer');
    if (unit.attackPattern !== undefined && !['bolt', 'blast', 'arc'].includes(unit.attackPattern)) errors.push(label + '.attackPattern must be bolt, blast or arc');
  }

  const rules = content.rules;
  if (validateStages && rules.maxUnits !== SLOT_COUNT) errors.push('rules.maxUnits must match default battlefield slots');
  if (!integer(rules.frostSlowTicks)) errors.push('rules.frostSlowTicks must be a positive integer');
  for (const field of ['frostSlowMultiplier', 'bossSlowMultiplier']) {
    if (!positive(rules[field]) || rules[field] >= 1) errors.push('rules.' + field + ' must be above zero and below one');
  }
  if (rules.bossSlowMultiplier < rules.frostSlowMultiplier) errors.push('boss slow must not be stronger than normal slow');
  for (const field of ['ticksPerSecond', 'waveTicks', 'totalWaves', 'bossTicks', 'spawnIntervalTicks', 'spawnRampEveryWaves', 'minSpawnIntervalTicks', 'overcrowdCount', 'overcrowdTicks', 'disconnectGraceTicks', 'startingGold', 'summonCost', 'summonCooldownTicks', 'killGold', 'waveGold', 'maxUnits', 'maxDispatch', 'maxUpgradeLevel']) {
    if (!integer(rules[field])) errors.push('rules.' + field + ' must be a positive integer');
  }
  for (const field of ['bossHp', 'enemyBaseHp', 'enemyHpPerWave', 'enemyProgressPerTick', 'upgradeBonus']) {
    if (!positive(rules[field])) errors.push('rules.' + field + ' must be positive and finite');
  }
  for (const field of ['enemyHpAcceleration', 'waveGoldGrowth']) {
    if (typeof rules[field] !== 'number' || !Number.isFinite(rules[field]) || rules[field] < 0) errors.push('rules.' + field + ' must be finite and nonnegative');
  }
  if (!positive(rules.salvageRefundRatio) || rules.salvageRefundRatio >= 1) errors.push('rules.salvageRefundRatio must be above zero and below one');
  if (rules.minSpawnIntervalTicks > rules.spawnIntervalTicks) errors.push('rules.minSpawnIntervalTicks exceeds spawnIntervalTicks');
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
    if (!Number.isSafeInteger(recipe.unlockBattlefield) || recipe.unlockBattlefield < 0 || recipe.unlockBattlefield > 5) errors.push(label + ' invalid unlockBattlefield (expected 0..5)');
    if (result) {
      if (result.rarity === 'basic') errors.push(label + ' recipe result cannot be basic');
      if (recipe.unlockType !== undefined && !['clear', 'research'].includes(recipe.unlockType)) errors.push(label + ' invalid unlockType');
      if (result.rarity !== 'legend' && recipe.unlockBattlefield > 0 && recipe.unlockType !== 'clear') errors.push(label + ' only legends can require research unlocks');
      if (recipe.unlockBattlefield > 0 && recipe.unlockType === 'clear' && recipe.researchCost !== 0) errors.push(label + ' clear unlock requires zero researchCost');
      if (recipe.unlockBattlefield > 0 && recipe.unlockType !== 'clear' && !integer(recipe.researchCost)) errors.push(label + ' researched recipe requires a positive researchCost');
      if (recipe.unlockBattlefield === 0 && recipe.researchCost !== undefined) errors.push(label + ' initially available recipe cannot have a research unlock cost');
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
  for (let unlock = 0; unlock <= 5; unlock++) {
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
      if ((unit.rarity === 'basic' || (recipe && recipe.unlockBattlefield <= unlock)) && !reachable.has(unit.id)) errors.push(unit.id + ' is not reachable from basic units at unlock ' + unlock);
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
  if (validateStages) {
    const stageIds = new Set();
    for (const stage of content.battlefields) {
      if (!object(stage)) { errors.push('battlefield must be an object'); continue; }
      const label = 'battlefield ' + stage.id + ': ';
      if (!integer(stage.id) || stage.id > 5 || stageIds.has(stage.id)) errors.push(label + 'expected unique id 1..5');
      stageIds.add(stage.id);
      if (!text(stage.name) || !text(stage.description)) errors.push(label + 'name and description required');
      if (stage.chapterId !== 1 || stage.planetId !== 'scrap') errors.push(label + 'chapter 1 must share the scrap planet');
      const layout = getBattlefieldLayout(stage.id);
      if (layout.slots.length !== (stage.rules?.maxUnits ?? rules.maxUnits)) errors.push(label + 'maxUnits must match map slots');
      if (new Set(layout.slots.map(point => point.x + ':' + point.y)).size !== layout.slots.length) errors.push(label + 'duplicate map slots');
      if ([...layout.routes.flatMap(route => route.points), ...layout.slots, ...(layout.facility ? [layout.facility] : [])].some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > layout.width || point.y < 0 || point.y > layout.height)) errors.push(label + 'map point outside combat bounds');
      const objective = stage.objective;
      if (!object(objective) || !['overcrowd', 'mining', 'engine'].includes(objective.kind) || !text(objective.label)) errors.push(label + 'valid objective required');
      else if (objective.kind === 'overcrowd') {
        if (layout.facility || layout.routes.some(route => !route.closed)) errors.push(label + 'overcrowd requires a closed loop without a facility');
      } else {
        if (!integer(objective.facilityHp) || !positive(objective.damage) || !integer(objective.attackIntervalTicks)) errors.push(label + 'facility health, damage and attack interval must be positive');
        if (objective.arrivalProgress !== 1) errors.push(label + 'facility arrival must be at the open path endpoint');
        if (!layout.facility || layout.routes.some(route => route.closed)) errors.push(label + 'facility requires open routes and a facility position');
      }
      if (!object(stage.rules)) { errors.push(label + 'rules overrides required'); continue; }
      for (const key of Object.keys(stage.rules)) if (!(key in content.rules)) errors.push(label + 'unknown rule ' + key);
      errors.push(...validateDefinition({ ...content, rules: { ...rules, ...stage.rules }, stories: stage.stories }, false).map(error => label + error));
    }
    if (![1, 2, 3, 4, 5].every(id => stageIds.has(id))) errors.push('battlefields must define stages 1 through 5');
  }
  return [...new Set(errors)];
}

export function validateContent(content) { return validateDefinition(content); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const content = JSON.parse(readFileSync(new URL('../shared/content.json', import.meta.url), 'utf8'));
  const errors = validateContent(content);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Content valid: ' + content.units.length + ' units, ' + content.recipes.length + ' recipes, ' + content.stories.length + ' stories (' + content.version + ')');
}
