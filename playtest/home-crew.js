import { unitSpriteUrl } from './casual-art.js';

// The same three appliance silhouettes appear in the hangar and on the field.
export function mountHomeCrew(container) {
  const crew = [
    { id: 'wind_1', faction: 'shu', troop: 'cavalry', trait: 'strategy', rarity: 'basic', element: 'wind', attackPattern: 'blast', device: 'handfan' },
    { id: 'fire_1', faction: 'shu', troop: 'infantry', trait: 'might', rarity: 'basic', element: 'fire', attackPattern: 'bolt', device: 'lighter' },
    { id: 'laser_1', faction: 'wu', troop: 'archer', trait: 'strategy', rarity: 'basic', element: 'laser', attackPattern: 'bolt', device: 'pointer' }
  ];
  for (const definition of crew) {
    const robot = document.createElement('div'); robot.className = 'crew-robot'; robot.dataset.device = definition.device; robot.dataset.element = definition.element;
    const poses = definition.device === 'lighter' ? ['idle', 'windup', 'strike', 'recovery'] : ['idle', 'windup', 'strike'];
    for (const pose of poses) {
      const frame = new Image(); frame.src = unitSpriteUrl(definition, pose); frame.alt = ''; frame.className = 'pose-' + pose;
      frame.width = 144; frame.height = 144; robot.append(frame);
    }
    container.append(robot);
  }
}
