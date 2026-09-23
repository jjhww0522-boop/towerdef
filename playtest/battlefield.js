import { unitSpriteUrl, enemySpriteUrl, applianceKind } from './casual-art.js';
import { BOARD_WIDTH, BOARD_HEIGHT, unitPoint, enemyPoint, projectPoint } from '../shared/battle-geometry.js';

const palette = { shu: '#75c9ac', wei: '#83bde7', wu: '#f2ad75' };
const elementColors = { fire: '#ff9c54', wind: '#9eeab7', frost: '#86dcff', laser: '#f1a8ff', electric: '#a6eeff' };
const WORLD_W = 1000, WORLD_H = 440, MAX_EFFECTS = 120;
const slot = (n, width = WORLD_W, height = WORLD_H) => projectPoint(unitPoint(n), roadFor(width, height), width === 600);
const roadFor = (width, height) => ({ left: width * .12, right: width * .84,
  top: height * (width === 600 ? .22 : .27), bottom: height * .80 });
const path = (progress, width = WORLD_W, height = WORLD_H) => {
  const point = enemyPoint(progress);
  return { ...projectPoint(point, roadFor(width, height), width === 600), face: point.face };
};
const clamp = value => Math.max(0, Math.min(1, value));
const easeOut = value => 1 - Math.pow(1 - clamp(value), 3);
const attackTimings = { fire: [65, 125, 120], wind: [125, 170, 170], frost: [80, 180, 130], laser: [110, 55, 95] };
const defaultAttackTiming = [80, 150, 90];
// Presentation only: leave the lighter open between confirmed shots, then close it at rest.
const LIGHTER_READY_MS = 1200;
// Presentation only. Attack stamps, health and removal come from the server.
export class Battlefield {
  constructor(canvas, onSelect, onCombat = () => {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.units = new Map(); this.enemies = new Map(); this.effects = []; this.arrivals = new Map();
    this.player = null; this.selected = new Set(); this.reduced = false;
    this.frames = new Map(); this.walkFrames = []; this.drawOrder = [];
    this.lastFrame = performance.now(); this.lastSnapshotAt = 0; this.snapshotDelay = 200;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.onCombat = onCombat;
    this.configureLayout();
    for (let index = 0; index < 12; index++) {
      this.walkFrames.push(this.spriteFrame(enemySpriteUrl(Math.floor(index / 4), index % 4)));
    }
    canvas.addEventListener('click', event => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left - this.ox) / this.scale;
      const y = (event.clientY - rect.top - this.oy) / this.scale;
      let nearest = null, distance = Infinity;
      for (const [unitId, view] of this.units) {
        const height = this.unitHeight(this.definitions.get(view.unit.definitionId));
        const d = Math.hypot((x - view.x) / (height * .43), (y - view.y + height * .47) / (height * .47));
        if (d < 1 && d < distance) { nearest = unitId; distance = d; }
      }
      onSelect(nearest);
    });
    requestAnimationFrame(now => this.draw(now));
  }

  configureLayout() {
    const portrait = typeof matchMedia === 'function' && matchMedia('(max-width:600px)').matches;
    const bounds = this.canvas.getBoundingClientRect();
    const width = portrait ? 600 : WORLD_W;
    const height = Math.max(280, Math.min(1600, Math.round(width * bounds.height / Math.max(1, bounds.width))));
    if (this.worldWidth === width && this.worldHeight === height) return;
    this.worldWidth = width; this.worldHeight = height; this.effects.length = 0;
    for (const view of this.units.values()) {
      const target = view.unit.dispatched ? this.portalSlot(view.unit.id) : this.position(view.unit.slot);
      view.x = target.x; view.y = target.y;
    }
  }
  position(index) { return slot(index, this.worldWidth, this.worldHeight); }
  path(progress) { return path(progress, this.worldWidth, this.worldHeight); }

  drawRange() {
    const context = this.ctx, road = roadFor(this.worldWidth, this.worldHeight), portrait = this.worldWidth === 600;
    for (const id of this.selected) {
      const view = this.units.get(id);
      if (!view || view.unit.dispatched) continue;
      const definition = this.definitions.get(view.unit.definitionId), range = definition.attackRange;
      if (!range) continue;
      const center = this.position(view.unit.slot);
      const rx = range * (road.right - road.left) / (portrait ? BOARD_HEIGHT : BOARD_WIDTH);
      const ry = range * (road.bottom - road.top) / (portrait ? BOARD_WIDTH : BOARD_HEIGHT);
      const color = elementColors[definition.element] || '#ffe6a0';
      context.save(); context.beginPath();
      context.rect(road.left - 24, road.top - 24, road.right - road.left + 48, road.bottom - road.top + 48); context.clip();
      context.fillStyle = color + '15'; context.strokeStyle = color; context.lineWidth = 2;
      context.setLineDash([7, 5]); context.beginPath(); context.ellipse(center.x, center.y, rx, ry, 0, 0, Math.PI * 2);
      context.fill(); context.stroke(); context.restore();
    }
  }

  spriteFrame(url) {
    const frame = new Image(96, 96);
    const rasterize = () => {
      if (frame.raster || !frame.naturalWidth) return;
      // Recoil and walking transforms reuse pixels instead of rerasterizing SVGs.
      const surface = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(192, 192) :
        typeof document !== 'undefined' ? document.createElement('canvas') : null;
      if (!surface) return;
      surface.width = 192; surface.height = 192;
      surface.getContext('2d').drawImage(frame, 0, 0, 192, 192);
      frame.raster = surface;
    };
    frame.onload = rasterize;
    frame.src = url;
    if (typeof frame.decode === 'function') frame.decode().then(rasterize).catch(() => {});
    return frame;
  }

  unitFrame(definition, pose) {
    const key = definition.id + ':' + pose;
    if (!this.frames.has(key)) {
      this.frames.set(key, this.spriteFrame(unitSpriteUrl(definition, pose)));
    }
    return this.frames.get(key);
  }

  addEffect(effect) {
    if (this.reduced || this.effects.length >= MAX_EFFECTS) return;
    this.effects.push(effect);
  }

  markArrival(unitId, kind) { this.arrivals.set(unitId, kind); }

  burst(x, y, color, now, count = 5) {
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + x * .013;
      this.addEffect({ type: 'spark', x, y, vx: Math.cos(angle) * (16 + i * 3),
        vy: Math.sin(angle) * 16 - 9, color, born: now, life: 420 + i * 25 });
    }
  }

  update(player, definitions, selected, speed = 1, reduced = false) {
    this.configureLayout();
    const now = performance.now(), changedLane = !this.player || this.player.id !== player.id;
    const resuming = changedLane || (this.lastSnapshotAt > 0 && now - this.lastSnapshotAt > 2000);
    if (changedLane) { this.units.clear(); this.enemies.clear(); this.effects.length = 0; this.lastSnapshotAt = 0; }
    if (!changedLane && player.lastFacilityHitTick != null && player.lastFacilityHitTick !== this.player?.lastFacilityHitTick) this.facilityHitAt = now;
    if (changedLane) this.facilityHitAt = -10000;
    this.player = player; this.definitions = definitions; this.selected = selected;
    this.speed = speed; this.reduced = reduced;
    if (reduced) this.effects.length = 0;
    const unitIds = new Set(player.units.map(unit => unit.id));
    const enemyIds = new Set(player.enemies.map(enemy => enemy.id));
    const previousArrival = this.lastSnapshotAt;
    if (resuming) { this.effects.length = 0; this.arrivals.clear(); }
    const impacts = new Map();
    const removedEnemyIds = new Set();
    let destroyed = 0;
    this.lastSnapshotAt = now;
    if (previousArrival && now > previousArrival + 40) this.snapshotDelay = Math.max(80, Math.min(260, now - previousArrival));

    for (const unit of player.units) {
      const definition = definitions.get(unit.definitionId);
      // Decode on snapshot arrival instead of waiting for the first visible pose.
      for (const pose of ['idle', 'windup', 'strike']) this.unitFrame(definition, pose);
      if (applianceKind(definition) === 'lighter') this.unitFrame(definition, 'recovery');
      let view = this.units.get(unit.id);
      const home = this.position(unit.slot), target = unit.dispatched ? this.portalSlot(unit.id) : home;
      if (!view) {
        view = { x: target.x, y: target.y, born: resuming ? now - 1000 : now,
          attackAt: -10000, lastAttackTick: unit.lastAttackTick, facing: 1, targetX: target.x + 1, targetY: target.y,
          dispatched: unit.dispatched, arrivalKind: resuming ? null : this.arrivals.get(unit.id) || 'summon' };
        this.units.set(unit.id, view);
        if (!resuming) {
          const color = palette[definitions.get(unit.definitionId).faction];
          const assembling = view.arrivalKind === 'combine';
          this.addEffect({ type: assembling ? 'assembly' : 'landing', x: home.x,
            y: assembling ? home.y - this.unitHeight(definition) * .45 : home.y,
            color, born: now, life: assembling ? 400 : 300 });
          this.onCombat({ type: 'assemble', intensity: .6 });
        }
      } else {
        if (unit.lastAttackTick != null && unit.lastAttackTick !== view.lastAttackTick) {
          // Ignore older stamps after a room reset; never replay initial history.
          if (!resuming && (view.lastAttackTick == null || unit.lastAttackTick > view.lastAttackTick)) this.attack(unit, view, now, impacts);
          view.lastAttackTick = unit.lastAttackTick;
        }
        if (unit.dispatched !== view.dispatched) {
          if (!resuming) this.burst(view.x, view.y - 9, '#b9eedb', now, 6);
          view.dispatched = unit.dispatched;
        }
      }
      view.unit = unit;
      if (resuming) { view.attackAt = -10000; view.lastAttackTick = unit.lastAttackTick; }
    }
    // An acknowledgement belongs to this observation only, never a later lane or reconnect.
    this.arrivals.clear();
    for (const unitId of this.units.keys()) if (!unitIds.has(unitId)) this.units.delete(unitId);

    for (const enemy of player.enemies) {
      const view = this.enemies.get(enemy.id);
      if (view) {
        if (!resuming && view.hp > enemy.hp && !impacts.has(enemy.id)) {
          const position = this.path(enemy.progress), damage = Math.round(view.hp - enemy.hp);
          view.hitAt = now + 230;
          this.addEffect({ type: 'damage', x: position.x, y: position.y - (enemy.boss ? 70 : 34),
            label: String(damage), color: enemy.boss ? '#ffe6a0' : '#fff5dc', born: now + 230, life: 650 });
        }
        view.from = ((this.progress(view, now) % 1) + 1) % 1;
        // Normalize each segment so every entrance crossing interpolates forward.
        view.to = enemy.progress < view.from - .5 ? enemy.progress + 1 : enemy.progress;
        view.progress = enemy.progress; view.hp = enemy.hp; view.at = now; view.enemy = enemy;
      } else this.enemies.set(enemy.id, { from: enemy.progress, to: enemy.progress, progress: enemy.progress,
        at: now, hp: enemy.hp, hitAt: -10000, enemy });
    }
    for (const [enemyId, view] of this.enemies) if (!enemyIds.has(enemyId)) {
      const position = this.path(this.progress(view, now));
      if (!resuming) {
        const impact = impacts.get(enemyId), at = impact?.at ?? now + 230;
        this.addEffect({ type: 'death', x: impact?.position.x ?? position.x, y: impact ? impact.position.y + 18 : position.y, facing: position.face,
          frame: this.enemyFrameIndex(view.enemy, now), boss: view.enemy.boss, born: at, life: 420 });
        this.burst(position.x, position.y - 14, '#e2b476', at, view.enemy.boss ? 9 : 4);
        destroyed++;
      }
      this.enemies.delete(enemyId);
      removedEnemyIds.add(enemyId);
    }
    for (const [targetId, impact] of impacts) {
      this.addEffect({ type: 'damage', x: impact.position.x, y: impact.position.y - (impact.boss ? 56 : 29),
        label: String(Math.round(impact.damage)), color: impact.boss ? '#ffd080' : '#fff3c8', born: impact.at, life: 620 });
      const view = this.enemies.get(targetId);
      if (view) view.hitAt = impact.at;
      // A hit record can outlive a target spawned and killed between two snapshots.
      if (!enemyIds.has(targetId) && !removedEnemyIds.has(targetId) && typeof targetId === 'number') {
        const enemy = { id: targetId, boss: impact.boss };
        this.addEffect({ type: 'death', x: impact.position.x, y: impact.position.y + 18, facing: 1,
          frame: this.enemyFrameIndex(enemy, now), boss: impact.boss, born: impact.at, life: 420 });
        this.burst(impact.position.x, impact.position.y, '#c7a580', impact.at, 3);
        destroyed++;
      }
    }
    if (destroyed) this.onCombat({ type: 'destroy', intensity: Math.min(1, .35 + destroyed * .1) });
    this.drawOrder.length = 0;
    for (const view of this.enemies.values()) this.drawOrder.push({ enemy: view, depth: this.path(view.progress).y });
    for (const view of this.units.values()) this.drawOrder.push({ unit: view, depth: view.y });
    this.drawOrder.sort((a, b) => a.depth - b.depth);
  }

  portalSlot(id) { return { x: this.worldWidth * .934 + (id % 2 - .5) * 24, y: this.worldHeight * .50 + (id % 2 - .5) * 24 }; }
  progress(view, now) { return view.from + (view.to - view.from) * clamp((now - view.at) / this.snapshotDelay); }

  attack(unit, view, now, impacts = new Map()) {
    const definition = this.definitions.get(unit.definitionId);
    const pattern = definition.attackPattern || 'bolt';
    const records = unit.lastAttackHits ?? [{ targetId: unit.lastTargetId, damage: 0 }];
    const targets = records.filter(hit => !unit.lastAttackHits || hit.damage > 0).map(hit => {
      const isStory = typeof hit.targetId === 'string';
      const target = this.player.enemies.find(enemy => enemy.id === hit.targetId), previous = this.enemies.get(hit.targetId);
      const position = isStory ? { x: this.worldWidth * .949, y: this.worldHeight * .382 + 16 } :
        Number.isFinite(hit.progress) ? this.path(hit.progress) : target ? this.path(target.progress) :
        previous ? this.path(this.progress(previous, now)) : null;
      return position ? { ...hit, position: { x: position.x, y: position.y - 18 } } : null;
    }).filter(Boolean);
    if (!targets.length) return;
    const position = targets[0].position;
    view.attackFromOpenLid = applianceKind(definition) === 'lighter' && now - view.attackAt < LIGHTER_READY_MS;
    view.attackAt = now;
    view.targetX = position.x; view.targetY = position.y;
    view.hitPositions = targets.map(hit => hit.position);
    view.facing = position.x < view.x ? -1 : 1;
    const color = elementColors[definition.element] || (pattern === 'blast' ? '#ffbd71' : pattern === 'arc' ? '#a6eeff' : palette[definition.faction]);
    const origin = this.weaponOrigin(definition, view.x, view.y, view.facing);
    const [prepare, travel] = attackTimings[definition.element] || defaultAttackTiming;
    this.addEffect({ type: 'muzzle', ...origin, color, element: definition.element, facing: view.facing, born: now + prepare, life: 105 });
    if (pattern === 'arc') this.addEffect({ type: 'arc', points: [origin, ...targets.map(hit => hit.position)], color, born: now + prepare, life: 210 });
    else this.addEffect({ type: definition.element === 'laser' || definition.element === 'fire' ? definition.element : pattern,
      element: definition.element, ...origin, tx: position.x, ty: position.y, color, born: now + prepare, life: travel });
    targets.forEach((hit, index) => {
      const at = now + prepare + (pattern === 'arc' ? 25 + index * 25 : travel);
      this.addEffect({ type: 'impact', ...hit.position, color, element: definition.element,
        angle: Math.atan2(hit.position.y - origin.y, hit.position.x - origin.x),
        blast: pattern === 'blast' && index === 0, born: at, life: pattern === 'blast' ? 340 : 180 });
      if (definition.element !== 'wind' && definition.element !== 'laser') this.burst(hit.position.x, hit.position.y, color, at, pattern === 'blast' ? 4 : 2);
      if (hit.damage > 0) {
        const previous = impacts.get(hit.targetId);
        impacts.set(hit.targetId, { position: hit.position, damage: hit.damage + (previous?.damage || 0), at, boss: hit.boss });
      }
    });
    this.onCombat({ type: pattern, element: definition.element, delay: prepare / 1000,
      intensity: definition.rarity === 'legend' ? 1 : definition.rarity === 'hero' ? .8 : .5 });
  }

  unitHeight(definition) { return definition.rarity === 'legend' ? 94 : definition.rarity === 'hero' ? 86 : definition.rarity === 'elite' ? 78 : 70; }

  weaponOrigin(definition, x, y, facing) {
    const height = this.unitHeight(definition), kind = applianceKind(definition);
    const nozzle = kind === 'lighter' ? [60, 24] : kind === 'dryer' ? [85, 38] : kind === 'pointer' ? [84, 45] : [80.64, 52.8];
    return { x: x + facing * height * (nozzle[0] / 96 - .5), y: y - height * (1 - nozzle[1] / 96) };
  }

  rect(x, y, width, height, color, radius = 0) {
    const context = this.ctx; context.fillStyle = color;
    context.beginPath(); context.roundRect(x, y, width, height, radius); context.fill();
  }
  circle(x, y, radius, color) {
    const context = this.ctx; context.fillStyle = color; context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
  }
  ellipse(x, y, width, height, color) {
    const context = this.ctx; context.fillStyle = color; context.beginPath();
    context.ellipse(x, y, width, height, 0, 0, Math.PI * 2); context.fill();
  }
  text(value, x, y, size, color) {
    const context = this.ctx; context.font = '600 ' + size + 'px "Pretendard", "Malgun Gothic", system-ui, sans-serif';
    context.textAlign = 'center'; context.lineJoin = 'round';
    context.strokeStyle = '#203944e0'; context.lineWidth = 3;
    context.strokeText(value, x, y); context.fillStyle = color; context.fillText(value, x, y);
  }

  ground(now) {
    const density = Math.max(1, Math.min(2, this.scale * (devicePixelRatio || 1)));
    const key = [this.worldWidth, this.worldHeight, this.battlefieldId, density].join(':');
    if (this.groundCache?.key !== key) {
      const surface = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(Math.ceil(this.worldWidth * density), Math.ceil(this.worldHeight * density)) :
        typeof document !== 'undefined' ? document.createElement('canvas') : null;
      if (surface) {
        surface.width = Math.ceil(this.worldWidth * density); surface.height = Math.ceil(this.worldHeight * density);
        const context = this.ctx;
        this.ctx = surface.getContext('2d'); this.ctx.scale(density, density);
        try { this.drawDeck(); } finally { this.ctx = context; }
        this.groundCache = { key, surface };
      }
    }
    if (this.groundCache?.key === key) this.ctx.drawImage(this.groundCache.surface, 0, 0, this.worldWidth, this.worldHeight);
    else this.drawDeck();
    if (this.objective && this.objective.kind !== 'overcrowd') this.facility(now);
    else this.miningRig(now);
  }

  facility(now) {
    const objective = this.objective, point = this.path(objective.arrivalProgress), portrait = this.worldWidth === 600;
    const x = point.x - (portrait ? 37 : 25), y = point.y - (portrait ? 0 : 18), context = this.ctx;
    const hit = now - (this.facilityHitAt ?? -10000) < 220, health = clamp(this.player.facilityHp / objective.facilityHp);
    const color = health <= .3 ? '#ff9575' : '#a4e2c9';
    this.ellipse(x, y + 14, 27, 8, '#050c16aa');
    this.rect(x - 24, y - 29, 48, 42, hit && !this.reduced ? '#84584b' : '#304b5b', 7);
    this.rect(x - 19, y - 24, 38, 12, objective.kind === 'engine' ? '#82aeda' : '#e0b160', 3);
    if (objective.kind === 'engine') {
      this.circle(x, y - 1, 14, '#0b1c2b'); this.circle(x, y - 1, 9, '#8ccee1');
      context.strokeStyle = '#d1eef2'; context.lineWidth = 2; context.beginPath();
      context.arc(x, y - 1, 6, this.reduced ? 0 : now / 400, (this.reduced ? 0 : now / 400) + Math.PI * 1.4); context.stroke();
    } else {
      this.rect(x - 5, y - 8, 10, 24, '#acc2c7', 2);
      for (let n = 0; n < 3; n++) this.rect(x - 7, y - 6 + n * 7, 14, 2, '#203946');
    }
    this.rect(x - 26, y + 21, 52, 5, '#0a1721', 2); this.rect(x - 26, y + 21, 52 * health, 5, color, 2);
    this.text(objective.label, x + (portrait ? 12 : 0), y - 43, portrait ? 15 : 11, color);
    if (this.player.facilityAttackers) this.text(`공격 ${this.player.facilityAttackers}기`, x + (portrait ? 12 : 0), y + 43, portrait ? 14 : 11, '#ffb496');
    if (hit) {
      context.strokeStyle = '#ffc194'; context.lineWidth = this.reduced ? 2 : 4;
      context.beginPath(); context.moveTo(point.x, point.y - 12); context.lineTo(x, y - 5); context.stroke();
    }
  }

  drawSky(terrain, road) {
    const context = this.ctx, width = this.worldWidth, height = this.worldHeight;
    const sky = context.createLinearGradient(0, 0, width * .5, height);
    sky.addColorStop(0, '#040916'); sky.addColorStop(.45, terrain.sky); sky.addColorStop(1, '#070d1b');
    this.rect(0, 0, width, height, sky);
    // Distant gas and stars remain low contrast and are cached with the terrain.
    context.save(); context.translate(width * .36, road.top * .2); context.rotate(-.25); context.scale(1, .32);
    const cloud = context.createRadialGradient(0, 0, 0, 0, 0, width * .75);
    cloud.addColorStop(0, terrain.halo + '38'); cloud.addColorStop(.45, terrain.halo + '18'); cloud.addColorStop(1, terrain.halo + '00');
    this.circle(0, 0, width * .75, cloud); context.restore();
    for (let i = 0; i < 115; i++) {
      const x = (i * 137.51 + 19) % width, y = (i * 59.73 + 11) % height;
      const bright = i % 17 === 0;
      this.circle(x, y, bright ? 1.35 : .65, bright ? '#dce5ed99' : '#b9cadd48');
      if (bright) {
        this.rect(x - 3, y - .35, 6, .7, '#dce5ed24'); this.rect(x - .35, y - 3, .7, 6, '#dce5ed24');
      }
    }
    const portrait = width === 600;
    const radius = Math.min(width * .155, road.top * (portrait ? .64 : .56));
    const planetX = width * (portrait ? .82 : .94), planetY = road.top * (portrait ? .47 : .75);
    context.save(); context.translate(planetX, planetY); context.rotate(-.3);
    if (this.battlefieldId === 2) {
      context.strokeStyle = '#8aafc65c'; context.lineWidth = radius * .21;
      context.beginPath(); context.ellipse(0, 0, radius * 1.7, radius * .39, 0, 0, Math.PI * 2); context.stroke();
    }
    const planet = context.createRadialGradient(-radius * .52, -radius * .48, 0, 0, 0, radius);
    planet.addColorStop(0, terrain.planet); planet.addColorStop(.68, terrain.sky); planet.addColorStop(1, '#080f1c');
    this.circle(0, 0, radius, planet);
    context.save(); context.beginPath(); context.arc(0, 0, radius - 1, 0, Math.PI * 2); context.clip();
    context.strokeStyle = terrain.halo + '18'; context.lineWidth = radius * .12;
    for (let band = -2; band < 4; band++) {
      context.beginPath(); context.ellipse(-radius * .12, band * radius * .3, radius * 1.12, radius * .18, -.1, 0, Math.PI); context.stroke();
    }
    const night = context.createLinearGradient(-radius, -radius, radius * .65, radius * .2);
    night.addColorStop(0, '#03081700'); night.addColorStop(.45, '#03081715'); night.addColorStop(1, '#030817dc');
    this.rect(-radius, -radius, radius * 2, radius * 2, night); context.restore();
    context.strokeStyle = terrain.halo + '70'; context.lineWidth = 1.4;
    context.beginPath(); context.arc(0, 0, radius, Math.PI * .8, Math.PI * 1.8); context.stroke();
    if (this.battlefieldId === 2) {
      context.strokeStyle = '#aec5cd73'; context.lineWidth = radius * .16;
      context.beginPath(); context.ellipse(0, 0, radius * 1.7, radius * .39, 0, 0, Math.PI); context.stroke();
    }
    context.restore();
    const moonX = width * (portrait ? .2 : .05), moonY = road.top * (portrait ? .49 : .72), moonR = radius * .25;
    this.circle(moonX, moonY, moonR, '#8193a057');
    this.circle(moonX + moonR * .42, moonY - moonR * .13, moonR * .93, terrain.sky);
    if (this.battlefieldId === 3) {
      this.circle(width * .41, road.top * .2, radius * .09, '#b6acc77a');
    }
  }

  drawSurface(terrain, road) {
    const context = this.ctx, width = this.worldWidth, height = this.worldHeight;
    // A curved horizon connects the open sky to the playable planetary surface.
    const horizon = road.top - 22;
    context.beginPath(); context.moveTo(0, horizon + 55);
    context.bezierCurveTo(width * .22, horizon - 38, width * .63, horizon - 25, width, horizon + 47);
    context.lineTo(width, height); context.lineTo(0, height); context.closePath();
    const soil = context.createLinearGradient(0, horizon, width * .4, height);
    soil.addColorStop(0, terrain.ridge); soil.addColorStop(.2, terrain.soil); soil.addColorStop(1, '#101723');
    context.fillStyle = soil; context.fill();
    context.save(); context.clip();
    context.strokeStyle = terrain.halo + '21'; context.lineWidth = 5; context.stroke();
    if (this.battlefieldId === 2) {
      for (let i = 0; i < 11; i++) {
        const y = horizon + i * (height - horizon) / 10;
        context.beginPath(); context.moveTo(-60, y + 35);
        context.bezierCurveTo(width * .24, y - 76, width * .5, y + 104, width + 50, y - 30);
        context.strokeStyle = i % 2 ? '#78afbd13' : '#061d3040'; context.lineWidth = i % 2 ? 3 : 16; context.stroke();
      }
    } else if (this.battlefieldId === 3) {
      for (let i = 0; i < 13; i++) {
        const x = (i * 193 + 25) % width, y = horizon + (i * 97) % (height - horizon);
        context.beginPath(); context.moveTo(x - 40, y - 30); context.lineTo(x, y);
        context.lineTo(x - 12, y + 32); context.lineTo(x + 34, y + 58);
        context.strokeStyle = '#0b0e2070'; context.lineWidth = 8; context.stroke();
        context.strokeStyle = '#aa80c526'; context.lineWidth = 1.5; context.stroke();
      }
    } else {
      for (let i = 0; i < 22; i++) {
        const x = (i * 151 + 37) % width, y = horizon + (i * 109 + 83) % (height - horizon);
        const r = 13 + i % 5 * 8;
        this.ellipse(x, y, r, r * .38, '#a39b8520');
        this.ellipse(x + 2, y - 3, r - 2, r * .34, '#11192180');
        this.ellipse(x + 5, y - 5, r * .7, r * .21, '#131e2860');
      }
    }
    for (let i = 0; i < 110; i++) {
      const x = (i * 139.71 + 31) % width, y = horizon + (i * 73.91 + 37) % (height - horizon);
      this.ellipse(x, y, 1 + i % 3, .6 + i % 2, terrain.halo + '12');
    }
    // Mineral outcrops stay at the edges, away from combat and selectable robots.
    for (const side of [0, 1]) for (let i = 0; i < 5; i++) {
      const x = side ? width * (.9 + i % 2 * .07) : width * (.015 + i % 2 * .045);
      const y = road.top + 70 + i * (road.bottom - road.top - 60) / 5 + i % 2 * 13, size = 10 + i % 3 * 5;
      const rise = size * (this.battlefieldId === 3 ? 1.5 : this.battlefieldId === 2 ? .8 : .4);
      context.beginPath(); context.moveTo(x - size, y + 8); context.lineTo(x - size * .8, y - rise * .3);
      context.lineTo(x - size * .4, y - rise); context.lineTo(x + size * .3, y - rise * .7);
      context.lineTo(x + size, y + 9); context.closePath();
      context.fillStyle = terrain.rock; context.fill();
      context.beginPath(); context.moveTo(x - size * .4, y - rise); context.lineTo(x, y + 7); context.lineTo(x + size, y + 9);
      context.strokeStyle = terrain.halo + '42'; context.lineWidth = 1.5; context.stroke();
    }
    context.restore();
  }

  drawDeck() {
    const context = this.ctx, road = roadFor(this.worldWidth, this.worldHeight);
    const terrain = this.battlefieldId === 2 ? { sky: '#10263c', halo: '#81bccf', planet: '#658fa0', ridge: '#344e5b', soil: '#1d3444', rock: '#426b7a', track: '#334955' } :
      this.battlefieldId === 3 ? { sky: '#211a35', halo: '#b29acb', planet: '#80768f', ridge: '#494051', soil: '#292837', rock: '#5e4d70', track: '#44404f' } :
      { sky: '#152336', halo: '#9aaebd', planet: '#698595', ridge: '#4d4e4b', soil: '#2e3438', rock: '#535851', track: '#444e53' };
    this.drawSky(terrain, road); this.drawSurface(terrain, road);
    for (const [color, width] of [['#080f19', 53], [terrain.rock, 46], ['#1a2630', 41], [terrain.track, 29]]) {
      context.strokeStyle = color; context.lineWidth = width; context.lineJoin = 'round';
      context.beginPath(); context.roundRect(road.left, road.top, road.right - road.left, road.bottom - road.top, 10); context.stroke();
    }
    for (const x of [road.left, road.right]) for (const y of [road.top, road.bottom]) {
      this.circle(x, y, 4, '#142331'); this.circle(x, y, 1.8, '#dcc794');
    }
    for (const direction of [.09, .34, .60, .86]) {
      const point = this.path(direction), next = this.path(direction + .002);
      context.save(); context.translate(point.x, point.y);
      context.rotate(Math.atan2(next.y - point.y, next.x - point.x));
      context.strokeStyle = '#a0bfbd'; context.lineWidth = 3;
      context.beginPath(); context.moveTo(-4, -5); context.lineTo(2, 0); context.lineTo(-4, 5); context.stroke(); context.restore();
    }
    context.strokeStyle = '#a3bac221'; context.lineWidth = 1;
    for (let index = 0; index < 30; index++) {
      const position = this.position(index);
      context.beginPath(); context.ellipse(position.x, position.y + 2, 20, 7, 0, 0, Math.PI * 2); context.stroke();
    }
    const headingY = road.top - (this.worldWidth === 600 ? 55 : 45);
    this.rect(road.left + 23, headingY - 19, 152, 28, '#1c303c', 3);
    this.rect(road.left + 23, headingY - 19, 3, 28, '#f0b767');
    this.text('SECTOR / 0' + (this.battlefieldId || 1), road.left + 100, headingY, 13, '#c2d2d4');
    // The story dispatch pad replaces the old banner without moving its slots.
    const campX = this.worldWidth * .934, campY = this.worldHeight * .50;
    this.rect(campX - 33, campY - 64, 66, 100, '#08131d', 9);
    this.rect(campX - 29, campY - 68, 58, 99, '#344f59', 7);
    this.rect(campX - 24, campY - 63, 48, 88, '#192f3b', 5);
    this.ellipse(campX, campY + 3, 24, 10, '#427773');
    context.strokeStyle = '#9fe4c8'; context.lineWidth = 2;
    context.beginPath(); context.ellipse(campX, campY + 3, 19, 7, 0, 0, Math.PI * 2); context.stroke();
    this.circle(campX, campY - 40, 14, '#0f232e'); this.circle(campX, campY - 40, 9, '#72c9ba');
    context.strokeStyle = '#163f47'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(campX, campY - 46); context.lineTo(campX, campY - 36);
    context.moveTo(campX - 4, campY - 40); context.lineTo(campX, campY - 36); context.lineTo(campX + 4, campY - 40); context.stroke();
    this.text('스토리', campX, campY + 51, this.worldWidth === 600 ? 16 : 11, '#d9eee5');
    const entrance = this.path(0);
    this.rect(entrance.x - 21, entrance.y - 27, 42, 7, '#e2a75a', 2);
    this.text('진입', entrance.x, entrance.y - 36, this.worldWidth === 600 ? 16 : 11, '#ffd09a');
    const serviceY = road.bottom + 57;
    this.rect(road.left + 18, serviceY, 95, 12, '#29414b', 2);
    for (let i = 0; i < 5; i++) this.rect(road.left + 23 + i * 17, serviceY + 3, 10, 3, '#a5c4bd55', 1);
    this.text('EXTRACTION SITE', this.worldWidth * .59, serviceY + 11, this.worldWidth === 600 ? 13 : 10, '#648490');
  }

  miningRig(now) {
    const context = this.ctx, road = roadFor(this.worldWidth, this.worldHeight);
    const compact = this.worldHeight === 330;
    const rigX = this.worldWidth * .64, rigY = compact ? 60 : road.top - (this.worldWidth === 600 ? 64 : 54);
    context.save();
    if (compact) { context.translate(rigX, rigY); context.scale(.6, .6); context.translate(-rigX, -rigY); }
    const progress = clamp(this.expedition?.miningProgress || 0);
    const drilling = !this.reduced && this.player.status === 'active' && progress < 1;
    const piston = drilling ? Math.sin(now / 100) * 3 : 0;
    this.ellipse(rigX, rigY + 36, 61, 10, '#01081099');
    this.rect(rigX - 50, rigY + 23, 100, 10, '#162531', 3);
    this.rect(rigX - 45, rigY + 19, 90, 8, '#687b81', 2);
    for (const side of [-1, 1]) {
      this.rect(rigX + side * 39 - 5, rigY - 38, 10, 61, '#405764', 2);
      this.rect(rigX + side * 39 - 3, rigY - 32, 3, 51, '#819595');
    }
    this.rect(rigX - 48, rigY - 40, 96, 13, '#e2aa58', 3);
    for (let x = -36; x <= 30; x += 17) this.rect(rigX + x, rigY - 38, 8, 9, '#3b4345', 1);
    this.rect(rigX - 17, rigY - 26 + piston, 34, 37, '#394d57', 5);
    this.rect(rigX - 14, rigY - 25 + piston, 28, 18, '#edb565', 3);
    this.rect(rigX - 8, rigY - 20 + piston, 16, 8, '#132734', 2);
    this.circle(rigX - 3, rigY - 16 + piston, 1.8, '#b1f4db'); this.circle(rigX + 3, rigY - 16 + piston, 1.8, '#b1f4db');
    this.rect(rigX - 6, rigY + 7 + piston, 12, 16, '#a5b9bc', 2);
    for (let i = 0; i < 3; i++) {
      const y = rigY + 8 + i * 5 + piston;
      context.strokeStyle = '#425c66'; context.lineWidth = 2;
      context.beginPath(); context.moveTo(rigX - 6, y); context.lineTo(rigX + 6, y + 4); context.stroke();
    }
    if (drilling) for (let i = 0; i < 3; i++) {
      const phase = (now / 420 + i / 3) % 1;
      this.circle(rigX + Math.cos(i * 2.3) * phase * 22, rigY + 25 - Math.sin(phase * Math.PI) * 11, 1.5 * (1 - phase), '#f1c481');
    }
    this.rect(rigX - 43, rigY + 38, 86, 4, '#08151f', 2);
    this.rect(rigX - 43, rigY + 38, Math.max(1, progress * 86), 4, '#eabc6c', 2);
    context.restore();
  }

  drawSprite(frame, x, y, height, facing = 1, stretchX = 1, stretchY = 1, rotation = 0) {
    const context = this.ctx;
    context.save(); context.translate(x, y); context.rotate(rotation);
    context.scale(facing * stretchX, stretchY);
    if (frame && frame.complete && frame.naturalWidth) {
      const width = height * frame.width / frame.height;
      context.drawImage(frame.raster || frame, -width / 2, -height, width, height);
    } else {
      // Brief local SVG decode fallback; it never determines combat.
      this.rect(-12, -32, 24, 27, '#a8d4c4', 7); this.rect(-8, -27, 16, 10, '#345663', 3);
      this.circle(-4, -22, 1.5, '#e2f1cd'); this.circle(4, -22, 1.5, '#e2f1cd');
      this.rect(-13, -7, 26, 7, '#4e7078', 3);
    }
    context.restore();
  }

  soldier(view, now, delta) {
    const unit = view.unit, definition = this.definitions.get(unit.definitionId);
    const context = this.ctx, home = unit.dispatched ? this.portalSlot(unit.id) : this.position(unit.slot);
    const blend = this.reduced ? 1 : 1 - Math.exp(-delta / 85);
    view.x += (home.x - view.x) * blend; view.y += (home.y - view.y) * blend;
    const x = view.x, y = view.y, color = elementColors[definition.element] || palette[definition.faction];
    const hero = definition.rarity === 'hero' || definition.rarity === 'legend';
    const height = this.unitHeight(definition);
    let stretchX = 1, stretchY = 1, offsetX = 0, offsetY = 0, rotation = 0;
    const age = now - view.attackAt;
    const [prepare, travel, recovery] = attackTimings[definition.element] || defaultAttackTiming;
    const appliance = applianceKind(definition);
    if (!this.reduced) {
      // Rigid appliances act through their lid, fan and lens, rather than a shared squash.
      if (!appliance) offsetY = Math.sin(now / 530 + unit.id) * .35;
      if (age >= 0 && age < prepare) {
        const windup = age / prepare;
        rotation = view.facing * windup * (definition.element === 'laser' ? -.018 : .012);
      } else if (age >= prepare && age < prepare + travel + recovery) {
        const shotAge = age - prepare;
        const kick = shotAge < travel ? Math.sin(shotAge / travel * Math.PI * .5) : 1 - (shotAge - travel) / recovery;
        const recoil = definition.element === 'wind' ? 3.5 : definition.element === 'laser' ? .6 : definition.element === 'fire' ? 1.5 : definition.attackPattern === 'blast' ? 5 : 2.5;
        offsetX = -view.facing * kick * recoil;
        rotation = -view.facing * kick * (definition.element === 'laser' ? .008 : definition.element === 'wind' ? .035 : .02);
      }
      const summonAge = now - view.born;
      if (view.arrivalKind !== 'combine' && summonAge < 300) {
        const pop = easeOut(summonAge / 200);
        stretchX *= .88 + pop * .12; stretchY *= .88 + pop * .12;
        offsetY -= (1 - pop) * 55;
        if (summonAge > 180) offsetY += Math.sin((summonAge - 180) / 120 * Math.PI) * 2;
        context.save(); context.globalAlpha = 1 - pop;
        context.strokeStyle = '#ffe0a4'; context.lineWidth = 2;
        context.beginPath(); context.ellipse(x, y + 1, 19 + pop * 25, 8 + pop * 10, 0, 0, Math.PI * 2); context.stroke(); context.restore();
      }
    }
    if (hero) {
      this.ellipse(x, y + 3, 25, 9, '#efd78435');
      context.strokeStyle = '#ffe4a277'; context.lineWidth = 1.5;
      context.beginPath(); context.ellipse(x, y + 2, 24, 8, 0, 0, Math.PI * 2); context.stroke();
    }
    this.ellipse(x, y + 2, hero ? 23 : 18, 6, '#102c2870');
    if (this.selected.has(unit.id)) {
      context.strokeStyle = '#071820'; context.lineWidth = 7;
      context.beginPath(); context.ellipse(x, y + 2, 25, 9, 0, 0, Math.PI * 2); context.stroke();
      context.strokeStyle = '#fff3a6'; context.lineWidth = 3; context.stroke();
      this.circle(x, y - height - 8, 3, '#ffe3a0');
    }
    let pose = 'idle';
    if (!this.reduced && age >= 0) {
      if (age < prepare) pose = appliance === 'lighter' && view.attackFromOpenLid ? 'recovery' : 'windup';
      else if (age < prepare + travel) pose = 'strike';
      else if (appliance === 'lighter' && age < LIGHTER_READY_MS) pose = 'recovery';
    }
    const frame = this.unitFrame(definition, pose);
    this.drawSprite(frame, x + offsetX, y + offsetY, height, view.facing, stretchX, stretchY, rotation);
    if (definition.element) this.circle(x, y + 3, 3, color);
    // Motion reduction retains a short, steady targeting trace with no particles or recoil.
    if (this.reduced && age >= 0 && age < 180 && view.hitPositions?.length) {
      context.save(); context.globalAlpha = .65; context.strokeStyle = color; context.lineWidth = 1.5;
      const origin = this.weaponOrigin(definition, x, y, view.facing);
      context.beginPath(); context.moveTo(origin.x, origin.y);
      for (const position of view.hitPositions) context.lineTo(position.x, position.y);
      context.stroke(); context.restore();
    }
    // Labels are optional detail; the accessible DOM roster carries the full name.
    if ((this.worldWidth !== 600 && this.scale > .55 && this.units.size <= 10) || this.selected.has(unit.id)) this.text(unit.dispatched ? '파견 중' : definition.name, x, y + 18, this.worldWidth === 600 ? 18 : 10, unit.dispatched ? '#ffedb9' : '#f5f7df');
    if (hero || definition.rarity === 'elite') {
      // Tier marks are fixed geometry; dozens of robots need no per-frame font rasterization.
      context.save(); context.translate(x + (hero ? 21 : 19), y - height + (hero ? 7 : 5));
      context.fillStyle = hero ? '#ffe7a0' : color; context.strokeStyle = '#17313d'; context.lineWidth = 1.5;
      context.beginPath(); context.moveTo(0, hero ? -6 : -4);
      if (hero) {
        context.lineTo(1.5, -1.5); context.lineTo(5, 0); context.lineTo(1.5, 1.5);
        context.lineTo(0, 6); context.lineTo(-1.5, 1.5); context.lineTo(-5, 0); context.lineTo(-1.5, -1.5);
      } else { context.lineTo(3.5, 0); context.lineTo(0, 4); context.lineTo(-3.5, 0); }
      context.closePath(); context.fill(); context.stroke(); context.restore();
    }
  }

  enemyFrameIndex(enemy, now = 0) {
    if (!this.walkFrames.length) return enemy.boss ? 6 : (enemy.id % 3) * 4 + (enemy.id % 4 === 0 ? 2 : 0);
    const row = enemy.boss ? 2 : enemy.id % 3 === 0 ? 1 : 0;
    const moving = !this.reduced && this.player.status === 'active' && !enemy.attackingFacility;
    return row * 4 + (moving ? Math.floor(now / 110 * Math.min(this.speed, 3) + enemy.id) % 4 : 0);
  }
  enemy(view, now) {
    const enemy = view.enemy, position = this.path(this.progress(view, now)), context = this.ctx;
    // Small visual offsets make the stationary crowd readable; combat still uses the shared path point.
    if (enemy.attackingFacility) { position.x += (enemy.id % 3 - 1) * 8; position.y += Math.floor(enemy.id % 9 / 3) * 5; }
    const size = enemy.boss ? 106 : 51 + enemy.id % 3 * 3;
    const walking = !this.reduced && this.player.status === 'active' && !enemy.attackingFacility;
    const bounce = walking ? Math.abs(Math.sin(now * .009 * Math.min(this.speed, 3) + enemy.id)) * 2 : 0;
    const lean = walking ? Math.sin(now * .009 * Math.min(this.speed, 3) + enemy.id) * .035 : 0;
    this.ellipse(position.x, position.y + 2, enemy.boss ? 28 : 12, enemy.boss ? 9 : 4, '#10272275');
    const frameIndex = this.enemyFrameIndex(enemy, now);
    this.drawSprite(this.walkFrames[frameIndex], position.x, position.y - bounce,
      size, position.face, 1, 1, lean);
    if (enemy.slowed) {
      context.strokeStyle = '#86dcff'; context.lineWidth = 2;
      context.beginPath(); context.ellipse(position.x, position.y + 1, enemy.boss ? 28 : 15, 6, 0, 0, Math.PI * 2); context.stroke();
      // Frost marks follow the actual slow state; they never freeze the walking cycle.
      context.beginPath();
      for (const side of [-1, 1]) {
        const frostX = position.x + side * size * .22, frostY = position.y - size * .4;
        context.moveTo(frostX, frostY - 5); context.lineTo(frostX, frostY + 5);
        context.moveTo(frostX - 4, frostY - 3); context.lineTo(frostX + 4, frostY + 3);
        context.moveTo(frostX - 4, frostY + 3); context.lineTo(frostX + 4, frostY - 3);
      }
      context.stroke();
      this.text('감속', position.x, position.y - size - 12, this.worldWidth === 600 ? 15 : 10, '#b1ebff');
    }
    const hitAge = now - view.hitAt;
    if (hitAge >= 0 && hitAge < 130) {
      context.save(); context.globalAlpha = (1 - hitAge / 130) * .6;
      context.strokeStyle = '#fff3cb'; context.lineWidth = enemy.boss ? 4 : 2;
      context.beginPath(); context.ellipse(position.x, position.y - size * .45, size * .24, size * .39, 0, 0, Math.PI * 2); context.stroke(); context.restore();
    }
    const barWidth = enemy.boss ? 62 : 26, barY = position.y - size - 8;
    this.rect(position.x - barWidth / 2, barY, barWidth, enemy.boss ? 5 : 3, '#233d38', 2);
    this.rect(position.x - barWidth / 2, barY, barWidth * clamp(enemy.hp / enemy.maxHp), enemy.boss ? 5 : 3, enemy.boss ? '#efbc79' : '#e1a28b', 2);
    if (enemy.boss) this.text('폭주 압축기', position.x, barY - 6, 11, '#ffe7ac');
  }

  drawEffects(now) {
    const context = this.ctx;
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index], age = now - effect.born;
      if (age > effect.life || this.reduced) { this.effects.splice(index, 1); continue; }
      if (age < 0) {
        if (effect.type === 'death') this.drawSprite(this.walkFrames[effect.frame], effect.x, effect.y,
          effect.boss ? 106 : 54, effect.facing);
        continue;
      }
      const t = clamp(age / effect.life);
      context.save();
      if (effect.type === 'fire') {
        const distance = Math.hypot(effect.tx - effect.x, effect.ty - effect.y);
        context.translate(effect.x, effect.y); context.rotate(Math.atan2(effect.ty - effect.y, effect.tx - effect.x));
        const reach = distance * (.75 + .25 * easeOut(t * 4)), spread = (6 + Math.sin(t * Math.PI) * 5);
        context.globalAlpha = 1 - t * .7; context.fillStyle = '#ee8748';
        context.beginPath(); context.moveTo(0, -2);
        context.quadraticCurveTo(reach * .3, -spread, reach * .55, -spread * .7);
        context.lineTo(reach * .72, -spread); context.lineTo(reach * .69, -spread * .25);
        context.lineTo(reach, 0); context.lineTo(reach * .7, spread * .4);
        context.lineTo(reach * .62, spread); context.quadraticCurveTo(reach * .3, spread, 0, 2);
        context.closePath(); context.fill();
        context.fillStyle = '#ffe7a0'; context.beginPath(); context.moveTo(0, -1);
        context.quadraticCurveTo(reach * .4, -spread * .4, reach * .85, 0);
        context.quadraticCurveTo(reach * .3, spread * .45, 0, 1); context.fill();
      } else if (effect.type === 'laser') {
        context.globalAlpha = 1 - t * .65;
        context.strokeStyle = effect.color; context.lineWidth = 2.5;
        context.beginPath(); context.moveTo(effect.x, effect.y); context.lineTo(effect.tx, effect.ty); context.stroke();
        context.strokeStyle = '#fff0ff'; context.lineWidth = .8; context.stroke();
        this.circle(effect.tx, effect.ty, 2.5 * (1 - t) + 1, '#fff0ff');
      } else if (effect.type === 'bolt' || effect.type === 'blast') {
        const arc = effect.type === 'blast' && effect.element !== 'wind' ? Math.sin(t * Math.PI) * 23 : 0;
        const x = effect.x + (effect.tx - effect.x) * t, y = effect.y + (effect.ty - effect.y) * t - arc;
        const angle = Math.atan2(effect.ty - effect.y, effect.tx - effect.x);
        context.translate(x, y); context.rotate(angle);
        if (effect.element === 'wind') {
          context.strokeStyle = effect.color; context.lineWidth = 2; context.globalAlpha = .85;
          for (let ribbon = 0; ribbon < 3; ribbon++) {
            const start = -ribbon * 9;
            context.beginPath(); context.moveTo(start - 6, -6 - ribbon * 3);
            context.quadraticCurveTo(start + 13, 0, start - 6, 6 + ribbon * 3); context.stroke();
          }
        } else if (effect.type === 'blast') {
          this.ellipse(0, 0, 7, 5, '#ffdf9b'); this.ellipse(-4, 0, 5, 4, '#b77843');
          context.globalAlpha = .35; this.rect(-28, -3, 20, 6, '#f4b974', 3);
        } else {
          this.rect(-24, -3, 28, 6, effect.color, 3); this.rect(-15, -1, 20, 2, '#fff9db', 1);
          context.globalAlpha = .2; this.rect(-42, -4, 24, 8, effect.color, 4);
        }
      } else if (effect.type === 'arc') {
        const visible = Math.min(effect.points.length, 2 + Math.floor(age / 25));
        context.globalAlpha = Math.min(1, (1 - t) * 2.5);
        const points = [];
        for (let index = 1; index < visible; index++) {
          const a = effect.points[index - 1], b = effect.points[index];
          points.push(a);
          for (let step = 1; step < 6; step++) {
            const at = step / 6, jitter = Math.sin(step * 7.3 + index * 3 + Math.floor(age / 45) * 2) * 7;
            points.push({ x: a.x + (b.x - a.x) * at + jitter, y: a.y + (b.y - a.y) * at - jitter });
          }
          points.push(b);
        }
        for (const [color, width] of [[effect.color, 5], ['#f0ffff', 1.6]]) {
          context.strokeStyle = color; context.lineWidth = width;
          context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
        }
      } else if (effect.type === 'muzzle') {
        context.translate(effect.x, effect.y); context.scale(effect.facing, 1); context.globalAlpha = 1 - t;
        if (effect.element === 'laser') this.circle(0, 0, 3 * (1 - t) + 1, '#f5d9ff');
        else if (effect.element === 'wind') {
          context.strokeStyle = effect.color; context.lineWidth = 1.5;
          context.beginPath(); context.arc(0, 0, 4 + t * 6, -.8, .8); context.stroke();
        } else {
          this.ellipse(2, 0, (effect.element === 'fire' ? 5 : 13) * (1 - t) + 3, 5 * (1 - t) + 2, effect.color);
          this.ellipse(0, 0, 4, 2, '#fffce8');
        }
      } else if (effect.type === 'impact') {
        context.translate(effect.x, effect.y); context.globalAlpha = 1 - t;
        if (effect.element === 'wind') {
          context.rotate(effect.angle); context.strokeStyle = effect.color; context.lineWidth = 2 * (1 - t) + .5;
          for (const offset of [-8, 0, 8]) {
            context.beginPath(); context.moveTo(-10 + t * 8, offset - 4);
            context.quadraticCurveTo(8 + t * 10, offset, -5 + t * 8, offset + 4); context.stroke();
          }
        } else if (effect.element === 'fire') {
          this.ellipse(-3, -2 - t * 7, 5 * (1 - t) + 1, 8 * (1 - t) + 2, '#ffb866');
          this.ellipse(4, 2 - t * 10, 3 * (1 - t) + 1, 6 * (1 - t) + 1, '#ffe3a0');
        } else if (effect.element === 'laser' || effect.element === 'frost') {
          context.strokeStyle = effect.color; context.lineWidth = 1.8;
          const radius = 3 + t * 9;
          for (let ray = 0; ray < (effect.element === 'frost' ? 6 : 4); ray++) {
            const angle = ray * Math.PI * 2 / (effect.element === 'frost' ? 6 : 4);
            context.beginPath(); context.moveTo(Math.cos(angle) * 2, Math.sin(angle) * 2);
            context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius); context.stroke();
          }
          this.circle(0, 0, 2 * (1 - t), '#fff4fc');
        } else {
          const radius = effect.blast ? 9 + easeOut(t) * 37 : 3 + t * 15;
          if (effect.blast) {
            this.circle(0, 0, radius * .86, '#d68d4133');
            this.circle(0, 0, Math.max(0, 14 * (1 - t)), '#ffdc8f');
          }
          context.strokeStyle = effect.color; context.lineWidth = effect.blast ? 3 - t * 2 : 2;
          context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.stroke();
          context.strokeStyle = '#fff7dc'; context.lineWidth = 2 * (1 - t) + .5;
          context.beginPath(); context.moveTo(-5 - t * 9, 0); context.lineTo(5 + t * 9, 0);
          context.moveTo(0, -5 - t * 9); context.lineTo(0, 5 + t * 9); context.stroke();
        }
      } else if (effect.type === 'assembly') {
        const lock = easeOut(t / .6), distance = 30 - lock * 12;
        context.translate(effect.x, effect.y); context.globalAlpha = t < .65 ? .85 : (1 - t) / .35;
        context.strokeStyle = effect.color; context.lineWidth = 2.5;
        for (const side of [-1, 1]) {
          context.beginPath(); context.moveTo(side * (distance - 8), -distance);
          context.lineTo(side * distance, -distance); context.lineTo(side * distance, -distance + 8);
          context.moveTo(side * (distance - 8), distance);
          context.lineTo(side * distance, distance); context.lineTo(side * distance, distance - 8); context.stroke();
          if (t > .55) this.circle(side * 18, 0, 2.5, '#fff0be');
        }
      } else if (effect.type === 'landing') {
        const fall = clamp(t / .45);
        context.globalAlpha = (1 - t) * .6;
        this.rect(effect.x - 18, effect.y - 125 + fall * 70, 36, 67 * (1 - fall) + 8, effect.color, 9);
        context.strokeStyle = effect.color; context.lineWidth = 2;
        context.beginPath(); context.ellipse(effect.x, effect.y, 15 + t * 26, 6 + t * 11, 0, 0, Math.PI * 2); context.stroke();
      } else if (effect.type === 'spark') {
        context.globalAlpha = 1 - t; const x = effect.x + effect.vx * t, y = effect.y + effect.vy * t + t * t * 13;
        context.translate(x, y); context.rotate(t * 3);
        this.rect(-2, -1, 5 * (1 - t), 2 * (1 - t), effect.color, .5);
      } else if (effect.type === 'damage') {
        context.globalAlpha = Math.min(1, (1 - t) * 3);
        this.text(effect.label, effect.x, effect.y - easeOut(t) * 22, this.worldWidth === 600 ? 18 : 13, effect.color);
      } else if (effect.type === 'death') {
        context.globalAlpha = 1 - easeOut(t);
        this.drawSprite(this.walkFrames[effect.frame], effect.x, effect.y + t * 6,
          effect.boss ? 106 : 54, effect.facing, 1 + t * .15, 1 - t * .5, effect.facing * t * .4);
      }
      context.restore();
    }
  }

  draw(now) {
    this.configureLayout();
    const delta = Math.min(50, Math.max(0, now - this.lastFrame)); this.lastFrame = now;
    if (this.player && !this.canvas.closest('[hidden]')) {
      const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      if (rect.width > 0 && rect.height > 0) {
        const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
        if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
        const context = this.ctx;
        this.scale = Math.min(rect.width / this.worldWidth, rect.height / this.worldHeight);
        this.ox = (rect.width - this.worldWidth * this.scale) / 2; this.oy = (rect.height - this.worldHeight * this.scale) / 2;
        context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, rect.width, rect.height);
        context.translate(this.ox, this.oy); context.scale(this.scale, this.scale);
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        this.ground(now);
        this.drawRange();
        for (const entry of this.drawOrder) {
          if (entry.enemy) this.enemy(entry.enemy, now); else this.soldier(entry.unit, now, delta);
        }
        this.drawEffects(now);
      }
    }
    requestAnimationFrame(time => this.draw(time));
  }
}
