// Combat coordinates are independent of screen size and orientation.
export const BOARD_WIDTH = 720;
export const BOARD_HEIGHT = 246;
export const SLOT_COUNT = 30;

export function unitPoint(index) {
  return { x: 98 + index % 10 * 60, y: 79 + Math.floor(index / 10) * 61 };
}

export function enemyPoint(progress) {
  let distance = ((progress % 1 + 1) % 1) * (BOARD_WIDTH + BOARD_HEIGHT) * 2;
  if (distance < BOARD_WIDTH) return { x: distance, y: 0, face: 1 };
  distance -= BOARD_WIDTH;
  if (distance < BOARD_HEIGHT) return { x: BOARD_WIDTH, y: distance, face: 1 };
  distance -= BOARD_HEIGHT;
  if (distance < BOARD_WIDTH) return { x: BOARD_WIDTH - distance, y: BOARD_HEIGHT, face: -1 };
  return { x: 0, y: BOARD_HEIGHT - (distance - BOARD_WIDTH), face: -1 };
}

export function distanceSquared(a, b) {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

// Portrait rotates the same board; it never reorders slots or changes combat.
export function projectPoint(point, road, portrait) {
  const x = point.x / BOARD_WIDTH, y = point.y / BOARD_HEIGHT;
  return { x: road.left + (portrait ? 1 - y : x) * (road.right - road.left),
    y: road.top + (portrait ? x : y) * (road.bottom - road.top) };
}
