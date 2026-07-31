// Estado global de la partida y bucle de simulación.

import {
  UNITS, BUILDINGS, TECHS, UPGRADES, AGES, RESOURCES, PLAYER_COLORS,
  GATHER_RATE, DIFFICULTIES, MAX_PLAYERS,
} from './config.js';
import { GameMap, minMapSizeFor } from './map.js';
import { Player, Unit, Building, Projectile } from './entities.js';
import { clamp, dist, Rng } from './utils.js';
import { nearestFree, ringTiles } from './path.js';

// --- Efectos visuales -------------------------------------------------------

class Fx {
  constructor() { this.parts = []; this.texts = []; this.decals = []; }

  spawn(x, y, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (opts.speed || 1) * (0.4 + Math.random() * 0.8);
      this.parts.push({
        x, y, z: opts.z ?? 0.3,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: opts.vz ?? (0.6 + Math.random()),
        life: opts.life || 0.6, max: opts.life || 0.6,
        color: opts.color, size: opts.size || 2.5, grav: opts.grav ?? 3,
      });
    }
  }

  blood(x, y) { this.spawn(x, y, 6, { color: '#a01f1f', speed: 1.2, life: 0.5, size: 2.4 }); }
  puff(x, y, n = 8) { this.spawn(x, y, n, { color: '#d8ccae', speed: 1.0, life: 0.8, size: 4, grav: 1.2 }); }
  spark(x, y) { this.spawn(x, y, 4, { color: '#ffd98a', speed: 1.6, life: 0.3, size: 2 }); }
  debris(x, y, n = 16) { this.spawn(x, y, n, { color: '#7a6a52', speed: 1.8, life: 1.2, size: 3.4, grav: 4 }); }

  floatText(x, y, text, kind) {
    this.texts.push({ x, y, text, kind, life: 1.4, max: 1.4 });
  }

  decal(x, y, kind) {
    this.decals.push({ x, y, kind, life: kind === 'rubble' ? 30 : 14, max: kind === 'rubble' ? 30 : 14 });
    if (this.decals.length > 220) this.decals.shift();
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.z += p.vz * dt; p.vz -= p.grav * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life <= 0) this.decals.splice(i, 1);
    }
  }
}

// --- Juego ------------------------------------------------------------------

export class Game {
  constructor(opts) {
    this.opts = opts;
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.difficulty = DIFFICULTIES[opts.difficulty] || DIFFICULTIES.normal;
    // En red viene el número exacto de jugadores; contra la máquina, los rivales.
    this.playerCount = clamp(opts.playerCount ?? (1 + (opts.opponents ?? 1)), 2, MAX_PLAYERS);
    // Con muchas bases hace falta sitio: si el mapa elegido se queda corto se
    // agranda, y como los dos lados calculan lo mismo el mundo sigue siendo
    // idéntico para todos.
    this.mapSize = Math.max(opts.mapSize, minMapSizeFor(this.playerCount));
    this.map = new GameMap(this.mapSize, this.seed, this.playerCount);
    this.players = [];
    this.units = new Set();
    this.buildings = new Set();
    this.projectiles = [];
    this.fx = new Fx();
    this.time = 0;
    this.speed = 1;
    this.paused = false;
    this.over = null;
    this.selection = [];
    this.groups = {};
    this.placing = null;
    this.cellSize = 2;
    this.gridW = Math.ceil(this.map.size / this.cellSize);
    this.grid = new Array(this.gridW * this.gridW);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = [];
    this.fogVisible = new Uint8Array(this.map.size * this.map.size);
    this.fogExplored = new Uint8Array(this.map.size * this.map.size);
    this.fogCd = 0;
    this.byId = new Map();

    // Red: null en un jugador; en multijugador lo rellena NetSession.
    this.net = null;
    this.netRemoved = [];
    this.netDepleted = [];
    this.netHasState = false;
    this.netSnapMs = 0.1;   // separación real entre instantáneas, en segundos

    const names = opts.playerNames || [];
    const localIdx = opts.localPlayer ?? 0;
    for (let i = 0; i < this.playerCount; i++) {
      const local = i === localIdx;
      const p = new Player(i, i, local, names[i] || (local ? 'Tú' : `Rival ${i}`));
      this.players.push(p);
    }
    this.human = this.players[localIdx];
    // Los animales que se pueden domesticar se guardan aparte: hay que
    // repasarlos cada poco y recorrer los miles de árboles del mapa no.
    this.herds = this.map.nodes.filter((n) => n.herd);
    this.herdCd = 0;
    this.setupStart();
    this.dropAbsent(opts.absent);
  }

  /** El invitado no simula: sólo pinta lo que le manda el anfitrión. */
  get isGuest() { return this.net !== null && this.net.role === 'guest'; }

  /** ¿Lleva la máquina a ese jugador? En red no hay ninguno: todos son personas. */
  isAi(playerId) {
    const p = this.players[playerId];
    return !!p && !p.isHuman && this.net === null;
  }

  netSend(cmd) { if (this.net) this.net.sendCommand(cmd); }

  // --- Preparación ----------------------------------------------------------

  setupStart() {
    this.map.starts.forEach((s, i) => {
      if (i >= this.players.length) return;
      const p = this.players[i];
      const tc = this.createBuilding('towncenter', p, s.x - 1, s.y - 1, true);
      if (tc) tc.rally = { x: s.x + 2.5, y: s.y + 2.5 };
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.7;
        const px = s.x + 1 + Math.cos(a) * 3, py = s.y + 1 + Math.sin(a) * 3;
        this.createUnit('villager', p, px, py);
      }
      const sc = this.createUnit('scout', p, s.x + 1.5, s.y + 3.5);
      if (sc && !p.isHuman) sc.task = null;
    });
    this.updateFog(true);
  }

  /**
   * Jugadores que reservaron sitio pero no llegaron a conectarse. Se les retira
   * del mapa antes de empezar; se marcan derrotados primero para que su
   * desaparición no se anuncie como una derrota en mitad de la partida.
   */
  dropAbsent(absent) {
    for (const id of absent || []) {
      const p = this.players[id];
      if (!p || p === this.human) continue;
      p.defeated = true;
      p.resultSent = true;   // no hay a quién avisar
      for (const b of [...p.buildings]) this.killBuilding(b, null);
      for (const u of [...p.units]) this.killUnit(u, null);
    }
    // Nada de esto llegó a existir para los demás: no hay que retransmitirlo.
    this.netRemoved = [];
    this.fx.decals.length = 0;
    this.fx.parts.length = 0;
  }

  // --- Fábrica de entidades -------------------------------------------------

  createUnit(type, player, x, y) {
    const free = nearestFree(this.map, Math.floor(x), Math.floor(y), 14);
    if (!free) return null;
    const u = new Unit(type, player.id, free.x + 0.5, free.y + 0.5).init(player);
    this.units.add(u);
    player.units.add(u);
    this.byId.set(u.id, u);
    return u;
  }

  canPlace(type, tx, ty, player) {
    const B = BUILDINGS[type];
    const s = B.size;
    if (B.req && !player.hasBuilding(B.req)) return false;
    for (let y = ty; y < ty + s; y++) {
      for (let x = tx; x < tx + s; x++) {
        if (!this.map.isBuildable(x, y)) return false;
        if (this.map.nodeIndexAt(x, y) >= 0) return false;
      }
    }
    return true;
  }

  createBuilding(type, player, tx, ty, instant = false) {
    const B = BUILDINGS[type];
    const s = B.size;
    if (tx < 0 || ty < 0 || tx + s > this.map.size || ty + s > this.map.size) return null;
    const b = new Building(type, player.id, tx, ty, player);
    for (let y = ty; y < ty + s; y++) {
      for (let x = tx; x < tx + s; x++) {
        this.map.occupied[this.map.idx(x, y)] = b.id;
        const n = this.map.nodeAtTile(x, y);
        if (n) this.map.removeNode(n);
      }
    }
    // Desaloja a quien quedase dentro de la huella: si no, quedaría atrapado.
    for (const u of this.units) {
      if (u.x < tx || u.x >= tx + s || u.y < ty || u.y >= ty + s) continue;
      const free = nearestFree(this.map, Math.floor(u.x), Math.floor(u.y), 10);
      if (free) { u.x = free.x + 0.5; u.y = free.y + 0.5; u.path = null; u.repathCd = 0; }
    }
    this.buildings.add(b);
    player.buildings.add(b);
    this.byId.set(b.id, b);
    if (instant) {
      b.built = true; b.progress = 1; b.hp = b.maxHp;
      this.onBuildingComplete(b);
    }
    return b;
  }

  onBuildingComplete(b) {
    if (this.human.id === b.owner) this.updateFog(true);
  }

  killUnit(u, from) {
    if (u.dead) return;
    u.dead = true;
    this.units.delete(u);
    this.players[u.owner].units.delete(u);
    this.players[u.owner].stats.unitsLost++;
    if (from && from.owner !== undefined) this.players[from.owner].stats.kills++;
    this.byId.delete(u.id);
    if (this.net && !this.isGuest) this.netRemoved.push(u.id);
    this.fx.blood(u.x, u.y);
    this.fx.decal(u.x, u.y, 'blood');
    const i = this.selection.indexOf(u);
    if (i >= 0) this.selection.splice(i, 1);
    if (u.owner === this.human.id && this.audio) this.audio.play('die');
    this.checkDefeat(this.players[u.owner]);
  }

  killBuilding(b, from) {
    if (b.dead) return;
    b.dead = true;
    this.buildings.delete(b);
    this.players[b.owner].buildings.delete(b);
    if (from && from.owner !== undefined) this.players[from.owner].stats.kills++;
    this.byId.delete(b.id);
    if (this.net && !this.isGuest) this.netRemoved.push(b.id);
    for (let y = b.ty; y < b.ty + b.size; y++) {
      for (let x = b.tx; x < b.tx + b.size; x++) {
        if (this.map.occupied[this.map.idx(x, y)] === b.id) this.map.occupied[this.map.idx(x, y)] = 0;
      }
    }
    this.fx.debris(b.cx, b.cy, 10 + b.size * 6);
    this.fx.decal(b.cx, b.cy, 'rubble');
    if (this.audio) this.audio.play('collapse');
    // Los aldeanos que trabajaban aquí quedan libres; si estaban construyendo,
    // intentan encadenar solos con otra obra pendiente que tengan a la vista.
    for (const u of this.units) {
      if (!u.task || u.task.target !== b) continue;
      if (u.task.type === 'build') u.chainOrIdle(this, this.players[u.owner], b);
      else u.task = null;
    }
    const i = this.selection.indexOf(b);
    if (i >= 0) this.selection.splice(i, 1);
    this.checkDefeat(this.players[b.owner]);
  }

  checkDefeat(p) {
    // Quien decide el final de la partida es el anfitrión, que lo comunica.
    if (this.isGuest) return;
    if (p.defeated) return;
    if (p.buildings.size > 0) return;
    let hasVil = false;
    for (const u of p.units) if (u.type === 'villager') { hasVil = true; break; }
    if (hasVil) return;
    p.defeated = true;
    if (this.ui) this.ui.notify(`${p.name} ha sido derrotado.`, p.isHuman ? 'bad' : 'good');
    this.checkVictory();
  }

  /**
   * Gana quien se queda solo en pie. Con más de dos jugadores el resto de la
   * partida continúa aunque uno caiga, así que a cada jugador se le avisa de su
   * propio resultado en cuanto se decide y sólo una vez.
   */
  checkVictory() {
    if (this.isGuest) return;
    const alive = this.players.filter((p) => !p.defeated);
    const winner = alive.length === 1 ? alive[0] : null;

    if (this.net) {
      for (const p of this.players) {
        if (p === this.human || p.resultSent) continue;
        if (p.defeated) { p.resultSent = true; this.net.announceResult(p, false); }
        else if (p === winner) { p.resultSent = true; this.net.announceResult(p, true); }
      }
    }

    if (this.over) return;
    if (this.human.defeated) this.endGame(false);
    else if (winner === this.human) this.endGame(true);
  }

  /**
   * El anfitrión sigue simulando aunque le hayan eliminado: es quien lleva la
   * partida de todos y pararla dejaría a los demás sin juego.
   */
  get keepsSimulating() {
    if (!this.net || this.isGuest) return false;
    return this.players.filter((p) => !p.defeated).length > 1;
  }

  endGame(won, reason = null) {
    if (this.over) return;
    this.over = { won, time: this.time, reason };
    if (this.ui) this.ui.showEnd(won, reason);
  }

  // --- Consultas espaciales -------------------------------------------------

  rebuildGrid() {
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i].length) this.grid[i].length = 0;
    for (const u of this.units) {
      const cx = clamp((u.x / this.cellSize) | 0, 0, this.gridW - 1);
      const cy = clamp((u.y / this.cellSize) | 0, 0, this.gridW - 1);
      this.grid[cy * this.gridW + cx].push(u);
    }
  }

  unitsNear(x, y, r) {
    const out = [];
    const c0 = clamp(((x - r) / this.cellSize) | 0, 0, this.gridW - 1);
    const c1 = clamp(((x + r) / this.cellSize) | 0, 0, this.gridW - 1);
    const r0 = clamp(((y - r) / this.cellSize) | 0, 0, this.gridW - 1);
    const r1 = clamp(((y + r) / this.cellSize) | 0, 0, this.gridW - 1);
    const r2 = r * r;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        for (const u of this.grid[cy * this.gridW + cx]) {
          const dx = u.x - x, dy = u.y - y;
          if (dx * dx + dy * dy <= r2) out.push(u);
        }
      }
    }
    return out;
  }

  walkable(x, y, unit) {
    const m = this.map;
    if (x < 0.2 || y < 0.2 || x > m.size - 0.2 || y > m.size - 0.2) return false;
    return m.isPassable(x | 0, y | 0);
  }

  edgeDist(a, b) {
    if (b.kind === 'building') {
      const dx = Math.max(0, Math.abs(a.x - b.cx) - b.size / 2);
      const dy = Math.max(0, Math.abs(a.y - b.cy) - b.size / 2);
      return Math.max(0, Math.hypot(dx, dy) - (a.radius || 0.3));
    }
    return Math.max(0, dist(a.x, a.y, b.x, b.y) - (a.radius || 0.3) - (b.radius || 0.3));
  }

  /**
   * Distancia de una unidad al borde de la casilla centrada en (cx,cy). Es la
   * medida que decide si un aldeano está pegado a un recurso: al centro de la
   * casilla nunca se puede llegar (el árbol o la mina la ocupan), así que
   * medirla desde ahí dejaba a los aldeanos trabajando desde lejos.
   */
  tileEdgeDist(a, cx, cy) {
    const dx = Math.max(0, Math.abs(a.x - cx) - 0.5);
    const dy = Math.max(0, Math.abs(a.y - cy) - 0.5);
    return Math.max(0, Math.hypot(dx, dy) - (a.radius || 0.3));
  }

  isEnemy(ownerA, ownerB) { return ownerA !== ownerB; }

  findEnemyNear(owner, x, y, r, unitsOnly = false) {
    let best = null, bestD = Infinity;
    for (const u of this.unitsNear(x, y, r)) {
      if (u.owner === owner || u.dead) continue;
      const d = dist(x, y, u.x, u.y);
      // Prioriza unidades militares sobre civiles.
      const score = d - (u.isMilitary ? 1.5 : 0);
      if (score < bestD) { bestD = score; best = u; }
    }
    if (best || unitsOnly) return best;
    for (const b of this.buildings) {
      if (b.owner === owner || b.dead) continue;
      const d = this.edgeDist({ x, y, radius: 0 }, b);
      if (d < r && d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  findEnemiesNear(owner, x, y, r, count) {
    const list = [];
    for (const u of this.unitsNear(x, y, r)) {
      if (u.owner === owner || u.dead) continue;
      list.push({ u, d: dist(x, y, u.x, u.y) - (u.isMilitary ? 2 : 0) });
    }
    list.sort((a, b) => a.d - b.d);
    return list.slice(0, count).map((e) => e.u);
  }

  /** Recurso más cercano del tipo pedido (búsqueda en espiral). */
  findResourceNear(x, y, res, radius, player) {
    const m = this.map;
    const sx = Math.floor(x), sy = Math.floor(y);
    let best = null, bestD = Infinity;
    if (res === 'food' && player) {
      for (const b of player.buildings) {
        if (b.type !== 'farm' || !b.built || b.farmAmount <= 0) continue;
        const d = dist(x, y, b.cx, b.cy);
        if (d < bestD && d < radius) { bestD = d; best = b; }
      }
    }
    for (let r = 1; r <= radius; r++) {
      if (best && bestD < r - 1) break;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const n = m.nodeAtTile(sx + dx, sy + dy);
          if (!n || !n.alive || n.res !== res || n.amount <= 0) continue;
          const d = dist(x, y, n.fx, n.fy);
          if (d < bestD) { bestD = d; best = n; }
        }
      }
    }
    return best;
  }

  /**
   * ¿Ese edificio le sirve al aldeano para soltar lo que lleva encima? Con esto,
   * señalar el centro urbano (o un molino, campamento...) con un aldeano cargado
   * es la orden de ir a depositar, no la de plantarse al lado.
   */
  acceptsCarry(b, u) {
    if (!b || b.kind !== 'building' || !b.built || b.dead) return false;
    if (!u || u.type !== 'villager' || u.owner !== b.owner) return false;
    if (!(u.carry > 0.5) || !u.carryRes) return false;
    const d = BUILDINGS[b.type].dropoff;
    return !!d && d.includes(u.carryRes);
  }

  findDropoff(player, res, x, y) {
    let best = null, bestD = Infinity;
    for (const b of player.buildings) {
      if (!b.built || b.dead) continue;
      const d = BUILDINGS[b.type].dropoff;
      if (!d || !d.includes(res)) continue;
      const dd = dist(x, y, b.cx, b.cy);
      if (dd < bestD) { bestD = dd; best = b; }
    }
    return best;
  }

  /**
   * Obra sin terminar del mismo jugador más cercana a (x,y), dentro del radio
   * dado. La usan los aldeanos para encadenar construcciones: al terminar una,
   * si hay otra a la vista, van solos a seguir con ella.
   */
  findUnbuiltNear(player, x, y, radius, exclude) {
    let best = null, bestD = Infinity;
    for (const b of player.buildings) {
      if (b === exclude || b.built || b.dead) continue;
      const d = dist(x, y, b.cx, b.cy);
      if (d <= radius && d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /**
   * Recurso que debería ponerse a recolectar el aldeano que acaba de levantar
   * un edificio: el molino manda a por comida, el campamento maderero a por
   * leña y el minero a por oro o piedra (lo que tenga más cerca). Quien
   * construye una granja se queda cultivándola.
   * Devuelve el nodo (o la granja) o null si no hay nada cerca.
   */
  autoGatherJob(player, building) {
    if (!building || building.dead || !building.built) return null;
    const B = BUILDINGS[building.type];
    if (!B) return null;
    if (building.type === 'farm') return building.farmAmount > 0 ? building : null;
    // El centro urbano almacena de todo, así que no hay un recurso "suyo".
    if (!B.dropoff || building.type === 'towncenter') return null;

    const radius = (B.los || 5) + 3;
    let best = null, bestD = Infinity;
    for (const res of B.dropoff) {
      const node = this.findResourceNear(building.cx, building.cy, res, radius, player);
      if (!node) continue;
      const nx = node.kind === 'building' ? node.cx : node.fx;
      const ny = node.kind === 'building' ? node.cy : node.fy;
      const d = dist(building.cx, building.cy, nx, ny);
      if (d < bestD) { bestD = d; best = node; }
    }
    return best;
  }

  gatherInfo(target) {
    if (target.kind === 'building') {
      return { res: 'food', rate: 'farm', x: target.cx, y: target.cy, amount: target.farmAmount || 0 };
    }
    return { res: target.res, rate: target.rate, x: target.fx, y: target.fy, amount: target.amount };
  }

  consumeResource(target, amount) {
    if (target.kind === 'building') target.farmAmount -= amount;
    else target.amount -= amount;
  }

  depleteResource(target) {
    if (target.kind === 'building') {
      target.farmAmount = 0;
      this.killBuilding(target, null);
    } else if (target.alive) {
      const wasTree = target.kind === 'tree';
      if (this.net && !this.isGuest) this.netDepleted.push(target.id);
      this.map.removeNode(target);
      this.dropFromSelection(target);
      if (wasTree) this.fx.decal(target.fx, target.fy, 'stump');
      else this.fx.puff(target.fx, target.fy, 5);
    }
  }

  /** Saca del cuadro de selección algo que acaba de desaparecer o cambiar de dueño. */
  dropFromSelection(e) {
    const i = this.selection.indexOf(e);
    if (i >= 0) this.selection.splice(i, 1);
    e.selected = false;
  }

  // --- Rebaños --------------------------------------------------------------

  /**
   * Las ovejas se domestican solas: pasan al bando del jugador que tenga la
   * unidad más cercana dentro de su radio, y cambian de dueño si otro se acerca
   * más tarde. Mientras nadie ronde, se quedan con el último bando que las tuvo.
   */
  updateHerds(dt) {
    if (!this.herds.length) return;
    this.herdCd -= dt;
    const retame = this.herdCd <= 0;
    if (retame) this.herdCd = 0.4;
    for (const n of this.herds) {
      if (!n.alive) continue;
      if (retame) this.tameHerdNode(n);
      if (n.task) this.moveHerdNode(n, dt);
    }
  }

  tameHerdNode(n) {
    let best = null, bestD = Infinity;
    for (const u of this.unitsNear(n.fx, n.fy, n.tame)) {
      if (u.dead) continue;
      const d = dist(n.fx, n.fy, u.x, u.y);
      if (d < bestD) { bestD = d; best = u; }
    }
    if (!best || best.owner === n.owner) return;
    n.owner = best.owner;
    n.task = null;
    // Ya no es mía: no puede seguir seleccionada ni recibiendo órdenes.
    if (n.selected && n.owner !== this.human.id) this.dropFromSelection(n);
  }

  /**
   * Movimiento del rebaño: en línea recta, sin buscar camino. Si se topa con
   * algo intenta deslizarse por un eje y, si tampoco puede, se detiene: una
   * oveja no rodea un bosque, se queda donde la deja el obstáculo.
   */
  moveHerdNode(n, dt) {
    const t = n.task;
    const d = dist(n.fx, n.fy, t.x, t.y);
    if (d < 0.12) { n.task = null; return; }
    const step = Math.min(d, (n.speed || 0.7) * dt);
    const dx = ((t.x - n.fx) / d) * step, dy = ((t.y - n.fy) / d) * step;
    if (!this.stepHerdNode(n, dx, dy)
      && !this.stepHerdNode(n, dx, 0)
      && !this.stepHerdNode(n, 0, dy)) {
      n.task = null;
    }
  }

  stepHerdNode(n, dx, dy) {
    if (!dx && !dy) return false;
    const nx = n.fx + dx, ny = n.fy + dy;
    const m = this.map;
    if (nx < 0.5 || ny < 0.5 || nx > m.size - 0.5 || ny > m.size - 0.5) return false;
    const tx = Math.floor(nx), ty = Math.floor(ny);
    const sameTile = tx === n.x && ty === n.y;
    // Fuera de su casilla sólo puede pasar a terreno libre y sin otro recurso.
    if (!sameTile && (!m.isPassable(tx, ty) || m.nodeIndexAt(tx, ty) >= 0)) return false;
    const ox = n.fx, oy = n.fy;
    n.fx = nx; n.fy = ny;
    if (!m.retileNode(n)) { n.fx = ox; n.fy = oy; return false; }
    return true;
  }

  /** Manda el rebaño seleccionado a un punto del mapa. */
  commandHerd(animals, x, y, player = this.human) {
    const list = animals.filter((a) => a && a.herd && a.alive && a.owner === player.id);
    if (!list.length) return;
    if (this.isGuest) {
      this.netSend({ c: 'herd', ids: list.map((a) => a.id), x, y });
      return;
    }
    const spots = this.formationSpots(x, y, list.length);
    list.forEach((a, i) => {
      const s = spots[i] || { x, y };
      a.task = { x: s.x, y: s.y };
    });
  }

  // --- Combate --------------------------------------------------------------

  attackStats(src) {
    if (src.kind === 'building') {
      const p = this.players[src.owner];
      return {
        attack: p.buildingStat(src.type, 'attack'),
        pierce: !!BUILDINGS[src.type].pierce,
        bonus: null,
        ranged: true,
      };
    }
    const p = this.players[src.owner];
    const def = UNITS[src.type];
    return {
      attack: p.stat(src.type, 'attack'),
      pierce: !!def.pierce,
      bonus: def.bonus || null,
      ranged: p.stat(src.type, 'range') > 1.6,
      splash: def.splash || 0,
    };
  }

  armorOf(target, pierce) {
    if (target.kind === 'building') {
      const B = BUILDINGS[target.type];
      return pierce ? (B.pArmor ?? 4) : (B.armor ?? 0);
    }
    return this.players[target.owner].stat(target.type, pierce ? 'pArmor' : 'armor');
  }

  computeDamage(src, target) {
    const s = this.attackStats(src);
    let dmg = s.attack;
    if (s.bonus) {
      const classes = target.kind === 'building'
        ? ['building'] : UNITS[target.type].armorClasses;
      for (const c of classes) if (s.bonus[c]) dmg += s.bonus[c];
    }
    dmg -= this.armorOf(target, s.pierce);
    return Math.max(1, dmg);
  }

  launchAttack(src, target) {
    const s = this.attackStats(src);
    if (s.ranged) {
      this.spawnProjectile(src, target, 0);
    } else {
      this.applyDamage(src, target, this.computeDamage(src, target));
      this.fx.spark(target.x ?? target.cx, target.y ?? target.cy);
      if (this.audio && (src.owner === this.human.id || target.owner === this.human.id)) {
        this.audio.play('hit');
      }
    }
  }

  spawnProjectile(src, target, delay) {
    const def = src.kind === 'building' ? BUILDINGS[src.type] : UNITS[src.type];
    const boulder = def.splash > 0;
    const dmg = this.computeDamage(src, target);
    const p = new Projectile(src.owner, src, target, dmg, {
      splash: def.splash || 0,
      kindOf: boulder ? 'boulder' : 'arrow',
      delay,
      z: src.kind === 'building' ? 1.2 + src.size * 0.25 : 0.55,
    });
    p.src = src;
    this.projectiles.push(p);
    if (this.audio && src.owner === this.human.id) this.audio.play(boulder ? 'catapult' : 'bow');
  }

  projectileHit(p) {
    const x = p.px ?? p.tx, y = p.py ?? p.ty;
    if (p.splash > 0) {
      this.fx.spawn(x, y, 14, { color: '#c8a464', speed: 2.2, life: 0.6, size: 3.5 });
      if (this.audio) this.audio.play('impact');
      for (const u of this.unitsNear(x, y, p.splash)) {
        const falloff = 1 - dist(x, y, u.x, u.y) / (p.splash + 0.3);
        if (falloff <= 0) continue;
        u.takeDamage(Math.max(1, p.damage * falloff), this, p.src);
      }
      for (const b of this.buildings) {
        if (this.edgeDist({ x, y, radius: 0 }, b) <= p.splash) {
          b.takeDamage(p.damage * 0.6, this, p.src);
        }
      }
      return;
    }
    if (p.target && !p.target.dead) {
      this.applyDamage(p.src, p.target, p.damage);
      this.fx.spark(x, y);
    }
  }

  applyDamage(src, target, dmg) {
    if (!target || target.dead) return;
    target.takeDamage(dmg, this, src);
  }

  // --- Órdenes del jugador --------------------------------------------------

  commandMove(units, x, y, attackMove = false) {
    const list = units.filter((u) => u.kind === 'unit');
    if (!list.length) return;
    if (this.isGuest) {
      this.netSend({ c: 'move', ids: list.map((u) => u.id), x, y, a: attackMove });
      return;
    }
    const spots = this.formationSpots(x, y, list.length);
    list.forEach((u, i) => {
      const s = spots[i] || { x, y };
      u.stopTask();
      u.task = { type: attackMove ? 'attackmove' : 'move', x: s.x, y: s.y };
      u.carryTarget = null;
    });
  }

  formationSpots(x, y, n) {
    if (n === 1) return [{ x, y }];
    const out = [];
    const cols = Math.ceil(Math.sqrt(n));
    const gap = 0.95;
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const ox = (c - (cols - 1) / 2) * gap;
      const oy = (r - (Math.ceil(n / cols) - 1) / 2) * gap;
      const px = clamp(x + ox, 1, this.map.size - 2);
      const py = clamp(y + oy, 1, this.map.size - 2);
      out.push({ x: px, y: py });
    }
    return out;
  }

  commandTarget(units, target) {
    if (this.isGuest) {
      const list = units.filter((u) => u.kind === 'unit');
      if (!list.length || !target) return;
      const k = target.kind === 'building' ? 'b' : target.kind === 'unit' ? 'u' : 'n';
      this.netSend({ c: 'target', ids: list.map((u) => u.id), k, t: target.id });
      return;
    }
    for (const u of units) {
      if (u.kind !== 'unit') continue;
      // El recurso al que estaba dedicado, para volver a él después de descargar.
      const prev = u.task;
      const back = prev && (prev.type === 'gather' ? prev.target : prev.type === 'deliver' ? prev.back : null);
      u.stopTask();
      if (target.kind === 'building') {
        if (target.owner === u.owner) {
          if (!target.built && u.type === 'villager') u.task = { type: 'build', target };
          else if (this.acceptsCarry(target, u)) u.task = { type: 'deliver', target, back };
          else if (target.type === 'farm' && u.type === 'villager') u.task = { type: 'gather', target };
          else if (target.hp < target.maxHp && u.type === 'villager') u.task = { type: 'build', target };
          else u.task = { type: 'move', x: target.cx, y: target.cy };
        } else {
          u.task = { type: 'attack', target };
        }
      } else if (target.kind === 'unit') {
        if (target.owner === u.owner) u.task = { type: 'move', x: target.x, y: target.y };
        else u.task = { type: 'attack', target };
      } else {
        // Nodo de recursos.
        if (u.type === 'villager') u.task = { type: 'gather', target };
        else u.task = { type: 'move', x: target.fx, y: target.fy };
      }
    }
  }

  /** Detener: cancela lo que estuvieran haciendo las unidades. */
  commandStop(units) {
    const animals = units.filter((a) => a && a.herd && a.alive && a.owner === this.human.id);
    if (animals.length) {
      if (this.isGuest) this.netSend({ c: 'herdstop', ids: animals.map((a) => a.id) });
      else for (const a of animals) a.task = null;
    }
    const list = units.filter((u) => u.kind === 'unit' && u.owner === this.human.id);
    if (!list.length) return;
    if (this.isGuest) { this.netSend({ c: 'stop', ids: list.map((u) => u.id) }); return; }
    for (const u of list) u.stopTask();
  }

  /** Eliminar lo seleccionado (unidades o edificios propios). */
  commandDelete(entities) {
    const list = entities.filter((e) => (e.kind === 'unit' || e.kind === 'building')
      && e.owner === this.human.id && !e.dead);
    if (!list.length) return;
    if (this.isGuest) { this.netSend({ c: 'delete', ids: list.map((e) => e.id) }); return; }
    for (const e of list) {
      if (e.kind === 'unit') this.killUnit(e, null);
      else this.killBuilding(e, null);
    }
  }

  /** Punto de reunión de uno o varios edificios. */
  commandRally(buildings, x, y, target) {
    const list = buildings.filter((b) => b.kind === 'building' && b.owner === this.human.id);
    if (!list.length) return;
    if (this.isGuest) {
      this.netSend({ c: 'rally', ids: list.map((b) => b.id), x, y, t: target && target.kind ? target.id : null });
      return;
    }
    for (const b of list) {
      b.rally = target && target.kind
        ? { x: target.x ?? target.cx, y: target.y ?? target.cy, target }
        : { x, y };
    }
  }

  /** Compraventa en el mercado. dir es 'sell' o 'buy'. */
  commandMarket(res, dir) {
    const p = this.human;
    const price = Math.round(100 * (dir === 'sell' ? 0.8 : 1.4));
    if (dir === 'sell' && p.res[res] < 100) return;
    if (dir === 'buy' && p.res.gold < price) return;
    if (this.isGuest) { this.netSend({ c: 'market', r: res, d: dir }); return; }
    if (dir === 'sell') { p.res[res] -= 100; p.res.gold += price; }
    else { p.res.gold -= price; p.res[res] += 100; }
  }

  /** Rendirse. */
  commandResign() {
    if (this.isGuest) { this.netSend({ c: 'resign' }); return; }
    this.human.defeated = true;
    this.checkVictory();
    if (!this.over) this.endGame(false);
  }

  /** Cola de producción. Devuelve un mensaje de error o null. */
  queueUnit(building, type, player) {
    const def = UNITS[type];
    if (!def) return 'Unidad desconocida';
    if (this.isGuest) { this.netSend({ c: 'train', b: building.id, t: type }); return null; }
    if (player.age < def.age) return `Requiere la ${AGES[def.age].name}`;
    if (!player.canAfford(def.cost)) return 'Recursos insuficientes';
    if (building.queue.length >= 12) return 'Cola llena';
    player.pay(def.cost);
    building.queue.push({ kind: 'unit', key: type, progress: 0, time: def.time });
    return null;
  }

  queueTech(building, key, player) {
    const t = TECHS[key];
    if (!t) return 'Tecnología desconocida';
    if (this.isGuest) { this.netSend({ c: 'tech', b: building.id, k2: key }); return null; }
    if (player.techs.has(key)) return 'Ya investigada';
    if (player.age < t.age) return `Requiere la ${AGES[t.age].name}`;
    if (t.requires && !player.techs.has(t.requires)) return `Requiere ${TECHS[t.requires].name}`;
    if (building.queue.some((q) => q.key === key)) return 'Ya está en cola';
    if (!player.canAfford(t.cost)) return 'Recursos insuficientes';
    player.pay(t.cost);
    building.queue.push({ kind: 'tech', key, progress: 0, time: t.time });
    return null;
  }

  queueUpgrade(building, key, player) {
    const up = UPGRADES[key];
    if (!up) return 'Mejora desconocida';
    if (this.isGuest) { this.netSend({ c: 'upgrade', b: building.id, k2: key }); return null; }
    if (player.techs.has(key)) return 'Ya investigada';
    if (player.age < up.age) return `Requiere la ${AGES[up.age].name}`;
    if (building.queue.some((q) => q.key === key)) return 'Ya está en cola';
    if (!player.canAfford(up.cost)) return 'Recursos insuficientes';
    player.pay(up.cost);
    building.queue.push({ kind: 'upgrade', key, progress: 0, time: up.time });
    return null;
  }

  queueAge(building, player) {
    const next = player.age + 1;
    if (next >= AGES.length) return 'Ya estás en la Edad Imperial';
    if (this.isGuest) { this.netSend({ c: 'age', b: building.id }); return null; }
    const age = AGES[next];
    const req = player.countBuildings((b) => b.built && BUILDINGS[b.type].age <= player.age
      && !['house', 'farm', 'wall', 'towncenter'].includes(b.type));
    if (req < age.reqBuildings) return `Necesitas ${age.reqBuildings} edificios de la edad actual`;
    if (building.queue.some((q) => q.kind === 'age')) return 'Ya estás avanzando';
    if (!player.canAfford(age.cost)) return 'Recursos insuficientes';
    player.pay(age.cost);
    building.queue.push({ kind: 'age', key: next, progress: 0, time: age.time });
    return null;
  }

  cancelQueueItem(building, index) {
    if (this.isGuest) { this.netSend({ c: 'cancelq', b: building.id, i: index }); return; }
    const item = building.queue[index];
    if (!item) return;
    const player = this.players[building.owner];
    const cost = item.kind === 'unit' ? UNITS[item.key].cost
      : item.kind === 'tech' ? TECHS[item.key].cost
        : item.kind === 'upgrade' ? UPGRADES[item.key].cost
          : AGES[item.key].cost;
    player.refund(cost);
    building.queue.splice(index, 1);
  }

  spawnUnitFrom(building, type) {
    const player = this.players[building.owner];
    const spots = ringTiles(this.map, building.tx, building.ty, building.size, building.size, 1);
    let spot = spots.length ? spots[(Math.random() * spots.length) | 0] : null;
    if (!spot) spot = nearestFree(this.map, building.tx, building.ty + building.size, 12);
    if (!spot) return null;
    const u = this.createUnit(type, player, spot.x + 0.5, spot.y + 0.5);
    if (!u) return null;
    if (building.rally) {
      if (building.rally.target && !building.rally.target.dead) {
        this.commandTarget([u], building.rally.target);
      } else {
        u.task = { type: 'move', x: building.rally.x, y: building.rally.y };
      }
    }
    return u;
  }

  /** Coloca un edificio y manda a construir a los aldeanos seleccionados. */
  placeBuilding(type, tx, ty, player, builders) {
    if (!this.canPlace(type, tx, ty, player)) return 'No se puede construir aquí';
    const cost = BUILDINGS[type].cost;
    if (player.age < BUILDINGS[type].age) return `Requiere la ${AGES[BUILDINGS[type].age].name}`;
    if (this.isGuest) {
      // Se comprueba lo evidente en local para poder avisar al momento; la
      // colocación de verdad la hace el anfitrión.
      if (!player.canAfford(cost)) return 'Recursos insuficientes';
      const ids = (builders || []).filter((u) => u.type === 'villager' && !u.dead).map((u) => u.id);
      this.netSend({ c: 'build', t: type, x: tx, y: ty, ids });
      return null;
    }
    if (!player.canAfford(cost)) return 'Recursos insuficientes';
    player.pay(cost);
    const b = this.createBuilding(type, player, tx, ty, false);
    if (!b) { player.refund(cost); return 'No se puede construir aquí'; }
    const vs = (builders || []).filter((u) => u.kind === 'unit' && u.type === 'villager' && !u.dead);
    for (const v of vs) { v.stopTask(); v.task = { type: 'build', target: b }; }
    if (!vs.length) {
      // Sin aldeanos seleccionados, busca al más cercano que esté libre.
      let best = null, bestD = Infinity;
      for (const u of player.units) {
        if (u.type !== 'villager') continue;
        const d = dist(u.x, u.y, b.cx, b.cy);
        if (d < bestD) { bestD = d; best = u; }
      }
      if (best) { best.stopTask(); best.task = { type: 'build', target: b }; }
    }
    return null;
  }

  // --- Niebla de guerra -----------------------------------------------------

  updateFog(force = false) {
    const S = this.map.size;
    this.fogVisible.fill(0);
    const reveal = (cx, cy, r) => {
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(S - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(S - 1, Math.ceil(cy + r));
      const r2 = r * r;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r2) {
            const i = y * S + x;
            this.fogVisible[i] = 1;
            this.fogExplored[i] = 1;
          }
        }
      }
    };
    const p = this.human;
    for (const u of p.units) reveal(u.x, u.y, UNITS[u.type].los);
    for (const b of p.buildings) reveal(b.cx, b.cy, BUILDINGS[b.type].los);
    this.fogVersion = (this.fogVersion || 0) + 1;
  }

  isVisible(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.map.size || ty >= this.map.size) return false;
    return this.fogVisible[ty * this.map.size + tx] === 1;
  }

  isExplored(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.map.size || ty >= this.map.size) return false;
    return this.fogExplored[ty * this.map.size + tx] === 1;
  }

  // --- Bucle ----------------------------------------------------------------

  update(dt) {
    if (this.paused) return;
    if (this.over && !this.keepsSimulating) return;
    if (this.isGuest) { this.updateAsGuest(dt); return; }
    dt *= this.speed;
    this.time += dt;
    this.rebuildGrid();

    for (const u of this.units) u.update(this, dt);
    for (const b of this.buildings) b.update(this, dt);
    this.updateHerds(dt);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(this, dt);
      if (p.dead) this.projectiles.splice(i, 1);
    }

    this.fx.update(dt);

    this.fogCd -= dt;
    if (this.fogCd <= 0) { this.fogCd = 0.2; this.updateFog(); }

    if (this.ai) this.ai.update(dt);
    if (this.net) this.net.tick(dt);
  }

  /**
   * El invitado no simula: interpola entre las dos últimas instantáneas para
   * que el movimiento se vea suave aunque lleguen sólo diez por segundo, y
   * calcula su propia niebla a partir de sus unidades.
   */
  updateAsGuest(dt) {
    this.rebuildGrid();
    // El anfitrión espacia las instantáneas según cuánta gente haya; la sesión
    // mide cada cuánto llegan de verdad y aquí se interpola con esa medida.
    const step = dt / (this.netSnapMs || 0.1);
    for (const u of this.units) {
      if (!u.lerpTo) continue;
      u.lerpT = Math.min(1, (u.lerpT || 0) + step);
      const k = u.lerpT;
      u.x = u.lerpFrom.x + (u.lerpTo.x - u.lerpFrom.x) * k;
      u.y = u.lerpFrom.y + (u.lerpTo.y - u.lerpFrom.y) * k;
      if (u.attackAnim > 0) u.attackAnim -= dt;
    }
    this.fx.update(dt);
    this.fogCd -= dt;
    if (this.fogCd <= 0) { this.fogCd = 0.2; this.updateFog(); }
  }

  // Utilidades para la interfaz.
  idleVillagers() {
    const out = [];
    for (const u of this.human.units) if (u.type === 'villager' && !u.task) out.push(u);
    return out;
  }

  militaryCount(player) {
    let n = 0;
    for (const u of player.units) if (u.isMilitary) n++;
    return n;
  }
}
