// Generación del mapa: terreno, bosques, minas y posiciones iniciales.

import { TILE_W, TILE_H, RESOURCE_NODES } from './config.js';
import { Rng, makeNoise, fbm, clamp } from './utils.js';
import { drawTerrainTile, makeCanvas, TERRAIN_COLORS } from './sprites.js';

const HW = TILE_W / 2, HH = TILE_H / 2;

export class GameMap {
  constructor(size, seed, playerCount) {
    this.size = size;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.terrain = new Uint8Array(size * size);
    this.blocked = new Uint8Array(size * size);   // agua y recursos que bloquean
    this.occupied = new Int32Array(size * size);  // id del edificio que ocupa la celda
    this.nodeAt = new Int32Array(size * size);    // índice del recurso + 1
    this.nodes = [];
    this.starts = [];
    this.terrainNames = ['grass', 'grass2', 'grass3', 'dirt', 'sand', 'water', 'shallow'];
    this.generate(playerCount);
    this.buildTerrainCanvas();
  }

  idx(x, y) { return y * this.size + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }

  terrainAt(x, y) { return this.terrainNames[this.terrain[this.idx(x, y)]]; }

  isPassable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    return !this.blocked[i] && !this.occupied[i];
  }

  /** Sólo el terreno: útil para saber si se puede construir. */
  isBuildable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    const t = this.terrainNames[this.terrain[i]];
    return t !== 'water' && t !== 'shallow' && !this.blocked[i] && !this.occupied[i];
  }

  nodeIndexAt(x, y) {
    if (!this.inBounds(x, y)) return -1;
    return this.nodeAt[this.idx(x, y)] - 1;
  }

  nodeAtTile(x, y) {
    const i = this.nodeIndexAt(x, y);
    return i >= 0 ? this.nodes[i] : null;
  }

  // --- Generación -----------------------------------------------------------

  generate(playerCount) {
    const S = this.size, rng = this.rng;
    const n1 = makeNoise(rng, 64), n2 = makeNoise(rng, 64), n3 = makeNoise(rng, 64);

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const h = fbm(n1, x / S * 6, y / S * 6, 4, 1, 0.55);
        const m = fbm(n2, x / S * 4 + 11, y / S * 4 + 7, 3, 1, 0.5);
        // Los dos verdes se reparten con ruido fino, no al azar por casilla: así
        // la hierba sale a manchas en vez de en tablero de ajedrez.
        const g = fbm(n3, x / S * 14 + 5, y / S * 14 + 23, 2, 1, 0.5);
        let t;
        if (h < 0.30) t = 5;                       // agua
        else if (h < 0.345) t = 6;                 // orilla
        else if (m > 0.62) t = 2;                  // hierba frondosa
        else if (m < 0.36) t = 3;                  // tierra
        else t = g > 0.52 ? 1 : 0;                 // hierba
        this.terrain[this.idx(x, y)] = t;
      }
    }
    // Borde del mapa siempre transitable pero sin recursos.
    for (let i = 0; i < S * S; i++) {
      const t = this.terrain[i];
      this.blocked[i] = (t === 5 || t === 6) ? 1 : 0;
    }

    this.pickStarts(playerCount);
    this.clearStartAreas();
    this.addBeaches();
    this.placeResources(playerCount);
  }

  /**
   * Orla de arena donde la tierra toca el agua. Sin ella la costa es un corte
   * seco de hierba a agua; con ella el mapa tiene ribera. Va después de aplanar
   * las bases para que no salgan playas alrededor de un lago ya rellenado.
   */
  addBeaches() {
    const S = this.size, rng = this.rng;
    const wet = (x, y) => this.inBounds(x, y) && this.terrain[this.idx(x, y)] >= 5;
    const beach = [];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = this.idx(x, y);
        if (this.terrain[i] >= 5) continue;
        const side = wet(x - 1, y) || wet(x + 1, y) || wet(x, y - 1) || wet(x, y + 1);
        const corner = wet(x - 1, y - 1) || wet(x + 1, y + 1) || wet(x - 1, y + 1) || wet(x + 1, y - 1);
        // Las esquinas sólo a veces: así el borde de la playa sale mellado.
        if (side || (corner && rng.chance(0.6))) beach.push(i);
      }
    }
    for (const i of beach) this.terrain[i] = 4;
  }

  pickStarts(playerCount) {
    const S = this.size, c = S / 2;
    const r = S * 0.33;
    const base = this.rng.float(0, Math.PI * 2);
    for (let i = 0; i < playerCount; i++) {
      const a = base + (i / playerCount) * Math.PI * 2;
      let x = Math.round(c + Math.cos(a) * r);
      let y = Math.round(c + Math.sin(a) * r);
      x = clamp(x, 8, S - 9); y = clamp(y, 8, S - 9);
      this.starts.push({ x, y });
    }
  }

  /** Aplana el terreno alrededor de cada base para que quepa el centro urbano. */
  clearStartAreas() {
    for (const s of this.starts) {
      for (let dy = -7; dy <= 7; dy++) {
        for (let dx = -7; dx <= 7; dx++) {
          const x = s.x + dx, y = s.y + dy;
          if (!this.inBounds(x, y)) continue;
          if (Math.hypot(dx, dy) > 7.5) continue;
          const i = this.idx(x, y);
          if (this.terrain[i] >= 5) this.terrain[i] = 3;
          this.blocked[i] = 0;
        }
      }
    }
  }

  addNode(kind, x, y) {
    if (!this.inBounds(x, y)) return null;
    const i = this.idx(x, y);
    if (this.nodeAt[i] || this.blocked[i] || this.terrain[i] >= 5) return null;
    const def = RESOURCE_NODES[kind];
    const node = {
      id: this.nodes.length, kind, x, y, res: def.res,
      // Posición exacta dentro del mundo. En los recursos fijos es el centro de
      // su casilla; los rebaños se mueven y la van cambiando.
      fx: x + 0.5, fy: y + 0.5,
      amount: def.amount, max: def.amount, rate: def.rate,
      variant: this.rng.int(0, 2), alive: true, blocking: def.blocking,
      herd: !!def.herd, tame: def.tame || 0, speed: def.speed || 0,
      owner: null, task: null, selected: false,
    };
    this.nodes.push(node);
    this.nodeAt[i] = node.id + 1;
    if (def.blocking) this.blocked[i] = 1;
    return node;
  }

  removeNode(node) {
    node.alive = false;
    node.task = null;
    const i = this.idx(node.x, node.y);
    if (this.nodeAt[i] === node.id + 1) this.nodeAt[i] = 0;
    this.blocked[i] = 0;
  }

  /**
   * Vuelve a registrar un recurso que se ha movido en la casilla que le toca
   * por su posición. Devuelve false —y lo deja donde estaba— si la casilla de
   * destino ya está ocupada por otro recurso.
   */
  retileNode(node) {
    const nx = clamp(Math.floor(node.fx), 0, this.size - 1);
    const ny = clamp(Math.floor(node.fy), 0, this.size - 1);
    if (nx === node.x && ny === node.y) return true;
    const dst = this.idx(nx, ny);
    if (this.nodeAt[dst]) return false;
    const src = this.idx(node.x, node.y);
    if (this.nodeAt[src] === node.id + 1) this.nodeAt[src] = 0;
    if (node.blocking) this.blocked[src] = 0;
    node.x = nx; node.y = ny;
    this.nodeAt[dst] = node.id + 1;
    if (node.blocking) this.blocked[dst] = 1;
    return true;
  }

  cluster(kind, cx, cy, count, spread, avoid = 0) {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 25) {
      tries++;
      const a = this.rng.float(0, Math.PI * 2);
      const d = Math.sqrt(this.rng.next()) * spread;
      const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
      if (avoid && this.nearStart(x, y) < avoid) continue;
      if (this.addNode(kind, x, y)) placed++;
    }
    return placed;
  }

  nearStart(x, y) {
    let best = Infinity;
    for (const s of this.starts) best = Math.min(best, Math.hypot(s.x - x, s.y - y));
    return best;
  }

  placeResources(playerCount) {
    const S = this.size, rng = this.rng;

    // Recursos garantizados junto a cada base.
    for (const s of this.starts) {
      const a0 = rng.float(0, Math.PI * 2);
      const at = (ang, d) => [Math.round(s.x + Math.cos(ang) * d), Math.round(s.y + Math.sin(ang) * d)];
      let [bx, by] = at(a0, 8.5);
      this.cluster('berries', bx, by, 6, 1.6);
      let [gx, gy] = at(a0 + 2.1, 9.5);
      this.cluster('gold', gx, gy, 6, 1.6);
      let [g2x, g2y] = at(a0 + 3.6, 13);
      this.cluster('gold', g2x, g2y, 5, 1.6);
      let [sx, sy] = at(a0 + 4.4, 10.5);
      this.cluster('stone', sx, sy, 5, 1.5);
      // Dos bosques cercanos.
      for (const ang of [a0 + 1.1, a0 + 4.9]) {
        const [fx, fy] = at(ang, 9);
        this.cluster('tree', fx, fy, 46, 4.2);
      }
      // Ovejas alrededor del centro urbano.
      for (let i = 0; i < 8; i++) {
        const ang = a0 + 0.6 + i * 0.7;
        const d = i < 4 ? 4.5 : 6.5;
        const [ox, oy] = at(ang, d);
        this.addNode('sheep', ox, oy);
      }
    }

    // Bosques neutrales.
    const forests = Math.round((S * S) / 420);
    for (let i = 0; i < forests; i++) {
      const x = rng.int(3, S - 4), y = rng.int(3, S - 4);
      if (this.nearStart(x, y) < 14) continue;
      this.cluster('tree', x, y, rng.int(30, 70), rng.float(3.5, 6));
    }
    // Minas y caza neutrales.
    const mines = Math.round(playerCount * 2.5);
    for (let i = 0; i < mines; i++) {
      const x = rng.int(4, S - 5), y = rng.int(4, S - 5);
      if (this.nearStart(x, y) < 15) continue;
      this.cluster(rng.chance(0.55) ? 'gold' : 'stone', x, y, rng.int(4, 7), 1.8);
    }
    for (let i = 0; i < playerCount * 2; i++) {
      const x = rng.int(4, S - 5), y = rng.int(4, S - 5);
      if (this.nearStart(x, y) < 12) continue;
      this.cluster('deer', x, y, 4, 2.2);
    }
  }

  // --- Renderizado estático -------------------------------------------------

  buildTerrainCanvas() {
    const S = this.size;
    this.originX = S * HW;
    this.canvas = makeCanvas(S * TILE_W, S * TILE_H + TILE_H);
    const ctx = this.canvas.getContext('2d');
    ctx.fillStyle = '#1d2a17';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    /*
     * El azar de cada rombo se guarda, porque el renderizador vuelve a pintar
     * los que se ven cuando la cámara está cerca y deben salir igual que aquí.
     * Va en ocho escalones en vez de continuo: así el renderizador puede hornear
     * un rombo por escalón y copiarlo, en vez de dibujar la textura de cada uno.
     */
    const rng = new Rng(this.seed ^ 0x9e3779b9);
    this.tileRnd = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = this.idx(x, y);
        this.tileRnd[i] = (rng.int(0, 7) + 0.5) / 8;
        const [sx, sy] = this.tileToCanvas(x, y);
        drawTerrainTile(ctx, sx, sy, this.terrainNames[this.terrain[i]], this.tileRnd[i]);
      }
    }
    this.buildMinimap();
  }

  /** Coordenadas dentro del lienzo estático (esquina superior del rombo). */
  tileToCanvas(x, y) {
    return [this.originX + (x - y) * HW, (x + y) * HH];
  }

  buildMinimap() {
    const S = this.size;
    const w = 512, h = 256;
    this.minimap = makeCanvas(w, h);
    const ctx = this.minimap.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const colors = this.terrainNames.map((n) => TERRAIN_COLORS[n]);
    const sx = w / (S * 2), sy = h / (S * 2);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const px = (x - y + S) * sx, py = (x + y) * sy;
        ctx.fillStyle = colors[this.terrain[this.idx(x, y)]];
        ctx.fillRect(px - sx - 0.5, py - 0.5, sx * 2 + 1, sy * 2 + 1);
      }
    }
    // Recursos visibles en el minimapa. Los rebaños no: se mueven, así que los
    // pinta el renderizador en cada fotograma con el color de su dueño.
    for (const n of this.nodes) {
      if (n.herd) continue;
      const px = (n.x - n.y + S) * sx, py = (n.x + n.y) * sy;
      ctx.fillStyle = n.kind === 'tree' ? '#28541f'
        : n.kind === 'gold' ? '#e0b52c'
          : n.kind === 'stone' ? '#c8c8c2'
            : '#d24a3a';
      ctx.fillRect(px - sx, py - sy * 0.5, sx * 2, sy * 1.5);
    }
  }
}
