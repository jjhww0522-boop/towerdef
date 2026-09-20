// Display/selection helpers only. The server validates every submitted recipe.
export function recipeMaterials(recipe, units, focusedId = null) {
  const available = units.filter(unit => !unit.dispatched), counts = new Map(), ids = [];
  for (const ingredient of recipe.ingredients) counts.set(ingredient, (counts.get(ingredient) || 0) + 1);
  const entries = [...counts].map(([key, need]) => ({ key, need, have: available.filter(unit => unit.definitionId === key).length }));
  const focus = focusedId === null ? null : available.find(unit => unit.id === focusedId);
  const eligible = focusedId === null || !!focus && recipe.ingredients.includes(focus.definitionId);
  let anchored = false;
  if (eligible && focus) ids.push(focus.id);
  for (const ingredient of recipe.ingredients) {
    if (eligible && focus && !anchored && ingredient === focus.definitionId) { anchored = true; continue; }
    const unit = available.find(candidate => candidate.definitionId === ingredient && !ids.includes(candidate.id));
    if (unit) ids.push(unit.id);
  }
  return { ids, entries, ready: eligible && ids.length === recipe.ingredients.length && recipe.unlockBattlefield === 0 };
}

export function evolutionOptions(content, player, focusedId) {
  const focus = player.units.find(unit => unit.id === focusedId && !unit.dispatched);
  if (!focus) return [];
  return content.recipes.filter(recipe => recipe.ingredients.includes(focus.definitionId))
    .map(recipe => ({ recipe, materials: recipeMaterials(recipe, player.units, focusedId) }));
}

export function theoreticalDps(definition, player, rules) {
  const bonus = [definition.faction, definition.troop, definition.trait].reduce((sum, tag) => sum + player.upgrades[tag], 0) * rules.upgradeBonus;
  return definition.attack * (1 + bonus) * rules.ticksPerSecond / definition.attackIntervalTicks;
}
