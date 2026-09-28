// The web, native contract checks and authoritative combat share six upgrade families.
export const upgradeNames = Object.freeze({ fire: '화염', water: '물', frost: '냉기', wind: '바람', electric: '전기', laser: '레이저' });
export const upgradeKeys = Object.keys(upgradeNames);

/** @param {{ element: string, tier?: string }} definition @param {{ [key: string]: number }} levels */
export function getUpgradeLevel(definition, levels) {
  if (definition.tier === 'ultimate') return Math.max.apply(null, upgradeKeys.map(key => levels[key] || 0));
  return levels[definition.element] || 0;
}
