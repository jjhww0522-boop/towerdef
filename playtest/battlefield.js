import { unitSpriteUrl, enemySpriteUrl } from './casual-art.js';

const palette = { shu: '#59b991', wei: '#70a9dc', wu: '#ed966b' };
const WORLD_W = 1000, WORLD_H = 440, MAX_EFFECTS = 120;
const slot = (n, width = WORLD_W) => width === 600 ?
  ({ x: 130 + n % 6 * 60, y: 248 + Math.floor(n / 6) * 58 }) :
  ({ x: 218 + n % 10 * 60, y: 185 + Math.floor(n / 10) * 61 });
const roadFor = (width, height) => ({ left: width * .12, right: width * .84, top: height * .24, bottom: height * .8 });
const path = (progress, width = WORLD_W, height = WORLD_H) => {
  const road = roadFor(width, height), roadWidth = road.right - road.left, roadHeight = road.bottom - road.top;
  let distance = ((progress % 1 + 1) % 1) * (roadWidth + roadHeight) * 2;
  if (distance < roadWidth) return { x: road.left + distance, y: road.top, face: 1 };
  distance -= roadWidth;
  if (distance < roadHeight) return { x: road.right, y: road.top + distance, face: 1 };
  distance -= roadHeight;
  if (distance < roadWidth) return { x: road.right - distance, y: road.bottom, face: -1 };
  return { x: road.left, y: road.bottom - (distance - roadWidth), face: -1 };
};
const clamp = value => Math.max(0, Math.min(1, value));
const easeOut = value => 1 - Math.pow(1 - clamp(value), 3);
// Presentation only. Attack stamps, health and removal come from the server.
export class Battlefield {
  constructor(canvas, onSelect) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.units = new Map(); this.enemies = new Map(); this.effects = [];
    this.player = null; this.selected = new Set(); this.reduced = false;
    this.frames = new Map(); this.walkFrames = []; this.drawOrder = [];
    this.lastFrame = performance.now(); this.lastSnapshotAt = 0; this.snapshotDelay = 200;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.configureLayout();
    for (let index = 0; index < 12; index++) {
      const frame = new Image(96, 96);
      frame.src = enemySpriteUrl(Math.floor(index / 4), index % 4);
      this.walkFrames.push(frame);
    }
    canvas.addEventListener('click', event => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left - this.ox) / this.scale;
      const y = (event.clientY - rect.top - this.oy) / this.scale;
      let nearest = null, distance = Infinity;
      for (const [unitId, view] of this.units) {
        const d = Math.hypot(x - view.x, y - (view.y - 25));
        if (d < 33 && d < distance) { nearest = unitId; distance = d; }
      }
      if (nearest !== null) onSelect(nearest);
    });
    requestAnimationFrame(now => this.draw(now));
  }

  configureLayout() {
    const portrait = typeof matchMedia === 'function' && matchMedia('(max-width:600px)').matches;
    const width = portrait ? 600 : WORLD_W, height = portrait ? 700 : WORLD_H;
    if (this.worldWidth === width && this.worldHeight === height) return;
    this.worldWidth = width; this.worldHeight = height; this.effects.length = 0;
    for (const view of this.units.values()) {
      const target = view.unit.dispatched ? this.portalSlot(view.unit.id) : this.position(view.unit.slot);
      view.x = target.x; view.y = target.y;
    }
  }
  position(index) { return slot(index, this.worldWidth); }
  path(progress) { return path(progress, this.worldWidth, this.worldHeight); }

  unitFrame(definition, pose) {
    const key = definition.id + ':' + pose;
    if (!this.frames.has(key)) {
      const frame = new Image(96, 96);
      frame.src = unitSpriteUrl(definition, pose);
      this.frames.set(key, frame);
    }
    return this.frames.get(key);
  }

  addEffect(effect) {
    if (this.reduced || this.effects.length >= MAX_EFFECTS) return;
    this.effects.push(effect);
  }

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
    if (changedLane) { this.units.clear(); this.enemies.clear(); this.effects.length = 0; this.lastSnapshotAt = 0; }
    this.player = player; this.definitions = definitions; this.selected = selected;
    this.speed = speed; this.reduced = reduced;
    if (reduced) this.effects.length = 0;
    const unitIds = new Set(player.units.map(unit => unit.id));
    const enemyIds = new Set(player.enemies.map(enemy => enemy.id));
    const previousArrival = this.lastSnapshotAt;
    this.lastSnapshotAt = now;
    if (previousArrival && now > previousArrival + 40) this.snapshotDelay = Math.max(80, Math.min(260, now - previousArrival));

    for (const unit of player.units) {
      let view = this.units.get(unit.id);
      const home = this.position(unit.slot), target = unit.dispatched ? this.portalSlot(unit.id) : home;
      if (!view) {
        view = { x: target.x, y: target.y, born: changedLane ? now - 1000 : now,
          attackAt: -10000, lastAttackTick: unit.lastAttackTick, facing: 1, targetX: target.x + 1, targetY: target.y,
          dispatched: unit.dispatched };
        this.units.set(unit.id, view);
        if (!changedLane) this.burst(home.x, home.y - 18, palette[definitions.get(unit.definitionId).faction], now, 8);
      } else {
        if (unit.lastAttackTick != null && unit.lastAttackTick !== view.lastAttackTick) {
          // Ignore older stamps after a room reset; never replay initial history.
          if (view.lastAttackTick == null || unit.lastAttackTick > view.lastAttackTick) this.attack(unit, view, now);
          view.lastAttackTick = unit.lastAttackTick;
        }
        if (unit.dispatched !== view.dispatched) {
          this.burst(view.x, view.y - 9, '#b9eedb', now, 6);
          view.dispatched = unit.dispatched;
        }
      }
      view.unit = unit;
    }
    for (const unitId of this.units.keys()) if (!unitIds.has(unitId)) this.units.delete(unitId);

    for (const enemy of player.enemies) {
      const view = this.enemies.get(enemy.id);
      if (view) {
        if (view.hp > enemy.hp) {
          const position = this.path(enemy.progress), damage = Math.round(view.hp - enemy.hp);
          view.hitAt = now + 100;
          this.addEffect({ type: 'damage', x: position.x, y: position.y - (enemy.boss ? 70 : 34),
            label: String(damage), color: enemy.boss ? '#ffe6a0' : '#fff5dc', born: now + 100, life: 650 });
          this.burst(position.x, position.y - 18, '#ffe8ad', now + 90, enemy.boss ? 7 : 3);
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
      this.addEffect({ type: 'death', x: position.x, y: position.y, facing: position.face,
        frame: this.enemyFrameIndex(view.enemy, now), boss: view.enemy.boss, born: now, life: 390 });
      this.burst(position.x, position.y - 14, '#e2d5ad', now + 80, view.enemy.boss ? 10 : 4);
      this.enemies.delete(enemyId);
    }
    this.drawOrder.length = 0;
    for (const view of this.enemies.values()) this.drawOrder.push({ enemy: view, depth: this.path(view.progress).y });
    for (const view of this.units.values()) this.drawOrder.push({ unit: view, depth: view.y });
    this.drawOrder.sort((a, b) => a.depth - b.depth);
  }

  portalSlot(id) { return { x: this.worldWidth * .934 + (id % 2 - .5) * 24, y: this.worldHeight * .50 + (id % 2 - .5) * 24 }; }
  progress(view, now) { return view.from + (view.to - view.from) * clamp((now - view.at) / this.snapshotDelay); }

  attack(unit, view, now) {
    const definition = this.definitions.get(unit.definitionId);
    const isStory = typeof unit.lastTargetId === 'string';
    const target = isStory ? { x: this.worldWidth * .949, y: this.worldHeight * .382 } :
      this.player.enemies.find(enemy => enemy.id === unit.lastTargetId);
    const previousTarget = this.enemies.get(unit.lastTargetId);
    const position = isStory ? target : target ? this.path(target.progress) :
      previousTarget ? this.path(this.progress(previousTarget, now)) : null;
    view.attackAt = now;
    if (!position) return;
    view.targetX = position.x; view.targetY = position.y - 16;
    view.facing = position.x < view.x ? -1 : 1;
    if (definition.troop === 'archer') {
      this.addEffect({ type: 'arrow', x: view.x + view.facing * 10, y: view.y - 29,
        tx: position.x, ty: position.y - 15, color: '#ffe7ab', born: now + 80, life: 160 });
    } else {
      this.addEffect({ type: 'slash', x: position.x, y: position.y - 17,
        color: definition.rarity === 'hero' ? '#fff0ae' : palette[definition.faction],
        facing: view.facing, born: now + 90, life: 170 });
    }
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
    const context = this.ctx; context.font = '600 ' + size + 'px "Malgun Gothic",system-ui,sans-serif';
    context.textAlign = 'center'; context.lineJoin = 'round';
    context.strokeStyle = '#142620e0'; context.lineWidth = 3;
    context.strokeText(value, x, y); context.fillStyle = color; context.fillText(value, x, y);
  }

  ground() {
    const context = this.ctx, road = roadFor(this.worldWidth, this.worldHeight);
    this.rect(0, 0, this.worldWidth, this.worldHeight, '#c4df9e');
    // Quiet grass and a continuous stone path keep moving targets easy to follow.
    for (let index = 0; index < 44; index++) {
      const x = (index * 139 + 31) % this.worldWidth, y = (index * 73 + 37) % this.worldHeight;
      this.ellipse(x, y, 15, 5, '#afd08b');
      context.strokeStyle = '#91b775'; context.lineWidth = 2;
      context.beginPath(); context.moveTo(x - 3, y); context.lineTo(x - 6, y - 5);
      context.moveTo(x + 2, y); context.lineTo(x + 5, y - 6); context.stroke();
    }
    for (const [color, width] of [['#91a981', 49], ['#eee2bd', 43]]) {
      context.strokeStyle = color; context.lineWidth = width; context.lineJoin = 'round';
      context.beginPath(); context.roundRect(road.left, road.top, road.right - road.left, road.bottom - road.top, 10); context.stroke();
    }
    const stoneCount = this.worldWidth === 600 ? 50 : 58;
    for (let index = 0; index < stoneCount; index++) {
      const point = this.path(index / stoneCount);
      this.rect(point.x - 10, point.y - 6, 20, 12, index % 3 ? '#e0d2ae' : '#f8edcf', 4);
    }
    context.strokeStyle = '#84aa7255'; context.lineWidth = 1.5;
    for (let index = 0; index < 30; index++) {
      const position = this.position(index);
      context.beginPath(); context.ellipse(position.x, position.y + 2, 17, 6, 0, 0, Math.PI * 2); context.stroke();
    }
    const campX = this.worldWidth * .934, campY = this.worldHeight * .50;
    this.ellipse(campX, campY + 5, 35, 16, '#a7c28e');
    context.strokeStyle = '#526d57'; context.lineWidth = 4;
    context.beginPath(); context.moveTo(campX, campY - 8); context.lineTo(campX, campY - 55); context.stroke();
    context.fillStyle = '#f3bc68'; context.beginPath(); context.moveTo(campX + 2, campY - 55);
    context.lineTo(campX + 28, campY - 47); context.lineTo(campX + 2, campY - 36); context.closePath(); context.fill();
    this.text('스토리 지원', campX, campY + 32, this.worldWidth === 600 ? 16 : 11, '#fff8dc');
    this.text('입구', road.left, road.top - 30, this.worldWidth === 600 ? 16 : 11, '#fff8dc');
  }

  drawSprite(frame, x, y, height, facing = 1, stretchX = 1, stretchY = 1, rotation = 0) {
    const context = this.ctx;
    context.save(); context.translate(x, y); context.rotate(rotation);
    context.scale(facing * stretchX, stretchY);
    if (frame && frame.complete && frame.naturalWidth) {
      const width = height * frame.width / frame.height;
      context.drawImage(frame, -width / 2, -height, width, height);
    } else {
      // Brief local SVG decode fallback; it never determines combat.
      this.rect(-10, -25, 20, 25, '#b9ceab', 4); this.rect(-9, -40, 18, 19, '#e5c597', 6);
      this.rect(-12, -42, 24, 8, '#597f70', 3);
    }
    context.restore();
  }

  soldier(view, now, delta) {
    const unit = view.unit, definition = this.definitions.get(unit.definitionId);
    const context = this.ctx, home = unit.dispatched ? this.portalSlot(unit.id) : this.position(unit.slot);
    const blend = this.reduced ? 1 : 1 - Math.exp(-delta / 85);
    view.x += (home.x - view.x) * blend; view.y += (home.y - view.y) * blend;
    const x = view.x, y = view.y, color = palette[definition.faction];
    const hero = definition.rarity === 'hero' || definition.rarity === 'legend';
    const height = hero ? 77 : definition.rarity === 'elite' ? 68 : 60;
    let stretchX = 1, stretchY = 1, offsetX = 0, offsetY = 0, rotation = 0;
    const age = now - view.attackAt;
    if (!this.reduced) {
      offsetY = Math.sin(now / 410 + unit.id) * .8;
      if (age >= 0 && age < 80) {
        const windup = age / 80; stretchX = 1 + windup * .07; stretchY = 1 - windup * .07;
        offsetX = -view.facing * windup * 3; rotation = -view.facing * windup * .045;
      } else if (age >= 80 && age < 180) {
        const strike = Math.sin((age - 80) / 100 * Math.PI);
        stretchX = 1 - strike * .045; stretchY = 1 + strike * .06;
        offsetX = view.facing * strike * 7; rotation = view.facing * strike * .09;
      } else if (age >= 180 && age < 320) {
        const recoil = (1 - (age - 180) / 140) * .04;
        stretchX += recoil; stretchY -= recoil;
      }
      const summonAge = now - view.born;
      if (summonAge < 350) {
        const pop = easeOut(summonAge / 350);
        stretchX *= .35 + pop * .65; stretchY *= .35 + pop * .65;
        offsetY -= (1 - pop) * 22;
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
      context.strokeStyle = '#34554b'; context.lineWidth = 7;
      context.beginPath(); context.ellipse(x, y + 2, 25, 9, 0, 0, Math.PI * 2); context.stroke();
      context.strokeStyle = '#fff3a6'; context.lineWidth = 3; context.stroke();
      this.circle(x, y - height - 8, 3, '#ffe3a0');
    }
    const pose = this.reduced ? 'idle' : age >= 0 && age < 80 ? 'windup' : age >= 80 && age < 230 ? 'strike' : 'idle';
    const frame = this.unitFrame(definition, pose);
    this.drawSprite(frame, x + offsetX, y + offsetY, height, view.facing, stretchX, stretchY, rotation);
    // Labels are optional detail; the accessible DOM roster carries the full name.
    if ((this.worldWidth !== 600 && this.scale > .55) || this.selected.has(unit.id)) this.text(unit.dispatched ? '파견 중' : definition.name, x, y + 18, this.worldWidth === 600 ? 18 : 10, unit.dispatched ? '#ffedb9' : '#f5f7df');
    if (hero) this.text('✦', x + 21, y - height + 12, 12, '#ffe7a0');
    else if (definition.rarity === 'elite') this.text('◆', x + 19, y - height + 9, 9, color);
  }

  enemyFrameIndex(enemy, now = 0) {
    if (!this.walkFrames.length) return enemy.boss ? 6 : (enemy.id % 3) * 4 + (enemy.id % 4 === 0 ? 2 : 0);
    const row = enemy.boss ? 2 : enemy.id % 3 === 0 ? 1 : 0;
    const moving = !this.reduced && this.player.status === 'active';
    return row * 4 + (moving ? Math.floor(now / 110 * Math.min(this.speed, 3) + enemy.id) % 4 : 0);
  }
  enemy(view, now) {
    const enemy = view.enemy, position = this.path(this.progress(view, now)), context = this.ctx;
    const size = enemy.boss ? 94 : 41 + enemy.id % 3 * 3;
    const walking = !this.reduced && this.player.status === 'active';
    const bounce = walking ? Math.abs(Math.sin(now * .009 * Math.min(this.speed, 3) + enemy.id)) * 2 : 0;
    const lean = walking ? Math.sin(now * .009 * Math.min(this.speed, 3) + enemy.id) * .035 : 0;
    this.ellipse(position.x, position.y + 2, enemy.boss ? 28 : 12, enemy.boss ? 9 : 4, '#10272275');
    const frameIndex = this.enemyFrameIndex(enemy, now);
    this.drawSprite(this.walkFrames[frameIndex], position.x, position.y - bounce,
      size, position.face, 1, 1, lean);
    const hitAge = now - view.hitAt;
    if (!this.reduced && hitAge >= 0 && hitAge < 130) {
      context.save(); context.globalAlpha = (1 - hitAge / 130) * .6;
      context.strokeStyle = '#fff3cb'; context.lineWidth = enemy.boss ? 4 : 2;
      context.beginPath(); context.ellipse(position.x, position.y - size * .45, size * .24, size * .39, 0, 0, Math.PI * 2); context.stroke(); context.restore();
    }
    const barWidth = enemy.boss ? 62 : 26, barY = position.y - size - 8;
    this.rect(position.x - barWidth / 2, barY, barWidth, enemy.boss ? 5 : 3, '#233d38', 2);
    this.rect(position.x - barWidth / 2, barY, barWidth * clamp(enemy.hp / enemy.maxHp), enemy.boss ? 5 : 3, enemy.boss ? '#efbc79' : '#e1a28b', 2);
    if (enemy.boss) this.text('관문 수장', position.x, barY - 6, 11, '#ffe7ac');
  }

  drawEffects(now) {
    const context = this.ctx;
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index], age = now - effect.born;
      if (age > effect.life || this.reduced) { this.effects.splice(index, 1); continue; }
      if (age < 0) continue;
      const t = clamp(age / effect.life);
      context.save();
      if (effect.type === 'arrow') {
        const x = effect.x + (effect.tx - effect.x) * t, y = effect.y + (effect.ty - effect.y) * t - Math.sin(t * Math.PI) * 18;
        const angle = Math.atan2(effect.ty - effect.y, effect.tx - effect.x);
        context.translate(x, y); context.rotate(angle); context.strokeStyle = '#684c2b'; context.lineWidth = 3;
        context.beginPath(); context.moveTo(-14, 0); context.lineTo(4, 0); context.stroke();
        context.fillStyle = '#fff0c2'; context.beginPath(); context.moveTo(9, 0); context.lineTo(1, -3); context.lineTo(1, 3); context.closePath(); context.fill();
        context.strokeStyle = '#ffffff77'; context.lineWidth = 2; context.beginPath(); context.moveTo(-21, 0); context.lineTo(-15, 0); context.stroke();
      } else if (effect.type === 'slash') {
        context.translate(effect.x, effect.y); context.scale(effect.facing, 1);
        context.globalAlpha = Math.sin(t * Math.PI); context.strokeStyle = effect.color; context.lineWidth = 6 * (1 - t) + 1;
        context.beginPath(); context.arc(0, 0, 11 + t * 16, -.8, 1.25); context.stroke();
        context.strokeStyle = '#fff9df'; context.lineWidth = 2; context.beginPath(); context.arc(0, 0, 7 + t * 17, -.6, 1.05); context.stroke();
      } else if (effect.type === 'spark') {
        context.globalAlpha = 1 - t; const x = effect.x + effect.vx * t, y = effect.y + effect.vy * t + t * t * 13;
        context.translate(x, y); context.rotate(t * 3);
        this.rect(-2, -2, 4 * (1 - t), 4 * (1 - t), effect.color, 1);
      } else if (effect.type === 'damage') {
        context.globalAlpha = Math.min(1, (1 - t) * 3);
        this.text(effect.label, effect.x, effect.y - easeOut(t) * 22, this.worldWidth === 600 ? 18 : 13, effect.color);
      } else if (effect.type === 'death') {
        context.globalAlpha = 1 - easeOut(t);
        this.drawSprite(this.walkFrames[effect.frame], effect.x, effect.y + t * 6,
          effect.boss ? 94 : 44, effect.facing, 1 + t * .15, 1 - t * .25, effect.facing * t * .25);
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
        for (const entry of this.drawOrder) {
          if (entry.enemy) this.enemy(entry.enemy, now); else this.soldier(entry.unit, now, delta);
        }
        this.drawEffects(now);
      }
    }
    requestAnimationFrame(time => this.draw(time));
  }
}
