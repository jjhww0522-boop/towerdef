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
function rows(xs, ys) {
  const points = [];
  for (const y of ys) for (const x of xs) points.push({ x, y });
  return points;
}
function quadrants() {
  const points = [];
  for (const sy of [-1, 1]) for (const sx of [-1, 1]) {
    for (const pair of [[90, 90], [90, 210], [90, 330], [210, 90], [210, 210], [330, 90]]) {
      points.push({ x: 360 + sx * pair[0], y: 360 + sy * pair[1] });
    }
  }
  return points;
}
function route(vertices, closed = false) {
  const points = vertices.map(point => ({ x: point[0], y: point[1] }));
  let length = 0;
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const from = points[i], to = points[(i + 1) % points.length];
    length += Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
  }
  return { points, closed, length };
}
function openLayout(routes, slots, facility) {
  return { width: 720, height: 720, rotateInPortrait: false, routes, slots, facility };
}

// Slot indices are permanent within a stage, including while a robot is dispatched.
// Stage 1 keeps the original 30 coordinates and rectangular loop exactly.
const layouts = {
  1: { width: BOARD_WIDTH, height: BOARD_HEIGHT, rotateInPortrait: true,
    routes: [route([[0, 0], [720, 0], [720, 246], [0, 246]], true)],
    slots: grid(10, 3, 98, 79, 60, 61), facility: null },
  2: openLayout([route([[360, 0], [360, 630]])],
    rows([150, 270, 450, 570], [0, 100, 200, 300, 400, 500, 600]),
    { x: 360, y: 695 }),
  3: openLayout([route([[0, 360], [630, 360]])],
    rows([0, 120, 240, 360, 480, 600, 720], [150, 270, 450, 570])
      .filter(point => !((point.y === 150 || point.y === 570) && point.x === 360)),
    { x: 695, y: 360 }),
  4: openLayout([route([[0, 360], [270, 360]]), route([[720, 360], [450, 360]])],
    [...rows([60, 180, 300, 420, 540, 660], [150, 570]),
      ...[60, 180, 420, 540, 660].map(x => ({ x, y: 270 })),
      ...[60, 180, 300, 540, 660].map(x => ({ x, y: 450 }))],
    { x: 360, y: 360 }),
  5: openLayout([route([[0, 360], [270, 360]]), route([[720, 360], [450, 360]]),
    route([[360, 0], [360, 270]]), route([[360, 720], [360, 450]])],
    quadrants(),
    { x: 360, y: 360 })
};

export function getBattlefieldLayout(battlefieldId = 1) { return layouts[battlefieldId] || layouts[1]; }

export function unitPoint(index, battlefieldId = 1) {
  return getBattlefieldLayout(battlefieldId).slots[index];
}

export function enemyPoint(progress, battlefieldId = 1, routeIndex = 0) {
  const layout = getBattlefieldLayout(battlefieldId);
  const route = layout.routes[routeIndex] || layout.routes[0];
  const { points, length, closed } = route;
  let distance = (closed ? ((progress % 1 + 1) % 1) : Math.max(0, Math.min(1, progress))) * length;
  const segments = points.length - (closed ? 0 : 1);
  for (let i = 0; i < segments; i++) {
    const from = points[i], to = points[(i + 1) % points.length];
    const segment = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
    if (distance < segment || i === segments - 1) {
      const ratio = distance / segment;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio,
        face: to.x > from.x ? 1 : to.x < from.x ? -1 : from.x >= layout.width / 2 ? 1 : -1 };
    }
    distance -= segment;
  }
}

export function distanceSquared(a, b) {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

// Only the legacy loop rotates in portrait. Open maps keep their ingress direction.
export function projectPoint(point, road, portrait, battlefieldId = 1) {
  const layout = getBattlefieldLayout(battlefieldId), rotate = portrait && layout.rotateInPortrait;
  const x = point.x / layout.width, y = point.y / layout.height;
  return { x: road.left + (rotate ? 1 - y : x) * (road.right - road.left),
    y: road.top + (rotate ? x : y) * (road.bottom - road.top) };
}
