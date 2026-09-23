// Combat coordinates are independent of screen size and orientation.
export const BOARD_WIDTH = 720;
export const BOARD_HEIGHT = 246;
export const SLOT_COUNT = 30;

function grid(columns, rows, x, y, stepX, stepY) {
  const points = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    points.push({ x: x + column * stepX, y: y + row * stepY });
  }
  return points;
}
function layout(vertices, slots) {
  const route = vertices.map(point => ({ x: point[0], y: point[1] }));
  const length = route.reduce((sum, from, i) => {
    const to = route[(i + 1) % route.length];
    return sum + Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  }, 0);
  return { route, slots, length };
}

// Slot indices are permanent within a stage, including while a robot is dispatched.
// Stage 1 keeps the original 30 coordinates and rectangular loop exactly.
const layouts = {
  1: layout([[0, 0], [720, 0], [720, 246], [0, 246]], grid(10, 3, 98, 79, 60, 61)),
  2: layout([[0, 0], [720, 0], [720, 246], [280, 246], [280, 196], [0, 196]],
    [...grid(10, 2, 60, 48, 65, 53), ...grid(8, 1, 70, 154, 85, 0)]),
  3: layout([[0, 0], [720, 0], [720, 84], [620, 84], [620, 162], [720, 162], [720, 246], [0, 246]],
    [...grid(9, 2, 60, 55, 60, 70), ...grid(8, 1, 60, 195, 70, 0)]),
  4: layout([[0, 0], [720, 0], [720, 96], [360, 96], [360, 164], [720, 164], [720, 246], [0, 246]],
    [...grid(8, 1, 55, 48, 85, 0), ...grid(6, 1, 50, 126, 54, 0), ...grid(8, 1, 55, 206, 85, 0)]),
  5: layout([[0, 0], [280, 0], [280, 72], [440, 72], [440, 0], [720, 0], [720, 246], [0, 246]],
    grid(8, 3, 55, 110, 85, 52))
};

export function getBattlefieldLayout(battlefieldId = 1) { return layouts[battlefieldId] || layouts[1]; }

export function unitPoint(index, battlefieldId = 1) {
  return getBattlefieldLayout(battlefieldId).slots[index];
}

export function enemyPoint(progress, battlefieldId = 1) {
  const { route, length } = getBattlefieldLayout(battlefieldId);
  let distance = ((progress % 1 + 1) % 1) * length;
  for (let i = 0; i < route.length; i++) {
    const from = route[i], to = route[(i + 1) % route.length];
    const segment = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (distance < segment || i === route.length - 1) {
      const ratio = distance / segment;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio,
        face: to.x > from.x ? 1 : to.x < from.x ? -1 : from.x >= BOARD_WIDTH / 2 ? 1 : -1 };
    }
    distance -= segment;
  }
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
