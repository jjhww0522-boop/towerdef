import { unitSpriteUrl } from './casual-art.js';

// The same three appliance silhouettes appear in the hangar and on the field.
export function mountHomeCrew(container) {
  const crew = [
    { id: 'shu_archer', faction: 'shu', troop: 'archer', trait: 'strategy', rarity: 'basic', element: 'wind', device: 'dryer' },
    { id: 'wu_archer', faction: 'wu', troop: 'archer', trait: 'strategy', rarity: 'basic', element: 'fire', device: 'lighter' },
    { id: 'wei_archer', faction: 'wei', troop: 'archer', trait: 'strategy', rarity: 'basic', element: 'laser', device: 'pointer' }
  ];
  for (const definition of crew) {
    const robot = document.createElement('div'); robot.className = 'crew-robot'; robot.dataset.device = definition.device;
    for (const pose of ['idle', 'windup', 'strike']) {
      const frame = new Image(); frame.src = unitSpriteUrl(definition, pose); frame.alt = ''; frame.className = 'pose-' + pose;
      frame.width = 144; frame.height = 144; robot.append(frame);
    }
    container.append(robot);
  }
}
