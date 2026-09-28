// Original repository-authored cartoon appliances. Web and native share every body.
import { readFileSync } from 'node:fs';
import { unitSpriteUrl, enemySpriteUrl, applianceKind } from '../../playtest/casual-art.js';
const content = JSON.parse(readFileSync(new URL('../../shared/content.json', import.meta.url), 'utf8'));
export const units = content.units.map(unit => ({ id: unit.id, element: unit.element,
  tier: unit.tier === 'ultimate' ? 5 : { basic: 1, elite: 2, hero: 3, legend: 4 }[unit.rarity], family: applianceKind(unit) }));
export const enemies = ['grunt', 'runner', 'siege', 'swarm', 'boss'];
export const unitStates = ['idle', 'prepare', 'fire', 'recover'];
export const enemyStates = ['move', 'hit', 'stop', 'destroy'];
const group = (body, transform, extra = '') => `<g transform="${transform}" ${extra}>${body}</g>`;
const inner = url => decodeURIComponent(url.split(',')[1]).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const shell = (body, size = 256) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">${body}</svg>`;

export function unitSvg(unit, state = 'idle', frame = 0) {
  const definition = content.units.find(candidate => candidate.id === unit.id);
  const pose = { idle: 'idle', prepare: 'windup', fire: 'strike', recover: 'recovery' }[state];
  const recoil = state === 'fire' ? [0, -2, -1, 0][frame] : state === 'prepare' ? [0, .4, .8, 1][frame] : state === 'recover' ? [-1, -.5, 0, 0][frame] : 0;
  const breath = state === 'idle' ? [0, -.4, -.8, -.4][frame] : 0;
  return shell(group(inner(unitSpriteUrl(definition, pose)), `translate(${16 + recoil} ${19 + breath}) scale(2.35)`));
}

export function enemySvg(kind, state = 'move', frame = 0) {
  let body = inner(enemySpriteUrl(kind, state === 'move' ? frame : 0));
  if (state === 'hit') {
    const squash = [1, .94, .98, 1][frame], recoil = [0, -2, -1, 0][frame];
    body = group(body, `translate(${48 + recoil} 87) scale(${2 - squash} ${squash}) translate(-48 -87)`);
  }
  if (state === 'destroy') {
    const progress = frame / 3;
    body = group(body, `translate(48 87) scale(${1 - progress * .45} ${1 - progress * .7}) translate(-48 -87)`, `opacity="${1 - progress * .8}"`);
  }
  return shell(group(body, 'translate(16 19) scale(2.35)'), kind === 'boss' ? 512 : 256);
}
