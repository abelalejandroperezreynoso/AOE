// Entidades del juego: jugadores, unidades, edificios y proyectiles.

import {
  UNITS, BUILDINGS, TECHS, UPGRADES, AGES, RESOURCES, POP_MAX,
  CARRY_CAPACITY, GATHER_RATE, START_RESOURCES,
} from './config.js';
import { uid, clamp, dist } from './utils.js';
import { findPath, ringTiles, nearestFree } from './path.js';

// --- Jugador ----------------------------------------------------------------

export class Player {
  constructor(id, colorIdx, isHuman, name) {
    this.id = id;
    this.colorIdx = colorIdx;
    this.isHuman = isHuman;
    this.name = name;
    this.res = { ...START_RESOURCES };
    this.age = 0;
    this.advancing = null;      // { progress, time } al subir de edad
    this.techs = new Set();
    this.mods = {};             // modificadores acumulados por tipo/clase
    this.units = new Set();
    this.buildings = new Set();
    this.defeated = false;
    this.stats = { gathered: 0, unitsTrained: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0 };
  }

  get pop() { let n = 0; for (const u of this.units) n += UNITS[u.type].pop; return n; }

  get popCap() {
    let n = 0;
    for (const b of this.buildings) if (b.built && BUILDINGS[b.type].pop) n += BUILDINGS[b.type].pop;
    return Math.min(POP_MAX, n);
  }

  mod(target, key) { const m = this.mods[target]; return (m && m[key]) || 0; }

  /** Estadística efectiva de un tipo de unidad, con las mejoras aplicadas. */
  stat(type, key) {
    const base = UNITS[type];
    let v = key === 'carry' ? CARRY_CAPACITY : (base[key] ?? 0);
    v += this.mod(type, key) + this.mod(base.class, key);
    return v;
  }

  buildingStat(type, key) {
    const B = BUILDINGS[type];
    let v = B[key] ?? 0;
    if (key === 'hp') v *= 1 + this.mod('building', 'hpPct');
    // Las mejoras de arquería también afectan a las defensas con flechas.
    if (B.arrows && (key === 'attack' || key === 'range')) v += this.mod('archer', key);
    return v;
  }

  canAfford(cost) { return RESOURCES.every((r) => (this.res[r] || 0) >= (cost[r] || 0)); }
  pay(cost) { for (const r of RESOURCES) if (cost[r]) this.res[r] -= cost[r]; }
  refund(cost) { for (const r of RESOURCES) if (cost[r]) this.res[r] += cost[r]; }

  add(res, amount) { this.res[res] += amount; this.stats.gathered += amount; }

  hasBuilding(type, builtOnly = true) {
    for (const b of this.buildings) if (b.type === type && (!builtOnly || b.built)) return true;
    return false;
  }

  countBuildings(pred) { let n = 0; for (const b of this.buildings) if (pred(b)) n++; return n; }

  applyTech(key, g) {
    const t = TECHS[key];
    if (!t) return;
    this.techs.add(key);
    for (const e of t.effects || []) {
      const bucket = (this.mods[e.target] ||= {});
      const stat = e.pct ? `${e.stat}Pct` : e.stat;
      bucket[stat] = (bucket[stat] || 0) + e.add;
      // Aplicar de inmediato a lo que ya existe.
      if (e.stat === 'hp' && !e.pct) {
        for (const u of this.units) {
          const cls = UNITS[u.type].class;
          if (u.type === e.target || cls === e.target) { u.maxHp += e.add; u.hp += e.add; }
        }
      }
      if (e.stat === 'hp' && e.pct && e.target === 'building') {
        for (const b of this.buildings) {
          const inc = BUILDINGS[b.type].hp * e.add;
          b.maxHp += inc; b.hp += inc;
        }
      }
    }
  }

  applyUpgrade(key, g) {
    const up = UPGRADES[key];
    if (!up) return;
    this.techs.add(key);
    for (const u of this.units) if (u.type === up.from) u.setType(up.to, this);
  }

  /** ¿Está disponible este tipo de unidad ahora mismo? */
  unitAvailable(type) {
    const d = UNITS[type];
    if (this.age < d.age) return false;
    // Sólo se muestra el escalón más avanzado de cada línea.
    for (const k in UPGRADES) {
      const up = UPGRADES[k];
      if (up.from === type && this.techs.has(k)) return false;
      if (up.to === type && !this.techs.has(k)) return false;
    }
    return true;
  }
}

// --- Unidad -----------------------------------------------------------------

export class Unit {
  constructor(type, owner, x, y) {
    this.id = uid();
    this.kind = 'unit';
    this.type = type;
    this.owner = owner;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.dir = 1; this.back = false;
    this.anim = Math.random() * 4;
    this.attackAnim = 0;
    this.attackCd = 0;
    this.task = null;
    this.path = null;
    this.pathTarget = null;
    this.repathCd = 0;
    this.stuck = 0;
    this.carry = 0;
    this.carryRes = null;
    this.lastNode = null;
    this.scanCd = Math.random();
    this.selected = false;
    this.dead = false;
    this.corpse = 0;
  }

  init(player) {
    this.maxHp = player.stat(this.type, 'hp');
    this.hp = this.maxHp;
    this.radius = UNITS[this.type].radius;
    return this;
  }

  setType(type, player) {
    const frac = this.hp / this.maxHp;
    this.type = type;
    this.maxHp = player.stat(type, 'hp');
    this.hp = this.maxHp * frac;
    this.radius = UNITS[type].radius;
  }

  get def() { return UNITS[this.type]; }
  get cls() { return UNITS[this.type].class; }
  get isMilitary() { return UNITS[this.type].class !== 'civilian'; }

  stopTask() { this.task = null; this.path = null; }

  // --- Movimiento -----------------------------------------------------------

  setDestination(g, gx, gy, goals = null) {
    const tx = Math.floor(this.x), ty = Math.floor(this.y);
    let targets = goals;
    if (!targets) {
      const free = nearestFree(g.map, Math.floor(gx), Math.floor(gy), 10);
      if (!free) { this.path = null; return false; }
      targets = [free];
    }
    if (!targets.length) { this.path = null; return false; }
    const p = findPath(g.map, tx, ty, targets);
    this.path = p && p.length ? p : null;
    this.pathTarget = { x: gx, y: gy };
    this.repathCd = 1.2;
    return p !== null;
  }

  followPath(g, dt, speed) {
    if (!this.path || !this.path.length) { this.path = null; return true; }
    const wp = this.path[0];
    const tx = wp.x + 0.5, ty = wp.y + 0.5;
    const d = dist(this.x, this.y, tx, ty);
    if (d < 0.16) {
      this.path.shift();
      if (!this.path.length) { this.path = null; return true; }
      return false;
    }
    const nx = (tx - this.x) / d, ny = (ty - this.y) / d;
    this.move(g, nx * speed * dt, ny * speed * dt);
    return false;
  }

  move(g, dx, dy) {
    const before = this.x + this.y;
    const nx = this.x + dx, ny = this.y + dy;
    if (g.walkable(nx, ny, this)) { this.x = nx; this.y = ny; }
    else if (g.walkable(nx, this.y, this)) { this.x = nx; }
    else if (g.walkable(this.x, ny, this)) { this.y = ny; }
    else { this.stuck += 1; }
    const moved = Math.abs(this.x + this.y - before);
    if (moved > 1e-4) {
      const sdx = dx - dy;      // dirección en pantalla
      if (Math.abs(sdx) > 1e-4) this.dir = sdx > 0 ? 1 : -1;
      this.back = dx + dy < -1e-4;
      this.anim += Math.hypot(dx, dy) * 7;
      this.moving = true;
    }
  }

  /**
   * Último tramo: cuando la ruta se agota pero aún falta medio paso para
   * alcanzar el objetivo, se avanza en línea recta (move() ya esquiva).
   */
  moveToward(g, tx, ty, amount) {
    const d = dist(this.x, this.y, tx, ty);
    if (d < 1e-4) return;
    this.move(g, ((tx - this.x) / d) * amount, ((ty - this.y) / d) * amount);
  }

  faceTo(tx, ty) {
    const sdx = (tx - this.x) - (ty - this.y);
    if (Math.abs(sdx) > 1e-3) this.dir = sdx > 0 ? 1 : -1;
    this.back = (tx - this.x) + (ty - this.y) < 0;
  }

  // --- Ciclo principal ------------------------------------------------------

  update(g, dt) {
    this.moving = false;
    this.working = false;
    // Red de seguridad: si la unidad acabó sobre una casilla intransitable
    // (un edificio levantado encima, por ejemplo) se la saca al hueco más próximo.
    if (!g.walkable(this.x, this.y, this)) {
      const free = nearestFree(g.map, Math.floor(this.x), Math.floor(this.y), 10);
      if (free) { this.x = free.x + 0.5; this.y = free.y + 0.5; this.path = null; this.repathCd = 0; }
    }
    if (this.attackAnim > 0) this.attackAnim -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.repathCd > 0) this.repathCd -= dt;
    const player = g.players[this.owner];
    const speed = player.stat(this.type, 'speed');

    const t = this.task;
    if (!t) {
      this.idleScan(g, dt);
    } else {
      switch (t.type) {
        case 'move': this.doMove(g, dt, speed); break;
        case 'attackmove': this.doAttackMove(g, dt, speed); break;
        case 'gather': this.doGather(g, dt, speed, player); break;
        case 'deliver': this.doDeliver(g, dt, speed, player); break;
        case 'build': this.doBuild(g, dt, speed, player); break;
        case 'attack': this.doAttack(g, dt, speed, player); break;
        default: this.task = null;
      }
    }
    this.separate(g, dt);
    this.checkStall(g, dt);
  }

  /**
   * Red de seguridad: si una unidad tiene una orden pero ni avanza ni trabaja,
   * se recalcula la ruta y, tras varios intentos, se abandona la orden.
   */
  checkStall(g, dt) {
    this.stallCd = (this.stallCd || 0) - dt;
    if (this.stallCd > 0) return;
    this.stallCd = 1.5;
    const last = this.lastPos;
    const moved = last ? dist(this.x, this.y, last.x, last.y) : 1;
    this.lastPos = { x: this.x, y: this.y };
    if (!this.task || this.working || moved > 0.25) { this.stall = 0; return; }
    this.stall = (this.stall || 0) + 1;
    this.path = null;
    this.repathCd = 0;
    if (this.stall >= 3) {
      this.stall = 0;
      if (this.task.type === 'gather' || this.task.type === 'deliver') {
        this.findNextResource(g, g.players[this.owner]);
      } else {
        this.task = null;
      }
    }
  }

  /** Separación suave para que las unidades no se amontonen. */
  separate(g, dt) {
    const near = g.unitsNear(this.x, this.y, 1.1);
    let px = 0, py = 0, n = 0;
    for (const o of near) {
      if (o === this || o.dead) continue;
      const dx = this.x - o.x, dy = this.y - o.y;
      const d2 = dx * dx + dy * dy;
      const rr = this.radius + o.radius;
      if (d2 > rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (rr - d) / rr;
      px += (dx / d) * push; py += (dy / d) * push; n++;
    }
    if (n) {
      const k = Math.min(2.2, 2.2) * dt;
      this.move(g, clamp(px, -1, 1) * k, clamp(py, -1, 1) * k);
      this.moving = false;
    }
  }

  idleScan(g, dt) {
    if (!this.isMilitary) return;
    this.scanCd -= dt;
    if (this.scanCd > 0) return;
    this.scanCd = 0.6;
    const los = UNITS[this.type].los;
    const e = g.findEnemyNear(this.owner, this.x, this.y, los, true);
    if (e) this.task = { type: 'attack', target: e, guard: { x: this.x, y: this.y } };
  }

  doMove(g, dt, speed) {
    const t = this.task;
    if (!this.path && this.repathCd <= 0) {
      if (!this.setDestination(g, t.x, t.y)) { this.task = null; return; }
    }
    if (this.followPath(g, dt, speed)) {
      if (dist(this.x, this.y, t.x, t.y) < 1.6 || this.repathCd <= 0) this.task = null;
      else if (!this.setDestination(g, t.x, t.y)) this.task = null;
    }
    if (this.stuck > 20) { this.stuck = 0; this.path = null; this.repathCd = 0; }
  }

  doAttackMove(g, dt, speed) {
    this.scanCd -= dt;
    if (this.scanCd <= 0) {
      this.scanCd = 0.5;
      const e = g.findEnemyNear(this.owner, this.x, this.y, UNITS[this.type].los + 1, true);
      if (e) {
        const dest = { x: this.task.x, y: this.task.y };
        this.task = { type: 'attack', target: e, resume: dest };
        return;
      }
    }
    this.doMove(g, dt, speed);
  }

  // --- Recolección ----------------------------------------------------------

  doGather(g, dt, speed, player) {
    const target = this.task.target;
    if (!target || (target.alive === false) || (target.dead) || (target.farmAmount !== undefined && target.farmAmount <= 0)) {
      this.findNextResource(g, player);
      return;
    }
    const info = g.gatherInfo(target);
    this.wantRes = info.res;
    const isBuilding = target.kind === 'building';
    const near = isBuilding ? g.edgeDist(this, target) <= 0.9
      : dist(this.x, this.y, info.x, info.y) <= 1.5;
    if (!near) {
      if (!this.path && this.repathCd <= 0) {
        const goals = isBuilding
          ? ringTiles(g.map, target.tx, target.ty, target.size, target.size, 1)
          : ringTiles(g.map, target.x, target.y, 1, 1, 1);
        if (!goals.length || !this.setDestination(g, info.x, info.y, goals)) {
          this.findNextResource(g, player); return;
        }
      }
      if (this.path) this.followPath(g, dt, speed);
      else this.moveToward(g, info.x, info.y, speed * dt);
      if (this.stuck > 25) { this.stuck = 0; this.path = null; this.repathCd = 0; }
      return;
    }
    this.path = null;
    // Antes de cambiar de recurso conviene descargar lo que ya se lleva encima.
    if (this.carryRes && this.carryRes !== info.res && this.carry > 0.5) {
      const drop = g.findDropoff(player, this.carryRes, this.x, this.y);
      if (drop) { this.task = { type: 'deliver', target: drop, back: target }; return; }
      this.carry = 0;
    }
    this.working = true;
    this.faceTo(info.x, info.y);
    this.attackAnim = this.attackAnim > 0 ? this.attackAnim : 0.6;
    const cap = player.stat('villager', 'carry');
    const rate = GATHER_RATE[info.rate] * (player.gatherBonus || 1);
    if (this.carryRes !== info.res) this.carry = 0;
    this.carryRes = info.res;
    const take = Math.min(rate * dt, info.amount, cap - this.carry);
    this.carry += take;
    g.consumeResource(target, take);
    this.lastNode = target;
    if (this.carry >= cap - 1e-6) {
      const drop = g.findDropoff(player, info.res, this.x, this.y);
      if (drop) this.task = { type: 'deliver', target: drop, back: target };
    }
    if (info.amount - take <= 1e-6) g.depleteResource(target);
  }

  findNextResource(g, player) {
    const prev = this.lastNode;
    const want = this.wantRes || this.carryRes || 'food';
    let next = null;
    if (prev && !prev.dead && prev.alive !== false) {
      const px = prev.kind === 'building' ? prev.cx : prev.x;
      const py = prev.kind === 'building' ? prev.cy : prev.y;
      next = g.findResourceNear(px, py, want, 14, player);
    }
    if (!next) next = g.findResourceNear(this.x, this.y, want, 22, player);
    if (next) this.task = { type: 'gather', target: next };
    else {
      // Si lleva carga, al menos la entrega.
      if (this.carry > 0.5 && this.carryRes) {
        const drop = g.findDropoff(player, this.carryRes, this.x, this.y);
        if (drop) { this.task = { type: 'deliver', target: drop, back: null }; return; }
      }
      this.task = null;
    }
  }

  doDeliver(g, dt, speed, player) {
    const b = this.task.target;
    if (!b || b.dead || !b.built) {
      const drop = g.findDropoff(player, this.carryRes, this.x, this.y);
      if (drop && drop !== b) { this.task.target = drop; this.path = null; return; }
      this.task = null; return;
    }
    const d = g.edgeDist(this, b);
    if (d > 0.8) {
      if (!this.path && this.repathCd <= 0) {
        const goals = ringTiles(g.map, b.tx, b.ty, b.size, b.size, 1);
        if (!goals.length || !this.setDestination(g, b.cx, b.cy, goals)) { this.task = null; return; }
      }
      if (this.path) this.followPath(g, dt, speed);
      else this.moveToward(g, b.cx, b.cy, speed * dt);
      if (this.stuck > 25) { this.stuck = 0; this.path = null; this.repathCd = 0; }
      return;
    }
    this.path = null;
    if (this.carry > 0 && this.carryRes) {
      player.add(this.carryRes, this.carry);
      g.fx.floatText(b.cx, b.cy, `+${Math.round(this.carry)}`, this.carryRes);
      this.carry = 0;
    }
    const back = this.task.back;
    if (back && back.alive !== false && !back.dead && (back.farmAmount === undefined || back.farmAmount > 0)) {
      this.task = { type: 'gather', target: back };
    } else {
      this.lastNode = back || this.lastNode;
      this.findNextResource(g, player);
    }
  }

  // --- Construcción ---------------------------------------------------------

  doBuild(g, dt, speed, player) {
    const b = this.task.target;
    if (!b || b.dead) { this.chainOrIdle(g, player, b); return; }
    if (b.built && b.hp >= b.maxHp) { this.chainOrIdle(g, player, b); return; }
    const d = g.edgeDist(this, b);
    if (d > 0.8) {
      if (!this.path && this.repathCd <= 0) {
        const goals = ringTiles(g.map, b.tx, b.ty, b.size, b.size, 1);
        if (!goals.length || !this.setDestination(g, b.cx, b.cy, goals)) { this.chainOrIdle(g, player, b); return; }
      }
      if (this.path) this.followPath(g, dt, speed);
      else this.moveToward(g, b.cx, b.cy, speed * dt);
      if (this.stuck > 25) { this.stuck = 0; this.path = null; this.repathCd = 0; }
      return;
    }
    this.path = null;
    this.working = true;
    this.faceTo(b.cx, b.cy);
    if (this.attackAnim <= 0) this.attackAnim = 0.5;
    if (!b.built) {
      b.addProgress(dt / BUILDINGS[b.type].time, player, g);
      if (b.built) {
        g.fx.puff(b.cx, b.cy, 14);
        if (player.isHuman) g.audio.play('build');
      }
    } else {
      b.hp = Math.min(b.maxHp, b.hp + (b.maxHp / BUILDINGS[b.type].time) * 0.75 * dt);
      if (b.hp >= b.maxHp) this.chainOrIdle(g, player, b);
    }
  }

  /**
   * Al quedarse sin obra, busca otra construcción sin terminar del mismo
   * jugador dentro de su rango de visión y se va sola a seguir con ella; si
   * no encuentra ninguna, se queda libre (como antes de esta mecánica).
   */
  chainOrIdle(g, player, finished) {
    const radius = UNITS.villager.los;
    const next = g.findUnbuiltNear(player, this.x, this.y, radius, finished);
    if (next) { this.task = { type: 'build', target: next }; this.path = null; this.repathCd = 0; }
    else this.task = null;
  }

  // --- Combate --------------------------------------------------------------

  doAttack(g, dt, speed, player) {
    const t = this.task.target;
    if (!t || t.dead) {
      const r = this.task.resume;
      const guard = this.task.guard;
      this.task = null;
      if (r) this.task = { type: 'attackmove', x: r.x, y: r.y };
      else if (guard && dist(this.x, this.y, guard.x, guard.y) > 4) this.task = { type: 'move', x: guard.x, y: guard.y };
      return;
    }
    const def = UNITS[this.type];
    if (def.class === 'civilian' && t.kind === 'building' && t.owner === this.owner) {
      this.task = { type: 'build', target: t }; return;
    }
    const range = player.stat(this.type, 'range');
    const d = g.edgeDist(this, t);
    if (d > range) {
      if (!this.path || this.repathCd <= 0) {
        const goals = t.kind === 'building'
          ? ringTiles(g.map, t.tx, t.ty, t.size, t.size, 1)
          : null;
        this.setDestination(g, t.kind === 'building' ? t.cx : t.x, t.kind === 'building' ? t.cy : t.y, goals);
      }
      if (this.path) this.followPath(g, dt, speed);
      else this.moveToward(g, t.x ?? t.cx, t.y ?? t.cy, speed * dt);
      if (this.stuck > 25) { this.stuck = 0; this.path = null; this.repathCd = 0; }
      return;
    }
    this.path = null;
    if (def.minRange && d < def.minRange) {
      // Retroceder para poder disparar.
      const ang = Math.atan2(this.y - (t.y ?? t.cy), this.x - (t.x ?? t.cx));
      this.move(g, Math.cos(ang) * speed * dt, Math.sin(ang) * speed * dt);
      return;
    }
    this.faceTo(t.x ?? t.cx, t.y ?? t.cy);
    this.working = true;
    if (this.attackCd <= 0) {
      this.attackCd = player.stat(this.type, 'rof');
      this.attackAnim = 0.5;
      g.launchAttack(this, t);
    }
  }

  takeDamage(amount, g, from) {
    this.hp -= amount;
    if (this.hp <= 0 && !this.dead) {
      g.killUnit(this, from);
      return;
    }
    // Contraataque si estaba ocioso.
    if (!this.task && this.isMilitary && from) this.task = { type: 'attack', target: from };
    else if (!this.task && !this.isMilitary && from && g.players[this.owner].isHuman === false) {
      this.task = { type: 'attack', target: from };
    }
  }
}

// --- Edificio ---------------------------------------------------------------

export class Building {
  constructor(type, owner, tx, ty, player) {
    this.id = uid();
    this.kind = 'building';
    this.type = type;
    this.owner = owner;
    this.tx = tx; this.ty = ty;
    this.size = BUILDINGS[type].size;
    this.cx = tx + this.size / 2;
    this.cy = ty + this.size / 2;
    this.maxHp = player.buildingStat(type, 'hp');
    this.built = false;
    this.progress = 0;
    this.hp = this.maxHp * 0.05;
    this.queue = [];
    this.rally = null;
    this.attackCd = 0;
    this.scanCd = Math.random() * 0.5;
    this.selected = false;
    this.dead = false;
    this.smoke = 0;
    if (BUILDINGS[type].farm) this.farmAmount = BUILDINGS[type].farm;
  }

  get def() { return BUILDINGS[this.type]; }

  addProgress(amount, player, g) {
    if (this.built) return;
    this.progress = Math.min(1, this.progress + amount);
    this.hp = Math.max(this.hp, this.maxHp * (0.05 + 0.95 * this.progress));
    if (this.progress >= 1) {
      this.built = true;
      this.hp = this.maxHp;
      player.stats.buildingsBuilt++;
      g.onBuildingComplete(this);
    }
  }

  update(g, dt) {
    const player = g.players[this.owner];
    if (!this.built) return;
    if (this.attackCd > 0) this.attackCd -= dt;

    // Producción en cola.
    if (this.queue.length) {
      const item = this.queue[0];
      let blocked = false;
      if (item.kind === 'unit') {
        const cost = UNITS[item.key].pop;
        if (player.pop + cost > player.popCap) blocked = true;
      }
      item.blocked = blocked;
      if (!blocked) {
        item.progress += dt;
        if (item.progress >= item.time) {
          this.queue.shift();
          this.completeQueueItem(item, g, player);
        }
      }
    }

    // Defensas que disparan.
    const arrows = this.def.arrows;
    if (arrows && this.attackCd <= 0) {
      this.scanCd -= dt;
      if (this.scanCd <= 0) {
        this.scanCd = 0.3;
        const range = player.buildingStat(this.type, 'range');
        const targets = g.findEnemiesNear(this.owner, this.cx, this.cy, range + this.size / 2, arrows);
        if (targets.length) {
          this.attackCd = this.def.rof;
          targets.forEach((t, i) => g.spawnProjectile(this, t, i * 0.08));
        }
      }
    }
    if (this.hp < this.maxHp * 0.45) this.smoke += dt;
  }

  completeQueueItem(item, g, player) {
    if (item.kind === 'unit') {
      g.spawnUnitFrom(this, item.key);
      player.stats.unitsTrained++;
      if (player.isHuman) g.audio.play('train');
    } else if (item.kind === 'tech') {
      player.applyTech(item.key, g);
      if (player.isHuman) { g.audio.play('tech'); g.ui.notify(`Investigación completada: ${TECHS[item.key].name}`); }
    } else if (item.kind === 'upgrade') {
      player.applyUpgrade(item.key, g);
      if (player.isHuman) { g.audio.play('tech'); g.ui.notify(`Mejora completada: ${UPGRADES[item.key].name}`); }
    } else if (item.kind === 'age') {
      player.age++;
      if (player.isHuman) {
        g.audio.play('age');
        g.ui.notify(`¡Has avanzado a la ${AGES[player.age].name}!`, 'good');
      } else {
        g.ui.notify(`${player.name} ha avanzado a la ${AGES[player.age].name}.`, 'warn');
      }
    }
  }

  takeDamage(amount, g, from) {
    this.hp -= amount;
    if (this.hp <= 0 && !this.dead) g.killBuilding(this, from);
  }

  contains(x, y) {
    return x >= this.tx && x < this.tx + this.size && y >= this.ty && y < this.ty + this.size;
  }
}

// --- Proyectil --------------------------------------------------------------

export class Projectile {
  constructor(owner, from, target, damage, opts = {}) {
    this.id = uid();
    this.owner = owner;
    this.target = target;
    this.damage = damage;
    this.splash = opts.splash || 0;
    this.kindOf = opts.kindOf || 'arrow';
    this.source = from;
    this.x = from.x ?? from.cx;
    this.y = from.y ?? from.cy;
    this.z = opts.z ?? 0.6;
    this.tx = target.x ?? target.cx;
    this.ty = target.y ?? target.cy;
    this.delay = opts.delay || 0;
    const d = dist(this.x, this.y, this.tx, this.ty);
    this.speed = opts.speed || (this.kindOf === 'boulder' ? 7 : 12);
    this.total = Math.max(0.08, d / this.speed);
    this.t = 0;
    this.arc = this.kindOf === 'boulder' ? 2.4 : Math.min(1.1, d * 0.12);
    this.dead = false;
  }

  update(g, dt) {
    if (this.delay > 0) { this.delay -= dt; return; }
    // Persigue objetivos móviles.
    if (this.target && !this.target.dead && this.kindOf !== 'boulder') {
      this.tx = this.target.x ?? this.target.cx;
      this.ty = this.target.y ?? this.target.cy;
    }
    this.t += dt;
    const k = Math.min(1, this.t / this.total);
    this.px = this.x + (this.tx - this.x) * k;
    this.py = this.y + (this.ty - this.y) * k;
    this.pz = this.z + Math.sin(k * Math.PI) * this.arc;
    if (k >= 1) {
      this.dead = true;
      g.projectileHit(this);
    }
  }
}
