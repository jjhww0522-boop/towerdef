// Original scrap robots: the battlefield and roster use the same vector artwork.
// Element color is shared by bodies, weapons, portraits, the hangar and combat UI.
const robotElements = Object.freeze({
  fire: Object.freeze({ main: '#f58971', dark: '#b96460', light: '#ffd8bd', glow: '#fff0b2', accent: '#eb765b' }),
  water: Object.freeze({ main: '#6eaff5', dark: '#4e7fb4', light: '#cee7ff', glow: '#e8f8ff', accent: '#5b9de6' }),
  frost: Object.freeze({ main: '#70d3de', dark: '#4c99ab', light: '#cef5f4', glow: '#e6fff7', accent: '#5cc6d9' }),
  wind: Object.freeze({ main: '#73d2a2', dark: '#4a9b80', light: '#d5f2cd', glow: '#e9ffe4', accent: '#60bd95' }),
  laser: Object.freeze({ main: '#b69ce5', dark: '#8371ae', light: '#eddefb', glow: '#f7eaff', accent: '#a185d5' }),
  electric: Object.freeze({ main: '#f5d475', dark: '#b49a55', light: '#fff0bd', glow: '#fffbdc', accent: '#e4c165' })
});
const neutralRobot = Object.freeze({ main: '#72848d', dark: '#3d4e58', light: '#a8b5ba', glow: '#e2e9dd', accent: '#b7c8ce' });
const metal = { main: '#a8b5ba', light: '#d6ddd7', dark: '#596971' };
export function elementPalette(element) { return Object.hasOwn(robotElements, element) ? robotElements[element] : neutralRobot; }
const outline = '#35445b';
const cache = new Map();
const svgPath = (d, fill = 'none', extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const rect = (x, y, width, height, radius, fill, extra = '') => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" ${extra}/>`;
const ellipse = (x, y, rx, ry, fill, extra = '') => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const circle = (x, y, radius, fill, extra = '') => ellipse(x, y, radius, radius, fill, extra);
const svg = (shapes, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">${defs}<g stroke="${outline}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${shapes}</g></svg>`;

export function applianceKind(definition) {
  if (definition.id === 'guardian_s') return 'guardian';
  const family = /^(fire|water|frost|wind|electric|laser)_([1-4])$/.exec(definition.id);
  if (family) return ({ fire: ['lighter', 'range', 'flamethrower', 'incinerator'],
    water: ['watergun', 'hose', 'washer', 'firetruck'], frost: ['fridge', 'icemaker', 'freezer', 'coldstore'],
    wind: ['handfan', 'standfan', 'blower', 'jet'], electric: ['battery', 'swatter', 'transformer', 'powerplant'],
    laser: ['pointer', 'engraver', 'cutter', 'lasercannon'] })[family[1]][Number(family[2]) - 1];
  if (definition.rarity !== 'basic') return null;
  return definition.id === 'wu_archer' ? 'lighter' : definition.id === 'shu_archer' ? 'dryer' : definition.id === 'wei_archer' ? 'pointer' : null;
}

// Round appliance bodies and readable faces are original code-authored vector paths.
function applianceSvg(kind, pose, p) {
  const ready = pose === 'windup', firing = pose === 'strike', recovering = pose === 'recovery';
  const cream = '#fff8e8', blush = '#f4a69d';
  const line = (d, color = outline, width = 2.4) => svgPath(d, 'none', `stroke="${color}" stroke-width="${width}"`);
  const shine = d => line(d, '#fffdf4', 2.5);
  const face = (x, y, width = 32, height = 22) => {
    const left = x - width * .21, right = x + width * .21;
    let s = ellipse(x, y, width / 2, height / 2, cream, 'stroke="none"');
    s += ellipse(x - width * .36, y + 3, 3.2, 2, blush, 'stroke="none"') + ellipse(x + width * .36, y + 3, 3.2, 2, blush, 'stroke="none"');
    if (firing) s += line(`M${left - 2.5} ${y - 1} Q${left} ${y - 5} ${left + 2.5} ${y - 1}`) + line(`M${right - 2.5} ${y - 1} Q${right} ${y - 5} ${right + 2.5} ${y - 1}`);
    else {
      s += ellipse(left, y - 2, 2.7, ready ? 3 : 3.7, outline, 'stroke="none"') + ellipse(right, y - 2, 2.7, ready ? 3 : 3.7, outline, 'stroke="none"');
      s += circle(left - .7, y - 3.5, .9, '#ffffff', 'stroke="none"') + circle(right - .7, y - 3.5, .9, '#ffffff', 'stroke="none"');
    }
    return s + (ready ? ellipse(x, y + 4, 2.1, 2.5, outline, 'stroke="none"') : line(`M${x - 3} ${y + 3} Q${x} ${y + 7} ${x + 3} ${y + 3}`, outline, 1.7));
  };
  const nozzle = (x, y, width = 17, height = 14) => rect(x, y, width, height, 5, p.light) + ellipse(x + width, y + height / 2, 3.5, height / 2, p.dark) + ellipse(x + width + .6, y + height / 2, 1.7, firing ? height * .32 : height * .18, firing ? p.glow : p.accent, 'stroke="none"');
  const wheel = (x, y, radius = 7) => circle(x, y, radius, outline) + circle(x, y, radius * .49, cream, 'stroke="none"');
  const fan = (x, y, radius, friendly = false) => {
    let s = circle(x, y, radius, p.main) + circle(x, y, radius - 4, p.light);
    for (const angle of [0, 120, 240]) s += `<g transform="rotate(${angle + (firing ? 65 : ready ? -14 : recovering ? 24 : 0)} ${x} ${y})">` + svgPath(`M${x} ${y} Q${x - radius + 2} ${y - 5} ${x - 8} ${y - radius + 6} Q${x + 4} ${y - radius + 1} ${x + 4} ${y - 4} Z`, p.dark, 'stroke="none"') + '</g>';
    return s + (friendly ? face(x, y + 4, 28, 19) + (firing ? line(`M${x - radius + 4} ${y - 3} Q${x - radius + 4} ${y - radius + 4} ${x - 3} ${y - radius + 4}`, p.glow, 2.5) : '') : circle(x, y, 4, p.glow));
  };
  const snow = (x, y, radius = 5) => line(`M${x} ${y - radius} V${y + radius} M${x - radius} ${y - radius / 2} L${x + radius} ${y + radius / 2} M${x - radius} ${y + radius / 2} L${x + radius} ${y - radius / 2}`, p.glow, 2.2);
  const feet = rect(24, 77, 18, 10, 5, p.dark) + rect(56, 77, 18, 10, 5, p.dark) + shine('M29 80 H35 M61 80 H67');
  let body = feet;
  if (kind === 'lighter') {
    body += rect(25, 31, 46, 48, 15, p.main) + shine('M30 45 Q30 36 37 36');
    body += rect(30, 25, 34, 12, 4, cream) + circle(61, 28, 5, p.dark);
    body += (firing || recovering ? `<g transform="rotate(${firing ? -14 : -4} 24 35)">` + rect(7, 19, 20, 28, 7, p.main) + shine('M12 26 V35') : `<g transform="rotate(${ready ? -25 : -6} 27 35)">` + rect(27, 14, 44, 23, 8, p.main) + shine('M34 19 H57')) + '</g>' + circle(28, 35, 3, p.dark);
    body += face(48, 54, 35, 25) + rect(37, 71, 22, 4, 2, p.light, 'stroke="none"');
    if (firing) body += svgPath('M45 27 Q38 20 45 11 Q45 17 50 15 Q59 24 51 29 Z', p.glow, `stroke="${p.dark}" stroke-width="1.6"`);
  } else if (kind === 'range') {
    body += rect(18, 28, 60, 52, 14, p.main) + ellipse(48, 29, 29, 10, p.light);
    for (const x of [34, 62]) body += ellipse(x, 27, 9, 4.5, p.dark) + ellipse(x, 27, firing ? 6.5 : 3, 2, p.glow, 'stroke="none"');
    body += face(48, 47, 37, 24) + rect(28, 62, 40, 12, 5, p.dark) + rect(34, 66, 28, 4, 2, p.light, 'stroke="none"') + shine('M23 42 V56');
  } else if (kind === 'flamethrower') {
    body += rect(12, 29, 20, 47, 10, p.dark) + rect(16, 22, 12, 10, 4, p.light);
    body += line('M22 54 Q7 73 30 73', p.light, 5) + rect(27, 32, 41, 47, 16, p.main);
    body += rect(61, 50, 14, 22, 6, p.dark) + nozzle(68, 53, 17, 16) + face(47, 50, 34, 25) + shine('M34 38 H47');
    body += circle(47, 71, 4, p.glow, 'stroke="none"');
  } else if (kind === 'incinerator') {
    body += rect(23, 10, 15, 25, 6, p.dark) + rect(19, 10, 23, 8, 4, p.light);
    body += rect(16, 27, 65, 53, 15, p.main) + face(48, 44, 40, 25);
    body += rect(27, 58, 43, 19, 8, p.dark) + svgPath('M37 72 Q32 66 42 60 L46 67 L54 59 Q67 69 59 73 Z', p.glow, 'stroke="none"') + shine('M23 36 V48');
  } else if (kind === 'watergun') {
    body += line('M61 59 L64 79', p.dark, 5);
    body += rect(30, 56, 22, 23, 8, p.dark) + rect(17, 31, 54, 33, 16, p.main);
    body += rect(26, 21, 34, 15, 7, p.light) + nozzle(69, 38, 16, 15);
    body += face(43, 49, 36, 23) + shine('M25 37 H35') + circle(68, 60, 3, p.glow, 'stroke="none"');
  } else if (kind === 'hose') {
    body += rect(20, 28, 48, 51, 15, p.main) + face(43, 44, 36, 24);
    body += circle(43, 65, 13, p.dark) + circle(43, 65, 8, p.light) + circle(43, 65, 3, p.dark, 'stroke="none"');
    body += line('M56 71 Q80 82 76 44', p.main, 5) + nozzle(67, 30, 17, 11) + shine('M25 35 L31 32');
  } else if (kind === 'washer') {
    body += line('M27 31 V17 Q42 10 55 17 V30', p.dark, 6);
    body += rect(19, 26, 46, 53, 17, p.main) + face(42, 44, 35, 25);
    body += rect(29, 61, 25, 9, 4, p.dark) + wheel(25, 79, 8) + wheel(59, 79, 8);
    body += line('M58 65 Q79 79 77 41', p.dark, 4) + nozzle(67, 26, 18, 10) + shine('M26 33 L33 30');
  } else if (kind === 'firetruck') {
    body = rect(9, 39, 53, 36, 10, p.main) + rect(58, 29, 29, 46, 11, p.main);
    body += face(72, 53, 25, 23) + rect(14, 48, 38, 20, 7, p.light) + circle(32, 58, 8, p.dark) + circle(32, 58, 4, p.light, 'stroke="none"');
    body += wheel(26, 78, 9) + wheel(73, 78, 9) + rect(23, 27, 35, 7, 3, cream) + line('M31 26 V20 H55', p.dark, 5) + nozzle(55, 15, 18, 10);
    body += rect(67, 24, 11, 6, 3, p.glow) + shine('M64 34 H76');
  } else if (kind === 'fridge') {
    body += rect(24, 15, 48, 66, 15, p.main) + face(48, 40, 36, 25);
    body += line('M27 55 H69', p.dark, 2) + rect(61, 28, 4, 16, 2, cream, 'stroke="none"') + rect(61, 62, 4, 11, 2, cream, 'stroke="none"');
    body += snow(43, 68, 6) + shine('M30 30 Q30 21 39 21');
  } else if (kind === 'icemaker') {
    body += rect(22, 24, 51, 57, 15, p.main) + rect(25, 16, 45, 13, 6, p.light) + face(48, 44, 36, 24);
    body += rect(30, 59, 36, 18, 7, p.dark);
    for (const [x, y, angle] of [[35, 64, -10], [47, 66, 12], [54, 61, -7]]) body += `<g transform="rotate(${angle} ${x + 3} ${y + 3})">` + rect(x, y, 8, 8, 2, p.glow, 'stroke-width="1.2"') + '</g>';
    body += shine('M29 32 H40');
  } else if (kind === 'freezer') {
    body += rect(12, 27, 72, 53, 15, p.main) + rect(13, 20, 70, 12, 6, p.light);
    body += face(48, 45, 40, 25) + line('M48 60 V77', p.dark, 2) + rect(39, 61, 4, 11, 2, cream, 'stroke="none"') + rect(54, 61, 4, 11, 2, cream, 'stroke="none"');
    body += snow(25, 64) + snow(72, 64) + shine('M19 38 V48');
  } else if (kind === 'coldstore') {
    body += rect(13, 29, 65, 51, 13, p.main) + svgPath('M11 32 Q10 28 16 25 L42 11 Q46 9 51 12 L80 28 L78 33 Z', p.dark);
    body += face(42, 46, 39, 25) + rect(28, 61, 29, 19, 7, p.light) + snow(43, 71);
    body += rect(69, 35, 18, 30, 7, cream) + fan(78, 49, 6) + shine('M19 38 V45');
  } else if (kind === 'handfan' || kind === 'standfan') {
    body += kind === 'handfan' ? rect(35, 49, 26, 29, 11, p.main) + circle(48, 69, 3, p.glow) : rect(43, 45, 10, 28, 5, p.dark) + ellipse(48, 76, 26, 7, p.main);
    body += fan(48, kind === 'handfan' ? 33 : 31, kind === 'handfan' ? 25 : 27, true) + shine('M30 24 Q33 16 40 15');
  } else if (kind === 'blower') {
    body += rect(11, 26, 73, 51, 15, p.main) + rect(15, 73, 64, 8, 4, p.dark);
    body += fan(62, 48, 22) + face(30, 48, 26, 24) + line('M24 26 V19 H63 V26', p.dark, 5) + shine('M18 34 H27');
  } else if (kind === 'jet') {
    body += svgPath('M32 32 L47 16 Q50 13 54 17 L61 33 M33 68 L49 79 L64 65', p.light);
    body += rect(17, 30, 65, 41, 20, p.main) + ellipse(24, 50, 13, 22, p.dark) + fan(24, 50, 9);
    body += nozzle(70, 39, 15, 21) + face(50, 51, 32, 25) + shine('M39 35 H54');
  } else if (kind === 'battery') {
    body += rect(38, 11, 20, 13, 5, p.dark) + rect(26, 19, 44, 62, 17, p.main) + rect(28, 22, 40, 12, 7, p.light, 'stroke="none"');
    body += face(48, 47, 34, 26) + line('M48 65 V74 M43.5 69.5 H52.5', p.glow, 3.5) + shine('M32 36 V43');
  } else if (kind === 'swatter') {
    body += rect(33, 53, 30, 27, 10, p.main) + ellipse(48, 31, 25, 24, p.main) + ellipse(48, 31, 19, 18, p.light);
    for (const x of [39, 48, 57]) body += line(`M${x} 17 V44`, firing ? p.glow : p.dark, 1.5);
    for (const y of [24, 32, 40]) body += line(`M32 ${y} H64`, p.dark, 1.5);
    body += face(48, 65, 27, 21) + shine('M31 19 L36 14');
  } else if (kind === 'transformer') {
    body += rect(19, 30, 59, 49, 15, p.main);
    for (const x of [32, 64]) body += rect(x - 4, 11, 8, 24, 4, p.dark) + ellipse(x, 16, 9, 4, p.light) + ellipse(x, 25, 9, 4, p.light);
    body += rect(11, 42, 9, 29, 4, p.dark) + rect(77, 42, 9, 29, 4, p.dark) + face(48, 47, 38, 26);
    body += svgPath('M48 63 L40 70 H47 L45 77 L56 67 H49 L51 63 Z', p.glow, 'stroke="none"') + shine('M26 37 H36');
  } else if (kind === 'powerplant') {
    body += svgPath('M17 43 L21 15 Q27 11 36 15 L40 43 M58 39 L62 19 Q68 16 75 20 L79 43', p.dark);
    body += ellipse(28, 15, 9, 4, p.light) + ellipse(69, 20, 8, 3, p.light) + rect(11, 36, 74, 44, 15, p.main) + face(49, 52, 40, 25);
    body += rect(26, 66, 46, 9, 4, p.dark) + circle(34, 70, 2.5, p.glow, 'stroke="none"') + circle(48, 70, 2.5, p.glow, 'stroke="none"') + circle(63, 70, 2.5, p.glow, 'stroke="none"') + shine('M18 44 V50');
  } else if (kind === 'pointer' || kind === 'dryer') {
    body += line('M36 61 L33 79 M59 61 L64 79', p.dark, 5);
    body += rect(11, 31, 67, 31, 15, p.main) + ellipse(17, 46, 6, 14, p.dark) + rect(65, 30, 18, 34, 8, p.light) + ellipse(82, 47, 7, 15, p.dark);
    body += ellipse(84, 47, firing ? 4 : 3, firing ? 10 : 7, firing ? p.glow : p.accent, 'stroke="none"') + rect(36, 22, 22, 9, 4, p.dark);
    body += face(43, 48, 36, 25) + shine('M26 35 H38') + line('M21 32 Q18 18 32 20', p.light, 3);
  } else if (kind === 'engraver') {
    body += rect(15, 57, 67, 24, 11, p.main) + rect(18, 21, 9, 39, 4, p.dark) + rect(70, 21, 9, 39, 4, p.dark) + rect(18, 18, 61, 10, 5, p.light);
    body += rect(39, 26, 20, 19, 6, p.main) + line('M49 45 V56', firing ? p.glow : p.dark, firing ? 4 : 1.5) + face(48, 68, 38, 21) + shine('M26 22 H39');
  } else if (kind === 'cutter') {
    body += rect(13, 28, 72, 53, 15, p.main) + rect(20, 20, 58, 12, 6, p.light) + rect(22, 34, 53, 22, 8, p.dark);
    body += rect(31, 37, 23, 5, 2, cream, 'stroke="none"') + rect(43, 39, 11, 8, 3, p.main) + line('M49 47 V53', p.glow, firing ? 4 : 1.5);
    body += face(49, 66, 40, 23) + circle(78, 41, 3, p.glow, 'stroke="none"') + shine('M18 36 V46');
  } else if (kind === 'lasercannon') {
    body += rect(20, 67, 60, 15, 7, p.dark) + rect(30, 43, 39, 34, 13, p.main) + face(49, 61, 33, 23);
    body += rect(16, 22, 56, 29, 13, p.main) + nozzle(66, 23, 18, 27) + rect(33, 14, 23, 8, 4, p.light) + shine('M24 28 H43');
  } else if (kind === 'guardian') {
    body += svgPath('M26 38 Q12 24 10 42 L14 65 Q18 73 29 67 M69 38 Q83 24 87 42 L83 65 Q78 73 67 67', p.dark);
    body += rect(23, 38, 52, 42, 17, p.main) + rect(24, 19, 49, 36, 16, p.light) + face(49, 37, 40, 26);
    body += svgPath('M37 19 L33 10 L45 14 L49 7 L55 15 L65 11 L61 20 Z', '#f5d475');
    body += circle(49, 64, 11, p.dark) + svgPath('M49 55 L52 61 L59 62 L54 67 L55 74 L49 70 L43 74 L44 67 L39 62 L46 61 Z', p.glow, 'stroke="none"');
    for (const [index, element] of ['fire', 'water', 'frost', 'wind', 'electric', 'laser'].entries()) body += circle(24 + index * 10, 78, 3, elementPalette(element).main, 'stroke-width="1.3"');
    body += shine('M17 43 V53');
  }
  const transform = ready ? 'translate(48 86) rotate(-3) scale(1.045 .95) translate(-48 -86)' : firing ? 'translate(46 86) rotate(2) scale(.97 1.025) translate(-48 -86)' : recovering ? 'translate(48.5 86) scale(1.015 .99) translate(-48 -86)' : '';
  return svg(ellipse(48, 89, 29, 3, '#14233925', 'stroke="none"') + `<g transform="${transform}">${body}</g>`);
}

function robotSvg(definition, pose) {
  const appliance = applianceKind(definition);
  const palette = elementPalette(definition.element);
  if (appliance) return applianceSvg(appliance, pose, palette);
  const tier = { basic: 0, elite: 1, hero: 2, legend: 3 }[definition.rarity] || 0;
  const tracked = definition.troop === 'cavalry';
  const turret = definition.troop === 'archer';
  const computing = definition.trait === 'strategy';
  const commanding = definition.trait === 'command';
  const pattern = definition.attackPattern || 'bolt';
  const strike = pose === 'strike', windup = pose === 'windup';
  const armAngle = windup ? -6 : strike ? -12 : 0;
  let shapes = ellipse(47, 88, 29, 4, '#06141c55', 'stroke="none"');

  // Higher tiers visibly assemble extra machinery around the original chassis.
  if (tier >= 2) {
    shapes += rect(20, 31, 55, 37, 9, palette.dark);
    shapes += rect(9, 23, 17, 34, 5, metal.main) + rect(70, 23, 17, 34, 5, metal.main);
    shapes += rect(11, 47, 13, 11, 3, palette.dark) + rect(72, 47, 13, 11, 3, palette.dark);
    shapes += svgPath('M16 33 L21 33 M16 39 L21 39 M75 33 L80 33 M75 39 L80 39', 'none', 'stroke-width="2"');
    shapes += svgPath('M18 57 L18 65 M78 57 L78 65', 'none', `stroke="${palette.glow}" stroke-width="5"`);
  }
  if (tier === 3) {
    shapes += svgPath('M22 27 L3 12 L4 42 L21 53 Z M73 27 L93 12 L92 42 L74 53 Z', palette.dark);
    shapes += svgPath('M8 21 L19 29 L18 42 L9 36 Z M87 21 L77 29 L78 42 L87 36 Z', palette.main);
    shapes += svgPath('M10 25 L10 34 M15 29 L15 38 M82 28 L82 38 M87 24 L87 34', 'none', `stroke="${palette.glow}" stroke-width="2"`);
    shapes += svgPath('M13 59 L7 70 L11 79 L23 74 M82 59 L89 70 L84 79 L73 74', metal.main);
    shapes += svgPath('M38 19 L38 10 L57 10 L57 19', metal.main);
    shapes += svgPath('M32 17 L30 7 L39 12 L48 4 L56 12 L66 7 L63 18 Z', palette.dark);
    shapes += circle(47.5, 12, 4, palette.glow);
  }

  if (tracked) {
    shapes += rect(17, 70, 61, 17, 8, palette.dark);
    for (let x = 26; x < 75; x += 12) shapes += circle(x, 79, 4.6, '#d0dbe0') + circle(x, 79, 1.3, outline, 'stroke="none"');
    shapes += svgPath('M23 72 L71 72 M23 86 L71 86', 'none', 'stroke="#eef4e2" stroke-width="1.5"');
  } else if (turret) {
    shapes += svgPath('M36 68 L28 80 L19 80 L19 86 L38 86 L43 73 M57 68 L65 80 L75 80 L75 86 L55 86 L50 73', palette.dark);
    shapes += rect(36, 65, 24, 12, 5, metal.main);
  } else {
    shapes += svgPath('M34 68 L32 81 M58 68 L61 81', 'none', `stroke="${palette.dark}" stroke-width="9"`);
    shapes += rect(22, 79, 19, 9, 4, metal.main) + rect(53, 79, 19, 9, 4, metal.main);
  }

  // Preserve each chassis silhouette while its color follows the attack element.
  if (definition.faction === 'shu') {
    if (tracked) {
      shapes += svgPath('M25 67 L25 47 Q25 24 47 24 Q69 24 69 47 L69 67 Z', palette.main);
      shapes += ellipse(47, 65, 22, 8, palette.light);
      shapes += svgPath('M31 29 L31 21 L48 21', 'none', `stroke="${palette.dark}" stroke-width="5"`);
    } else {
      shapes += rect(27, 25, 42, 46, 10, palette.main);
      shapes += ellipse(48, 26, 21, 6, metal.main);
      shapes += ellipse(48, 25, 6, 2.5, palette.dark, 'stroke-width="1.4"');
      shapes += svgPath('M28 62 Q47 70 68 62', 'none', `stroke="${palette.dark}" stroke-width="2"`);
    }
  } else if (definition.faction === 'wei') {
    if (turret) {
      shapes += svgPath('M30 37 L26 28 L31 17 L43 24 M65 37 L72 29 L68 19 L57 25', palette.light);
      shapes += circle(48, 44, 25, palette.main);
      shapes += rect(29, 59, 39, 13, 5, palette.dark);
    } else {
      shapes += rect(23, tracked ? 33 : 25, 49, tracked ? 39 : 46, 8, palette.main);
      shapes += rect(29, tracked ? 26 : 20, 37, 8, 3, metal.main);
      shapes += svgPath('M61 61 L66 61 M61 65 L66 65', 'none', 'stroke-width="1.5"');
    }
  } else {
    if (turret) {
      shapes += svgPath('M31 35 L31 24 L60 24 L60 35 M31 35 Q20 43 27 65 Q46 77 67 64 L67 42 L82 36 L78 49 L68 53', palette.main);
      shapes += ellipse(46, 25, 16, 4, metal.main);
      shapes += svgPath('M28 38 Q14 35 15 48 Q15 60 27 58', 'none', `stroke="${palette.dark}" stroke-width="5"`);
    } else if (tracked) {
      shapes += rect(28, 30, 41, 42, 7, palette.main);
      shapes += rect(39, 23, 19, 8, 3, palette.dark);
      shapes += svgPath('M29 59 L68 59', 'none', `stroke="${palette.dark}" stroke-width="3"`);
    } else {
      shapes += rect(23, 29, 49, 41, 10, palette.main);
      shapes += rect(31, 24, 32, 7, 3, palette.dark);
      shapes += svgPath('M31 20 L37 24 L43 19 L49 24 L55 19 L61 24', 'none', `stroke="${palette.light}" stroke-width="4"`);
      shapes += rect(72, 45, 6, 13, 2, palette.light);
    }
  }

  // Every chassis fires a visible tool: no remote fist or melee slash animation.
  if (!turret) {
    shapes += `<g transform="rotate(${-armAngle * .6} 28 49)">`;
    shapes += svgPath('M27 49 L19 57 L20 65', 'none', `stroke="${palette.dark}" stroke-width="7"`);
    shapes += svgPath('M15 63 L13 69 L18 74 M25 63 L28 69 L23 74', 'none', `stroke="${palette.light}" stroke-width="4"`) + '</g>';
    shapes += svgPath('M67 50 L74 58 L79 54', 'none', `stroke="${palette.dark}" stroke-width="7"`);
  }
  const recoil = windup ? 1.5 : strike ? -4 : 0;
  shapes += `<g transform="translate(${recoil} 0)">`;
  if (pattern === 'arc') {
    shapes += rect(66, 45, 15, 15, 4, palette.dark);
    shapes += svgPath('M80 45 L89 41 L90 47 M80 59 L89 63 L90 56', 'none', `stroke="${palette.light}" stroke-width="4"`);
    shapes += circle(81, 52, windup ? 6 : 4.5, palette.glow);
    shapes += svgPath('M74 47 L74 57 M69 49 L69 55', 'none', `stroke="${palette.main}" stroke-width="2"`);
    if (strike) shapes += svgPath('M89 43 L86 49 L93 51 L88 58', 'none', 'stroke="#e9ffff" stroke-width="2"');
  } else if (pattern === 'blast') {
    shapes += rect(62, 43, 25, 20, 5, palette.dark);
    shapes += rect(68, 43, 12, 20, 3, palette.main);
    shapes += rect(82, 42, 10, 22, 3, metal.main);
    shapes += ellipse(89, 53, 4, 7, '#263847');
    shapes += ellipse(90, 53, 2, windup ? 5 : 3, windup || strike ? palette.glow : palette.accent, 'stroke="none"');
    shapes += svgPath('M65 47 L65 58 M74 46 L74 60', 'none', 'stroke="#f8edc9" stroke-width="1.5"');
  } else {
    shapes += rect(63, 46, 25, 12, 4, palette.dark);
    shapes += rect(70, 46, 13, 9, 2, palette.main);
    shapes += rect(83, 45, 9, 15, 3, metal.main);
    shapes += ellipse(89, 52.5, 2.5, 4, windup || strike ? palette.glow : palette.dark);
    shapes += svgPath('M67 49 L79 49', 'none', 'stroke="#ffffff" stroke-opacity=".7" stroke-width="1.3"');
  }
  shapes += '</g>';

  const faceY = definition.faction === 'wei' && turret ? 39 : 36;
  shapes += rect(31, faceY, 33, 17, 6, '#294a54');
  if (computing) {
    shapes += circle(42, faceY + 8, 7, palette.light) + circle(42, faceY + 8, 3.8, palette.dark);
    shapes += circle(41, faceY + 6, 1.5, '#ffffff', 'stroke="none"');
    shapes += rect(55, faceY + 5, 3, 6, 1.5, palette.glow, 'stroke="none"');
  } else {
    shapes += rect(38, faceY + 5, 4, strike ? 4 : 7, 2, palette.light, 'stroke="none"');
    shapes += rect(53, faceY + 5, 4, strike ? 4 : 7, 2, palette.light, 'stroke="none"');
  }
  shapes += svgPath(`M44 ${faceY + 12} Q48 ${faceY + 15} 51 ${faceY + 12}`, 'none', `stroke="${palette.light}" stroke-width="1.3"`);
  shapes += circle(31, 58, 1.2, palette.light, 'stroke="none"') + circle(65, 58, 1.2, palette.light, 'stroke="none"');
  shapes += svgPath('M29 34 L29 55 M32 32 L39 32', 'none', 'stroke="#ffffff" stroke-opacity=".42" stroke-width="1.8"');
  shapes += svgPath('M58 69 L65 66 L66 57', 'none', `stroke="${palette.dark}" stroke-width="2.8"`);
  shapes += rect(29, 61, 6, 3, 1, '#e2c081', 'stroke-width=".8"');

  if (commanding) {
    shapes += svgPath('M58 23 L62 13 M62 13 L70 10', 'none', `stroke="${palette.dark}" stroke-width="3"`);
    shapes += circle(70, 10, 3.5, palette.glow);
    shapes += svgPath('M39 60 L45 55 L51 60 L45 65 Z', palette.glow, 'stroke-width="1.5"');
  } else if (computing) {
    shapes += svgPath('M39 59 L44 59 L44 65 L53 65 M52 57 L57 57 L57 61', 'none', `stroke="${palette.light}" stroke-width="2"`);
    shapes += circle(39, 59, 1.5, palette.glow, 'stroke="none"');
  } else {
    shapes += svgPath('M48 54 L41 62 L47 62 L44 69 L55 59 L49 59 L52 54 Z', palette.glow, 'stroke-width="1.2"');
  }

  if (tier >= 1) {
    shapes += rect(19, 39, 8, 16, 3, metal.main);
    shapes += svgPath('M20 32 L20 22 L25 18 M19 23 L14 19', 'none', `stroke="${palette.dark}" stroke-width="3"`);
    shapes += rect(57, 20, 11, 7, 2, palette.glow);
  }
  if (tier >= 2) {
    shapes += circle(47, 66, tier === 3 ? 10 : 8, palette.dark);
    shapes += circle(47, 66, tier === 3 ? 6.5 : 4.5, palette.glow);
    shapes += svgPath('M45 63 L49 63 L46 68', 'none', 'stroke="#ffffff" stroke-width="1.5"');
  }
  if (tier === 3) {
    shapes += circle(11, 13, 3, palette.glow) + circle(84, 13, 3, palette.glow);
    shapes += svgPath('M34 77 L47 84 L61 77', 'none', `stroke="${palette.glow}" stroke-width="3"`);
  }
  const defs = `<defs><linearGradient id="body" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="${palette.light}"/><stop offset=".38" stop-color="${palette.main}"/><stop offset="1" stop-color="${palette.dark}"/></linearGradient><linearGradient id="metal" x2=".5" y2="1"><stop stop-color="${metal.light}"/><stop offset=".45" stop-color="${metal.main}"/><stop offset="1" stop-color="${metal.dark}"/></linearGradient></defs>`;
  return svg(shapes.replaceAll(`fill="${palette.main}"`, 'fill="url(#body)"').replaceAll(`fill="${metal.main}"`, 'fill="url(#metal)"'), defs);
}

function scrapDroneSvg(kind, pose) {
  const frame = typeof pose === 'number' ? pose % 4 : 0, step = [0, 3, 0, -3][frame];
  const boss = kind === 2, ink = '#393449', cream = '#e5d7cc', shell = boss ? '#766079' : kind === 3 ? '#a47c83' : kind === 5 ? '#917486' : '#918497';
  const line = (d, color = ink, width = 2.5) => svgPath(d, 'none', `stroke="${color}" stroke-width="${width}"`);
  const wheels = (x, y, radius = 8) => circle(x, y, radius, ink) + circle(x, y, radius * .5, cream, 'stroke="none"');
  // Dark visors, inward-slanting eyes and uneven teeth distinguish hostile robots at small sizes.
  const face = (x, y, width = 31) => rect(x - width / 2 - 1, y - 12, width + 2, 27, 8, '#342b3e', 'stroke-width="1.5"') +
    svgPath(`M${x - 13} ${y - 7} L${x - 3} ${y - 3} L${x - 4} ${y + 1} L${x - 12} ${y - 1} Z M${x + 3} ${y - 3} L${x + 13} ${y - 8} L${x + 12} ${y - 1} L${x + 4} ${y + 1} Z`, boss ? '#ff8574' : '#ffc184', 'stroke="none"') +
    line(`M${x - 14} ${y - 10} L${x - 3} ${y - 6} M${x + 3} ${y - 6} L${x + 14} ${y - 11}`, shell, 3) +
    svgPath(`M${x - 10} ${y + 4} Q${x} ${y + 7} ${x + 11} ${y + 2} L${x + 8} ${y + 11} Q${x} ${y + 14} ${x - 9} ${y + 10} Z`, '#191b2a', 'stroke="none"') +
    svgPath(`M${x - 9} ${y + 5} L${x - 4} ${y + 6} L${x - 6} ${y + 10} Z M${x - 2} ${y + 6} L${x + 3} ${y + 5} L${x + 1} ${y + 9} Z M${x + 6} ${y + 4} L${x + 10} ${y + 3} L${x + 7} ${y + 9} Z`, cream, 'stroke="none"');
  let body = '';
  if (boss || kind === 4) {
    body += rect(14, 70, 69, 18, 9, ink);
    for (const x of [26, 48, 70]) body += wheels(x, 79, 6) + line(`M${x - 2} ${78 + step * .3} L${x + 2} ${80 - step * .3}`, ink, 1.3);
    body += rect(15, 25, 68, 49, 19, shell) + rect(24, 61, 49, 13, 6, '#897d99') + face(48, 47, 40);
    if (boss) {
      body += svgPath('M25 30 L18 12 L37 20 L47 6 L59 20 L78 10 L70 30 Z', '#bfa2ae');
      body += rect(5, 48, 16, 22, 5, '#9f7b8e') + rect(76, 48, 16, 22, 5, '#9f7b8e');
      body += svgPath('M7 49 L7 35 L20 49 Z M77 49 L88 34 L90 50 Z', cream) + line('M10 55 L16 61 M86 55 L80 61', '#f0b198', 2);
      body += svgPath('M33 65 L39 69 L33 72 Z M45 65 L51 69 L45 72 Z M57 65 L63 69 L57 72 Z', '#f0b198', 'stroke="none"');
    } else {
      body += rect(18, 28, 11, 35, 4, '#b3a0b5') + rect(69, 28, 11, 35, 4, '#b3a0b5') + line('M37 68 H59', cream, 2.5);
      body += svgPath('M17 33 L12 21 L27 29 Z M70 29 L85 20 L80 34 Z', cream) + line('M20 42 L26 47 M72 43 L78 48', ink, 2);
    }
    body += line('M33 32 H40', '#f6ece7', 2.5);
  } else if (kind === 3) {
    body += wheels(27, 78, 10) + wheels(72, 78, 8) + svgPath('M16 64 Q46 57 75 64 L80 71 Q79 76 71 75 H25 Q16 75 16 64 Z', '#a4859c');
    body += rect(29, 29, 42, 40, 17, shell) + svgPath('M30 33 L35 21 L48 17 L67 25 L73 31 Z', '#b8969d') + face(50, 47, 31);
    body += svgPath('M35 25 L24 14 L46 21 Z', cream) + line('M59 28 L66 31', ink, 2);
    body += line('M34 26 L26 20 M29 59 L21 65 M64 60 L74 54', ink, 4) + line('M69 54 L78 52', '#e4c7a9', 3);
    body += line(`M${23 - step} 76 L${31 + step} 80`, cream, 2);
  } else if (kind === 5) {
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) body += line(`M${48 + side * 14} ${47 + i * 10} Q${48 + side * 28} ${43 + i * 11} ${48 + side * (30 + (i % 2 ? step : -step))} ${56 + i * 11}`, '#978499', 4);
    body += ellipse(48, 53, 24, 27, shell) + svgPath('M48 28 Q37 30 35 40 L47 46 L61 39 Q57 29 48 28', '#b298ac', 'stroke="none"') + face(48, 53, 33);
    body += svgPath('M33 34 L27 18 L41 29 Z M56 29 L69 18 L64 35 Z', cream) + line('M43 74 H53', '#74677c', 2.5);
  } else {
    body += rect(24 + step, 76, 19, 11, 5, '#897d99') + rect(56 - step, 76, 19, 11, 5, '#897d99');
    body += line('M25 51 L18 63 M72 51 L79 63', '#897d99', 7) + circle(17, 64, 6, '#d7c6bf') + circle(79, 64, 6, '#d7c6bf');
    body += rect(23, 27, 51, 53, 19, shell) + ellipse(48, 29, 23, 8, '#b3a0b5') + face(48, 50, 36);
    body += line('M47 21 L43 16 L47 12', ink, 3) + circle(47, 11, 3, '#e7ac89') + rect(37, 68, 24, 7, 3, '#74677c') + line('M30 31 L36 36 M59 25 L64 29', ink, 2);
  }
  const bob = frame === 1 || frame === 3 ? -1 : 0;
  return svg(ellipse(48, 90, boss ? 33 : 27, 3, '#14233925', 'stroke="none"') + `<g transform="translate(0 ${bob})">${body}</g>`);
}

export function unitSpriteUrl(definition, pose = 'idle') {
  const key = [applianceKind(definition) || 'robot', definition.element || 'neutral', definition.faction, definition.troop, definition.trait, definition.rarity, definition.attackPattern || 'bolt', pose].join(':');
  if (!cache.has(key)) cache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(robotSvg(definition, pose)));
  return cache.get(key);
}

export function enemySpriteUrl(kind, pose = 0) {
  if (typeof kind === 'string') kind = ({ grunt: 0, runner: 3, plated: 4, siege: 4, swarm: 5, boss: 2 })[kind] ?? 0;
  const key = `enemy:${kind}:${pose}`;
  if (!cache.has(key)) cache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(scrapDroneSvg(kind, pose)));
  return cache.get(key);
}
