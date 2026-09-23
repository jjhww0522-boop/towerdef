// Combat coordinates are independent of screen size and orientation.
export const BOARD_WIDTH = 420;
export const BOARD_HEIGHT = 220;
export const SLOT_COUNT = 10;

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
    for (const pair of [[120, 120], [120, 360], [120, 600], [360, 120], [600, 120]]) {
      points.push({ x: 720 + sx * pair[0], y: 720 + sy * pair[1] });
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
function openLayout(width, height, routes, slots, facility) {
  return { width, height, rotateInPortrait: false, routes, slots, facility };
}

// Slot indices are permanent within a stage, including while a robot is dispatched.
// The introductory loop starts compact; later maps expand area and total route length.
const layouts = {
  0: { width: 420, height: 220, rotateInPortrait: true,
    routes: [route([[0, 0], [420, 0], [420, 220], [0, 220]], true)],
    slots: [{ x: 80, y: 90 }, { x: 210, y: 140 }, { x: 340, y: 90 }], facility: null },
  1: { width: BOARD_WIDTH, height: BOARD_HEIGHT, rotateInPortrait: true,
    routes: [route([[0, 0], [420, 0], [420, 220], [0, 220]], true)],
    slots: grid(5, 2, 50, 65, 80, 90), facility: null },
  2: openLayout(600, 1440, [route([[300, 0], [300, 1360]])],
    rows([180, 420], [120, 360, 600, 840, 1080, 1320]),
    { x: 300, y: 1420 }),
  3: openLayout(1640, 800, [route([[0, 400], [1550, 400]])],
    rows([90, 330, 570, 810, 1050, 1290, 1530], [280, 520]),
    { x: 1620, y: 400 }),
  4: openLayout(1920, 880, [route([[0, 440], [870, 440]]), route([[1920, 440], [1050, 440]])],
    rows([120, 360, 600, 840, 1080, 1320, 1560, 1800], [320, 560]),
    { x: 960, y: 440 }),
  5: openLayout(1440, 1440, [route([[0, 720], [630, 720]]), route([[1440, 720], [810, 720]]),
    route([[720, 0], [720, 630]]), route([[720, 1440], [720, 810]])],
    quadrants(), { x: 720, y: 720 })
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

// Only the introductory loop rotates in portrait. Open maps keep their ingress direction.
export function projectPoint(point, road, portrait, battlefieldId = 1) {
  const layout = getBattlefieldLayout(battlefieldId), rotate = portrait && layout.rotateInPortrait;
  const x = point.x / layout.width, y = point.y / layout.height;
  return { x: road.left + (rotate ? 1 - y : x) * (road.right - road.left),
    y: road.top + (rotate ? x : y) * (road.bottom - road.top) };
}
