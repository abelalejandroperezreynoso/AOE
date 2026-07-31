// Renderizador isométrico sobre canvas 2D.

import { TILE_W, TILE_H, UNITS, BUILDINGS, PLAYER_COLORS } from './config.js';
import {
  unitSprite, buildingSprite, resourceSprite, makeCanvas, HW, HH,
  drawSprite, paintUnit, paintBuilding, paintResource, setSpriteQuality, drawTerrainSprite,
} from './sprites.js';
import { LOOK } from './data/appearance.js';
import { clamp, dist } from './utils.js';

const Z_PX = 18; // píxeles de altura por unidad de "z" en el mundo
/*
 * Tope de rombos que se copian uno a uno por fotograma antes de tirar del lienzo
 * horneado del mapa entero. Medido sobre el propio juego: hasta ~1000 rombos
 * sale igual o mejor que copiar el lienzo grande, porque ampliar un mapa de bits
 * de millones de píxeles cuesta más que copiar mil recortes pequeños; pasado ese
 * punto gana el lienzo. De cerca nunca se llega al tope, y de lejos el lienzo se
 * reduce en pantalla y ya se ve bien.
 */
const MAX_TILES = 1000;

/*
 * Banderas de destino: colores por clase de orden, los mismos del marcador que
 * parpadea al darla, y cuántas se pintan como mucho. Con la selección al
 * completo de una base salen destinos de sobra, y a partir de unas pocas
 * banderas ya no se distingue nada.
 */
const FLAG_COLORS = {
  move: { pole: '#cdeccd', cloth: '#5fb867' },
  gather: { pole: '#ffeaa8', cloth: '#d9a92c' },
  attack: { pole: '#ffc7bd', cloth: '#c8493a' },
  rally: { pole: '#ffe9a8', cloth: '#e0b52c' },
};
const MAX_FLAGS = 12;

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.game = game;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.minZoom = 0.3; this.maxZoom = 3.5; // resize() ajusta el mínimo al mapa
    this.fog = makeCanvas(64, 64);
    this.fogCtx = this.fog.getContext('2d');
    this.fogBlur = makeCanvas(64, 64);
    this.fogBlurCtx = this.fogBlur.getContext('2d');
    this.fogScale = 5;
    this.fogMargin = 8;
    this.fogKey = '';
    this.hover = null;
    this.showHealth = false;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.dpr = dpr;
    // Los sprites se guardan a la densidad de la pantalla: a zoom 1 la copia
    // sale píxel a píxel en vez de ampliada. Cada fotograma se sube o se baja
    // según lo cerca que esté la cámara (ver `render`).
    setSpriteQuality(dpr);
    const prevW = this.w, prevH = this.h;
    this.w = w; this.h = h;
    /*
     * La cámara mira al centro del lienzo, así que al cambiar éste de tamaño el
     * mundo se desplazaría media diferencia de golpe. Pero el lienzo no crece
     * por sus cuatro lados: su esquina de arriba a la izquierda se queda donde
     * está y lo que se mueve es el borde de abajo —al aparecer o retirarse la
     * barra inferior, sobre todo—. Se corrige la cámara en esa media diferencia
     * para que lo que ya se estaba viendo no se mueva ni un píxel: la franja que
     * se gana aparece por abajo, que es de donde viene.
     *
     * Al girar el aparato no: ahí cambian los dos lados de golpe y lo que se
     * quiere conservar es el centro, de lo que ya se encarga keepViewOnTurn().
     */
    const turned = !!prevW && ((prevW >= prevH) !== (w >= h));
    if (prevW && prevH && !turned) {
      this.cam.x += (w - prevW) / (2 * this.cam.zoom);
      this.cam.y += (h - prevH) / (2 * this.cam.zoom);
    }
    /*
     * Hasta dónde se puede alejar la cámara: lo justo para que quepa el mapa
     * entero con un margen. Sin minimapa, esa es la vista de conjunto —de dónde
     * viene el rival, dónde queda el bosque—, así que depende del mapa y de la
     * pantalla, no de un número fijo. El suelo evita que en un teléfono con un
     * mapa grande las unidades acaben siendo motas de polvo.
     */
    const m = this.game.map;
    if (m) {
      const fit = Math.min(w / (m.size * TILE_W), h / (m.size * TILE_H + TILE_H));
      this.minZoom = clamp(fit * 0.95, 0.12, 0.5);
      this.clampCam();
    }
    const fw = Math.ceil(w / this.fogScale) + this.fogMargin * 2;
    const fh = Math.ceil(h / this.fogScale) + this.fogMargin * 2;
    this.fog.width = fw; this.fog.height = fh;
    this.fogBlur.width = fw; this.fogBlur.height = fh;
    this.fogKey = '';
  }

  // --- Conversión de coordenadas -------------------------------------------

  worldToCanvas(u, v) {
    return [this.game.map.originX + (u - v) * HW, (u + v) * HH];
  }

  canvasToWorld(mx, my) {
    const a = (mx - this.game.map.originX) / HW;
    const b = my / HH;
    return [(a + b) / 2, (b - a) / 2];
  }

  worldToScreen(u, v) {
    const [mx, my] = this.worldToCanvas(u, v);
    return [(mx - this.cam.x) * this.cam.zoom + this.w / 2, (my - this.cam.y) * this.cam.zoom + this.h / 2];
  }

  screenToWorld(sx, sy) {
    const mx = (sx - this.w / 2) / this.cam.zoom + this.cam.x;
    const my = (sy - this.h / 2) / this.cam.zoom + this.cam.y;
    return this.canvasToWorld(mx, my);
  }

  centerOn(u, v) {
    const [mx, my] = this.worldToCanvas(u, v);
    this.cam.x = mx; this.cam.y = my;
    this.clampCam();
  }

  clampCam() {
    const m = this.game.map;
    const pad = 200;
    this.cam.x = clamp(this.cam.x, -pad, m.size * TILE_W + pad);
    this.cam.y = clamp(this.cam.y, -pad, m.size * TILE_H + TILE_H + pad);
    this.cam.zoom = clamp(this.cam.zoom, this.minZoom, this.maxZoom);
  }

  visibleTileBounds(pad = 3) {
    const corners = [
      this.screenToWorld(0, 0), this.screenToWorld(this.w, 0),
      this.screenToWorld(0, this.h), this.screenToWorld(this.w, this.h),
    ];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [u, v] of corners) {
      x0 = Math.min(x0, u); x1 = Math.max(x1, u);
      y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    }
    const S = this.game.map.size;
    return {
      x0: clamp(Math.floor(x0) - pad, 0, S - 1), x1: clamp(Math.ceil(x1) + pad, 0, S - 1),
      y0: clamp(Math.floor(y0) - pad, 0, S - 1), y1: clamp(Math.ceil(y1) + pad, 0, S - 1),
    };
  }

  // --- Dibujo ---------------------------------------------------------------

  render(dt) {
    const g = this.game, ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0d1410';
    ctx.fillRect(0, 0, this.w, this.h);

    const z = this.cam.zoom;
    ctx.save();
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z,
      this.dpr * (this.w / 2 - this.cam.x * z), this.dpr * (this.h / 2 - this.cam.y * z));

    /*
     * Ampliar es lo que emborrona: por debajo de 1:1 los mapas de bits ya
     * horneados se ven perfectos, y por encima hay que volver a dibujar. Antes
     * de llegar a eso está la caché, que se hornea a la resolución que pida la
     * cámara: copiar un mapa de bits cuesta una fracción de lo que cuesta
     * volver a dibujar a un soldado entero con su armadura, así que sólo se
     * pinta a mano cuando ni al máximo (3×) daría la talla. Y ahí ya está la
     * cámara tan cerca que caben pocas unidades en pantalla.
     */
    setSpriteQuality(Math.min(3, Math.ceil(this.dpr * z)));
    this.sharp = this.dpr * z > 3;
    ctx.imageSmoothingEnabled = true;

    const b = this.visibleTileBounds();
    this.drawTerrain(ctx, b);
    this.drawDecals(ctx, b);
    this.drawSelectionMarkers(ctx);
    this.drawEntities(ctx, b);
    this.drawFlags(ctx);
    this.drawParticles(ctx);
    this.drawPlacement(ctx);
    ctx.restore();

    this.drawFog(ctx);
    this.drawFloatingText(ctx);
    this.drawHud(ctx);
  }

  /**
   * El terreno está horneado en un solo lienzo del tamaño del mapa, que a
   * pantalla completa mide decenas de millones de píxeles: no cabe guardarlo a
   * más resolución. En su lugar, cuando la cámara lo ampliaría se copian rombo a
   * rombo los que se ven, desde una tabla de rombos horneados a la resolución de
   * la pantalla. Se hace sólo si son pocos: de lejos entra medio mapa y el
   * lienzo grande, que allí se reduce, se ve igual de bien y cuesta un único
   * `drawImage`.
   */
  drawTerrain(ctx, b) {
    const m = this.game.map;
    const tiles = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
    if (this.dpr * this.cam.zoom <= 1.15 || tiles > MAX_TILES || !m.tileRnd) {
      ctx.drawImage(m.canvas, 0, 0);
      return;
    }
    // El fondo del lienzo horneado, para que el borde del mapa se vea igual.
    ctx.fillStyle = '#1d2a17';
    ctx.fillRect(0, 0, m.canvas.width, m.canvas.height);
    /*
     * Los rombos se copian sin interpolar: están horneados a la resolución que
     * pide la cámara, así que la copia es casi uno a uno y el filtro no aporta
     * nada, pero filtrar setecientos rombos por fotograma cuesta lo suyo donde
     * el lienzo no va por tarjeta gráfica.
     */
    ctx.imageSmoothingEnabled = false;
    const names = m.terrainNames;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const i = m.idx(x, y);
        const [sx, sy] = m.tileToCanvas(x, y);
        drawTerrainSprite(ctx, sx, sy, names[m.terrain[i]], m.tileRnd[i]);
      }
    }
    ctx.imageSmoothingEnabled = true;
  }

  drawDecals(ctx, b) {
    for (const d of this.game.fx.decals) {
      if (d.x < b.x0 || d.x > b.x1 || d.y < b.y0 || d.y > b.y1) continue;
      if (!this.game.isExplored(d.x | 0, d.y | 0)) continue;
      const [mx, my] = this.worldToCanvas(d.x, d.y);
      const a = Math.min(1, d.life / 3) * 0.55;
      if (d.kind === 'blood') {
        ctx.fillStyle = `rgba(90,20,18,${a})`;
        ctx.beginPath(); ctx.ellipse(mx, my, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      } else if (d.kind === 'rubble') {
        ctx.fillStyle = `rgba(60,52,40,${a})`;
        ctx.beginPath(); ctx.ellipse(mx, my, 26, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(110,98,78,${a})`;
        for (let i = 0; i < 7; i++) {
          const ang = i * 1.7, r = 6 + (i % 3) * 6;
          ctx.fillRect(mx + Math.cos(ang) * r - 2, my + Math.sin(ang) * r * 0.5 - 2, 5, 4);
        }
      } else if (d.kind === 'stump') {
        ctx.globalAlpha = Math.min(1, d.life / 3);
        if (this.sharp) paintResource(ctx, mx, my, 'stump', 0);
        else drawSprite(ctx, resourceSprite('stump', 0), mx, my);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawSelectionMarkers(ctx) {
    const g = this.game;
    for (const e of g.selection) {
      if (e.dead || e.alive === false) continue;
      const owner = e.owner === null || e.owner === undefined ? g.human.id : e.owner;
      const col = PLAYER_COLORS[g.players[owner].colorIdx].light;
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      if (e.kind === 'unit') {
        const [mx, my] = this.worldToCanvas(e.x, e.y);
        ctx.beginPath();
        ctx.ellipse(mx, my, 13 * (e.radius / 0.3), 6.5 * (e.radius / 0.3), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind !== 'building') {
        // Animal del rebaño: lleva el mismo cerco que una unidad.
        const [mx, my] = this.worldToCanvas(e.fx, e.fy);
        ctx.beginPath();
        ctx.ellipse(mx, my, 15, 7.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const s = e.size;
        const pts = [[0, 0], [s, 0], [s, s], [0, s]].map(([u, v]) => this.worldToCanvas(e.tx + u, e.ty + v));
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath(); ctx.stroke();
      }
    }
  }

  /**
   * Banderas de lo seleccionado: a dónde va cada unidad y dónde tiene el punto
   * de reunión un edificio. Van después de las entidades y no antes, porque son
   * un aviso para el jugador y no algo que esté plantado en el mundo: una
   * bandera detrás del centro urbano no la ve nadie.
   *
   * Cada destino lleva el color de su orden —verde ir a un sitio, ámbar un
   * recurso, rojo ir a por alguien— y se agrupan por punto: una tropa entera
   * yendo al mismo sitio planta una sola bandera, no cuarenta pegadas. Se corta
   * a las primeras: con media base seleccionada el mapa sería un banderín.
   */
  drawFlags(ctx) {
    const g = this.game;
    const sel = g.selection[0];
    if (sel && sel.kind === 'building' && sel.rally && sel.owner === g.human.id) {
      this.drawFlag(ctx, sel.rally.x, sel.rally.y, FLAG_COLORS.rally);
    }
    const seen = new Set();
    for (const e of g.selection) {
      if (e.owner !== g.human.id) continue;
      const d = g.destinationOf(e);
      if (!d) continue;
      const key = `${Math.round(d.x * 2)}:${Math.round(d.y * 2)}:${d.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.drawFlag(ctx, d.x, d.y, FLAG_COLORS[d.kind] || FLAG_COLORS.move);
      if (seen.size >= MAX_FLAGS) return;
    }
  }

  /** Bandera clavada en un punto del mundo, con su cerco en el suelo. */
  drawFlag(ctx, wx, wy, col) {
    const [mx, my] = this.worldToCanvas(wx, wy);
    ctx.strokeStyle = col.pole;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(mx, my, 7, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, my - 22); ctx.stroke();
    ctx.fillStyle = col.cloth;
    ctx.beginPath();
    ctx.moveTo(mx, my - 22); ctx.lineTo(mx + 13, my - 18); ctx.lineTo(mx, my - 13);
    ctx.closePath(); ctx.fill();
  }

  drawEntities(ctx, b) {
    const g = this.game;
    const list = [];

    // Recursos del mapa visibles.
    const m = g.map;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const n = m.nodeAtTile(x, y);
        if (!n || !n.alive) continue;
        // Los recursos fijos se recuerdan una vez explorados; los animales se
        // mueven, así que sólo se ven donde alcanza la vista (los propios siempre).
        const mine = n.owner === g.human.id;
        if (!mine && !(n.herd ? g.isVisible(x, y) : g.isExplored(x, y))) continue;
        list.push({ d: n.fx + n.fy, t: 'node', e: n });
      }
    }
    for (const bd of g.buildings) {
      if (bd.cx < b.x0 - 4 || bd.cx > b.x1 + 4 || bd.cy < b.y0 - 4 || bd.cy > b.y1 + 4) continue;
      const mine = bd.owner === g.human.id;
      if (!mine && !g.isExplored(bd.cx | 0, bd.cy | 0)) continue;
      // Las granjas son suelo pintado: van debajo de todo lo que tienen cerca,
      // porque por encima de ellas se anda y no pueden tapar a nadie.
      list.push({ d: bd.cx + bd.cy - (bd.passable ? 8 : 0), t: 'building', e: bd });
    }
    for (const u of g.units) {
      if (u.x < b.x0 - 2 || u.x > b.x1 + 2 || u.y < b.y0 - 2 || u.y > b.y1 + 2) continue;
      const mine = u.owner === g.human.id;
      if (!mine && !g.isVisible(u.x | 0, u.y | 0)) continue;
      list.push({ d: u.x + u.y, t: 'unit', e: u });
    }
    for (const p of g.projectiles) {
      if (p.px === undefined) continue;
      list.push({ d: p.px + p.py + 0.4, t: 'proj', e: p });
    }

    list.sort((a, c) => a.d - c.d);

    for (const item of list) {
      if (item.t === 'node') this.drawNode(ctx, item.e);
      else if (item.t === 'building') this.drawBuilding(ctx, item.e);
      else if (item.t === 'unit') this.drawUnit(ctx, item.e);
      else this.drawProjectile(ctx, item.e);
    }
  }

  drawNode(ctx, n) {
    const [mx, my] = this.worldToCanvas(n.fx, n.fy);
    const kind = n.kind;
    const depleted = n.amount < n.max * 0.34;
    if (this.sharp) paintResource(ctx, mx, my, kind, n.variant, depleted);
    else drawSprite(ctx, resourceSprite(kind, n.variant, depleted), mx, my);
    if (n.owner !== null && n.owner !== undefined) this.drawCollar(ctx, mx, my, n);
  }

  /**
   * Los animales domesticados llevan collar del color de su dueño, con su
   * cascabel. Va encima del sprite y a su misma escala: las medidas salen de
   * cómo está dibujada la oveja (cuerpo centrado en (0,-12) y cabeza en
   * (-11,-17) desde el centro del rombo, ver `drawResource` en sprites.js).
   */
  drawCollar(ctx, mx, my, n) {
    const s = (LOOK.node[n.kind] && LOOK.node[n.kind].scale) || 1;
    const col = PLAYER_COLORS[this.game.players[n.owner].colorIdx];
    /*
     * Punto del cuello: donde la cabeza se junta con el cuerpo, que es el borde
     * de la cabeza por el lado del lomo (la cabeza mide 5 de radio, así que su
     * canto cae a media distancia entre los dos centros), y el eje que los une.
     */
    const bx = mx, by = my - 12 * s;
    const hx = mx - 11 * s, hy = my - 17 * s;
    const ang = Math.atan2(hy - by, hx - bx);
    const nx = bx + (hx - bx) * 0.47, ny = by + (hy - by) * 0.42;
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(ang);
    // La correa: un anillo estrecho en el eje del cuello y ancho en cruz, que
    // es como se ve una banda que le da la vuelta al pescuezo.
    ctx.strokeStyle = col.main;
    ctx.lineWidth = 2.2 * s;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.6 * s, 4.4 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    // El cascabel, colgando por debajo.
    ctx.fillStyle = col.light;
    ctx.beginPath();
    ctx.arc(0, 5.1 * s, 1.7 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 0.7 * s;
    ctx.stroke();
    ctx.restore();
  }

  drawBuilding(ctx, b) {
    const g = this.game;
    const stage = b.built ? 2 : (b.progress > 0.45 ? 1 : 0);
    const colorIdx = g.players[b.owner].colorIdx;
    const [mx, my] = this.worldToCanvas(b.tx, b.ty);
    if (!b.built) ctx.globalAlpha = 0.55 + b.progress * 0.45;
    if (this.sharp) paintBuilding(ctx, mx, my, b.type, colorIdx, stage);
    else drawSprite(ctx, buildingSprite(b.type, colorIdx, stage), mx, my);
    ctx.globalAlpha = 1;

    // Humo en edificios dañados.
    if (b.built && b.hp < b.maxHp * 0.45) {
      const t = g.time * 2 + b.id;
      ctx.globalAlpha = 0.35;
      for (let i = 0; i < 3; i++) {
        const k = (t + i * 0.7) % 2;
        ctx.fillStyle = '#5a5a5a';
        ctx.beginPath();
        ctx.arc(mx + Math.sin(t + i) * 8, my - 20 - k * 26 - b.size * 8, 5 + k * 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const dmg = b.hp < b.maxHp - 0.5;
    if (!b.built || dmg || this.showHealthFor(b)) {
      const [cx, cy] = this.worldToCanvas(b.cx, b.cy);
      const topY = cy - (b.size * TILE_H) / 2 - (b.type === 'castle' ? 90 : b.type === 'tower' ? 58 : 46);
      this.healthBar(ctx, cx, topY, 26 + b.size * 8, b.hp / b.maxHp, b.owner);
      if (!b.built) {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(cx - 20, topY + 7, 40, 4);
        ctx.fillStyle = '#e6c86a';
        ctx.fillRect(cx - 20, topY + 7, 40 * b.progress, 4);
      }
    }
    // Barra de producción.
    if (b.queue.length && b.owner === g.human.id) {
      const [cx, cy] = this.worldToCanvas(b.cx, b.cy);
      const item = b.queue[0];
      const topY = cy - (b.size * TILE_H) / 2 - 34;
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(cx - 18, topY, 36, 3);
      ctx.fillStyle = item.blocked ? '#d2453c' : '#6fd06f';
      ctx.fillRect(cx - 18, topY, 36 * (item.progress / item.time), 3);
    }
  }

  showHealthFor(e) {
    return this.showHealth || e.selected || (this.hover === e);
  }

  drawUnit(ctx, u) {
    const g = this.game;
    const frame = u.attackAnim > 0
      ? (u.attackAnim > 0.25 ? 4 : 5)
      : (u.moving ? (Math.floor(u.anim) % 4) : 0);
    const colorIdx = g.players[u.owner].colorIdx;
    const [mx, my] = this.worldToCanvas(u.x, u.y);
    if (this.sharp) paintUnit(ctx, mx, my, u.type, colorIdx, u.dir, frame, u.back);
    else drawSprite(ctx, unitSprite(u.type, colorIdx, u.dir, frame, u.back), mx, my);

    if (u.carry > 0.5 && u.carryRes) {
      const col = { food: '#d24a3a', wood: '#8a6234', gold: '#e0b52c', stone: '#b6b6b0' }[u.carryRes];
      ctx.fillStyle = col;
      ctx.fillRect(mx + (u.dir > 0 ? -13 : 8), my - 34, 6, 5);
    }
    // La vida se ve siempre que la unidad esté herida, sea de quien sea: en una
    // batalla hay que poder saber a qué enemigo le queda menos.
    if (u.hp < u.maxHp - 0.5 || this.showHealthFor(u)) {
      this.healthBar(ctx, mx, my - 44, 22, u.hp / u.maxHp, u.owner);
    }
  }

  /**
   * Barra de vida. Debajo lleva una línea del color del jugador: en un combate
   * con las dos barras juntas es lo que dice de quién es cada una.
   */
  healthBar(ctx, x, y, w, frac, owner) {
    frac = clamp(frac, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 8);
    ctx.fillStyle = frac > 0.6 ? '#4fbf4f' : frac > 0.3 ? '#e0b52c' : '#d2453c';
    ctx.fillRect(x - w / 2, y, w * frac, 4);
    const p = this.game.players[owner];
    if (p) {
      ctx.fillStyle = PLAYER_COLORS[p.colorIdx].main;
      ctx.fillRect(x - w / 2, y + 4.5, w, 2);
    }
  }

  drawProjectile(ctx, p) {
    const [mx, my] = this.worldToCanvas(p.px, p.py);
    const y = my - p.pz * Z_PX;
    if (p.kindOf === 'boulder') {
      ctx.fillStyle = '#6b6259';
      ctx.beginPath(); ctx.arc(mx, y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      ctx.beginPath(); ctx.ellipse(mx, my, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
      ctx.save();
      ctx.translate(mx, y);
      ctx.rotate(ang * 0.5 - 0.4);
      ctx.strokeStyle = '#e8dfc0'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.restore();
    }
  }

  drawParticles(ctx) {
    for (const p of this.game.fx.parts) {
      const [mx, my] = this.worldToCanvas(p.x, p.y);
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + a * 0.5);
      ctx.fillRect(mx - s / 2, my - p.z * Z_PX - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  drawPlacement(ctx) {
    const g = this.game;
    const pl = g.placing;
    if (!pl || pl.tx === undefined) return;
    const B = BUILDINGS[pl.type];
    const ok = g.canPlace(pl.type, pl.tx, pl.ty, g.human) && g.human.canAfford(B.cost);
    const [mx, my] = this.worldToCanvas(pl.tx, pl.ty);
    // Huella
    for (let y = 0; y < B.size; y++) {
      for (let x = 0; x < B.size; x++) {
        const tileOk = g.map.isBuildable(pl.tx + x, pl.ty + y) && g.map.nodeIndexAt(pl.tx + x, pl.ty + y) < 0;
        const [px, py] = this.worldToCanvas(pl.tx + x, pl.ty + y);
        ctx.beginPath();
        ctx.moveTo(px, py); ctx.lineTo(px + HW, py + HH);
        ctx.lineTo(px, py + TILE_H); ctx.lineTo(px - HW, py + HH);
        ctx.closePath();
        ctx.fillStyle = tileOk ? 'rgba(110,220,120,.28)' : 'rgba(220,80,70,.35)';
        ctx.fill();
      }
    }
    ctx.globalAlpha = 0.65;
    if (this.sharp) paintBuilding(ctx, mx, my, pl.type, g.human.colorIdx, 2);
    else drawSprite(ctx, buildingSprite(pl.type, g.human.colorIdx, 2), mx, my);
    ctx.globalAlpha = 1;
    if (!ok) {
      ctx.strokeStyle = 'rgba(230,90,80,.9)'; ctx.lineWidth = 2;
      const c = this.worldToCanvas(pl.tx + B.size / 2, pl.ty + B.size / 2);
      ctx.beginPath();
      ctx.moveTo(c[0] - 12, c[1] - 12); ctx.lineTo(c[0] + 12, c[1] + 12);
      ctx.moveTo(c[0] + 12, c[1] - 12); ctx.lineTo(c[0] - 12, c[1] + 12);
      ctx.stroke();
    }
  }

  // --- Niebla ---------------------------------------------------------------

  /**
   * La niebla se dibuja a 1/5 de resolución y sólo se rehace cuando cambia la
   * cámara o la visibilidad; después se escala con suavizado bilineal.
   */
  drawFog(ctx) {
    const g = this.game;
    const key = `${Math.round(this.cam.x)}|${Math.round(this.cam.y)}|${this.cam.zoom.toFixed(3)}|${g.fogVersion}`;
    if (key !== this.fogKey) {
      this.fogKey = key;
      this.renderFogCanvas();
    }
    const S = this.fogScale, M = this.fogMargin;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.84;
    ctx.drawImage(this.fogBlur, -M * S, -M * S, this.fogBlur.width * S, this.fogBlur.height * S);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  renderFogCanvas() {
    const g = this.game;
    const fc = this.fogCtx, S = this.fogScale, M = this.fogMargin;
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.clearRect(0, 0, this.fog.width, this.fog.height);
    fc.fillStyle = '#000';
    fc.fillRect(0, 0, this.fog.width, this.fog.height);

    const b = this.visibleTileBounds(2);
    const z = this.cam.zoom;
    // Rombos "recortados" para lo que se ve o se ha explorado.
    const drawTile = (x, y, op) => {
      const [sx, sy] = this.worldToScreen(x, y);
      const px = sx / S + M, py = sy / S + M;
      const hw = (HW * z) / S + 0.9, hh = (HH * z) / S + 0.9;
      fc.globalAlpha = op;
      fc.beginPath();
      fc.moveTo(px, py - hh * 0.02);
      fc.lineTo(px + hw, py + hh);
      fc.lineTo(px, py + hh * 2);
      fc.lineTo(px - hw, py + hh);
      fc.closePath();
      fc.fill();
    };

    fc.globalCompositeOperation = 'destination-out';
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * g.map.size + x;
        if (g.fogVisible[i]) drawTile(x, y, 1);
        else if (g.fogExplored[i]) drawTile(x, y, 0.55);
      }
    }
    fc.globalCompositeOperation = 'source-over';
    fc.globalAlpha = 1;

    // Desenfoque barato: se aplica sobre el lienzo reducido, no sobre la pantalla.
    const bc = this.fogBlurCtx;
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.clearRect(0, 0, this.fogBlur.width, this.fogBlur.height);
    bc.filter = 'blur(1.4px)';
    bc.drawImage(this.fog, 0, 0);
    bc.filter = 'none';
  }

  // --- Texto flotante y HUD sobre el mundo ----------------------------------

  drawFloatingText(ctx) {
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    const colors = { food: '#ff8b76', wood: '#d3a468', gold: '#ffdc6a', stone: '#d8d8d2' };
    for (const t of this.game.fx.texts) {
      const [sx, sy] = this.worldToScreen(t.x, t.y);
      if (sx < -50 || sy < -50 || sx > this.w + 50 || sy > this.h + 50) continue;
      const k = 1 - t.life / t.max;
      ctx.globalAlpha = clamp(t.life / t.max * 1.6, 0, 1);
      ctx.fillStyle = colors[t.kind] || '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 3;
      ctx.strokeText(t.text, sx, sy - 40 - k * 26);
      ctx.fillText(t.text, sx, sy - 40 - k * 26);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawHud(ctx) {
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Rectángulo de selección.
    const s = this.dragBox;
    if (s) {
      ctx.strokeStyle = '#e8e2c8'; ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(232,226,200,.12)';
      const x = Math.min(s.x0, s.x1), y = Math.min(s.y0, s.y1);
      const w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    // Marcador de orden.
    if (this.orderMark && this.orderMark.life > 0) {
      const om = this.orderMark;
      const [sx, sy] = this.worldToScreen(om.x, om.y);
      const k = 1 - om.life / 0.5;
      ctx.strokeStyle = om.color; ctx.lineWidth = 2;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 6 + k * 16, 3 + k * 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  markOrder(x, y, color = '#8fe08f') {
    this.orderMark = { x, y, color, life: 0.5 };
  }

  tick(dt) {
    if (this.orderMark) this.orderMark.life -= dt;
  }

  // --- Selección por pantalla ----------------------------------------------

  entityAtScreen(sx, sy) {
    const g = this.game;
    const [u, v] = this.screenToWorld(sx, sy);
    let best = null, bestD = Infinity;
    for (const un of g.unitsNear(u, v, 1.2)) {
      if (un.owner !== g.human.id && !g.isVisible(un.x | 0, un.y | 0)) continue;
      // Comprobación en pantalla: el "cuerpo" está por encima del punto del suelo.
      const [mx, my] = this.worldToScreen(un.x, un.y);
      const dx = Math.abs(mx - sx), dy = my - sy;
      if (dx < 14 * this.cam.zoom && dy > -8 * this.cam.zoom && dy < 42 * this.cam.zoom) {
        const d = dx + Math.abs(dy - 18);
        if (d < bestD) { bestD = d; best = un; }
      }
    }
    if (best) return best;
    // Los animales del rebaño andan por el mapa, así que su casilla no basta:
    // se busca al más cercano al punto tocado.
    let animal = null, animalD = 0.75;
    for (const n of g.herds) {
      if (!n.alive) continue;
      if (n.owner !== g.human.id && !g.isVisible(n.x, n.y)) continue;
      const d = dist(u, v, n.fx, n.fy);
      if (d < animalD) { animalD = d; animal = n; }
    }
    if (animal) return animal;
    const tx = Math.floor(u), ty = Math.floor(v);
    const id = g.map.inBounds(tx, ty) ? g.map.occupied[g.map.idx(tx, ty)] : 0;
    if (id) {
      const b = g.byId.get(id);
      if (b && (b.owner === g.human.id || g.isExplored(tx, ty))) return b;
    }
    const node = g.map.nodeAtTile(tx, ty);
    if (node && g.isExplored(tx, ty)) return node;
    return null;
  }

  /** Animales del rebaño de un jugador dentro del rectángulo de selección. */
  animalsInBox(x0, y0, x1, y1, ownerId) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const out = [];
    for (const n of this.game.herds) {
      if (!n.alive || n.owner !== ownerId) continue;
      const [mx, my] = this.worldToScreen(n.fx, n.fy);
      const cy = my - 10 * this.cam.zoom;
      if (mx >= minX && mx <= maxX && cy >= minY && cy <= maxY) out.push(n);
    }
    return out;
  }

  unitsInBox(x0, y0, x1, y1, ownerId) {
    const g = this.game;
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const out = [];
    for (const u of g.units) {
      if (u.owner !== ownerId) continue;
      const [mx, my] = this.worldToScreen(u.x, u.y);
      const cy = my - 16 * this.cam.zoom;
      if (mx >= minX && mx <= maxX && cy >= minY && cy <= maxY) out.push(u);
    }
    return out;
  }
}
