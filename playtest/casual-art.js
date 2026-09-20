// Original flat vector characters shared by the battlefield and roster portraits.
const colors = {
  shu: { main: '#59b991', dark: '#267c64', light: '#d7f1bd' },
  wei: { main: '#70a9dc', dark: '#3b6598', light: '#d2e9ff' },
  wu: { main: '#ed966b', dark: '#b85843', light: '#ffe4ab' },
  enemy: { main: '#bb7b77', dark: '#784c57', light: '#ead3bd' }
};
const outline = '#344b48';
const cache = new Map();

function characterSvg(definition, pose = 'idle', enemy = false) {
  const palette = colors[enemy ? 'enemy' : definition.faction] || colors.shu;
  const hero = definition.rarity === 'hero' || definition.rarity === 'legend';
  const elite = definition.rarity === 'elite';
  const rider = !enemy && definition.troop === 'cavalry';
  const archer = !enemy && definition.troop === 'archer';
  const sage = hero && definition.trait === 'strategy';
  const walk = typeof pose === 'number' ? [9, 0, -9, 0][pose % 4] : 0;
  const arm = pose === 'windup' ? -42 : pose === 'strike' ? 62 : walk * .8;
  const headY = rider ? 30 : 32;
  const skin = enemy ? '#eed7b8' : '#ffe0b4';
  const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
  const ellipse = (cx, cy, rx, ry, fill) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
  let shapes = `<ellipse cx="47" cy="88" rx="24" ry="4" fill="#294b4626" stroke="none"/>`;
  if (hero) shapes += path('M33 48 Q21 65 25 83 L64 83 Q73 65 61 48 Z', palette.dark);
  if (!rider) {
    shapes += path(`M39 69 L${36 + walk} 83 L${29 + walk} 85`, palette.dark, 'stroke-width="8"');
    shapes += path(`M54 69 L${57 - walk} 83 L${64 - walk} 85`, palette.dark, 'stroke-width="8"');
  }
  shapes += path('M32 48 Q47 42 62 48 L65 69 Q48 78 29 69 Z', palette.main);
  shapes += path('M33 65 L62 65', 'none', `stroke="${palette.dark}" stroke-width="6"`);
  shapes += `<rect x="43" y="62" width="9" height="7" rx="2" fill="${palette.light}"/>`;
  shapes += `<g transform="rotate(${-arm * .45} 32 51)">` + path('M33 51 L25 63', 'none', `stroke="${palette.main}" stroke-width="10"`) + ellipse(25, 65, 5, 5, skin) + '</g>';
  if (rider) {
    shapes += ellipse(43, 74, 25, 12, '#c7a984');
    shapes += path(`M26 81 L${24 + walk} 90 M56 81 L${59 - walk} 90`, 'none', 'stroke-width="6"');
    shapes += path('M60 76 L61 59 Q60 50 69 50 L80 60 Q84 66 76 68 L67 67 L68 77 Z', '#c7a984');
    shapes += path('M61 55 L62 44 L68 51 M62 61 L58 66 M21 72 Q10 67 12 78', palette.dark);
    shapes += ellipse(70, 58, 1.5, 2, outline);
    shapes += path('M67 66 L79 66', 'none', `stroke="${palette.dark}"`);
    shapes += path('M35 68 L35 79 L47 80', 'none', `stroke="${palette.dark}" stroke-width="7"`);
  }
  shapes += `<g transform="rotate(${arm} 63 53)">`;
  shapes += path('M61 51 L69 61', 'none', `stroke="${palette.main}" stroke-width="10"`);
  if (sage) {
    shapes += path('M70 60 L60 35 Q76 26 86 39 Z', '#fff3d1');
    shapes += path('M70 59 L72 34 M70 59 L80 36', 'none', `stroke="${palette.dark}" stroke-width="1.5"`);
  } else if (archer) {
    shapes += path('M74 35 Q94 53 74 74 M74 35 L74 74', 'none', 'stroke="#885c3b" stroke-width="3"');
    shapes += path(pose === 'windup' ? 'M65 54 L83 54' : 'M66 54 L92 54 M92 54 L86 50 M92 54 L86 58', 'none', 'stroke-width="2"');
  } else if (rider) {
    shapes += path('M73 76 L73 16', 'none', 'stroke="#885c3b" stroke-width="4"');
    shapes += path('M73 8 L67 22 L79 22 Z', '#eff5e6');
    shapes += path('M74 25 L88 28 L74 37 Z', palette.light);
  } else {
    shapes += path('M73 62 L73 38 L78 26 L82 38 L79 62 Z', enemy ? '#d1c9be' : '#eff5e6');
    shapes += path('M68 62 L83 62 M75 63 L75 72', 'none', 'stroke="#986c43" stroke-width="4"');
  }
  shapes += ellipse(69, 62, 5, 5, skin) + '</g>';
  shapes += ellipse(47, headY, 19, 18, skin);
  shapes += ellipse(28, headY + 3, 3, 5, skin) + ellipse(66, headY + 3, 3, 5, skin);
  if (sage) {
    shapes += path('M28 28 L31 14 L41 14 L42 7 L53 7 L55 14 L63 14 L66 28 Z', palette.dark);
    shapes += path('M32 23 L62 23', 'none', `stroke="${palette.light}" stroke-width="4"`);
  } else {
    shapes += path(`M28 ${headY - 2} Q25 8 47 10 Q68 8 66 ${headY - 2} L60 ${headY - 5} L34 ${headY - 5} Z`, palette.main);
    shapes += path(`M29 ${headY - 5} L65 ${headY - 5}`, 'none', `stroke="${palette.dark}" stroke-width="5"`);
    if (hero || elite) shapes += path('M43 12 L47 5 L52 12 L48 19 Z', '#ffe2a0');
    if (enemy && hero) shapes += path('M29 18 L20 10 L24 26 M64 18 L75 10 L70 27', '#ffdf9b');
  }
  shapes += ellipse(41, headY + 3, 1.8, 2.5, outline) + ellipse(55, headY + 3, 1.8, 2.5, outline);
  shapes += path(enemy ? `M37 ${headY - 3} L44 ${headY - 1} M52 ${headY - 1} L59 ${headY - 3}` : `M44 ${headY + 10} Q48 ${headY + 13} 52 ${headY + 10}`, 'none', 'stroke-width="2"');
  shapes += `<ellipse cx="35" cy="${headY + 9}" rx="3" ry="2" fill="#efb099" stroke="none"/>`;
  if (hero && !sage) shapes += path(`M42 ${headY + 14} Q48 ${headY + 23} 54 ${headY + 14}`, palette.dark);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><g stroke="${outline}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${shapes}</g></svg>`;
}

export function unitSpriteUrl(definition, pose = 'idle') {
  const key = [definition.faction, definition.troop, definition.trait, definition.rarity, pose].join(':');
  if (!cache.has(key)) cache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(characterSvg(definition, pose)));
  return cache.get(key);
}

export function enemySpriteUrl(kind, pose = 0) {
  const key = `enemy:${kind}:${pose}`;
  if (!cache.has(key)) cache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(characterSvg({ rarity: kind === 2 ? 'hero' : 'basic' }, pose, true)));
  return cache.get(key);
}
