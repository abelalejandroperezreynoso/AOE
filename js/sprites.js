// Arte procedural: todos los sprites se dibujan con la API de Canvas y se
// cachean en lienzos fuera de pantalla. No hay imágenes externas.

import { TILE_W, TILE_H, PLAYER_COLORS, UNITS, BUILDINGS } from './config.js';
import { shade, mix } from './utils.js';
import { look, ramp } from './data/appearance.js';

const HW = TILE_W / 2; // 32
const HH = TILE_H / 2; // 16

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// --- Geometría isométrica ---------------------------------------------------

function iso(x, y, u, v) { return [x + (u - v) * HW, y + (u + v) * HH]; }

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

/** Prisma isométrico: (x,y) es la esquina superior de la huella. */
function isoPrism(ctx, x, y, w, d, h, top, left, right) {
  const p00 = iso(x, y, 0, 0), p10 = iso(x, y, w, 0), p11 = iso(x, y, w, d), p01 = iso(x, y, 0, d);
  const up = (p) => [p[0], p[1] - h];
  poly(ctx, [p01, p11, up(p11), up(p01)], left);           // cara sur-oeste
  poly(ctx, [p11, p10, up(p10), up(p11)], right);          // cara sur-este
  poly(ctx, [up(p00), up(p10), up(p11), up(p01)], top);    // techo plano
  return { p00, p10, p11, p01, up };
}

/** Tejado a dos aguas con la cumbrera a lo largo del eje u. */
function isoRoof(ctx, x, y, w, d, base, rh, c1, c2, c3) {
  const P = (u, v, hh = base) => { const p = iso(x, y, u, v); return [p[0], p[1] - hh]; };
  const r0 = P(0, d / 2, base + rh), r1 = P(w, d / 2, base + rh);
  const ov = 0.12; // alero
  poly(ctx, [P(-ov, -ov), P(w + ov, -ov), r1, r0], c1);                       // faldón trasero
  poly(ctx, [P(-ov, -ov), P(-ov, d + ov), r0], c3);                            // hastial izq.
  poly(ctx, [P(w + ov, -ov), P(w + ov, d + ov), r1], c3);                      // hastial der.
  poly(ctx, [r0, r1, P(w + ov, d + ov), P(-ov, d + ov)], c2);                  // faldón delantero
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
}

function shadowEllipse(ctx, cx, cy, rx, ry, a = 0.26) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}

// --- Terreno ----------------------------------------------------------------

export const TERRAIN_COLORS = {
  grass: '#5b8b3a', grass2: '#4f7d33', grass3: '#679a42',
  dirt: '#93743f', sand: '#c2ad6b', water: '#2f5f9e', shallow: '#3f7cb8', road: '#8a7247',
};

/*
 * Familia de textura de cada terreno: la hierba se cubre de matas, lo seco de
 * guijarros y el agua de olas. Varios nombres comparten familia porque lo que
 * los distingue es el color, no el material.
 */
const TERRAIN_KIND = {
  grass: 'grass', grass2: 'grass', grass3: 'grass',
  dirt: 'dry', sand: 'dry', road: 'road', water: 'water', shallow: 'water',
};

/*
 * Tonos derivados de cada terreno. Un rombo toca media docena (mancha clara,
 * mancha oscura, brizna, guijarro...) y derivarlos cuesta más que pintarlos, así
 * que se guardan hechos. El tono de cada rombo se redondea a cinco escalones
 * para que la tabla sea pequeña: la variación sigue rompiendo el tono liso y ya
 * no hay que calcular nada por rombo.
 */
const tileCache = new Map();

function tileTones(terrain, level) {
  const key = `${terrain}|${level}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const base = shade(TERRAIN_COLORS[terrain] || TERRAIN_COLORS.grass, (level / 4 - 0.5) * 0.08);
  const t = {
    base,
    patchD: shade(base, -0.05), patchL: shade(base, 0.04),
    blade: shade(base, 0.22), bladeD: shade(base, -0.26),
    pebble: shade(base, -0.24), pebbleL: shade(base, 0.2),
    hay: shade(mix(base, '#8a9a4a', 0.5), -0.05),
    deep: shade(base, -0.06), sandy: mix(base, TERRAIN_COLORS.sand, 0.16),
    rut: shade(base, -0.14), gravel: shade(base, 0.16),
  };
  tileCache.set(key, t);
  return t;
}

/**
 * Dibuja un rombo de terreno. Son miles —el lienzo del mapa los pinta todos y
 * la cámara de cerca vuelve a pintar los que se ven— así que cada familia gasta
 * cuatro o cinco trazos contados: las manchas rompen el tono liso y el resto de
 * los detalles va agrupado en un único trazado, no uno por brizna.
 */
export function drawTerrainTile(ctx, sx, sy, terrain, rnd) {
  const kind = TERRAIN_KIND[terrain] || 'grass';
  // Cinco escalones de tono: menos variación que antes (era el doble), porque
  // con textura encima ya no hace falta para que el suelo no parezca liso.
  const T = tileTones(terrain, Math.round(rnd * 4));
  const base = T.base;
  const cx = sx, cy = sy + HH;
  /*
   * El rombo se pinta medio píxel más grande de lo que mide para que solape con
   * sus vecinos: si se pinta justo, el suavizado de los cuatro bordes deja
   * pasar el fondo y el suelo se lee como una rejilla de líneas oscuras.
   */
  const e = 0.6;
  ctx.beginPath();
  ctx.moveTo(sx, sy - e);
  ctx.lineTo(sx + HW + e, sy + HH);
  ctx.lineTo(sx, sy + TILE_H + e);
  ctx.lineTo(sx - HW - e, sy + HH);
  ctx.closePath();
  ctx.fillStyle = base;
  ctx.fill();

  // Azar repetible: el mismo rombo saca siempre los mismos números, que es lo
  // que permite volver a dibujarlo idéntico al acercar la cámara.
  const h = (n) => {
    const v = Math.sin(rnd * 127.1 + n * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  // Un punto dentro del rombo, con margen para que nada se salga del borde.
  const spot = (n) => {
    const u = 0.16 + h(n) * 0.68, v = 0.16 + h(n + 0.37) * 0.68;
    return [cx + (u - v) * HW * 0.92, cy + (u + v - 1) * HH * 0.92];
  };
  ctx.lineCap = 'butt';

  if (kind === 'grass') {
    // Claro o calva: una mancha ancha que rompe el tono liso.
    const [mx, my] = spot(1);
    ctx.beginPath();
    ctx.ellipse(mx, my, 12 + h(0) * 9, 5 + h(9) * 3.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = rnd > 0.5 ? T.patchL : T.patchD;
    ctx.fill();
    // Matas: todas las briznas del rombo en un solo trazado.
    ctx.lineWidth = 1;
    ctx.strokeStyle = T.blade;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const [px, py] = spot(i * 7 + 2);
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(px + k * 1.7, py);
        ctx.lineTo(px + k * 2.4, py - 2.2 - h(i + k * 0.3) * 1.6);
      }
    }
    ctx.stroke();
    ctx.strokeStyle = T.bladeD;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const [px, py] = spot(i * 11 + 5);
      ctx.moveTo(px, py); ctx.lineTo(px + 1.4, py - 2.6);
      ctx.moveTo(px + 2.2, py); ctx.lineTo(px + 1.8, py - 2);
    }
    ctx.stroke();
    if (rnd > 0.9) {
      // Flores: van a puñados y sólo en algún rombo, para que se noten.
      const [px, py] = spot(21);
      ctx.fillStyle = h(3) > 0.5 ? '#e8e2b0' : '#d8cfe4';
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const fx = px + (h(i * 5) - 0.5) * 9, fy = py + (h(i * 5 + 2) - 0.5) * 5;
        ctx.moveTo(fx + 1, fy); ctx.arc(fx, fy, 1, 0, Math.PI * 2);
      }
      ctx.fill();
    } else if (rnd < 0.06) {
      // Canto rodado suelto.
      const [px, py] = spot(31);
      ctx.fillStyle = '#8a877e';
      ctx.beginPath(); ctx.ellipse(px, py, 3.2, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a8a49a';
      ctx.beginPath(); ctx.ellipse(px - 0.8, py - 0.8, 1.6, 1, 0, 0, Math.PI * 2); ctx.fill();
    }
  } else if (kind === 'dry') {
    // Mancha de polvo o de tierra apretada.
    const [mx, my] = spot(3);
    ctx.beginPath();
    ctx.ellipse(mx, my, 12 + h(0) * 8, 5.4 + h(4) * 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = rnd > 0.5 ? T.patchL : T.patchD;
    ctx.fill();
    // Guijarros: la sombra de todos en un trazado y el brillo en otro.
    ctx.fillStyle = T.pebble;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const [px, py] = spot(i * 9 + 4);
      const r = 0.8 + h(i) * 0.8;
      ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = T.pebbleL;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const [px, py] = spot(i * 9 + 4);
      ctx.moveTo(px + 0.6, py - 0.7); ctx.arc(px - 0.4, py - 0.7, 0.6, 0, Math.PI * 2);
    }
    ctx.fill();
    if (rnd > 0.76) {
      // Hierba seca agarrada a la tierra.
      ctx.strokeStyle = T.hay;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const [px, py] = spot(17);
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(px + k * 1.8, py);
        ctx.lineTo(px + k * 2.6, py - 3 - h(k + 2) * 1.6);
      }
      ctx.stroke();
    }
  } else if (kind === 'water') {
    const shallowW = terrain === 'shallow';
    // Fondo: en la orilla se transparenta la arena; en lo hondo, la sombra.
    const [px, py] = spot(2);
    ctx.beginPath();
    ctx.ellipse(px, py, 13 + h(1) * 6, 5.5 + h(2) * 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = shallowW ? T.sandy : T.deep;
    ctx.fill();
    // Dos crestas de ola, con su sombra debajo para que tengan grueso.
    const wave = (dy) => {
      ctx.beginPath();
      for (let i = 0; i < 2; i++) {
        const yy = cy + (i - 0.5) * 7 + (h(i * 3) - 0.5) * 5 + dy;
        ctx.moveTo(cx - 15, yy);
        ctx.quadraticCurveTo(cx - 6, yy + 2.2, cx + 2, yy - 0.6);
        ctx.quadraticCurveTo(cx + 9, yy - 2.6, cx + 16, yy - 0.4);
      }
      ctx.stroke();
    };
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(12,34,64,.12)';
    wave(1.3);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255,255,255,${shallowW ? 0.14 : 0.07 + h(4) * 0.05})`;
    wave(0);
    // Chispas de sol sobre el agua.
    ctx.fillStyle = `rgba(255,255,255,${shallowW ? 0.22 : 0.16})`;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const [gx, gy] = spot(i * 13 + 6);
      ctx.moveTo(gx - 2, gy); ctx.lineTo(gx + 2, gy - 0.6); ctx.lineTo(gx + 2, gy + 0.4);
    }
    ctx.fill();
  } else {
    // Camino: dos rodadas y la grava del firme.
    ctx.strokeStyle = T.rut; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 2; i++) {
      const off = (i - 0.5) * 7;
      ctx.moveTo(cx - HW * 0.8, cy + off + HH * 0.4);
      ctx.lineTo(cx + HW * 0.8, cy + off - HH * 0.4);
    }
    ctx.stroke();
    ctx.fillStyle = T.gravel;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const [px, py] = spot(i * 9 + 8);
      ctx.moveTo(px + 0.8, py); ctx.arc(px, py, 0.8, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

/*
 * Rombos horneados. El terreno se repite —ocho tipos y ocho variantes de azar
 * cada uno— así que en vez de volver a pintar las matas de hierba de cada rombo
 * se hornea uno por variante y se copia. Copiar un mapa de bits cuesta una
 * fracción de lo que cuesta dibujarlo, y de cerca sale nítido porque el horneado
 * va a la resolución que pida la cámara.
 *
 * Las ocho variantes de un terreno van en una sola tira, no en ocho lienzos: un
 * lienzo suelto por variante son cientos de objetos que el navegador tiene que
 * mantener y subir a la tarjeta, y de la tira se copia igual de bien dando el
 * recorte.
 */
const tileSheets = new Map();
const TILE_PAD = 1;      // solape para que no se vea la junta entre rombos
const TILE_VARIANTS = 8;
const TW = TILE_W + TILE_PAD * 2, TH = TILE_H + TILE_PAD * 2;

function terrainSheet(terrain) {
  const hit = tileSheets.get(terrain);
  if (hit) return hit;
  const c = makeCanvas(TW * TILE_VARIANTS * quality, TH * quality);
  const ctx = c.getContext('2d');
  ctx.scale(quality, quality);
  for (let i = 0; i < TILE_VARIANTS; i++) {
    drawTerrainTile(ctx, i * TW + HW + TILE_PAD, TILE_PAD, terrain, (i + 0.5) / TILE_VARIANTS);
  }
  tileSheets.set(terrain, c);
  return c;
}

/** Copia un rombo horneado. (sx, sy) es su esquina superior, como al dibujarlo. */
export function drawTerrainSprite(ctx, sx, sy, terrain, rnd) {
  const i = Math.min(TILE_VARIANTS - 1, Math.floor(rnd * TILE_VARIANTS));
  ctx.drawImage(terrainSheet(terrain),
    i * TW * quality, 0, TW * quality, TH * quality,
    sx - HW - TILE_PAD, sy - TILE_PAD, TW, TH);
}

// --- Resolución de los sprites ----------------------------------------------

/*
 * Los sprites se cachean en mapas de bits y el mundo se dibuja con la cámara
 * escalada, así que un sprite rasterizado a 1× se ve borroso en cuanto se
 * amplía. `quality` es cuántos píxeles de sprite se guardan por cada píxel de
 * mundo: se ajusta a la densidad de la pantalla para que a zoom 1 la copia sea
 * exacta. Por encima de ese zoom el renderizador no usa la caché, dibuja los
 * sprites directamente sobre el lienzo (ver las funciones `paint*`), que a
 * cualquier ampliación salen nítidos y no gastan memoria.
 */
let quality = 1;

export function spriteQuality() { return quality; }

/** Cambiarla invalida los sprites del mundo; los iconos ya rasterizados valen. */
export function setSpriteQuality(q) {
  q = Math.max(1, Math.min(3, Math.round(q * 2) / 2));
  if (q === quality) return;
  quality = q;
  tileSheets.clear();
  resCache.clear();
  unitCache.clear();
  buildCache.clear();
  boundsCache.clear(); // las cajas de los iconos van en píxeles del lienzo
}

/**
 * Dibuja un sprite de la caché. Su lienzo está a `quality`× y sus medidas y
 * anclaje vienen en píxeles de mundo, así que hay que darle a `drawImage` el
 * tamaño de destino: sin él saldría `quality` veces más grande.
 */
export function drawSprite(ctx, s, x, y, scale = 1) {
  ctx.drawImage(s.canvas, x - s.ox * scale, y - s.oy * scale, s.w * scale, s.h * scale);
}

// --- Sprites de recursos ----------------------------------------------------

const resCache = new Map();
const RW = 80, RH = 96, ROX = 40, ROY = 74; // lienzo y anclaje (centro del rombo)

export function resourceSprite(kind, variant = 0, depleted = false) {
  const key = `${kind}|${variant}|${depleted ? 1 : 0}`;
  let s = resCache.get(key);
  if (s) return s;
  const sc = look('node', kind === 'stump' ? 'tree' : kind).scale || 1;
  const c = makeCanvas(RW * sc * quality, RH * sc * quality);
  const ctx = c.getContext('2d');
  ctx.scale(sc * quality, sc * quality);
  drawResource(ctx, kind, variant, depleted, ROX, ROY);
  s = { canvas: c, ox: ROX * sc, oy: ROY * sc, w: RW * sc, h: RH * sc };
  resCache.set(key, s);
  return s;
}

/** Pinta un recurso directamente, con (x, y) ya en el sitio donde va. */
export function paintResource(ctx, x, y, kind, variant = 0, depleted = false) {
  const sc = look('node', kind === 'stump' ? 'tree' : kind).scale || 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  drawResource(ctx, kind, variant, depleted, 0, 0);
  ctx.restore();
}

function drawResource(ctx, kind, variant, depleted, ox, oy) {
  // El aspecto del tocón es el del árbol del que salió.
  const L = look('node', kind === 'stump' ? 'tree' : kind);
  const r = (n) => ((Math.sin(variant * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;

  switch (kind) {
    case 'tree': {
      const [barkL, bark, barkD] = ramp(L.trunk);
      const [foliL, foli, foliD] = ramp(L.foliage);
      shadowEllipse(ctx, ox + 3, oy + 3, 15, 7);
      const th = 17 + r(1) * 7;          // altura del tronco
      const lean = (r(2) - 0.5) * 3;     // ningún árbol crece recto del todo
      // Tronco: patas de raíz abajo, más fino arriba, y la cara en sombra.
      poly(ctx, [
        [ox - 4.4, oy + 1], [ox - 2.4, oy - th * 0.42], [ox - 2 + lean, oy - th],
        [ox + 2 + lean, oy - th], [ox + 2.6, oy - th * 0.42], [ox + 4.4, oy + 1],
      ], bark);
      poly(ctx, [
        [ox + 0.8, oy + 1], [ox + 0.9, oy - th * 0.42],
        [ox + 2 + lean, oy - th], [ox + 4.4, oy + 1],
      ], barkD);
      poly(ctx, [
        [ox - 4.4, oy + 1], [ox - 2.4, oy - th * 0.42], [ox - 1.5, oy - th * 0.42], [ox - 2.8, oy + 1],
      ], barkL);
      ctx.strokeStyle = barkD; ctx.lineWidth = 0.8; ctx.lineCap = 'butt';
      for (let i = 0; i < 3; i++) {
        const k = 0.24 + i * 0.22;
        ctx.beginPath();
        ctx.moveTo(ox - 2 + i * 1.7, oy - th * k);
        ctx.lineTo(ox - 1.5 + i * 1.7, oy - th * (k + 0.16));
        ctx.stroke();
      }
      // Dos ramas que salen del tronco y se meten en la copa.
      ctx.strokeStyle = bark; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox + lean * 0.4, oy - th * 0.84); ctx.lineTo(ox - 7 + lean, oy - th - 5);
      ctx.moveTo(ox + lean * 0.4, oy - th * 0.92); ctx.lineTo(ox + 7 + lean, oy - th - 4);
      ctx.stroke();
      /*
       * Copa por capas: primero la masa en sombra, encima el cuerpo y al final
       * los remates que da la luz. Es lo que separa una copa de un borrón: el
       * volumen sale de las tres capas, no del contorno.
       */
      const cx = ox + lean, cy = oy - th - 9;
      const tint = (variant % 3 - 1) * 0.045;
      const crown = [
        [0, 3, 15.5, foliD], [-11, 6, 11, foliD], [11, 5, 10.5, foliD], [2, -9, 12.5, foliD],
        [-6, -1, 12, foli], [8, 0, 11, foli], [-1, -10, 11, foli], [-12, 1, 8, foli],
        [-7, -7, 8.5, foliL], [4, -14, 8, foliL], [-1, -3, 7, foliL],
      ];
      for (const [bx, by, br, tone] of crown) {
        const k = 0.88 + r(bx + by) * 0.24;
        ctx.beginPath();
        ctx.ellipse(cx + bx, cy + by, br * k, br * k * 0.86, 0, 0, Math.PI * 2);
        ctx.fillStyle = shade(tone, tint + (r(bx + 2) - 0.5) * 0.1);
        ctx.fill();
      }
      // Bocados de hoja en el borde, para que la silueta no salga redonda.
      for (let i = 0; i < 7; i++) {
        const a = r(i * 3) * Math.PI * 2, rr = 13 + r(i * 5) * 4;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8, 3.4, 2.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = shade(Math.sin(a) < -0.1 ? foliL : foliD, tint);
        ctx.fill();
      }
      break;
    }
    case 'stump': {
      const [barkL, bark, barkD] = ramp(L.trunk);
      shadowEllipse(ctx, ox + 2, oy + 2, 9, 4);
      poly(ctx, [[ox - 4.6, oy], [ox - 3.6, oy - 7], [ox + 3.6, oy - 7], [ox + 4.6, oy]], bark);
      poly(ctx, [[ox + 1.4, oy], [ox + 1.6, oy - 7], [ox + 3.6, oy - 7], [ox + 4.6, oy]], barkD);
      // Testa cortada, con sus anillos.
      ctx.beginPath(); ctx.ellipse(ox, oy - 7, 3.8, 1.9, 0, 0, Math.PI * 2);
      ctx.fillStyle = barkL; ctx.fill();
      ctx.strokeStyle = shade(barkL, -0.24); ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.ellipse(ox, oy - 7, 2, 1, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'gold': case 'stone': {
      const isGold = kind === 'gold';
      const [rockL, rock, rockD] = ramp(L.rock);
      shadowEllipse(ctx, ox + 2, oy + 3, 17, 8);
      /*
       * Cada roca es un bloque facetado: cara de arriba a la luz, cara
       * izquierda de medio tono y cara derecha en sombra. Tres caras planas
       * dan más piedra que cualquier degradado, y el filo entre ellas es lo
       * que se lee de lejos.
       */
      const parts = depleted
        ? [[1, 0, 9, 7]]
        : [[-9, 1, 11, 9], [9, -1, 10, 8], [0, -7, 12, 11]];
      for (const [px, py, pw, ph] of parts) {
        const bx = ox + px, by = oy + py, t = shade(rock, (r(px) - 0.5) * 0.14);
        const top = ph * 0.42;
        // Falda de la roca.
        poly(ctx, [
          [bx - pw, by - top], [bx - pw * 0.55, by + 2.4],
          [bx + pw * 0.5, by + 3], [bx + pw, by - top * 0.8],
        ], shade(t, -0.12));
        poly(ctx, [
          [bx + pw * 0.1, by - top - 0.4], [bx + pw, by - top * 0.8],
          [bx + pw * 0.5, by + 3], [bx + pw * 0.05, by + 2.8],
        ], shade(t, -0.3));
        // Cara superior, la que mira al sol.
        poly(ctx, [
          [bx - pw, by - top], [bx - pw * 0.35, by - ph],
          [bx + pw * 0.45, by - ph * 0.92], [bx + pw, by - top * 0.8],
          [bx + pw * 0.1, by - top - 0.4],
        ], shade(t, 0.12));
        // Aristas: una clara arriba y otra oscura donde rompe la cara.
        ctx.strokeStyle = shade(t, 0.3); ctx.lineWidth = 0.9; ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(bx - pw + 0.6, by - top - 0.4);
        ctx.lineTo(bx - pw * 0.35, by - ph + 0.6);
        ctx.lineTo(bx + pw * 0.45, by - ph * 0.92 + 0.6);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.22)';
        ctx.beginPath();
        ctx.moveTo(bx + pw * 0.1, by - top - 0.4);
        ctx.lineTo(bx + pw * 0.1, by + 2.8);
        ctx.stroke();
        /*
         * La veta: el oro va en pepitas redondas y brillantes, muy visibles;
         * la piedra, en facetas angulosas del mismo gris pero más claro. Así
         * se distinguen de un vistazo dos montones de la misma forma.
         */
        if (isGold) {
          ctx.fillStyle = L.accent;
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const a = r(px + i * 3), b = r(px + i * 7);
            const gx = bx + (a - 0.6) * pw * 0.9, gy = by - top - 1 - b * (ph - top) * 0.7;
            ctx.moveTo(gx + 1.7, gy); ctx.arc(gx, gy, 1.5 + a * 0.6, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.fillStyle = shade(L.accent, 0.35);
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const a = r(px + i * 3), b = r(px + i * 7);
            const gx = bx + (a - 0.6) * pw * 0.9, gy = by - top - 1 - b * (ph - top) * 0.7;
            ctx.moveTo(gx + 0.4, gy - 0.5); ctx.arc(gx - 0.5, gy - 0.6, 0.7, 0, Math.PI * 2);
          }
          ctx.fill();
        } else {
          ctx.fillStyle = L.accent;
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const a = r(px + i * 5), b = r(px + i * 11);
            const gx = bx + (a - 0.6) * pw * 0.8, gy = by - top - 1 - b * (ph - top) * 0.6;
            ctx.moveTo(gx - 1.6, gy + 1); ctx.lineTo(gx, gy - 1.3); ctx.lineTo(gx + 1.7, gy + 0.4);
          }
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      // Cascajo al pie del montón.
      ctx.fillStyle = shade(rockD, -0.06);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = r(i * 13), b = r(i * 17);
        const gx = ox + (a - 0.5) * 30, gy = oy + 1 + (b - 0.5) * 5;
        ctx.moveTo(gx + 1.6, gy); ctx.ellipse(gx, gy, 1.6 + a, 1 + a * 0.5, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      void rockL;
      break;
    }
    case 'berries': {
      const [bushL, bush, bushD] = ramp(L.bush);
      shadowEllipse(ctx, ox + 2, oy + 2, 14, 6);
      // Cepa: tres varas que salen del suelo y sostienen la mata.
      ctx.strokeStyle = '#6b5233'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(ox + i * 2.4, oy);
        ctx.lineTo(ox + i * 5.5, oy - 7 - r(i + 2) * 3);
      }
      ctx.stroke();
      /*
       * Mata por capas, como la copa de un árbol pero a ras de suelo: masa en
       * sombra abajo, cuerpo en medio y remates a la luz arriba.
       */
      const clumps = [
        [-9, -4, 6.5, bushD], [9, -4, 6, bushD], [0, -3, 7.5, bushD],
        [-5, -8, 6.5, bush], [5, -8, 6, bush], [0, -10, 6.5, bush],
        [-4, -12, 4.6, bushL], [4, -11, 4.2, bushL],
      ];
      for (const [bx, by, br, tone] of clumps) {
        const k = 0.9 + r(bx + by) * 0.2;
        ctx.beginPath();
        ctx.ellipse(ox + bx, oy + by, br * k, br * k * 0.82, 0, 0, Math.PI * 2);
        ctx.fillStyle = depleted ? shade(tone, -0.12) : shade(tone, (r(bx) - 0.5) * 0.1);
        ctx.fill();
      }
      if (depleted) {
        // Sin fruto: quedan los rabillos pelados.
        ctx.strokeStyle = shade(bushD, -0.2); ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = r(i * 7) * Math.PI * 2;
          ctx.moveTo(ox + Math.cos(a) * 7, oy - 8 + Math.sin(a) * 4);
          ctx.lineTo(ox + Math.cos(a) * 9, oy - 9 + Math.sin(a) * 5);
        }
        ctx.stroke();
        break;
      }
      // Bayas: van en racimos, no sueltas, y cada una con su reflejo.
      const berryD = shade(L.berry, -0.3), berryL = shade(L.berry, 0.4);
      for (let c = 0; c < 4; c++) {
        const cxb = ox + (r(c * 3) - 0.5) * 20, cyb = oy - 5 - r(c * 5) * 8;
        ctx.fillStyle = berryD;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const bx = cxb + (r(c * 7 + i) - 0.5) * 5, by = cyb + (r(c * 11 + i) - 0.5) * 4;
          ctx.moveTo(bx + 2.1, by + 0.4); ctx.arc(bx, by + 0.4, 2.1, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.fillStyle = L.berry;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const bx = cxb + (r(c * 7 + i) - 0.5) * 5, by = cyb + (r(c * 11 + i) - 0.5) * 4;
          ctx.moveTo(bx + 1.9, by); ctx.arc(bx, by, 1.9, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.fillStyle = berryL;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const bx = cxb + (r(c * 7 + i) - 0.5) * 5, by = cyb + (r(c * 11 + i) - 0.5) * 4;
          ctx.moveTo(bx - 0.1, by - 0.7); ctx.arc(bx - 0.6, by - 0.7, 0.7, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      break;
    }
    case 'sheep': case 'deer': {
      const deer = kind === 'deer';
      shadowEllipse(ctx, ox + 2, oy + 2, 12, 5);
      ctx.fillStyle = L.legs;
      ctx.fillRect(ox - 7, oy - 8, 2.5, 8); ctx.fillRect(ox + 5, oy - 8, 2.5, 8);
      ctx.beginPath(); ctx.ellipse(ox, oy - 12, 11, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = L.body; ctx.fill();
      ctx.beginPath(); ctx.ellipse(ox - 11, oy - 17, 5, 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = L.head; ctx.fill();
      if (deer) {
        ctx.strokeStyle = L.antlers; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(ox - 12, oy - 21); ctx.lineTo(ox - 15, oy - 27); ctx.moveTo(ox - 13, oy - 24); ctx.lineTo(ox - 17, oy - 24);
        ctx.moveTo(ox - 9, oy - 21); ctx.lineTo(ox - 7, oy - 27); ctx.moveTo(ox - 8, oy - 24); ctx.lineTo(ox - 4, oy - 25);
        ctx.stroke();
      }
      break;
    }
  }
}

// --- Sprites de unidades ----------------------------------------------------

const unitCache = new Map();
const UW = 48, UH = 60, UOX = 24, UOY = 48;
const BOWSTRING = '#e8e4d8';
// Hueco extra por encima del ancla: al jinete se le salía la cabeza del lienzo
// y al trabuquete el brazo al lanzar.
const HEADROOM = { cavalry: 14, siege: 8, infantry: 6 };

/*
 * Anatomía del muñeco, en píxeles desde sus pies (hacia arriba es negativo).
 * Todas las unidades a pie salen de este mismo esqueleto —mismas caderas,
 * mismos hombros, misma cabeza— y lo que las distingue es el equipo que se les
 * cuelga encima, no el cuerpo.
 */
const BODY = {
  sole: 0, ankle: -3.2, knee: -8.8, hip: -14, waist: -17.6,
  chest: -21.6, shoulder: -25.4, neck: -27.4, head: -32.4, headR: 4.5,
};

/*
 * El equipo de cada tipo:
 *   armor   0 ropa, 1 cuero, 2 cota de malla, 3 coraza, 4 coraza y hombreras
 *   helm    'cap' capacete, 'nasal' con nasal y cofia, 'great' yelmo cerrado,
 *           'crest' yelmo cerrado con penacho, 'hood' capucha de tela
 *   shield  'round' redondo, 'heater' de cometa, 'buckler' rodela
 *   cape    largo de la capa, en fracción del cuerpo (0 = sin capa)
 *
 * Las mejoras de una misma línea suben de escalón, así que un campeón y una
 * milicia se distinguen de un vistazo aunque salgan del mismo dibujo.
 */
const GEAR = {
  villager: { armor: 0, helm: null, cape: 0 },
  militia: { armor: 1, helm: 'cap', shield: 'round', cape: 0.5 },
  manatarms: { armor: 2, helm: 'nasal', shield: 'round', cape: 0.75 },
  longswordsman: { armor: 3, helm: 'great', shield: 'heater', cape: 0.95 },
  champion: { armor: 4, helm: 'crest', shield: 'heater', cape: 1.1 },
  spearman: { armor: 1, helm: 'cap', shield: 'buckler', cape: 0.45 },
  pikeman: { armor: 2, helm: 'nasal', shield: 'buckler', cape: 0.7 },
  archer: { armor: 0, helm: 'hood', cape: 0 },
  crossbowman: { armor: 1, helm: 'cap', cape: 0 },
  arbalester: { armor: 2, helm: 'nasal', cape: 0 },
  skirmisher: { armor: 1, helm: 'hood', cape: 0 },
  scout: { armor: 1, helm: 'cap', cape: 0.55 },
  knight: { armor: 3, helm: 'great', shield: 'heater', cape: 1 },
  cavalier: { armor: 4, helm: 'crest', shield: 'heater', cape: 1.1 },
};
const NO_GEAR = { armor: 0, helm: null, cape: 0 };

/*
 * Colores ya resueltos de una unidad. El soldado toca dos docenas de tonos
 * (cara al sol, cara en sombra, filo, brillo del yelmo...) y derivarlos cuesta
 * más que pintarlos, así que se hace una vez por tipo y color de jugador. Como
 * salen de `look`, que el catálogo puede cambiar, el caché se vacía con los
 * demás.
 */
const palCache = new Map();

function palette(type, colorIdx) {
  const key = `${type}|${colorIdx}`;
  const hit = palCache.get(key);
  if (hit) return hit;
  const col = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
  const L = look('unit', type);
  const [metalL, metal, metalD] = ramp(L.metal || '#b9bcc4');
  const [helmL, helm, helmD] = ramp(L.helmet || L.metal || '#a7a9b0');
  const [woodL, wood, woodD] = ramp(L.wood || '#7a5c33');
  const [legsL, legs] = ramp(L.legs || '#3e3a33');
  const [leatherL, leather, leatherD] = ramp(L.leather || '#7a5432');
  const skin = L.skin || '#d9a878';
  const cloth = L.cloth || '#b9a279';
  const p = {
    col,
    tunic: col.main, tunicL: shade(col.main, 0.2), tunicD: col.dark,
    cape: shade(col.main, -0.06), capeL: mix(col.main, col.light, 0.5),
    capeD: shade(col.dark, -0.22),
    skin, skinL: shade(skin, 0.13), skinD: shade(skin, -0.26),
    metal, metalL, metalD, gleam: shade(metalL, 0.32),
    helm, helmL, helmD,
    wood, woodL, woodD,
    legs, legsL,
    leather, leatherL, leatherD,
    cloth, clothD: shade(cloth, -0.2),
    hair: L.hair || '#6b4a2c',
    plume: L.plume || '#e0dcd2',
    mail: mix(metalD, '#3c3f46', 0.5), mailL: mix(metal, '#5a5e66', 0.4),
  };
  palCache.set(key, p);
  return p;
}

function limb(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

// --- Piezas del soldado -----------------------------------------------------
//
// La luz entra por arriba y por la izquierda: lo que mira a ese lado va con el
// tono claro de su material y lo que le da la espalda con el oscuro. Todas las
// piezas siguen ese acuerdo, que es lo que hace que el muñeco parezca de bulto
// y no una pegatina.

/** Pierna: muslo, pantorrilla, bota y, si va acorazado, greba y rodillera. */
function leg(ctx, P, G, phase, front, bob) {
  const hipX = front ? 1.4 : -1.4;
  const kneeX = hipX + phase * 2.4;
  const footX = hipX + phase * 4.6;
  const lift = Math.max(0, phase) * 1.5; // el pie que adelanta se despega
  const hipY = BODY.hip + bob;
  const kneeY = BODY.knee + bob * 0.4 - lift * 0.5;
  const ankY = BODY.ankle - lift;
  const hose = front ? P.legsL : P.legs;
  limb(ctx, hipX, hipY, kneeX, kneeY, 4.6, hose);
  limb(ctx, kneeX, kneeY, footX, ankY, 3.8, hose);
  if (G.armor >= 3) {
    // Greba y rodillera: una tira de hierro sobre la espinilla, no toda la pierna.
    limb(ctx, (kneeX + footX) / 2 + 0.4, (kneeY + ankY) / 2, footX + 0.6, ankY, 2.2,
      front ? P.metal : P.metalD);
    dot(ctx, kneeX + 0.2, kneeY + 0.4, 1.5, front ? P.metal : P.metalD);
  }
  // Bota: caña, empeine y suela.
  const sole = BODY.sole - lift;
  const lea = front ? P.leather : P.leatherD;
  poly(ctx, [
    [footX - 2.6, ankY - 1.2], [footX + 2.4, ankY - 1.2],
    [footX + 4.8, sole - 1.6], [footX + 4.8, sole - 0.9], [footX - 2.8, sole - 0.9],
  ], lea);
  poly(ctx, [
    [footX - 2.9, sole - 1.1], [footX + 4.9, sole - 1.1],
    [footX + 4.9, sole], [footX - 2.9, sole],
  ], P.leatherD);
}

/** Piernas del jinete: rodilla doblada sobre la silla y pie en el estribo. */
function ridingLegs(ctx, P, G) {
  const hipY = BODY.hip, kneeY = hipY + 1.5, footY = hipY + 9;
  for (const [side, tone] of [[-1, P.legs], [1, P.legsL]]) {
    const kx = 4.2 + side * 0.8, fx = 1.8 + side * 0.8;
    limb(ctx, side * 1.2, hipY, kx, kneeY, 4.6, tone);
    limb(ctx, kx, kneeY, fx, footY, 3.8, tone);
    if (G.armor >= 3) limb(ctx, kx, kneeY + 0.5, fx, footY, 3, side < 0 ? P.metalD : P.metal);
    poly(ctx, [
      [fx - 2.4, footY - 1.4], [fx + 1.6, footY - 1.4],
      [fx + 4, footY + 0.4], [fx - 2.6, footY + 0.4],
    ], side < 0 ? P.leatherD : P.leather);
    // Estribo.
    ctx.strokeStyle = P.metalD; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(fx + 0.4, footY + 0.6, 2.2, 0, Math.PI); ctx.stroke();
  }
}

/** Faldón de la túnica, con ribete y las escarcelas de hierro por encima. */
function skirt(ctx, P, G, walk) {
  const y0 = BODY.waist, y1 = BODY.hip + 3.6;
  const sway = walk * 0.9;
  poly(ctx, [[-4.8, y0], [4.8, y0], [5.8 + sway, y1], [-5.8 + sway, y1]], P.tunic);
  // Mitad en sombra y ribete del bajo.
  poly(ctx, [[0.8, y0], [4.8, y0], [5.8 + sway, y1], [1.4 + sway, y1]], P.tunicD);
  poly(ctx, [
    [-5.8 + sway, y1 - 1.3], [5.8 + sway, y1 - 1.3],
    [5.8 + sway, y1], [-5.8 + sway, y1],
  ], P.tunicD);
  if (G.armor >= 2) {
    // Tiras de cuero bajo el faldón.
    ctx.fillStyle = P.leatherD;
    for (let i = -2; i <= 2; i++) ctx.fillRect(i * 2.2 + sway - 0.7, y1 - 0.4, 1.6, 2.4);
  }
  if (G.armor >= 3) {
    // Escarcelas: dos lamas de hierro sobre la cadera.
    poly(ctx, [[-5.2, y0 + 0.6], [5.2, y0 + 0.6], [5.6, y0 + 2.4], [-5.6, y0 + 2.4]], P.metal);
    poly(ctx, [[-5.6, y0 + 2.4], [5.6, y0 + 2.4], [6, y0 + 4.2], [-6, y0 + 4.2]], P.metalD);
    ctx.fillStyle = P.metalL;
    ctx.fillRect(-5, y0 + 0.8, 3.4, 0.8);
  }
}

/** Torso: túnica, protección según el escalón, cinturón y hombreras. */
function torso(ctx, P, G) {
  const sh = BODY.shoulder, ch = BODY.chest, wa = BODY.waist + 0.6, R = 6.3;
  // Silueta: hombros anchos que se estrechan en la cintura.
  poly(ctx, [
    [-R + 0.6, sh + 0.6], [R - 0.2, sh + 0.6], [R - 0.5, ch],
    [4.6, wa], [-4.6, wa], [-R + 0.9, ch],
  ], P.tunic);
  // Costado en sombra y luz de canto en el hombro izquierdo.
  poly(ctx, [[1.2, sh + 0.8], [R - 0.2, sh + 0.6], [R - 0.5, ch], [4.6, wa], [1.6, wa]], P.tunicD);
  poly(ctx, [[-R + 0.6, sh + 0.8], [-R + 2.4, sh + 0.8], [-R + 2.6, ch], [-R + 0.9, ch]], P.tunicL);
  // Escote: asoma la camisa de lino de debajo.
  poly(ctx, [[-2.6, sh + 0.2], [2.6, sh + 0.2], [2.2, sh + 2.2], [-2.2, sh + 2.2]], P.cloth);
  poly(ctx, [[0.4, sh + 0.4], [2.6, sh + 0.2], [2.2, sh + 2.2], [0.4, sh + 2.2]], P.clothD);

  if (G.armor === 1) {
    // Coleto de cuero con sus costuras.
    poly(ctx, [[-4.4, sh + 1.6], [4.4, sh + 1.6], [4, wa - 0.4], [-4, wa - 0.4]], P.leather);
    poly(ctx, [[1, sh + 1.6], [4.4, sh + 1.6], [4, wa - 0.4], [1, wa - 0.4]], P.leatherD);
    ctx.strokeStyle = P.leatherL; ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-0.2, sh + 2); ctx.lineTo(-0.2, wa - 0.8); ctx.stroke();
  } else if (G.armor === 2) {
    // Cota de malla, y encima la sobreveste del color del jugador.
    poly(ctx, [[-5.4, sh + 1], [5.2, sh + 1], [4.6, wa], [-4.6, wa]], P.mail);
    ctx.fillStyle = P.mailL;
    for (let y = sh + 2.4; y < wa - 0.6; y += 1.6) {
      for (let x = -4.4; x < 4.4; x += 1.8) ctx.fillRect(x + (y % 3.2 < 1.6 ? 0 : 0.9), y, 0.9, 0.7);
    }
    poly(ctx, [[-2.6, sh + 1.4], [2.6, sh + 1.4], [2.4, wa], [-2.4, wa]], P.tunic);
    poly(ctx, [[0.4, sh + 1.4], [2.6, sh + 1.4], [2.4, wa], [0.4, wa]], P.tunicD);
  } else if (G.armor >= 3) {
    // Coraza: peto abombado, con el brillo por el lado de la luz.
    ctx.fillStyle = P.metal;
    ctx.beginPath();
    ctx.moveTo(-5, sh + 1.4);
    ctx.lineTo(5, sh + 1.4);
    ctx.quadraticCurveTo(5.4, ch + 2, 3.4, wa + 0.4);
    ctx.lineTo(-3.4, wa + 0.4);
    ctx.quadraticCurveTo(-5.4, ch + 2, -5, sh + 1.4);
    ctx.closePath(); ctx.fill();
    poly(ctx, [[1.4, sh + 1.4], [5, sh + 1.4], [4.6, ch + 3], [3.4, wa + 0.4], [1.8, wa + 0.4]], P.metalD);
    poly(ctx, [[-4.2, sh + 2], [-2.6, sh + 2], [-2.2, wa], [-3.4, wa]], P.metalL);
    ctx.fillStyle = P.gleam; ctx.fillRect(-3.9, sh + 2.4, 0.7, 4.4);
    // Nervio central y remaches.
    ctx.strokeStyle = P.metalD; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(0, sh + 2.2); ctx.lineTo(0.4, wa); ctx.stroke();
    dot(ctx, -3.6, sh + 2.2, 0.7, P.metalL);
    dot(ctx, 3.4, sh + 2.2, 0.7, P.metalD);
  }

  if (G.armor >= 1) {
    // Cinturón con hebilla.
    poly(ctx, [[-4.8, wa - 1.4], [4.8, wa - 1.4], [4.8, wa + 0.6], [-4.8, wa + 0.6]], P.leatherD);
    ctx.fillStyle = P.woodL; ctx.fillRect(-1.2, wa - 1.6, 2.6, 2.4);
    ctx.fillStyle = P.woodD; ctx.fillRect(-0.4, wa - 1, 1, 1.2);
  }
  if (G.armor >= 2) {
    // Gola.
    poly(ctx, [[-3.4, sh + 0.4], [3.4, sh + 0.4], [3, sh + 2], [-3, sh + 2]], P.metalD);
    ctx.fillStyle = P.metalL; ctx.fillRect(-3, sh + 0.6, 3, 0.8);
  }
  if (G.armor >= 3) {
    // Hombreras: casquete de hierro sobre cada hombro.
    for (const [side, tone] of [[-1, P.metal], [1, P.metalD]]) {
      ctx.fillStyle = tone;
      ctx.beginPath();
      ctx.ellipse(side * 5.4, sh + 1.8, 2.8, 2.4, side * 0.3, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(side * 5.4 - 2.8, sh + 1.6, 5.6, 2.2);
      if (G.armor >= 4) {
        // Reborde y remache de la hombrera de campeón.
        ctx.fillStyle = side < 0 ? P.metalL : P.metal;
        ctx.fillRect(side * 5.4 - 2.8, sh + 3.4, 5.6, 0.9);
        dot(ctx, side * 5.4, sh + 1.4, 0.8, side < 0 ? P.metalL : P.metal);
      }
    }
  }
}

/** Capa del color del jugador, que ondea con el paso. */
function cape(ctx, P, G, walk, back) {
  if (!G.cape) return;
  const top = BODY.shoulder + 0.4;
  const bottom = BODY.shoulder + 22 * G.cape;
  const mid = (top + bottom) / 2;
  const sway = walk * 1.8;
  // La capa vuela hacia atrás lo bastante como para verse por detrás del
  // escudo; de espaldas se abre todavía más y tapa casi todo el cuerpo.
  const w = back ? 1.35 : 1;
  ctx.beginPath();
  ctx.moveTo(2.4, top);
  ctx.lineTo(-4.4, top + 0.4);
  ctx.quadraticCurveTo(-11.4 * w - sway, mid, -10 * w - sway * 1.5, bottom);
  ctx.quadraticCurveTo(-3, bottom + 1.8, 2.6 - sway * 0.4, bottom - 1.4);
  ctx.quadraticCurveTo(5.4 * w, mid, 3.2, top + 1);
  ctx.closePath();
  ctx.fillStyle = P.cape; ctx.fill();
  // Pliegues: el que da al viento va claro y el hueco, oscuro.
  ctx.strokeStyle = P.capeD; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-2.6, top + 2);
  ctx.quadraticCurveTo(-6.4 * w - sway, mid, -5.6 * w - sway, bottom - 1.4);
  ctx.moveTo(1.4, top + 2.6);
  ctx.quadraticCurveTo(0.2, mid, -0.4 - sway * 0.5, bottom - 1.6);
  ctx.stroke();
  ctx.strokeStyle = P.capeL; ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-3.8, top + 1.4);
  ctx.quadraticCurveTo(-10 * w - sway, mid, -8.8 * w - sway * 1.4, bottom - 1);
  ctx.stroke();
  // Broche en el hombro.
  dot(ctx, 2.2, top + 0.8, 1.4, P.woodL);
  dot(ctx, 2.5, top + 1.1, 0.6, P.woodD);
}

/** Cabeza, cuello y yelmo. */
function head(ctx, P, G, back) {
  const hy = BODY.head, R = BODY.headR;
  const style = G.helm;
  limb(ctx, 0, BODY.neck + 1.8, 0.4, BODY.neck - 1.4, 4, P.skinD);
  if (G.armor >= 2 && style !== 'great' && style !== 'crest') {
    // Cofia de malla: enmarca la cara y baja hasta los hombros.
    ctx.fillStyle = P.mail;
    ctx.beginPath(); ctx.ellipse(0.2, hy + 0.8, R + 1.4, R + 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = P.mailL;
    ctx.beginPath(); ctx.ellipse(-2, hy - 0.4, R * 0.6, R * 0.9, 0, Math.PI, Math.PI * 2); ctx.fill();
  }

  if (style === 'great' || style === 'crest') {
    // Yelmo cerrado: no se ve la cara, sólo la vista y los respiraderos.
    ctx.fillStyle = P.helm;
    ctx.beginPath();
    ctx.moveTo(-R - 0.4, hy - 1);
    ctx.quadraticCurveTo(0.2, hy - R - 2.6, R + 0.8, hy - 1);
    ctx.lineTo(R + 0.6, hy + R - 0.6);
    ctx.quadraticCurveTo(0.4, hy + R + 1.4, -R - 0.2, hy + R - 0.8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = P.helmD; // media cara en sombra
    poly(ctx, [[2, hy - R - 1], [R + 0.8, hy - 1], [R + 0.6, hy + R - 0.6], [2, hy + R]], P.helmD);
    ctx.fillStyle = '#20242b'; // vista
    ctx.fillRect(-R + 0.2, hy - 1.6, 2 * R + 0.4, 1.6);
    ctx.fillStyle = P.helmL;
    ctx.fillRect(-R + 0.2, hy - 2.4, 2 * R + 0.4, 0.8); // reborde de la vista
    ctx.fillRect(-0.7, hy - R - 1.6, 1.4, R * 2 + 0.6); // nervio central
    ctx.fillStyle = P.helmD;
    for (let i = 0; i < 3; i++) dot(ctx, 2.4 + i * 1.4, hy + 2.2, 0.5, P.helmD);
    dot(ctx, -2.6, hy - R + 0.6, 1.5, P.gleam); // brillo
  } else {
    // Cara: óvalo, mandíbula en sombra y pómulo a la luz.
    ctx.fillStyle = P.skin;
    ctx.beginPath(); ctx.ellipse(0.4, hy, R * 0.88, R, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = P.skinD;
    ctx.beginPath(); ctx.ellipse(2.4, hy + 1.6, R * 0.42, R * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = P.skinL;
    ctx.beginPath(); ctx.ellipse(-1.4, hy - 1.2, R * 0.4, R * 0.46, 0, 0, Math.PI * 2); ctx.fill();
    if (!style) {
      // Sin yelmo se le ve el pelo: flequillo, nuca y patilla.
      ctx.fillStyle = P.hair;
      ctx.beginPath(); ctx.ellipse(0.2, hy - 1.8, R * 0.94, R * 0.72, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(-R * 0.92, hy - 2.4, 1.8, 4.2);
      ctx.fillStyle = shade(P.hair, 0.14);
      ctx.fillRect(-R * 0.5, hy - 3.9, 2.6, 1);
    }
    if (!back) {
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(2.2, hy - 1.2, 1.1, 1.2);   // ojo
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(1.8, hy + 1.6, 1.8, 0.6);   // boca
    }
  }

  if (style === 'cap' || style === 'nasal') {
    ctx.fillStyle = P.helm;
    ctx.beginPath(); ctx.arc(0.4, hy - 0.4, R + 1, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = P.helmD;
    ctx.fillRect(-R - 0.6, hy - 1.4, 2 * R + 2, 1.6); // ala
    ctx.fillStyle = P.helmL;
    ctx.beginPath(); ctx.arc(-1.4, hy - 1.4, R - 0.6, Math.PI * 1.05, Math.PI * 1.62); ctx.lineTo(-1.4, hy - 1.4);
    ctx.closePath(); ctx.fill();
    dot(ctx, -2.2, hy - 3.4, 0.9, P.gleam);
    if (style === 'nasal') {
      ctx.fillStyle = P.helmD;
      ctx.fillRect(1.8, hy - 1.4, 1.4, 4.4);        // nasal
      ctx.fillStyle = P.helmL;
      ctx.fillRect(1.8, hy - 1.4, 0.6, 4.4);
      dot(ctx, 0.4, hy - R - 1.2, 0.9, P.helmL);    // remate
    }
  } else if (style === 'hood') {
    // Capucha de tela: casquete sobre la cabeza y esclavina en los hombros.
    ctx.fillStyle = P.tunic;
    ctx.beginPath();
    ctx.moveTo(-R - 1.2, hy + 1.4);
    ctx.quadraticCurveTo(-R - 1.2, hy - R - 2.4, 0.6, hy - R - 1.8);
    ctx.quadraticCurveTo(R + 1, hy - R - 1, R + 0.6, hy - 1.6);
    ctx.lineTo(1.4, hy - 2.6);
    ctx.quadraticCurveTo(-R + 0.6, hy - 2.4, -R - 0.2, hy + 1.6);
    ctx.closePath(); ctx.fill();
    // Esclavina: cae redondeada por detrás del cuello hasta los hombros.
    ctx.fillStyle = P.tunicD;
    ctx.beginPath();
    ctx.moveTo(-R - 0.6, hy + 1.6);
    ctx.quadraticCurveTo(-1.6, hy + 3.4, 0.4, hy + R + 2.8);
    ctx.quadraticCurveTo(-3.4, hy + R + 3.6, -R - 1.4, hy + R + 1.8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = P.tunicL;
    ctx.beginPath();
    ctx.arc(-1.4, hy - 2.4, 3, Math.PI * 1.08, Math.PI * 1.72);
    ctx.lineTo(-1.4, hy - 2.4);
    ctx.closePath(); ctx.fill();
  }

  if (style === 'crest') {
    // Penacho: cresta de crin peinada de la frente al cogote.
    // Arranca en la cima del yelmo y cae hacia la nuca.
    const base = hy - 3.6;
    ctx.fillStyle = P.plume;
    ctx.beginPath();
    ctx.moveTo(3, base + 0.6);
    ctx.quadraticCurveTo(2.6, base - 5.4, -2.2, base - 5.6);
    ctx.quadraticCurveTo(-6.6, base - 5, -8.4, base + 1.4);
    ctx.quadraticCurveTo(-5.4, base - 0.4, -2.2, base - 0.8);
    ctx.quadraticCurveTo(0.4, base - 1, 1.2, base + 0.6);
    ctx.closePath(); ctx.fill();
    // Mechones: dos surcos oscuros siguiendo la curva de la crin.
    ctx.strokeStyle = shade(P.plume, -0.26); ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(2.4, base - 0.4);
    ctx.quadraticCurveTo(1.6, base - 4.2, -2.4, base - 4.4);
    ctx.moveTo(-2.6, base - 4.2);
    ctx.quadraticCurveTo(-6, base - 3.4, -7.4, base + 0.4);
    ctx.stroke();
    ctx.fillStyle = P.woodL;
    ctx.fillRect(1.4, base + 0.2, 2.4, 1.8); // abrazadera del penacho
  }
}

/**
 * Brazo de dos tramos. (hx, hy) es la mano; el codo sale del punto medio,
 * separado hacia fuera, para que el brazo no quede como un palo.
 */
function arm(ctx, P, G, hx, hy, o = {}) {
  const sx = o.sx !== undefined ? o.sx : 0.6;
  const sy = o.sy !== undefined ? o.sy : BODY.shoulder + 2.4;
  const bend = o.bend !== undefined ? o.bend : 2;
  const dx = hx - sx, dy = hy - sy;
  const len = Math.hypot(dx, dy) || 1;
  const ex = (sx + hx) / 2 - (dy / len) * bend;
  const ey = (sy + hy) / 2 + (dx / len) * bend;
  const far = !!o.far; // el brazo del fondo va un punto más oscuro
  // Manga: hierro, malla, la propia túnica o la camisa de lino de debajo.
  const sleeve = G.armor >= 3 ? (far ? P.metalD : P.metal)
    : G.armor === 2 ? (far ? P.mail : P.mailL)
      : G.armor === 1 ? (far ? P.tunicD : P.tunic)
        : (far ? P.clothD : P.cloth);
  const fore = G.armor >= 2 ? (far ? P.metalD : P.metal) : (far ? P.skinD : P.skin);
  limb(ctx, sx, sy, ex, ey, 3.9, sleeve);
  limb(ctx, ex, ey, hx, hy, 3.2, fore);
  if (G.armor >= 3) {
    // Codal y guardabrazo.
    dot(ctx, ex, ey, 1.8, far ? P.metalD : P.metal);
    limb(ctx, ex, ey, hx * 0.5 + ex * 0.5, hy * 0.5 + ey * 0.5, 3.3, far ? P.metalD : P.metal);
  }
  // Mano: guantelete de hierro, guante de cuero o la mano desnuda.
  dot(ctx, hx, hy, 1.8, G.armor >= 2 ? (far ? P.metalD : P.metal)
    : G.armor === 1 ? (far ? P.leatherD : P.leather) : (far ? P.skinD : P.skin));
  return { ex, ey };
}

// --- Armas y escudos --------------------------------------------------------

/** Escudo visto de canto, ya en su sitio. */
function shield(ctx, P, style, x, y) {
  if (!style) return;
  ctx.save();
  ctx.translate(x, y);
  if (style === 'heater') {
    const w = 4.9, h = 7.2;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-w, -h);
      ctx.lineTo(w, -h + 0.4);
      ctx.quadraticCurveTo(w * 0.9, h * 0.4, 0, h);
      ctx.quadraticCurveTo(-w * 0.9, h * 0.4, -w, -h);
      ctx.closePath();
    };
    path(); ctx.fillStyle = P.tunic; ctx.fill();
    // Mitad en sombra, banda del color oscuro y filete claro.
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = P.tunicD; ctx.fillRect(1.4, -h - 1, w + 1, h * 2 + 2);
    ctx.fillStyle = P.tunicL;
    ctx.beginPath();
    ctx.moveTo(-w, -h + 2.6); ctx.lineTo(w, -h + 1.6);
    ctx.lineTo(w, -h + 4); ctx.lineTo(-w, -h + 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    path(); ctx.strokeStyle = P.metalD; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = P.metalL; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(-w + 0.4, -h + 1); ctx.lineTo(-w + 0.4, h * 0.3); ctx.stroke();
    dot(ctx, 0, -1, 1.6, P.metal);
    dot(ctx, -0.5, -1.5, 0.7, P.gleam);
  } else {
    const r = style === 'buckler' ? 4.2 : 5.7;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.84, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = P.tunic; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = P.tunicD; ctx.fillRect(0.8, -r, r, r * 2);
    ctx.fillStyle = P.tunicL; ctx.fillRect(-r, -r, r * 0.5, r * 2);
    ctx.restore();
    // Aro metálico, umbo y clavos.
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.84, r, 0, 0, Math.PI * 2);
    ctx.strokeStyle = P.metalD; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-0.6, -0.6, r * 0.84, r, 0, Math.PI * 0.9, Math.PI * 1.7);
    ctx.strokeStyle = P.metalL; ctx.lineWidth = 0.8; ctx.stroke();
    dot(ctx, 0, 0, r * 0.34, P.metal);
    dot(ctx, -r * 0.12, -r * 0.14, r * 0.16, P.gleam);
    ctx.fillStyle = P.metalD;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      dot(ctx, Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.72, 0.6, P.metalD);
    }
  }
  ctx.restore();
}

/** Espada con la empuñadura en el origen y la hoja hacia arriba. */
function sword(ctx, P, len) {
  // Puño forrado de cuero y pomo de latón.
  ctx.fillStyle = P.leatherD; ctx.fillRect(-1, -1.2, 2, 4.4);
  ctx.strokeStyle = P.leather; ctx.lineWidth = 0.5;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-1, -0.2 + i * 1.2); ctx.lineTo(1, -0.6 + i * 1.2); ctx.stroke();
  }
  dot(ctx, 0, 3.6, 1.3, P.woodL);
  dot(ctx, 0.4, 3.9, 0.6, P.woodD);
  // Guarda: dos gavilanes rectos con el canto en sombra.
  poly(ctx, [[-3.6, -2], [3.6, -2], [3.1, -0.7], [-3.1, -0.7]], P.woodL);
  poly(ctx, [[-3.6, -1.2], [3.6, -1.2], [3.3, -0.7], [-3.3, -0.7]], P.woodD);
  // Hoja: cuerpo, filo iluminado, canto en sombra y vaceo.
  const w = 1.3, tip = -len - 2.2;
  poly(ctx, [[-w, -2], [w, -2], [w * 0.78, -len + 1], [0, tip], [-w * 0.78, -len + 1]], P.metal);
  poly(ctx, [[-w, -2], [-w * 0.3, -2], [-w * 0.24, -len + 1], [-w * 0.78, -len + 1]], P.metalL);
  poly(ctx, [[w * 0.42, -2], [w, -2], [w * 0.78, -len + 1], [w * 0.34, -len + 1]], P.metalD);
  ctx.strokeStyle = P.metalD; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, -len + 1); ctx.stroke();
}

/** Asta con moharra: lanza, pica o jabalina. */
function polearm(ctx, P, len, headLen) {
  const top = -len * 0.75;
  ctx.fillStyle = P.wood; ctx.fillRect(-1.1, top, 2.2, len);
  ctx.fillStyle = P.woodD; ctx.fillRect(0.4, top, 0.8, len);   // veta en sombra
  ctx.fillStyle = P.woodL; ctx.fillRect(-1.1, top, 0.6, len);  // veta a la luz
  // Empuñadura de cuero y regatón.
  ctx.fillStyle = P.leatherD; ctx.fillRect(-1.3, -1.6, 2.6, 3.4);
  ctx.fillStyle = P.metalD; ctx.fillRect(-1.2, len * 0.25 - 1.4, 2.4, 1.6);
  // Cubo y moharra de hoja de laurel.
  ctx.fillStyle = P.metalD; ctx.fillRect(-1.4, top - 1.4, 2.8, 2.4);
  ctx.fillStyle = P.metal;
  ctx.beginPath();
  ctx.moveTo(0, top - headLen);
  ctx.quadraticCurveTo(2.6, top - headLen * 0.42, 0, top - 0.6);
  ctx.quadraticCurveTo(-2.6, top - headLen * 0.42, 0, top - headLen);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = P.metalL;
  ctx.beginPath();
  ctx.moveTo(0, top - headLen);
  ctx.quadraticCurveTo(-1.3, top - headLen * 0.45, -0.3, top - 1.4);
  ctx.lineTo(-0.3, top - headLen * 0.7);
  ctx.closePath(); ctx.fill();
}

/**
 * Arco recurvo. Las palas curvan hacia delante y la cuerda se tira hacia el
 * cuerpo, así que la flecha apunta adelante; `draw` es cuánto se ha tensado.
 */
function bow(ctx, P, draw) {
  ctx.strokeStyle = P.wood; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-1.6, -10.4);
  ctx.quadraticCurveTo(3.4, -5, 2.4, 0);
  ctx.quadraticCurveTo(3.4, 5, -1.6, 10.4);
  ctx.stroke();
  ctx.strokeStyle = P.woodL; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-1.2, -9.6);
  ctx.quadraticCurveTo(2.6, -4.8, 1.8, 0);
  ctx.quadraticCurveTo(2.6, 4.8, -1.2, 9.6);
  ctx.stroke();
  ctx.fillStyle = P.leatherD; ctx.fillRect(1.2, -2.4, 2.2, 4.8); // empuñadura
  const nock = -1.4 - draw * 7;
  ctx.strokeStyle = BOWSTRING; ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-1.6, -10.4); ctx.lineTo(nock, 0); ctx.lineTo(-1.6, 10.4); ctx.stroke();
  if (draw > 0) {
    // Flecha montada sobre la cuerda.
    ctx.strokeStyle = P.woodL; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(nock, 0); ctx.lineTo(8.4, 0); ctx.stroke();
    poly(ctx, [[11.6, 0], [8, -1.3], [8, 1.3]], P.metalL);
    ctx.strokeStyle = P.plume; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(nock + 0.6, -1.2); ctx.lineTo(nock + 2.4, 1.2); ctx.stroke();
  }
}

/** Ballesta vista de perfil; `draw` marca si está montada. */
function crossbow(ctx, P, draw) {
  // Cureña: corta y de canto, para que no tape el pecho.
  poly(ctx, [[-5.4, -1], [5.4, -1.6], [5.8, 0.4], [-5, 1.4]], P.wood);
  poly(ctx, [[-5.4, -1], [5.4, -1.6], [5.6, -0.8], [-5.2, -0.2]], P.woodL);
  poly(ctx, [[-5.2, 0.2], [5.7, -0.5], [5.8, 0.4], [-5, 1.4]], P.woodD);
  ctx.fillStyle = P.metalD; ctx.fillRect(-2.4, 1, 1.4, 2.2); // gatillo
  ctx.fillStyle = P.leatherD; ctx.fillRect(-5.6, -1.2, 1.6, 2.6); // culata
  // Arco de acero, atado a la punta de la cureña.
  ctx.strokeStyle = P.metalD; ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(3, -6.4); ctx.quadraticCurveTo(6.2, -0.6, 3, 5.4); ctx.stroke();
  ctx.strokeStyle = P.metalL; ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(2.8, -5.8); ctx.quadraticCurveTo(5.4, -0.6, 2.8, 4.8); ctx.stroke();
  ctx.strokeStyle = BOWSTRING; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(3, -6.4); ctx.lineTo(draw ? -2.2 : 2.2, -0.6); ctx.lineTo(3, 5.4); ctx.stroke();
  if (draw) {
    ctx.fillStyle = P.woodL; ctx.fillRect(-2, -1.4, 8, 1);
    poly(ctx, [[8.6, -0.9], [5.8, -2], [5.8, 0.2]], P.metalL); // virote
  }
}

/** Carcaj a la espalda, con sus flechas emplumadas. */
function quiver(ctx, P) {
  const y = BODY.shoulder + 2;
  // Bandolera cruzada al pecho, y detrás la aljaba.
  ctx.strokeStyle = P.leather; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-5.4, y - 1.6); ctx.lineTo(3.2, BODY.waist - 0.6); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const x = -8 + i * 1.3;
    ctx.strokeStyle = P.woodL; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x + 0.5, y - 4.6); ctx.stroke();
    ctx.strokeStyle = P.plume; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x + 0.3, y - 3); ctx.lineTo(x + 0.5, y - 4.4); ctx.stroke();
  }
  poly(ctx, [[-9, y + 0.6], [-5.6, y], [-4.8, y + 8], [-8.2, y + 8.6]], P.leather);
  poly(ctx, [[-6.4, y + 0.4], [-5.6, y], [-4.8, y + 8], [-5.6, y + 8.2]], P.leatherD);
  ctx.strokeStyle = P.leatherD; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(-8.8, y + 2.8); ctx.lineTo(-5.4, y + 2.2); ctx.stroke();
}

/** Hacha del aldeano: mango de madera y hoja de hierro remachada. */
function axe(ctx, P) {
  ctx.fillStyle = P.wood; ctx.fillRect(-0.9, -11, 1.8, 14);
  ctx.fillStyle = P.woodD; ctx.fillRect(0.3, -11, 0.7, 14);
  // Hoja: filo curvo hacia fuera y ojo remachado al mango.
  ctx.fillStyle = P.metal;
  ctx.beginPath();
  ctx.moveTo(-0.6, -12.6);
  ctx.quadraticCurveTo(2.4, -12.2, 3.4, -10.2);
  ctx.quadraticCurveTo(2.4, -8.2, -0.6, -8);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = P.metalL;
  ctx.beginPath();
  ctx.moveTo(1.4, -12.1);
  ctx.quadraticCurveTo(3, -11.6, 3.4, -10.2);
  ctx.quadraticCurveTo(3, -8.8, 1.4, -8.3);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = P.metalD; ctx.fillRect(-1.5, -12.4, 1.4, 4.6);
  dot(ctx, -0.8, -10.2, 0.5, P.metalL);
}

// --- Montura ----------------------------------------------------------------

function drawHorse(ctx, P, type, f) {
  const [horseL, horse, horseD] = ramp(look('unit', type).horse || '#8a6a4a');
  const gallop = Math.sin((f / 4) * Math.PI * 2);
  // Patas: primero las del lado en sombra.
  limb(ctx, -6, 0, -8 + gallop * 3.4, 9, 3, horseD);
  limb(ctx, 7, 0, 9 - gallop * 3.4, 9, 3, horseD);
  limb(ctx, -4, 0, -3 - gallop * 3.4, 9, 3.2, horse);
  limb(ctx, 6, 0, 7 + gallop * 3.4, 9, 3.2, horse);
  for (const [hx, hy] of [[-8 + gallop * 3.4, 9], [9 - gallop * 3.4, 9], [-3 - gallop * 3.4, 9], [7 + gallop * 3.4, 9]]) {
    dot(ctx, hx, hy, 1.5, horseD);
  }
  // Cuerpo, grupa y pecho.
  ctx.fillStyle = horse;
  ctx.beginPath(); ctx.ellipse(1, -2.4, 12.2, 6.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = horseL;
  ctx.beginPath(); ctx.ellipse(-0.5, -5.2, 10, 3.4, -0.06, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = horseD;
  ctx.beginPath(); ctx.ellipse(2.5, 1.4, 9, 2.6, 0.05, 0, Math.PI * 2); ctx.fill();
  // Cuello y cabeza.
  ctx.fillStyle = horse;
  poly(ctx, [[6, -4], [11.6, -12.4], [14.4, -11], [10, -1]], horse);
  ctx.beginPath(); ctx.ellipse(13.4, -12.4, 4.4, 3.2, -0.34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = horseL;
  ctx.beginPath(); ctx.ellipse(12.4, -13.2, 3.2, 1.8, -0.34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = horseD;
  ctx.fillRect(15.4, -12.6, 2.4, 2.6);            // hocico
  ctx.fillRect(13.2, -15.6, 1.6, 2.6);            // orejas
  ctx.fillRect(10.8, -15.2, 1.6, 2.6);
  dot(ctx, 14.6, -13.4, 0.7, '#231d19');          // ojo
  // Crin y cola.
  ctx.strokeStyle = horseD; ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(11.4, -13.4);
  ctx.quadraticCurveTo(8.4, -10.4, 6.2, -5.4); ctx.stroke();
  ctx.strokeStyle = horseD; ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(-10, -4); ctx.quadraticCurveTo(-14.4, -2.4, -14.8, 3.4); ctx.stroke();
  // Cabezada y riendas.
  ctx.strokeStyle = P.leatherD; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(15.6, -11.6); ctx.lineTo(11.4, -11); ctx.moveTo(13.6, -14.4); ctx.lineTo(12.8, -10.2);
  ctx.moveTo(11.8, -11.2); ctx.lineTo(6.4, -6.6);
  ctx.stroke();
  if (type !== 'scout') {
    // Gualdrapa del color del jugador y silla.
    poly(ctx, [[-7, -6.4], [5.4, -6.8], [6.4, 1.6], [-8, 2]], P.tunic);
    poly(ctx, [[-8, 0.4], [6.4, 0], [6.4, 1.6], [-8, 2]], P.tunicD);
    ctx.fillStyle = P.tunicL; ctx.fillRect(-7, -6.4, 12.4, 1.2);
  }
  ctx.fillStyle = P.leatherD;
  ctx.fillRect(-4.6, -8.4, 8.6, 2.6);
  ctx.fillStyle = P.leather;
  ctx.fillRect(-4.6, -8.4, 8.6, 1);
}

// --- El soldado completo ----------------------------------------------------

/**
 * Dibuja la unidad a pie (o al jinete). f = 0..3 ciclo de marcha, 4 el brazo
 * atrás y 5 el golpe. `back` es de espaldas: se le quita la cara y la capa le
 * tapa el cuerpo.
 */
function drawSoldier(ctx, type, P, f, back, mounted) {
  const G = GEAR[type] || NO_GEAR;
  const atk = f >= 4;
  const swing = f === 5 ? 1 : f === 4 ? -0.5 : 0;
  const walk = !mounted && f < 4 ? Math.sin((f / 4) * Math.PI * 2) : 0;
  const bob = walk ? Math.abs(walk) * -1.2 : 0;
  const armY = BODY.shoulder + bob + 3;

  // El cuerpo se inclina con el golpe: primero se echa atrás y luego encima.
  const lean = atk ? swing * 1.6 : 0;

  if (!back) cape(ctx, P, G, walk, back);
  if (mounted) ridingLegs(ctx, P, G);
  else {
    leg(ctx, P, G, -walk, false, bob);
    leg(ctx, P, G, walk, true, bob);
  }

  ctx.save();
  ctx.translate(lean, bob);
  skirt(ctx, P, G, walk);
  // Brazo del fondo, por detrás del torso.
  const offHand = { x: -6.4, y: armY - bob + 3.6 };
  if (!G.shield) arm(ctx, P, G, offHand.x - 1, offHand.y + 1.4, { far: true, bend: -2.4 });
  torso(ctx, P, G);
  if (type === 'archer' || type === 'crossbowman' || type === 'arbalester' || type === 'skirmisher') {
    quiver(ctx, P);
  }
  head(ctx, P, G, back);
  if (back) cape(ctx, P, G, walk, back);
  ctx.restore();

  ctx.save();
  ctx.translate(lean, bob);
  drawWeapons(ctx, type, P, G, f, atk, swing, armY - bob);
  ctx.restore();
}

/** Los brazos, el arma y el escudo: lo que de verdad cambia de unidad a unidad. */
function drawWeapons(ctx, type, P, G, f, atk, swing, armY) {
  const shieldAt = (x, y) => {
    arm(ctx, P, G, x + 1.4, y + 1, { far: true, bend: -2.6 });
    shield(ctx, P, G.shield, x, y);
  };

  switch (type) {
    case 'villager': {
      arm(ctx, P, G, -6.4, armY + 6, { far: true, bend: -2.2 });
      const hx = 7.2, hy = armY + 5 - (atk ? swing * 6 : 0);
      arm(ctx, P, G, hx, hy, { bend: 2.4 });
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(atk ? -0.7 + swing * 1.4 : 0.55);
      axe(ctx, P);
      ctx.restore();
      break;
    }
    case 'militia': case 'manatarms': case 'longswordsman': case 'champion': {
      shieldAt(-8.2, armY + 3.6);
      const blade = type === 'militia' ? 11 : type === 'manatarms' ? 13 : type === 'longswordsman' ? 15 : 17;
      // En reposo la hoja se apoya hacia fuera para que no cruce la cara; al
      // atacar primero se echa atrás sobre el hombro y luego cae hacia delante.
      const hx = f === 4 ? 3.6 : f === 5 ? 7.4 : 5.4;
      const hy = f === 4 ? armY - 0.8 : f === 5 ? armY + 2.2 : armY + 3.2;
      arm(ctx, P, G, hx, hy, { bend: atk ? 3 : 2.2 });
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(f === 4 ? -1 : f === 5 ? 1.5 : 0.34);
      sword(ctx, P, blade);
      ctx.restore();
      break;
    }
    case 'spearman': case 'pikeman': {
      if (G.shield) shieldAt(-7.4, armY + 3.4);
      else arm(ctx, P, G, -6.4, armY + 4.6, { far: true, bend: -2.4 });
      // El asta se lleva terciada hacia delante y la estocada la baja y la
      // adelanta, en vez de pasar por encima de la cabeza.
      const hx = f === 4 ? 3.6 : f === 5 ? 7.4 : 5.6;
      const hy = f === 4 ? armY + 1 : armY + 2.4;
      arm(ctx, P, G, hx, hy, { bend: 2 });
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(f === 4 ? 0.12 : f === 5 ? 0.86 : 0.3);
      polearm(ctx, P, type === 'pikeman' ? 30 : 25, type === 'pikeman' ? 8 : 7);
      ctx.restore();
      break;
    }
    case 'archer': case 'crossbowman': case 'arbalester': case 'skirmisher': {
      const draw = atk ? (f === 5 ? 1 : 0.55) : 0;
      if (type === 'skirmisher') {
        arm(ctx, P, G, -6, armY + 5, { far: true, bend: -2.2 });
        const hx = 6.4, hy = armY - 1.4 - draw * 1.6;
        arm(ctx, P, G, hx, hy, { bend: 2.6 });
        ctx.save();
        ctx.translate(hx, hy);
        // Se echa la jabalina atrás por encima del hombro y se lanza adelante.
        ctx.rotate(atk ? -0.5 + draw * 1.5 : 0.26);
        polearm(ctx, P, 18, 6);
        ctx.restore();
      } else if (type === 'archer') {
        // Brazo del arco estirado y el de la cuerda tirando hacia atrás.
        const bx = 8.2, by = armY - 0.6;
        arm(ctx, P, G, bx + 1.6, by, { far: true, bend: -1.2 });
        ctx.save();
        ctx.translate(bx, by);
        bow(ctx, P, draw);
        ctx.restore();
        arm(ctx, P, G, bx - 2.6 - draw * 6, by + 0.8, { bend: 2.6 });
      } else {
        const bx = 8.4, by = armY - 0.2;
        arm(ctx, P, G, bx - 0.4, by + 1.4, { far: true, bend: -1.4 });
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(-0.12 + draw * 0.1);
        crossbow(ctx, P, draw > 0.4);
        ctx.restore();
        arm(ctx, P, G, bx - 4.4, by + 2.4, { bend: 2.2 });
      }
      break;
    }
    case 'scout': case 'knight': case 'cavalier': {
      if (G.shield) shieldAt(-7.2, armY + 3.4);
      else arm(ctx, P, G, -6, armY + 4.4, { far: true, bend: -2.4 });
      const hx = f === 4 ? 3.8 : f === 5 ? 7.6 : 5.4;
      const hy = f === 4 ? armY - 1.2 : f === 5 ? armY + 2 : armY + 2.8;
      arm(ctx, P, G, hx, hy, { bend: 2.4 });
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(f === 4 ? -0.95 : f === 5 ? 1.45 : 0.3);
      sword(ctx, P, type === 'scout' ? 12 : type === 'knight' ? 15 : 17);
      ctx.restore();
      break;
    }
    default:
      arm(ctx, P, G, -6.4, armY + 5, { far: true, bend: -2.2 });
      arm(ctx, P, G, 6.4, armY + 5, { bend: 2.2 });
  }
}

function drawUnit(ctx, type, colorIdx, f, back) {
  const U = UNITS[type];
  const P = palette(type, colorIdx);
  if (U && U.class === 'siege') {
    shadowEllipse(ctx, 1, 2, 13, 5.5);
    drawSiege(ctx, type, P.col, f, look('unit', type));
    return;
  }
  const mounted = U && U.class === 'cavalry';
  shadowEllipse(ctx, 1, 2, mounted ? 13 : 9, mounted ? 5.5 : 4.5);
  if (mounted) {
    ctx.save();
    ctx.translate(0, -9);
    drawHorse(ctx, P, type, f);
    ctx.restore();
  }
  ctx.save();
  // El jinete se ancla a la silla: la cadera queda justo encima del lomo.
  if (mounted) ctx.translate(0, -4.5);
  drawSoldier(ctx, type, P, f, back, mounted);
  ctx.restore();
}

function drawSiege(ctx, type, col, f, L) {
  const recoil = f >= 4 ? (f === 5 ? -3 : 2) : 0;
  const [woodL, wood, woodD] = ramp(L.wood);
  const [, wheel, wheelD] = ramp(L.wheel);
  if (type === 'ram') {
    poly(ctx, [[-16, -6], [16, -6], [13, -16], [-13, -16]], wood);
    poly(ctx, [[-13, -16], [13, -16], [10, -22], [-10, -22]], woodL);
    ctx.fillStyle = woodD;
    ctx.fillRect(-18 + recoil, -12, 30, 5);
    ctx.fillStyle = L.metal;
    ctx.fillRect(10 + recoil, -13.5, 7, 8);
    for (const wx of [-11, 0, 11]) {
      ctx.beginPath(); ctx.arc(wx, -3, 4, 0, Math.PI * 2);
      ctx.fillStyle = wheel; ctx.fill();
      ctx.strokeStyle = wheelD; ctx.lineWidth = 1.4; ctx.stroke();
    }
  } else {
    // Manganel / trabuquete
    poly(ctx, [[-16, -4], [16, -4], [14, -10], [-14, -10]], wood);
    for (const wx of [-10, 10]) {
      ctx.beginPath(); ctx.arc(wx, -3, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = wheel; ctx.fill();
      ctx.strokeStyle = wheelD; ctx.lineWidth = 1.4; ctx.stroke();
    }
    const tall = type === 'trebuchet';
    ctx.strokeStyle = woodL; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, -10); ctx.lineTo(0, tall ? -34 : -22);
    ctx.moveTo(6, -10); ctx.lineTo(0, tall ? -34 : -22); ctx.stroke();
    ctx.save();
    ctx.translate(0, tall ? -32 : -20);
    ctx.rotate(f >= 4 ? (f === 5 ? -1.9 : -0.2) : -0.9);
    ctx.strokeStyle = wood; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(12, 0); ctx.stroke();
    ctx.fillStyle = wheel;
    ctx.beginPath(); ctx.arc(13, 0, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = col.main;
    ctx.fillRect(-3, -14, 6, 4);
  }
}

export function unitSprite(type, colorIdx, dir, f, back = false) {
  const key = `${type}|${colorIdx}|${dir}|${f}|${back ? 1 : 0}`;
  let s = unitCache.get(key);
  if (s) return s;
  // El lienzo crece con el tamaño elegido, así una unidad más grande no se
  // recorta y una normal no gasta memoria de más.
  const sc = look('unit', type).scale || 1;
  const extra = HEADROOM[UNITS[type] && UNITS[type].class] || 0;
  const c = makeCanvas(UW * sc * quality, (UH + extra) * sc * quality);
  const ctx = c.getContext('2d');
  ctx.scale(sc * quality, sc * quality);
  ctx.translate(UOX, UOY + extra);
  if (dir < 0) ctx.scale(-1, 1);
  drawUnit(ctx, type, colorIdx, f, back);
  s = { canvas: c, ox: UOX * sc, oy: (UOY + extra) * sc, w: UW * sc, h: (UH + extra) * sc };
  unitCache.set(key, s);
  return s;
}

/** Pinta una unidad directamente, con (x, y) a sus pies. */
export function paintUnit(ctx, x, y, type, colorIdx, dir, f, back = false) {
  const sc = look('unit', type).scale || 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  if (dir < 0) ctx.scale(-1, 1);
  drawUnit(ctx, type, colorIdx, f, back);
  ctx.restore();
}

// --- Sprites de edificios ---------------------------------------------------

const buildCache = new Map();

function bannerPole(ctx, x, y, h, col) {
  ctx.strokeStyle = '#5b4a2f'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
  ctx.fillStyle = col.main;
  ctx.beginPath();
  ctx.moveTo(x, y - h); ctx.lineTo(x + 9, y - h + 3); ctx.lineTo(x, y - h + 7);
  ctx.closePath(); ctx.fill();
}

// --- Piezas de los edificios ------------------------------------------------
//
// Un edificio es un prisma con un tejado encima, y lo que lo convierte en una
// casa es lo que se le pone por encima: el material del tejado, el entramado de
// madera del muro, el zócalo de piedra, las ventanas y los trastos apoyados en
// la pared. Estas piezas hacen esas cuatro cosas para todos por igual.

const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/*
 * Una fachada se da con sus dos esquinas de abajo y su altura, y (t, k) la
 * recorre en tanto por uno: t de una esquina a la otra y k del suelo al alero.
 * Colgarle una viga o una ventana es dar cuatro números, sin repetir la cuenta
 * isométrica en cada edificio.
 */
function faceAt(a, b, h, t, k) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - h * k];
}

function facePanel(ctx, a, b, h, t0, k0, t1, k1, fill, stroke) {
  poly(ctx, [
    faceAt(a, b, h, t0, k0), faceAt(a, b, h, t1, k0),
    faceAt(a, b, h, t1, k1), faceAt(a, b, h, t0, k1),
  ], fill, stroke);
}

/** Viga: un trazo recto de un punto de la fachada a otro. */
function faceBeam(ctx, a, b, h, t0, k0, t1, k1, w, color) {
  const p = faceAt(a, b, h, t0, k0), q = faceAt(a, b, h, t1, k1);
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
}

/** Zócalo de piedra al pie del muro, con sus juntas a matajunta. */
function plinth(ctx, a, b, h, k, stone, stoneD) {
  facePanel(ctx, a, b, h, 0, 0, 1, k, stone);
  const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9));
  ctx.strokeStyle = stoneD; ctx.lineWidth = 0.8; ctx.lineCap = 'butt';
  for (let i = 1; i < n; i++) {
    const k0 = i % 2 ? 0 : k / 2;
    const p = faceAt(a, b, h, i / n, k0), q = faceAt(a, b, h, i / n, k0 + k / 2);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  faceBeam(ctx, a, b, h, 0, k / 2, 1, k / 2, 0.8, stoneD);
}

/**
 * Entramado de madera sobre el yeso: durmiente, carreras, postes y las
 * tornapuntas en aspa de cada tramo. Es lo que hace que un muro se lea como
 * una casa y no como una caja pintada.
 */
function timbering(ctx, a, b, h, k0, wood) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bays = Math.max(1, Math.round(len / 26));
  const mid = k0 + (1 - k0) * 0.52;
  faceBeam(ctx, a, b, h, 0, k0 + 0.02, 1, k0 + 0.02, 2.6, wood);
  faceBeam(ctx, a, b, h, 0, 0.97, 1, 0.97, 2.8, wood);
  faceBeam(ctx, a, b, h, 0, mid, 1, mid, 2, wood);
  for (let i = 0; i <= bays; i++) {
    faceBeam(ctx, a, b, h, i / bays, k0, i / bays, 1, i % bays === 0 ? 2.8 : 2.2, wood);
  }
  for (let i = 0; i < bays; i++) {
    const t0 = i / bays, t1 = (i + 1) / bays, tm = (t0 + t1) / 2;
    faceBeam(ctx, a, b, h, t0 + 0.02, mid, tm, 0.95, 1.6, wood);
    faceBeam(ctx, a, b, h, t1 - 0.02, mid, tm, 0.95, 1.6, wood);
  }
}

/** Ventana con marco, parteluz y contraventana del color del jugador. */
function faceWindow(ctx, a, b, h, t, k, wood, shutter) {
  const wt = Math.min(0.32, 8 / Math.hypot(b[0] - a[0], b[1] - a[1]));
  const hk = Math.min(0.4, 10 / h);
  facePanel(ctx, a, b, h, t - wt / 2, k, t + wt / 2, k + hk, '#2a2119');
  faceBeam(ctx, a, b, h, t - wt / 2, k + hk / 2, t + wt / 2, k + hk / 2, 1, '#3f342a');
  faceBeam(ctx, a, b, h, t, k, t, k + hk, 1, '#3f342a');
  // Contraventana abierta a un lado y dintel.
  facePanel(ctx, a, b, h, t - wt * 0.92, k + 0.01, t - wt * 0.46, k + hk - 0.01, shutter);
  faceBeam(ctx, a, b, h, t - wt * 0.62, k, t + wt * 0.62, k, 1.8, wood);
  faceBeam(ctx, a, b, h, t - wt * 0.62, k + hk, t + wt * 0.62, k + hk, 1.8, wood);
}

/** Puerta de tablas con jambas y dintel. */
function faceDoor(ctx, a, b, h, t, kh, wood, woodD, dark) {
  const wt = Math.min(0.4, 11 / Math.hypot(b[0] - a[0], b[1] - a[1]));
  facePanel(ctx, a, b, h, t - wt / 2, 0, t + wt / 2, kh, dark);
  ctx.strokeStyle = woodD; ctx.lineWidth = 0.9; ctx.lineCap = 'butt';
  for (let i = 1; i < 3; i++) {
    const p = faceAt(a, b, h, t - wt / 2 + (wt * i) / 3, 0);
    const q = faceAt(a, b, h, t - wt / 2 + (wt * i) / 3, kh);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  faceBeam(ctx, a, b, h, t - wt / 2, kh * 0.62, t + wt / 2, kh * 0.62, 1.4, woodD);
  faceBeam(ctx, a, b, h, t - wt / 2, 0, t - wt / 2, kh, 2, wood);
  faceBeam(ctx, a, b, h, t + wt / 2, 0, t + wt / 2, kh, 2, wood);
  faceBeam(ctx, a, b, h, t - wt / 2, kh, t + wt / 2, kh, 2.2, wood);
}

/** Textura de un faldón, del caballete al alero: haces de paja o hiladas de teja. */
function slopeTexture(ctx, rA, rB, eA, eB, tone, thatch) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(rA[0], rA[1]); ctx.lineTo(rB[0], rB[1]);
  ctx.lineTo(eB[0], eB[1]); ctx.lineTo(eA[0], eA[1]);
  ctx.closePath(); ctx.clip();
  ctx.lineCap = 'butt';
  const width = Math.hypot(rB[0] - rA[0], rB[1] - rA[1]);
  if (thatch) {
    // Los haces bajan del caballete al alero, cada uno con su tono.
    const n = Math.max(4, Math.round(width / 4.5));
    ctx.lineWidth = 3;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = lerp2(rA, rB, t), q = lerp2(eA, eB, t);
      ctx.strokeStyle = i % 3 === 0 ? shade(tone, 0.1) : i % 3 === 1 ? shade(tone, -0.11) : tone;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0] + (i % 2 ? 0.7 : -0.7), q[1] + (i % 2 ? 0.6 : 0));
      ctx.stroke();
    }
  } else {
    // Hiladas de teja, con las juntas desplazadas en filas alternas.
    const rows = 5;
    ctx.strokeStyle = shade(tone, -0.22); ctx.lineWidth = 1;
    for (let j = 1; j <= rows; j++) {
      const p = lerp2(rA, eA, j / rows), q = lerp2(rB, eB, j / rows);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      const cols = Math.max(3, Math.round(width / 7));
      for (let i = 0; i <= cols; i++) {
        const t = (i + (j % 2) * 0.5) / cols;
        const c0 = lerp2(lerp2(rA, rB, t), lerp2(eA, eB, t), (j - 1) / rows);
        const c1 = lerp2(lerp2(rA, rB, t), lerp2(eA, eB, t), j / rows);
        ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.stroke();
      }
    }
    ctx.strokeStyle = shade(tone, 0.16); ctx.lineWidth = 0.8;
    for (let j = 1; j < rows; j++) {
      const p = lerp2(rA, eA, j / rows), q = lerp2(rB, eB, j / rows);
      ctx.beginPath(); ctx.moveTo(p[0], p[1] - 1); ctx.lineTo(q[0], q[1] - 1); ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Tejado a dos aguas con material de verdad. La paja lleva alero grueso y
 * caballete de bálago; la teja, hiladas y caballete de cumbrera.
 */
function roofOn(ctx, x, y, w, d, base, rh, c1, c2, c3, thatch) {
  const P = (u, v, hh = base) => { const p = iso(x, y, u, v); return [p[0], p[1] - hh]; };
  const ov = thatch ? 0.13 : 0.1; // vuelo del alero
  const r0 = P(0, d / 2, base + rh), r1 = P(w, d / 2, base + rh);
  const bl = P(-ov, -ov), br = P(w + ov, -ov);
  const fl = P(-ov, d + ov), fr = P(w + ov, d + ov);
  poly(ctx, [bl, br, r1, r0], c1);                 // faldón trasero
  poly(ctx, [bl, fl, r0], c3);                     // hastial izquierdo
  poly(ctx, [br, fr, r1], c3);                     // hastial derecho
  if (thatch) {
    // El hastial es el corte de la paja: se abre en abanico desde la cumbrera.
    ctx.strokeStyle = shade(c3, -0.16); ctx.lineWidth = 1.4; ctx.lineCap = 'butt';
    for (const [apex, e0, e1] of [[r0, bl, fl], [r1, br, fr]]) {
      for (let i = 1; i < 4; i++) {
        const q = lerp2(e0, e1, i / 4);
        ctx.beginPath(); ctx.moveTo(apex[0], apex[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      }
    }
  }
  poly(ctx, [r0, r1, fr, fl], c2);                 // faldón delantero
  slopeTexture(ctx, r0, r1, bl, br, c1, thatch);
  slopeTexture(ctx, r0, r1, fl, fr, c2, thatch);
  if (thatch) {
    // Canto del alero: la paja tiene un palmo de grueso y se corta desigual.
    const th = 3.4;
    const pts = [fl, fr];
    poly(ctx, [pts[0], pts[1], [pts[1][0], pts[1][1] + th], [pts[0][0], pts[0][1] + th]], shade(c2, -0.2));
    ctx.strokeStyle = shade(c2, -0.34); ctx.lineWidth = 0.9; ctx.lineCap = 'butt';
    const n = Math.max(3, Math.round(Math.hypot(fr[0] - fl[0], fr[1] - fl[1]) / 5));
    for (let i = 1; i < n; i++) {
      const p = lerp2(fl, fr, i / n);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] + (i % 2 ? 1 : 0.4)); ctx.lineTo(p[0], p[1] + th);
      ctx.stroke();
    }
    // Caballete: un rollo de paja atado sobre la cumbrera.
    ctx.strokeStyle = shade(c2, 0.16); ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
    ctx.strokeStyle = shade(c2, -0.26); ctx.lineWidth = 0.9; ctx.lineCap = 'butt';
    for (let i = 1; i < 4; i++) {
      const p = lerp2(r0, r1, i / 4);
      ctx.beginPath(); ctx.moveTo(p[0], p[1] - 2); ctx.lineTo(p[0], p[1] + 2); ctx.stroke();
    }
  } else {
    ctx.strokeStyle = shade(c3, 0.12); ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
  }
}

/**
 * Cuerpo de yeso y madera: prisma, zócalo, entramado, cenefa del color del
 * jugador bajo el alero y ventanas. Devuelve las dos fachadas a la vista para
 * que cada edificio les cuelgue lo suyo.
 */
function timberBlock(ctx, x, y, w, d, h, M, o = {}) {
  isoPrism(ctx, x, y, w, d, h, M.wallL, M.wallD, M.wall);
  const p10 = iso(x, y, w, 0), p11 = iso(x, y, w, d), p01 = iso(x, y, 0, d);
  const faces = [
    { a: p01, b: p11, h, wood: M.woodD, band: shade(M.col.dark, 0.06) },  // suroeste, en sombra
    { a: p11, b: p10, h, wood: M.wood, band: M.col.main },                // sureste, a la luz
  ];
  const base = o.plinth === false ? 0 : Math.min(0.3, 5.5 / h);
  for (const f of faces) {
    if (base) plinth(ctx, f.a, f.b, h, base, M.stone, M.stoneD);
    // Cenefa del color del jugador justo bajo el alero: se ve de lejos y dice
    // de quién es el edificio sin mirar la bandera.
    facePanel(ctx, f.a, f.b, h, 0, 0.48, 1, 0.63, f.band);
    timbering(ctx, f.a, f.b, h, base, f.wood);
    if (o.windows !== false) {
      const n = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]) > 52 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        faceWindow(ctx, f.a, f.b, h, (i + 0.5) / n, base + 0.1, f.wood, f.band);
      }
    }
  }
  return faces;
}

/** Barril de duelas con sus aros. */
function barrel(ctx, cx, cy, s, wood, woodD, hoop) {
  poly(ctx, [
    [cx - 2.4 * s, cy - 1 * s], [cx - 3 * s, cy - 4.6 * s], [cx - 2.4 * s, cy - 8.2 * s],
    [cx + 2.4 * s, cy - 8.2 * s], [cx + 3 * s, cy - 4.6 * s], [cx + 2.4 * s, cy - 1 * s],
  ], wood);
  poly(ctx, [
    [cx + 0.8 * s, cy - 1 * s], [cx + 3 * s, cy - 4.6 * s],
    [cx + 2.4 * s, cy - 8.2 * s], [cx + 0.8 * s, cy - 8.2 * s],
  ], woodD);
  ctx.strokeStyle = hoop; ctx.lineWidth = 1 * s; ctx.lineCap = 'butt';
  for (const k of [2.4, 6.6]) {
    ctx.beginPath();
    ctx.moveTo(cx - 2.9 * s, cy - k * s); ctx.lineTo(cx + 2.9 * s, cy - k * s);
    ctx.stroke();
  }
  ctx.fillStyle = shade(wood, 0.14);
  ctx.beginPath();
  ctx.ellipse(cx, cy - 8.2 * s, 2.4 * s, 1 * s, 0, 0, Math.PI * 2); ctx.fill();
}

/** Cajón de tablas. */
function crate(ctx, cx, cy, s, wood, woodD) {
  const p = (u, v, hh) => [cx + (u - v) * 5 * s, cy + (u + v) * 2.5 * s - hh];
  const h = 7 * s;
  poly(ctx, [p(0, 1, 0), p(1, 1, 0), p(1, 1, h), p(0, 1, h)], woodD);
  poly(ctx, [p(1, 1, 0), p(1, 0, 0), p(1, 0, h), p(1, 1, h)], wood);
  poly(ctx, [p(0, 0, h), p(1, 0, h), p(1, 1, h), p(0, 1, h)], shade(wood, 0.16));
  ctx.strokeStyle = woodD; ctx.lineWidth = 0.8; ctx.lineCap = 'butt';
  ctx.beginPath();
  const m0 = p(1, 1, h * 0.55), m1 = p(1, 0, h * 0.55);
  ctx.moveTo(m0[0], m0[1]); ctx.lineTo(m1[0], m1[1]);
  ctx.stroke();
}

/** Mata de hierba o hiedra al pie de un muro. */
function ivy(ctx, cx, cy, r, tone) {
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    ctx.fillStyle = i % 2 ? tone : shade(tone, -0.14);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.3,
      r * 0.62, r * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Sillares: hiladas horizontales con juntas verticales alternas. */
function stoneTexture(ctx, x, y, w, d, h) {
  const p1 = iso(x, y, 0, d), p2 = iso(x, y, w, d), p3 = iso(x, y, w, 0);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  const rows = Math.floor(h / 8);
  for (let i = 1; i <= rows; i++) {
    const yy = -i * 8;
    // Cada hilada lleva su junta en sombra y el canto del sillar a la luz.
    for (const [dy, alpha, color] of [[0, 0.16, '#000'], [1, 0.1, '#fff']]) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1] + yy + dy); ctx.lineTo(p2[0], p2[1] + yy + dy);
      ctx.lineTo(p3[0], p3[1] + yy + dy);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#000';
    for (let k = 0; k <= 2; k++) {
      const t = (k + (i % 2) * 0.5) / 2.5;
      const a = [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
      const b = [p2[0] + (p3[0] - p2[0]) * t, p2[1] + (p3[1] - p2[1]) * t];
      for (const pt of [a, b]) {
        ctx.beginPath();
        ctx.moveTo(pt[0], pt[1] + yy); ctx.lineTo(pt[0], pt[1] + yy + 8);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Almenas sobre el borde superior de una huella cuadrada. */
function battlements(ctx, x, y, w, d, h, top, left, right) {
  const n = Math.max(2, Math.round(w * 2));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.15) * (w / n);
    const p = iso(x, y, u, d);
    isoPrism(ctx, p[0], p[1] - h, w / n * 0.6, 0.28, 7, top, left, right);
  }
  for (let i = 0; i < n; i++) {
    const v = (i + 0.15) * (d / n);
    const p = iso(x, y, w, v);
    isoPrism(ctx, p[0], p[1] - h, 0.28, d / n * 0.6, 7, top, left, right);
  }
}

/*
 * Qué edificios llevan paja y cuáles teja. La paja es de aldea (casas, molino,
 * cobertizos) y la teja, de obra (centro urbano, cuarteles, herrería): con eso
 * el bando civil y el militar se distinguen de lejos.
 */
const THATCHED = { house: 1, mill: 1, lumbercamp: 1, miningcamp: 1 };

function drawBuilding(ctx, type, colorIdx, x, y) {
  const col = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
  const B = BUILDINGS[type];
  const s = B.size;
  const L = look('building', type);
  // Cada material se pinta en tres tonos: cara al sol, cara base y sombra.
  const [wallL, wall, wallD] = ramp(L.wall || '#d8cba6');
  const [woodL, wood, woodD] = ramp(L.wood || '#8a6234');
  const [roofL, roofM, roofD] = ramp(L.roof || '#a8452f');
  const [stoneL, stone, stoneD] = ramp(L.stone || '#8f8a80');
  const thatch = !!THATCHED[type];
  const M = { col, wall, wallL, wallD, wood, woodL, woodD, stone, stoneL, stoneD };
  const green = L.ivy || '#3f6b32';

  switch (type) {
    case 'house': {
      const w = s * 0.82, h = 18;
      const faces = timberBlock(ctx, x, y, w, w, h, M);
      roofOn(ctx, x, y, w, w, h, 12, roofD, roofM, roofL, thatch);
      faceDoor(ctx, faces[1].a, faces[1].b, h, 0.62, 0.72, wood, woodD, L.door);
      // Trastos apoyados en la pared y hierba al pie.
      const c = iso(x, y, w * 0.1, w + 0.34);
      barrel(ctx, c[0] - 3, c[1], 0.72, wood, woodD, stoneD);
      ivy(ctx, c[0] + 16, c[1] + 3, 5, green);
      ivy(ctx, iso(x, y, w + 0.3, w * 0.4)[0], iso(x, y, w + 0.3, w * 0.4)[1], 4.4, green);
      bannerPole(ctx, x - w * HW + 3, y + w * HH - 1, 36, col);
      break;
    }
    case 'towncenter': {
      // Plataforma de piedra, sala central y pórtico con pilares de madera.
      const [baseL, baseM, baseD] = ramp(L.base);
      isoPrism(ctx, x, y, s, s, 7, baseL, baseD, baseM);
      stoneTexture(ctx, x, y, s, s, 7);
      // Cuerpo del edificio, algo más pequeño que la huella.
      const inner = iso(x, y, 0.55, 0.55);
      timberBlock(ctx, inner[0], inner[1] - 7, s - 1.1, s - 1.1, 22, M);
      // Pilares en las cuatro esquinas del pórtico.
      for (const [u, v] of [[0.15, 0.15], [s - 0.65, 0.15], [0.15, s - 0.65], [s - 0.65, s - 0.65]]) {
        const p = iso(x, y, u, v);
        isoPrism(ctx, p[0], p[1] - 7, 0.5, 0.5, 30, woodL, woodD, wood);
        // Zapata: la pieza que reparte la carga del alero sobre el pilar.
        isoPrism(ctx, p[0], p[1] - 36, 0.62, 0.62, 3, woodL, woodD, wood);
      }
      // Tejado bajo y ancho, muy distinto al de una casa.
      ctx.save();
      ctx.translate(0, -37);
      roofOn(ctx, iso(x, y, 0.28, 0.28)[0], iso(x, y, 0.28, 0.28)[1], s - 0.56, s - 0.56, 0, 13,
        roofD, roofM, roofL, false);
      ctx.restore();
      // Portalón de medio punto.
      const door = iso(x, y, s / 2, s - 0.55);
      ctx.fillStyle = L.door;
      ctx.beginPath();
      ctx.moveTo(door[0] - 7, door[1] - 7); ctx.lineTo(door[0] - 7, door[1] - 20);
      ctx.quadraticCurveTo(door[0], door[1] - 28, door[0] + 7, door[1] - 20);
      ctx.lineTo(door[0] + 7, door[1] - 7); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = wood; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = woodD; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(door[0], door[1] - 7); ctx.lineTo(door[0], door[1] - 25); ctx.stroke();
      // Fardos junto a la escalinata.
      const yard = iso(x, y, 0.4, s + 0.2);
      crate(ctx, yard[0], yard[1] - 2, 0.9, wood, woodD);
      barrel(ctx, yard[0] + 15, yard[1] + 1, 0.8, wood, woodD, stoneD);
      bannerPole(ctx, x - s * HW + 10, y + s * HH - 8, 26, col);
      bannerPole(ctx, x + s * HW - 10, y + s * HH - 8, 26, col);
      break;
    }
    case 'mill': {
      const w = s * 0.7, h = 20;
      const faces = timberBlock(ctx, x + 2, y, w, w, h, M);
      roofOn(ctx, x + 2, y, w, w, h, 10, roofD, roofM, roofL, thatch);
      faceDoor(ctx, faces[0].a, faces[0].b, h, 0.62, 0.62, wood, woodD, '#3b2a17');
      // Aspas, clavadas en el hastial que da a la cámara.
      const c0 = faceAt(faces[1].a, faces[1].b, h, 0.5, 0.52);
      ctx.save();
      ctx.translate(c0[0], c0[1]);
      ctx.strokeStyle = wood; ctx.lineWidth = 2.4;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); ctx.stroke();
      }
      // La tela va translúcida; se multiplica la opacidad en vez de fijarla
      // para no pisar el desvanecido de los edificios a medio construir.
      ctx.fillStyle = L.accent;
      ctx.globalAlpha *= 0.75;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 8, Math.sin(a) * 8, 4.2, 2.2, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      // Sacos de grano a la puerta.
      const yard = iso(x + 2, y, w * 0.94, w + 0.12);
      for (const [dx, dy, r] of [[0, 0, 4.6], [9, 3, 4]]) {
        ctx.fillStyle = L.accent;
        ctx.beginPath();
        ctx.ellipse(yard[0] + dx, yard[1] + dy - r * 0.6, r * 0.8, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shade(L.accent, -0.18);
        ctx.beginPath();
        ctx.ellipse(yard[0] + dx + r * 0.4, yard[1] + dy - r * 0.5, r * 0.35, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'lumbercamp': case 'miningcamp': {
      const w = s * 0.55, h = 12;
      // Cobertizo abierto: cuatro postes, sin muros que valgan.
      isoPrism(ctx, x + 3, y + 2, w, w, h, woodL, woodD, wood);
      roofOn(ctx, x + 3, y + 2, w, w, h, 6, roofD, roofM, roofL, thatch);
      if (type === 'lumbercamp') {
        for (let i = 0; i < 3; i++) {
          const p = iso(x, y, 0.95 + i * 0.16, 1.35);
          const tone = i % 2 ? shade(L.accent, -0.1) : L.accent;
          ctx.fillStyle = tone;
          ctx.fillRect(p[0] - 12, p[1] - 6 - i * 4, 24, 5);
          ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1;
          ctx.strokeRect(p[0] - 12, p[1] - 6 - i * 4, 24, 5);
          // Testa del tronco, con sus anillos.
          ctx.fillStyle = shade(tone, 0.2);
          ctx.beginPath();
          ctx.ellipse(p[0] - 12, p[1] - 3.5 - i * 4, 1.8, 2.5, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = shade(tone, -0.3); ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.ellipse(p[0] - 12, p[1] - 3.5 - i * 4, 0.9, 1.3, 0, 0, Math.PI * 2); ctx.stroke();
        }
      } else {
        const p = iso(x, y, 1.05, 1.3);
        for (const [dx, dy, r] of [[-8, 0, 6], [4, -3, 7], [10, 2, 5]]) {
          ctx.beginPath(); ctx.ellipse(p[0] + dx, p[1] + dy, r, r * 0.75, 0, 0, Math.PI * 2);
          ctx.fillStyle = L.accent; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = shade(L.accent, 0.22);
          ctx.beginPath();
          ctx.ellipse(p[0] + dx - r * 0.3, p[1] + dy - r * 0.3, r * 0.3, r * 0.22, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      bannerPole(ctx, x - s * 0.42 * HW, y + s * 0.52 * HH, 26, col);
      break;
    }
    case 'farm': {
      const [, soil, soilD] = ramp(L.soil);
      const [, crop, cropD] = ramp(L.crop);
      const p00 = iso(x, y, 0, 0), p10 = iso(x, y, s, 0), p11 = iso(x, y, s, s), p01 = iso(x, y, 0, s);
      poly(ctx, [p00, p10, p11, p01], soil, soilD);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p00[0], p00[1]); ctx.lineTo(p10[0], p10[1]); ctx.lineTo(p11[0], p11[1]); ctx.lineTo(p01[0], p01[1]);
      ctx.closePath(); ctx.clip();
      ctx.lineCap = 'butt';
      for (let i = 0; i <= 8; i++) {
        const a = iso(x, y, (i / 8) * s, 0), b = iso(x, y, (i / 8) * s, s);
        // Cada surco lleva su lomo iluminado y su besana en sombra.
        ctx.strokeStyle = i % 2 ? crop : cropD;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.strokeStyle = i % 2 ? shade(crop, 0.16) : shade(cropD, -0.12);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a[0] - 1, a[1]); ctx.lineTo(b[0] - 1, b[1]); ctx.stroke();
      }
      ctx.restore();
      // Cerca de estacas alrededor de la parcela.
      poly(ctx, [p00, p10, p11, p01], null, L.fence);
      ctx.fillStyle = L.fence;
      for (let i = 0; i <= 6; i++) {
        for (const [e0, e1] of [[p01, p11], [p11, p10]]) {
          const p = lerp2(e0, e1, i / 6);
          ctx.fillRect(p[0] - 0.9, p[1] - 5, 1.8, 5);
        }
      }
      break;
    }
    case 'barracks': case 'archeryrange': case 'stable': case 'siegeworkshop': {
      // Cada edificio militar lleva su propio color de tejado para reconocerlo de un vistazo.
      const w = s - 0.5, h = 24;
      const faces = timberBlock(ctx, x + 2, y + 1, w, w, h, M);
      roofOn(ctx, x + 2, y + 1, w, w, h, 12, roofD, roofM, roofL, thatch);
      faceDoor(ctx, faces[0].a, faces[0].b, h, 0.5, 0.78, wood, woodD, L.door);
      // Emblema en el hastial que da a la cámara, como el rótulo de un gremio.
      const gable = iso(x + 2, y + 1, w + 0.14, w / 2);
      ctx.save();
      ctx.translate(gable[0], gable[1] - h - 5);
      ctx.strokeStyle = L.accent; ctx.lineWidth = 2; ctx.lineCap = 'round';
      if (type === 'barracks') {
        ctx.beginPath(); ctx.moveTo(-5, 5); ctx.lineTo(5, -6); ctx.moveTo(5, 5); ctx.lineTo(-5, -6); ctx.stroke();
      } else if (type === 'archeryrange') {
        ctx.beginPath(); ctx.arc(-1, 0, 6, -1.2, 1.2); ctx.moveTo(-3, -6); ctx.lineTo(-3, 6); ctx.stroke();
      } else if (type === 'stable') {
        ctx.beginPath(); ctx.arc(0, 0, 5, 0.4, 5.4); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(-6, 5); ctx.lineTo(6, -5); ctx.moveTo(2, -6); ctx.lineTo(7, -1); ctx.stroke();
      }
      ctx.restore();
      // Pertrechos junto a la puerta.
      const yard = iso(x + 2, y + 1, w + 0.42, w * 0.55);
      crate(ctx, yard[0], yard[1], 0.8, wood, woodD);
      barrel(ctx, yard[0] + 3, yard[1] + 7, 0.7, wood, woodD, stoneD);
      bannerPole(ctx, x - w * HW + 5, y + w * HH, 42, col);
      break;
    }
    case 'blacksmith': {
      const [chL, chM, chD] = ramp(L.chimney);
      const w = s * 0.8, h = 18;
      const faces = timberBlock(ctx, x + 2, y + 1, w, w, h, M, { windows: false });
      roofOn(ctx, x + 2, y + 1, w, w, h, 9, roofD, roofM, roofL, thatch);
      const ch = iso(x + 2, y + 1, s * 0.15, s * 0.15);
      isoPrism(ctx, ch[0], ch[1] - 20, 0.35, 0.35, 18, chL, chD, chM);
      stoneTexture(ctx, ch[0], ch[1] - 20, 0.35, 0.35, 18);
      ctx.fillStyle = 'rgba(210,210,210,.35)';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(ch[0] + i * 2 - 2, ch[1] - 44 - i * 8, 4 + i * 2, 0, Math.PI * 2); ctx.fill();
      }
      // Boca de la fragua, encendida, y el yunque a la puerta.
      const fo = faceAt(faces[1].a, faces[1].b, h, 0.5, 0.18);
      ctx.fillStyle = '#2a2119';
      ctx.fillRect(fo[0] - 5, fo[1] - 9, 10, 9);
      ctx.fillStyle = L.accent;
      ctx.fillRect(fo[0] - 3.5, fo[1] - 7, 7, 6);
      ctx.fillStyle = shade(L.accent, 0.3);
      ctx.fillRect(fo[0] - 2, fo[1] - 5.5, 4, 3.5);
      const anv = iso(x, y, 0.72, s * 0.82);
      poly(ctx, [[anv[0] - 5, anv[1] - 6], [anv[0] + 5, anv[1] - 6],
        [anv[0] + 3, anv[1] - 4], [anv[0] - 3, anv[1] - 4]], chM);
      ctx.fillStyle = chD; ctx.fillRect(anv[0] - 1.6, anv[1] - 4, 3.2, 4);
      bannerPole(ctx, x - s * 0.5 * HW, y + s * 0.5 * HH, 34, col);
      break;
    }
    case 'market': {
      // Plaza empedrada con puestos de distintos colores.
      const [grL, grM, grD] = ramp(L.ground);
      isoPrism(ctx, x, y, s, s, 3, grL, grD, grM);
      stoneTexture(ctx, x, y, s, s, 3);
      const stalls = [[0.5, 0.4, L.stall1], [1.9, 0.6, L.stall2], [0.7, 1.9, L.stall3], [2.0, 2.0, L.stall4]];
      for (const [u, v, tone] of stalls) {
        const p = iso(x, y, u, v);
        const py = p[1] - 3;
        // Mostrador
        poly(ctx, [[p[0] - 13, py - 2], [p[0], py + 5], [p[0] + 13, py - 2], [p[0], py - 9]],
          L.counter, shade(L.counter, -0.34));
        // Postes y toldo a rayas
        ctx.fillStyle = wood;
        ctx.fillRect(p[0] - 12, py - 16, 2, 14); ctx.fillRect(p[0] + 10, py - 16, 2, 14);
        poly(ctx, [[p[0] - 15, py - 16], [p[0], py - 22], [p[0] + 15, py - 16], [p[0], py - 11]], tone, 'rgba(0,0,0,.25)');
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p[0] - 15, py - 16); ctx.lineTo(p[0], py - 22);
        ctx.lineTo(p[0] + 15, py - 16); ctx.lineTo(p[0], py - 11);
        ctx.closePath(); ctx.clip();
        ctx.strokeStyle = shade(tone, 0.28); ctx.lineWidth = 2.4; ctx.lineCap = 'butt';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(p[0] + i * 6, py - 22); ctx.lineTo(p[0] + i * 6 - 3, py - 10);
          ctx.stroke();
        }
        ctx.restore();
        // Género sobre el mostrador
        ctx.fillStyle = shade(tone, 0.25);
        ctx.beginPath(); ctx.arc(p[0] - 3, py - 5, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(p[0] + 3, py - 6, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      const yard = iso(x, y, s * 0.5, s * 0.05);
      crate(ctx, yard[0] + 14, yard[1] + 2, 0.75, wood, woodD);
      bannerPole(ctx, x - s * HW + 8, y + s * HH - 6, 22, col);
      break;
    }
    case 'tower': {
      const H = 52;
      // Zócalo ligeramente más ancho que el fuste.
      isoPrism(ctx, x, y, 1, 1, 8, wallL, wallD, wall);
      stoneTexture(ctx, x, y, 1, 1, 8);
      const shaft = iso(x, y, 0.1, 0.1);
      isoPrism(ctx, shaft[0], shaft[1] - 8, 0.8, 0.8, H, wallL, wallD, wall);
      stoneTexture(ctx, shaft[0], shaft[1] - 8, 0.8, 0.8, H);
      // Saledizo sobre canes de madera y almenas.
      const topY = 8 + H;
      const corb = iso(x, y, 0.5, 1);
      ctx.fillStyle = woodD;
      for (let i = -1; i <= 1; i++) ctx.fillRect(corb[0] + i * 8 - 1.4, corb[1] - topY - 2, 2.8, 4);
      isoPrism(ctx, x, y - topY, 1, 1, 6, shade(wallL, 0.05), wallD, wall);
      battlements(ctx, x, y - topY - 6, 1, 1, 0, shade(wallL, 0.08), wallD, wall);
      // Aspillera y puerta.
      const face = iso(x, y, 0.5, 1);
      ctx.fillStyle = shade(L.door, -0.25);
      ctx.fillRect(face[0] - 2, face[1] - topY + 6, 4, 9);
      ctx.fillStyle = L.door;
      ctx.fillRect(face[0] - 4, face[1] - 12, 8, 10);
      ctx.strokeStyle = wood; ctx.lineWidth = 1.4;
      ctx.strokeRect(face[0] - 4, face[1] - 12, 8, 10);
      ctx.fillStyle = col.main;
      ctx.fillRect(face[0] - 3.5, face[1] - topY - 4, 7, 7);
      break;
    }
    case 'castle': {
      isoPrism(ctx, x + 0.1 * HW, y + 0.2 * HH, s - 0.2, s - 0.2, 36, wallL, wallD, wall);
      stoneTexture(ctx, x + 0.1 * HW, y + 0.2 * HH, s - 0.2, s - 0.2, 36);
      ctx.save(); ctx.translate(0, -36);
      isoPrism(ctx, x + 0.1 * HW, y + 0.2 * HH, s - 0.2, s - 0.2, 7, shade(wallL, 0.06), wallD, wall);
      ctx.restore();
      // Torreones en las cuatro esquinas
      const corners = [[0, 0], [s - 1.1, 0], [0, s - 1.1], [s - 1.1, s - 1.1]];
      for (const [u, v] of corners) {
        const p = iso(x, y, u, v);
        isoPrism(ctx, p[0], p[1], 1.1, 1.1, 56, wallL, wallD, wall);
        stoneTexture(ctx, p[0], p[1], 1.1, 1.1, 56);
        ctx.save(); ctx.translate(0, -56);
        isoPrism(ctx, p[0] - 0.08 * HW, p[1], 1.25, 1.25, 7, shade(wallL, 0.08), wallD, wall);
        ctx.restore();
      }
      const gate = iso(x, y, s / 2, s - 0.2);
      ctx.fillStyle = L.door;
      ctx.beginPath();
      ctx.moveTo(gate[0] - 7, gate[1] - 4); ctx.lineTo(gate[0] - 7, gate[1] - 18);
      ctx.quadraticCurveTo(gate[0], gate[1] - 26, gate[0] + 7, gate[1] - 18);
      ctx.lineTo(gate[0] + 7, gate[1] - 4); ctx.closePath(); ctx.fill();
      // Rastrillo sobre el portalón.
      ctx.strokeStyle = shade(L.door, 0.3); ctx.lineWidth = 1; ctx.lineCap = 'butt';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(gate[0] + i * 4, gate[1] - 5); ctx.lineTo(gate[0] + i * 4, gate[1] - 20);
        ctx.stroke();
      }
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(gate[0] - 6, gate[1] - 5 - i * 6); ctx.lineTo(gate[0] + 6, gate[1] - 5 - i * 6);
        ctx.stroke();
      }
      bannerPole(ctx, iso(x, y, 0, s - 1.1)[0] - 2, iso(x, y, 0, s - 1.1)[1] - 56, 26, col);
      bannerPole(ctx, iso(x, y, s - 1.1, 0)[0] + 2, iso(x, y, s - 1.1, 0)[1] - 56, 26, col);
      break;
    }
    case 'wall': {
      isoPrism(ctx, x, y, 1, 1, 26, wallL, wallD, wall);
      stoneTexture(ctx, x, y, 1, 1, 26);
      isoPrism(ctx, x, y - 26, 1, 1, 4, shade(wallL, 0.06), wallD, wall);
      battlements(ctx, x, y - 30, 1, 1, 0, shade(wallL, 0.1), wallD, wall);
      break;
    }
    default:
      isoPrism(ctx, x, y, s, s, 20, wallL, wallD, wall);
  }
}

/** Medidas del lienzo de un edificio y dónde cae su anclaje dentro de él. */
function buildingGeom(type) {
  const size = BUILDINGS[type].size;
  const pad = 14;
  const topH = type === 'castle' ? 96 : type === 'tower' ? 62 : type === 'towncenter' ? 74 : 52;
  return {
    size, pad, topH,
    w: size * TILE_W + pad * 2,
    h: pad + topH + size * TILE_H + pad,
    ox: size * HW + pad,
    oy: pad + topH,
  };
}

/** stage: 0 cimientos, 1 a medio construir, 2 terminado. */
export function buildingSprite(type, colorIdx, stage = 2) {
  const key = `${type}|${colorIdx}|${stage}`;
  let s = buildCache.get(key);
  if (s) return s;
  const G = buildingGeom(type);
  const c = makeCanvas(G.w * quality, G.h * quality);
  const ctx = c.getContext('2d');
  ctx.scale(quality, quality);
  drawBuildingStage(ctx, type, colorIdx, stage, G.ox, G.oy, G);
  s = { canvas: c, ox: G.ox, oy: G.oy, w: G.w, h: G.h };
  buildCache.set(key, s);
  return s;
}

/** Pinta un edificio directamente, con (x, y) en la esquina de su huella. */
export function paintBuilding(ctx, x, y, type, colorIdx, stage = 2) {
  drawBuildingStage(ctx, type, colorIdx, stage, x, y, buildingGeom(type));
}

function drawBuildingStage(ctx, type, colorIdx, stage, ox, oy, G) {
  const { size, topH, w, h } = G;

  if (stage === 0) {
    // Cimientos: estacas y una plataforma de tierra.
    const p00 = iso(ox, oy, 0, 0), p10 = iso(ox, oy, size, 0), p11 = iso(ox, oy, size, size), p01 = iso(ox, oy, 0, size);
    poly(ctx, [p00, p10, p11, p01], 'rgba(120,96,60,.55)', 'rgba(80,60,34,.9)');
    ctx.setLineDash([4, 3]);
    poly(ctx, [p00, p10, p11, p01], null, 'rgba(255,240,200,.5)');
    ctx.setLineDash([]);
    for (const [u, v] of [[0, 0], [size, 0], [size, size], [0, size]]) {
      const p = iso(ox, oy, u, v);
      ctx.fillStyle = '#7a5c33';
      ctx.fillRect(p[0] - 1.5, p[1] - 10, 3, 10);
    }
  } else if (stage === 1) {
    ctx.save();
    ctx.beginPath();
    // El recorte va sobre la caja del sprite, esté donde esté su anclaje.
    ctx.rect(ox - G.ox, oy - topH * 0.45, w, h);
    ctx.clip();
    ctx.globalAlpha = 0.92;
    drawBuilding(ctx, type, colorIdx, ox, oy);
    ctx.restore();
    // Andamios
    ctx.strokeStyle = '#8a6a3c'; ctx.lineWidth = 2;
    for (const [u, v] of [[0.1, 0.1], [size - 0.1, 0.1], [0.1, size - 0.1], [size - 0.1, size - 0.1]]) {
      const p = iso(ox, oy, u, v);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - topH * 0.5); ctx.stroke();
    }
  } else {
    drawBuilding(ctx, type, colorIdx, ox, oy);
  }
}

// --- Iconos para la interfaz ------------------------------------------------

const iconCache = new Map();

/** Emblemas vectoriales para las tecnologías y los avances de edad. */
function techGlyph(ctx, sym) {
  ctx.save();
  ctx.translate(28, 28);
  ctx.strokeStyle = '#2e2413';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const metal = '#e8e4da', metalD = '#9a978f', woodC = '#8a6234';
  switch (sym) {
    case 'sword':
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(0, -17); ctx.lineTo(4, -11); ctx.lineTo(4, 6); ctx.lineTo(-4, 6); ctx.lineTo(-4, -11);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = woodC;
      ctx.fillRect(-10, 6, 20, 4);
      ctx.fillRect(-2.5, 10, 5, 8);
      ctx.strokeRect(-10, 6, 20, 4);
      break;
    case 'armor':
      ctx.fillStyle = '#b9bcc4';
      ctx.beginPath();
      ctx.moveTo(0, -17); ctx.lineTo(15, -11); ctx.lineTo(13, 6);
      ctx.quadraticCurveTo(6, 15, 0, 18);
      ctx.quadraticCurveTo(-6, 15, -13, 6); ctx.lineTo(-15, -11);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#6b7078'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -14); ctx.lineTo(0, 15); ctx.moveTo(-12, -3); ctx.lineTo(12, -3);
      ctx.stroke();
      break;
    case 'arrow':
      ctx.strokeStyle = '#7a4f28'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-13, 13); ctx.lineTo(9, -9); ctx.stroke();
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(16, -16); ctx.lineTo(6, -12); ctx.lineTo(12, -6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e8e4d8'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-13, 13); ctx.lineTo(-6, 15); ctx.moveTo(-13, 13); ctx.lineTo(-15, 6);
      ctx.stroke();
      break;
    case 'cart':
      ctx.fillStyle = woodC;
      ctx.fillRect(-14, -10, 22, 11);
      ctx.strokeRect(-14, -10, 22, 11);
      ctx.beginPath(); ctx.arc(-6, 7, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#5a4028'; ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#2e2413';
      ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(16, -9); ctx.stroke();
      break;
    case 'loom':
      ctx.fillStyle = '#d8cba6';
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 13, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#a8905c'; ctx.lineWidth = 1.5;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, 11 - Math.abs(i) * 3, 13, 0.3 + i * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'tower':
      ctx.fillStyle = '#b0b0a8';
      ctx.fillRect(-11, -8, 22, 24);
      ctx.strokeRect(-11, -8, 22, 24);
      for (let i = -1; i <= 1; i++) ctx.fillRect(i * 9 - 3.5, -16, 7, 8);
      ctx.strokeRect(-11, -16, 22, 8);
      ctx.fillStyle = '#3b2a17';
      ctx.fillRect(-4, 6, 8, 10);
      break;
    default: { // números romanos de la edad
      ctx.fillStyle = '#3a2c14';
      ctx.font = 'bold 26px Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(sym, 0, 2);
    }
  }
  ctx.restore();
}

const TECH_SYMBOLS = {
  Forja: 'sword', 'Fundición de hierro': 'sword', 'Armadura de escamas': 'armor',
  'Cota de malla': 'armor', 'Armadura acolchada': 'armor', Emplumado: 'arrow',
  'Punta de bodkin': 'arrow', Telar: 'loom', Carretilla: 'cart', 'Carretilla de mano': 'cart',
  Almenas: 'tower', Oscura: 'I', Feudal: 'II', Castillos: 'III', Imperial: 'IV',
};

/** Caja envolvente de los píxeles no transparentes (para encuadrar iconos). */
const boundsCache = new Map();
function tightBounds(canvas, key) {
  if (boundsCache.has(key)) return boundsCache.get(key);
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 12) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  } catch { /* lienzo "manchado": se usa el tamaño completo */ }
  const b = x1 <= x0 || y1 <= y0
    ? { x: 0, y: 0, w, h }
    : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  boundsCache.set(key, b);
  return b;
}

export function iconFor(kind, type, colorIdx = 0) {
  const key = `${kind}|${type}|${colorIdx}`;
  let url = iconCache.get(key);
  if (url) return url;
  const c = makeCanvas(56, 56);
  const ctx = c.getContext('2d');
  if (kind === 'unit') {
    // Retrato de medio cuerpo: así se distinguen el yelmo y el arma de cada unidad.
    const s = unitSprite(type, colorIdx, 1, 0, false);
    const b = tightBounds(s.canvas, `u${key}`);
    const cls = UNITS[type].class;
    const crop = cls === 'siege' ? 1 : 0.66;
    const ch = Math.max(8, b.h * crop);
    const sc = Math.min(54 / b.w, 52 / ch);
    ctx.drawImage(s.canvas, b.x, b.y, b.w, ch,
      28 - (b.w * sc) / 2, 30 - (ch * sc) / 2, b.w * sc, ch * sc);
  } else if (kind === 'building') {
    const s = buildingSprite(type, colorIdx, 2);
    const b = tightBounds(s.canvas, `b${key}`);
    const sc = Math.min(52 / b.w, 50 / b.h);
    ctx.drawImage(s.canvas, b.x, b.y, b.w, b.h,
      28 - (b.w * sc) / 2, 54 - b.h * sc, b.w * sc, b.h * sc);
  } else if (kind === 'tech') {
    const grad = ctx.createLinearGradient(0, 0, 0, 56);
    grad.addColorStop(0, '#e2d3a6'); grad.addColorStop(1, '#bda87a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(6, 4); ctx.lineTo(50, 4); ctx.lineTo(50, 40);
    ctx.quadraticCurveTo(28, 56, 6, 40);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7a5f36'; ctx.lineWidth = 2; ctx.stroke();
    techGlyph(ctx, TECH_SYMBOLS[type] || (type || '?').slice(0, 1).toUpperCase());
  } else if (kind === 'res') {
    const cols = { food: ['#ff8b76', '#b8332a'], wood: ['#b98a4d', '#6b4a24'], gold: ['#ffe58a', '#c9971a'], stone: ['#dcdcd6', '#85857e'] }[type] || ['#aaa', '#666'];
    const grad = ctx.createRadialGradient(22, 20, 2, 28, 28, 20);
    grad.addColorStop(0, cols[0]); grad.addColorStop(1, cols[1]);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(28, 28, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
  }
  url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

/**
 * Vacía todos los cachés de dibujo. Hay que llamarla cuando se cambian datos
 * del juego desde el catálogo: los sprites se guardan por tipo y color, así
 * que si cambia el tamaño de un edificio o el color de un terreno hay que
 * volver a dibujarlos.
 */
export function clearSpriteCaches() {
  tileCache.clear();
  tileSheets.clear();
  resCache.clear();
  unitCache.clear();
  palCache.clear();
  buildCache.clear();
  iconCache.clear();
  boundsCache.clear();
}

export { HW, HH };
