// Original scrap robots: the battlefield and roster use the same vector artwork.
const colors = {
  shu: { main: '#75c9ac', dark: '#33776b', light: '#dbf5ce', glow: '#f5e493' },
  wei: { main: '#83bde7', dark: '#446c95', light: '#dcf0ff', glow: '#bdf5ef' },
  wu: { main: '#f2ad75', dark: '#ab654e', light: '#ffebbd', glow: '#fff0a3' }
};
const outline = '#19313e';
const cache = new Map();
const svgPath = (d, fill = 'none', extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const rect = (x, y, width, height, radius, fill, extra = '') => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" ${extra}/>`;
const ellipse = (x, y, rx, ry, fill, extra = '') => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const circle = (x, y, radius, fill, extra = '') => ellipse(x, y, radius, radius, fill, extra);
const svg = (shapes, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">${defs}<g stroke="${outline}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${shapes}</g></svg>`;

export function applianceKind(definition) {
  if (definition.rarity !== 'basic') return null;
  return definition.id === 'wu_archer' ? 'lighter' : definition.id === 'shu_archer' ? 'dryer' : definition.id === 'wei_archer' ? 'pointer' : null;
}

function applianceSvg(kind, pose) {
  const ready = pose === 'windup', firing = pose === 'strike', recovering = pose === 'recovery';
  let shapes = ellipse(47, 88, 26, 3, '#06141c44', 'stroke="none"');
  if (kind === 'lighter') {
    shapes += svgPath('M37 70 L35 81 M59 70 L63 81', 'none', 'stroke="#596765" stroke-width="6"');
    shapes += rect(26, 80, 15, 7, 3, '#d5d1bb') + rect(59, 80, 15, 7, 3, '#d5d1bb');
    shapes += rect(29, 32, 39, 41, 7, '#e99a5e');
    shapes += svgPath('M32 39 L32 62 Q32 68 39 68', 'none', 'stroke="#ffd6a2" stroke-width="3"');
    shapes += rect(36, 23, 28, 13, 3, '#d5d1bb');
    for (const x of [42, 49, 56]) shapes += circle(x, 29, 1.6, '#48585b', 'stroke="none"');
    shapes += `<g transform="rotate(${firing || recovering ? -105 : ready ? -25 : 0} 30 35)">`;
    shapes += rect(29, 18, 39, 18, 4, '#ce704c') + svgPath('M33 22 L62 22', 'none', 'stroke="#f3b27b" stroke-width="2"') + '</g>';
    shapes += circle(30, 35, 3, '#d5d1bb');
    shapes += circle(60, 24, 5, '#7a8581') + svgPath(`M57 ${ready ? 20 : 23} L63 ${ready ? 26 : 23}`, 'none', 'stroke="#e8dfc8" stroke-width="1.5"');
    shapes += ellipse(42, 49, 3, firing ? 2.6 : 4, '#203a40', 'stroke="none"') + ellipse(55, 49, 3, 4, '#203a40', 'stroke="none"');
    shapes += svgPath('M43 58 Q48 61 53 58', 'none', 'stroke="#7e4b3c" stroke-width="1.8"');
    shapes += rect(49, 64, 13, 4, 1, '#e8d5a6', 'stroke-width="1"');
    if (firing) {
      shapes += svgPath('M54 22 Q48 14 56 7 Q54 14 61 12 Q68 21 59 25 Z', '#ffb65a', 'stroke="#a65d3e" stroke-width="1.5"');
      shapes += svgPath('M57 22 Q53 18 58 15 Q63 21 59 23 Z', '#fff0b0', 'stroke="none"');
    }
  } else if (kind === 'dryer') {
    const brace = firing ? 4 : 0;
    shapes += svgPath(`M35 71 L${27 - brace} 81 M51 69 L${59 + brace} 81`, 'none', 'stroke="#49695f" stroke-width="5"');
    shapes += rect(17 - brace, 80, 18, 7, 3, '#cee1b9') + rect(56 + brace, 80, 18, 7, 3, '#cee1b9');
    shapes += svgPath('M38 49 L54 48 L50 73 Q47 78 35 74 Z', '#6ea58a');
    shapes += rect(39, 57, 6, 10, 2, ready || firing ? '#e9bd71' : '#3c635a', 'stroke-width="1.4"');
    shapes += svgPath('M38 74 Q43 87 31 87 L22 85', 'none', 'stroke="#384e4d" stroke-width="2.5"');
    shapes += svgPath('M32 20 Q17 19 17 36 Q17 53 35 53 L68 49 L76 43 L76 30 L66 23 Z', '#91bd9d');
    shapes += svgPath('M32 24 Q51 22 63 27', 'none', 'stroke="#deebca" stroke-width="3"');
    shapes += svgPath('M68 27 L85 31 L85 44 L68 47 Z', '#d0ddc3');
    shapes += ellipse(84, 37.5, 4, 7, '#395952');
    shapes += circle(29, 36, 11, '#456b60') + circle(29, 36, 8, '#c1d5b1', 'stroke="none"');
    shapes += `<g transform="rotate(${firing ? 100 : ready ? 42 : 0} 29 36)">`;
    for (const angle of [0, 120, 240]) shapes += `<path d="M29 35 Q20 28 24 32 L29 36 Z" fill="#5e8f7c" stroke="#5e8f7c" stroke-width="3" transform="rotate(${angle} 29 36)"/>`;
    shapes += '</g>' + circle(29, 36, 2, '#e4e7cc', 'stroke="none"');
    shapes += ellipse(48, 35, 2.5, firing ? 2.3 : 3.8, '#203a40', 'stroke="none"') + ellipse(59, 34, 2.5, 3.8, '#203a40', 'stroke="none"');
    shapes += svgPath('M50 43 Q54 45 58 42', 'none', 'stroke="#426b5d" stroke-width="1.5"');
    shapes += svgPath('M58 48 L62 47', 'none', 'stroke="#d7d7b4" stroke-width="3"');
  } else {
    shapes += svgPath('M39 58 L31 78 M60 58 L69 78', 'none', 'stroke="#66768c" stroke-width="5"');
    shapes += rect(20, 77, 19, 8, 3, '#d2d8df') + rect(64, 77, 18, 8, 3, '#d2d8df');
    shapes += `<g transform="rotate(${ready ? -3 : firing ? -1 : 0} 47 46)">`;
    shapes += rect(13, 32, 64, 26, 12, '#8da8c4');
    shapes += ellipse(16, 45, 5, 11, '#64758a') + svgPath('M23 36 L62 36', 'none', 'stroke="#dce4e7" stroke-width="3"');
    shapes += rect(64, 32, 17, 26, 5, '#d1d9dc');
    shapes += ellipse(80, 45, 8, 12, '#657789') + ellipse(82, 45, 4.5, 8, '#343f59');
    shapes += ellipse(83, 45, firing ? 3 : ready ? 2 : 1.5, firing ? 6 : 3, firing ? '#f4d8ff' : '#b087b2', 'stroke="none"');
    shapes += rect(44, 26, 13, 6, 3, ready ? '#b8acb1' : '#cd7980', 'stroke-width="1.6"');
    shapes += ellipse(35, 44, 2.5, 3.5, '#203a40', 'stroke="none"') + ellipse(47, 44, 2.5, ready ? 2 : 3.5, '#203a40', 'stroke="none"');
    shapes += svgPath('M35 51 L43 51', 'none', 'stroke="#57718b" stroke-width="1.5"');
    shapes += svgPath('M20 34 L22 24 Q26 19 33 23', 'none', 'stroke="#89949e" stroke-width="2.5"');
    shapes += '</g>';
  }
  return svg(shapes);
}

function robotSvg(definition, pose) {
  const appliance = applianceKind(definition);
  if (appliance) return applianceSvg(appliance, pose);
  const palette = colors[definition.faction] || colors.shu;
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
    shapes += rect(9, 23, 17, 34, 5, palette.light) + rect(70, 23, 17, 34, 5, palette.light);
    shapes += rect(11, 47, 13, 11, 3, palette.dark) + rect(72, 47, 13, 11, 3, palette.dark);
    shapes += svgPath('M16 33 L21 33 M16 39 L21 39 M75 33 L80 33 M75 39 L80 39', 'none', 'stroke-width="2"');
    shapes += svgPath('M18 57 L18 65 M78 57 L78 65', 'none', `stroke="${palette.glow}" stroke-width="5"`);
  }
  if (tier === 3) {
    shapes += svgPath('M22 27 L3 12 L4 42 L21 53 Z M73 27 L93 12 L92 42 L74 53 Z', palette.dark);
    shapes += svgPath('M8 21 L19 29 L18 42 L9 36 Z M87 21 L77 29 L78 42 L87 36 Z', palette.main);
    shapes += svgPath('M10 25 L10 34 M15 29 L15 38 M82 28 L82 38 M87 24 L87 34', 'none', `stroke="${palette.glow}" stroke-width="2"`);
    shapes += svgPath('M13 59 L7 70 L11 79 L23 74 M82 59 L89 70 L84 79 L73 74', palette.light);
    shapes += svgPath('M38 19 L38 10 L57 10 L57 19', palette.light);
    shapes += svgPath('M32 17 L30 7 L39 12 L48 4 L56 12 L66 7 L63 18 Z', palette.dark);
    shapes += circle(47.5, 12, 4, palette.glow);
  }

  if (tracked) {
    shapes += rect(17, 70, 61, 17, 8, palette.dark);
    for (let x = 26; x < 75; x += 12) shapes += circle(x, 79, 4.6, '#d0dbe0') + circle(x, 79, 1.3, outline, 'stroke="none"');
    shapes += svgPath('M23 72 L71 72 M23 86 L71 86', 'none', 'stroke="#eef4e2" stroke-width="1.5"');
  } else if (turret) {
    shapes += svgPath('M36 68 L28 80 L19 80 L19 86 L38 86 L43 73 M57 68 L65 80 L75 80 L75 86 L55 86 L50 73', palette.dark);
    shapes += rect(36, 65, 24, 12, 5, palette.light);
  } else {
    shapes += svgPath('M34 68 L32 81 M58 68 L61 81', 'none', `stroke="${palette.dark}" stroke-width="9"`);
    shapes += rect(22, 79, 19, 9, 4, palette.light) + rect(53, 79, 19, 9, 4, palette.light);
  }

  // Mint robots use cans and cylinders; blue robots use panels and optics;
  // orange robots use salvaged appliances, coils and battery housings.
  if (definition.faction === 'shu') {
    if (tracked) {
      shapes += svgPath('M25 67 L25 47 Q25 24 47 24 Q69 24 69 47 L69 67 Z', palette.main);
      shapes += ellipse(47, 65, 22, 8, palette.light);
      shapes += svgPath('M31 29 L31 21 L48 21', 'none', `stroke="${palette.dark}" stroke-width="5"`);
    } else {
      shapes += rect(27, 25, 42, 46, 10, palette.main);
      shapes += ellipse(48, 26, 21, 6, palette.light);
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
      shapes += rect(29, tracked ? 26 : 20, 37, 8, 3, palette.light);
      shapes += svgPath('M61 61 L66 61 M61 65 L66 65', 'none', 'stroke-width="1.5"');
    }
  } else {
    if (turret) {
      shapes += svgPath('M31 35 L31 24 L60 24 L60 35 M31 35 Q20 43 27 65 Q46 77 67 64 L67 42 L82 36 L78 49 L68 53', palette.main);
      shapes += ellipse(46, 25, 16, 4, palette.light);
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
    shapes += rect(82, 42, 10, 22, 3, palette.light);
    shapes += ellipse(89, 53, 4, 7, '#263847');
    shapes += ellipse(90, 53, 2, windup ? 5 : 3, windup || strike ? '#ffdc8e' : '#916c43', 'stroke="none"');
    shapes += svgPath('M65 47 L65 58 M74 46 L74 60', 'none', 'stroke="#f8edc9" stroke-width="1.5"');
  } else {
    shapes += rect(63, 46, 25, 12, 4, palette.dark);
    shapes += rect(70, 46, 13, 9, 2, palette.main);
    shapes += rect(83, 45, 9, 15, 3, palette.light);
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
    shapes += rect(19, 39, 8, 16, 3, palette.light);
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
  const defs = `<defs><linearGradient id="body" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="${palette.light}"/><stop offset=".38" stop-color="${palette.main}"/><stop offset="1" stop-color="${palette.dark}"/></linearGradient><linearGradient id="metal" x2=".5" y2="1"><stop stop-color="#fff9df"/><stop offset=".45" stop-color="${palette.light}"/><stop offset="1" stop-color="${palette.main}"/></linearGradient></defs>`;
  return svg(shapes.replaceAll(`fill="${palette.main}"`, 'fill="url(#body)"').replaceAll(`fill="${palette.light}"`, 'fill="url(#metal)"'), defs);
}

function scrapDroneSvg(kind, pose) {
  const step = typeof pose === 'number' ? [0, 4, 0, -4][pose % 4] : 0;
  const boss = kind === 2;
  let shapes = ellipse(47, 88, boss ? 34 : 24, 4, '#354b6126', 'stroke="none"');
  if (boss) {
    shapes += rect(15, 71, 66, 16, 8, '#5b5878');
    for (let x = 24; x < 78; x += 13) {
      shapes += circle(x, 79, 5, '#b3adca') + circle(x, 79, 1.5, '#5b5878', 'stroke="none"');
      shapes += svgPath(`M${x - 2} ${76 + step * .4} L${x + 2} ${82 - step * .4}`, 'none', 'stroke="#79718c" stroke-width="1.4"');
    }
    shapes += svgPath('M22 46 L10 53 L10 67 M72 46 L86 53 L86 67', 'none', 'stroke="#5b5878" stroke-width="8"');
    shapes += svgPath('M5 65 L5 74 L15 74 L15 65 M81 65 L81 74 L91 74 L91 65', 'none', 'stroke="#de9a9a" stroke-width="5"');
    shapes += rect(22, 25, 52, 47, 9, '#a394ba');
    shapes += rect(28, 16, 40, 12, 4, '#cac4d7');
    shapes += svgPath('M34 18 L34 24 M47 18 L47 24 M60 18 L60 24', 'none', 'stroke="#5b5878" stroke-width="4"');
    shapes += rect(28, 48, 40, 15, 4, '#5b5878');
    shapes += svgPath('M34 48 L38 57 L43 48 L49 57 L55 48 L62 57 L66 48', '#e2c998', 'stroke-width="1.8"');
  } else if (kind === 1) {
    shapes += svgPath(`M29 61 L${15 + step} 70 L12 82 M66 61 L${81 - step} 70 L84 82 M35 67 L31 84 M59 67 L63 84`, 'none', 'stroke="#79718c" stroke-width="7"');
    shapes += rect(24, 29, 47, 38, 11, '#c1b5ce');
    shapes += svgPath('M27 30 L21 20 L36 25 M68 30 L75 20 L59 25', '#e3cda4');
    shapes += rect(31, 51, 34, 10, 3, '#8c829e');
    shapes += svgPath('M38 53 L38 59 M46 53 L46 59 M54 53 L54 59', 'none', 'stroke="#e7deed" stroke-width="2"');
  } else {
    shapes += svgPath(`M31 67 L${27 + step} 80 L19 83 M61 67 L${65 - step} 80 L74 83`, 'none', 'stroke="#787086" stroke-width="7"');
    shapes += svgPath('M25 46 L15 54 L18 63 M68 46 L79 53 L77 63', 'none', 'stroke="#9990a6" stroke-width="6"');
    shapes += rect(27, 29, 40, 43, 10, '#b8afc4');
    shapes += ellipse(47, 29, 20, 6, '#d9d4e1');
    shapes += svgPath('M38 28 L39 19 L47 17 L55 21 L54 27', '#a899b7');
    shapes += svgPath('M36 62 L59 62 M36 66 L51 66', 'none', 'stroke="#82738e" stroke-width="2"');
  }
  shapes += rect(31, boss ? 32 : 37, 33, 14, 5, '#514962');
  shapes += svgPath(boss ? 'M37 36 L43 39 M53 39 L59 36' : 'M37 41 L43 43 M53 43 L59 41', 'none', 'stroke="#ffcfaa" stroke-width="3"');
  shapes += circle(61, boss ? 68 : 61, 2, '#ffe5b8', 'stroke="none"');
  return svg(shapes);
}

export function unitSpriteUrl(definition, pose = 'idle') {
  const key = [applianceKind(definition) || 'robot', definition.faction, definition.troop, definition.trait, definition.rarity, definition.attackPattern || 'bolt', pose].join(':');
  if (!cache.has(key)) cache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(robotSvg(definition, pose)));
  return cache.get(key);
}

export function enemySpriteUrl(kind, pose = 0) {
  const key = `enemy:${kind}:${pose}`;
  if (!cache.has(key)) cache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(scrapDroneSvg(kind, pose)));
  return cache.get(key);
}
