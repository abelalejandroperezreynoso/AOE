// Sprites del juego. Las unidades, los edificios y los recursos son imágenes:
// atlas PNG en assets/sprites/ con un índice (indice.json) que dice dónde está
// cada sprite y por dónde se ancla. Se cargan por color de jugador, sólo los
// que hacen falta, y la partida no empieza hasta tenerlos (`prepareSprites`).
// El terreno se sigue pintando con la API de Canvas.

import { TILE_W, TILE_H, UNITS } from './config.js';
import { shade, mix } from './utils.js';

const HW = TILE_W / 2; // 32
const HH = TILE_H / 2; // 16

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
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
  // Si el terreno tiene losetas dibujadas (la hierba), va la suya.
  if (drawTerrainBitmap(ctx, sx, sy, terrain, rnd)) return;
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
 * Losetas dibujadas: las que trae terreno.png, una por variante, recortadas al
 * rombo y un poco más grandes para solapar con las vecinas. Se pintan con el
 * centro de su rombo en el del rombo del juego.
 */
const terrCache = new Map();

/**
 * Una variante de terreno como sprite (lienzo, medidas en píxeles de mundo y
 * ancla en el centro del rombo), para enseñarla en el catálogo: la loseta
 * dibujada si la hay, o el rombo de código pintado a la resolución de los
 * sprites.
 */
export function terrainSprite(terrain, variant = 0) {
  if (terrainHasBitmap(terrain)) {
    const key = `${terrain}|${variant}`;
    let s = terrCache.get(key);
    if (!s) { s = slice(`t|${key}`); if (s) terrCache.set(key, s); }
    return s;
  }
  const res = (index && index.res) || 2;
  const c = makeCanvas((TILE_W + 2) * res, (TILE_H + 2) * res);
  const ctx = c.getContext('2d');
  ctx.scale(res, res);
  drawTerrainTile(ctx, HW + 1, 1, terrain, (variant + 0.5) / TILE_VARIANTS);
  return { canvas: c, w: TILE_W + 2, h: TILE_H + 2, ox: HW + 1, oy: HH + 1 };
}

/** ¿Tiene este terreno losetas dibujadas? (el catálogo no ofrece su color). */
export function terrainHasBitmap(terrain) {
  return !!(index && index.sprites[`t|${terrain}|0`]);
}

function drawTerrainBitmap(ctx, sx, sy, terrain, rnd) {
  if (!terrainHasBitmap(terrain)) return false;
  const i = Math.min(TILE_VARIANTS - 1, Math.floor(rnd * TILE_VARIANTS));
  const key = `${terrain}|${i}`;
  let s = terrCache.get(key);
  if (!s) { s = slice(`t|${key}`); if (!s) return false; terrCache.set(key, s); }
  // Al reducir, suavizado; al ampliar, píxel visto, como el resto de sprites.
  const escala = ctx.getTransform().a * (s.w / s.canvas.width);
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = escala < 1;
  ctx.drawImage(s.canvas, sx - s.ox, sy + HH - s.oy, s.w, s.h);
  ctx.imageSmoothingEnabled = sm;
  return true;
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
 * `quality` es cuántos píxeles se hornean por píxel de mundo para el TERRENO,
 * que se sigue dibujando de forma vectorial y gana nitidez al acercar la
 * cámara. Los sprites de los atlas no dependen de ella: vienen horneados
 * a resolución fija (2×) y, si la cámara amplía más, se ven sus píxeles, que es
 * exactamente como envejecía el clásico al acercarse.
 */
let quality = 1;

export function spriteQuality() { return quality; }

/** Cambiarla invalida los rombos horneados del terreno; los sprites valen. */
export function setSpriteQuality(q) {
  q = Math.max(1, Math.min(3, Math.round(q * 2) / 2));
  if (q === quality) return;
  quality = q;
  tileSheets.clear();
}

/**
 * Dibuja un sprite de la caché. Su lienzo puede estar a más resolución que el
 * mundo, pero sus medidas y anclaje vienen en píxeles de mundo, así que hay que
 * darle a `drawImage` el tamaño de destino.
 */
export function drawSprite(ctx, s, x, y, scale = 1) {
  if (!s) return;
  // Un sprite de más resolución que la de serie (las unidades dibujadas a
  // mano) se reduce con filtro, que conserva su detalle; sólo si se amplía más
  // allá de su resolución se copia a píxel visto.
  if (s.res > 2) {
    const m = ctx.getTransform();
    const sm = ctx.imageSmoothingEnabled, q = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = Math.hypot(m.a, m.b) * scale < s.res * 1.01;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s.canvas, x - s.ox * scale, y - s.oy * scale, s.w * scale, s.h * scale);
    ctx.imageSmoothingEnabled = sm; ctx.imageSmoothingQuality = q;
    return;
  }
  ctx.drawImage(s.canvas, x - s.ox * scale, y - s.oy * scale, s.w * scale, s.h * scale);
}

// --- Sprites de los atlas -----------------------------------------------------

// Relativa a este módulo, no a la página: así vale también desde tools/.
const DIR = new URL('../assets/sprites/', import.meta.url).href;
let indexPromise = null;
// { res, resHojas: { nombre: res }, hojas: [nombre], sprites: { clave: [hoja, x, y, w, h, ox, oy] } }
// `res` son los píxeles de hoja por píxel de mundo; una hoja con más
// resolución lo dice en `resHojas`.
let index = null;
const sheets = new Map();      // nombre de hoja → Promise<HTMLImageElement>
const loaded = new Map();      // nombre de hoja → HTMLImageElement ya decodificada

const resCache = new Map();
const unitCache = new Map();
const buildCache = new Map();

function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(DIR + 'indice.json')
      .then((r) => { if (!r.ok) throw new Error(`indice.json: ${r.status}`); return r.json(); })
      .then((j) => { index = j; return j; })
      .catch((err) => { indexPromise = null; throw err; });
  }
  return indexPromise;
}

function loadSheet(name) {
  let p = sheets.get(name);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { loaded.set(name, img); resolve(img); };
      img.onerror = () => { sheets.delete(name); reject(new Error(`No se pudo cargar ${name}`)); };
      img.src = DIR + name;
    });
    sheets.set(name, p);
  }
  return p;
}

/**
 * Carga lo que hace falta para dibujar con estos colores de jugador: el índice,
 * las hojas sin color (los recursos) y las de cada color, que se reconocen por
 * acabar en `-<color>.png`. Lo que ya esté cargado no se vuelve a pedir.
 */
export async function prepareSprites(colors = [0]) {
  await loadIndex();
  const want = new Set(colors.map(Number));
  const names = index.hojas.filter((n) => {
    const m = n.match(/-(\d+)\.png$/);
    return !m || want.has(Number(m[1]));
  });
  const nuevaLoseta = names.includes('terreno.png') && !loaded.has('terreno.png');
  await Promise.all(names.map(loadSheet));
  // Los rombos horneados antes de tener las losetas eran los de código.
  if (nuevaLoseta) { tileSheets.clear(); terrCache.clear(); }
}

/*
 * Animación de cada unidad: los fotogramas que recorre al andar, en orden, el
 * que enseña quieta y los dos de golpear o trabajar. Las que no digan otra
 * cosa en el índice son las de siempre: andar del 0 al 3, quieta en el 0 y
 * golpe en el 4 y el 5. En el índice, `andar` puede ser un número (del 0 a
 * ese menos uno) o la lista de fotogramas, por si alguno sobra, y
 * `andarCara` da la lista propia de una orientación que tenga otro número de
 * fotogramas ({ "1": [0, 1, 2] }). Las volteadas usan la de la suya.
 */
const ANIM_DE_SERIE = { andar: [0, 1, 2, 3], quieto: 0, golpe: [4, 5] };
const animCache = new Map();

export function unitAnim(type, face = 0) {
  const a = index && index.anim && index.anim[type];
  if (!a) return ANIM_DE_SERIE;
  face = ((Math.round(face) % 8) + 8) % 8;
  const cara = MIRROR[face] ?? face;
  const clave = `${type}|${cara}`;
  let r = animCache.get(clave);
  if (!r) {
    const propia = a.andarCara && a.andarCara[cara];
    const andar = propia || (Array.isArray(a.andar) ? a.andar : [...Array(a.andar || 4).keys()]);
    r = { andar, quieto: a.quieto ?? 0, golpe: a.golpe || [a.quieto ?? 0, a.quieto ?? 0] };
    animCache.set(clave, r);
  }
  return r;
}

/**
 * Recorta un sprite de su atlas a un lienzo propio, con sus medidas y anclaje
 * en píxeles de mundo. Si su hoja aún no ha llegado devuelve null (y la pide):
 * quien dibuja se salta ese objeto hasta que esté.
 */
function slice(key) {
  if (!index) { loadIndex().catch(() => {}); return null; }
  const e = index.sprites[key];
  if (!e) return null;
  const img = loaded.get(index.hojas[e[0]]);
  if (!img) { loadSheet(index.hojas[e[0]]).catch(() => {}); return null; }
  const [, x, y, w, h, ox, oy] = e;
  const c = makeCanvas(w, h);
  c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
  const res = (index.resHojas && index.resHojas[index.hojas[e[0]]]) || index.res;
  return { canvas: c, ox, oy, w: w / res, h: h / res, res };
}

/*
 * Espejo de orientaciones: como en los SLP del original, hay cinco vistas y
 * las tres que miran al otro lado salen volteadas. El volteo es sobre el eje
 * vertical de pantalla, que en el mundo intercambia u y v: la 2 sale de la 0,
 * la 3 de la 7 y la 4 de la 6. Una unidad con dibujo propio de alguna de ellas
 * (la milicia, en ← y ↖) lo tiene en el índice y se usa ése.
 */
const MIRROR = { 2: 0, 3: 7, 4: 6 };

function flipSprite(s) {
  const c = makeCanvas(s.canvas.width, s.canvas.height);
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(s.canvas, 0, 0);
  return { canvas: c, ox: s.w - s.ox, oy: s.oy, w: s.w, h: s.h, res: s.res };
}

/**
 * Sprite de una unidad: tipo, color de jugador, orientación 0-7 (0 = +u del
 * mundo, hacia abajo-derecha de la pantalla) y fotograma (ver `unitAnim`).
 * Anclado a los pies. Null mientras su hoja no haya llegado.
 */
export function unitSprite(type, colorIdx, face = 1, f = 0) {
  face = ((Math.round(face) % 8) + 8) % 8;
  const key = `${type}|${colorIdx}|${face}|${f}`;
  let s = unitCache.get(key);
  if (s) return s;
  // Las que miran a la izquierda salen volteadas, salvo que tengan dibujo propio.
  const src = MIRROR[face];
  if (src !== undefined && !(index && index.sprites[`u|${key}`])) {
    const base = unitSprite(type, colorIdx, src, f);
    s = base && flipSprite(base);
  } else {
    s = slice(`u|${key}`);
  }
  if (s) unitCache.set(key, s);
  return s;
}

/** Pinta una unidad directamente; a píxel visto, como manda la ampliación. */
export function paintUnit(ctx, x, y, type, colorIdx, face, f) {
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  drawSprite(ctx, unitSprite(type, colorIdx, face, f), x, y);
  ctx.imageSmoothingEnabled = sm;
}

/** Sprite de un edificio en una etapa de obra, anclado a la esquina superior. */
export function buildingSprite(type, colorIdx, stage = 2) {
  const key = `${type}|${colorIdx}|${stage}`;
  let s = buildCache.get(key);
  if (s) return s;
  s = slice(`b|${key}`);
  if (s) buildCache.set(key, s);
  return s;
}

export function paintBuilding(ctx, x, y, type, colorIdx, stage = 2) {
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  drawSprite(ctx, buildingSprite(type, colorIdx, stage), x, y);
  ctx.imageSmoothingEnabled = sm;
}

/** Sprite de un recurso del mapa, anclado al centro de su rombo. */
export function resourceSprite(kind, variant = 0, depleted = false) {
  const key = `${kind}|${variant}|${depleted ? 1 : 0}`;
  let s = resCache.get(key);
  if (s) return s;
  // Lo agotado sólo se horneó para la variante 0: las demás usan esa.
  s = slice(`r|${key}`) || (depleted && variant ? slice(`r|${kind}|0|1`) : null);
  if (s) resCache.set(key, s);
  return s;
}

export function paintResource(ctx, x, y, kind, variant = 0, depleted = false) {
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  drawSprite(ctx, resourceSprite(kind, variant, depleted), x, y);
  ctx.imageSmoothingEnabled = sm;
}

// --- Iconos para la interfaz ------------------------------------------------

const iconCache = new Map();

/** Emblemas vectoriales para las tecnologías. */
function techGlyph(ctx, sym) {
  ctx.save();
  ctx.translate(28, 28);
  ctx.strokeStyle = '#1c1c1e';
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
    default: { // sin emblema propio: el texto que se le pase
      ctx.fillStyle = '#fff';
      ctx.font = '700 26px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(sym, 0, 2);
    }
  }
  ctx.restore();
}

// Emblema de cada tecnología. Los demás dibujos de `techGlyph` se quedan para
// cuando vuelva a haber más de una.
const TECH_SYMBOLS = { Telar: 'loom' };

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
  // Sin su hoja cargada no hay retrato: se devuelve el lienzo vacío sin
  // guardarlo, para que la próxima vez salga ya con el dibujo.
  const s = kind === 'unit' ? unitSprite(type, colorIdx, 0, unitAnim(type).quieto)
    : kind === 'building' ? buildingSprite(type, colorIdx, 2)
      : kind === 'node' ? resourceSprite(type, 0) : null;
  if (!s && (kind === 'unit' || kind === 'building' || kind === 'node')) return c.toDataURL();
  if (kind === 'unit') {
    // Retrato de medio cuerpo: así se distinguen el yelmo y el arma de cada unidad.
    const b = tightBounds(s.canvas, `u${key}`);
    const cls = UNITS[type].class;
    const crop = cls === 'siege' ? 1 : 0.66;
    const ch = Math.max(8, b.h * crop);
    const sc = Math.min(54 / b.w, 52 / ch);
    ctx.drawImage(s.canvas, b.x, b.y, b.w, ch,
      28 - (b.w * sc) / 2, 30 - (ch * sc) / 2, b.w * sc, ch * sc);
  } else if (kind === 'building') {
    const b = tightBounds(s.canvas, `b${key}`);
    const sc = Math.min(52 / b.w, 50 / b.h);
    ctx.drawImage(s.canvas, b.x, b.y, b.w, b.h,
      28 - (b.w * sc) / 2, 54 - b.h * sc, b.w * sc, b.h * sc);
  } else if (kind === 'node') {
    const b = tightBounds(s.canvas, `n${key}`);
    const sc = Math.min(52 / b.w, 50 / b.h);
    ctx.drawImage(s.canvas, b.x, b.y, b.w, b.h,
      28 - (b.w * sc) / 2, 54 - b.h * sc, b.w * sc, b.h * sc);
  } else if (kind === 'tech') {
    // Insignia de iOS: cuadrado redondeado con el degradado del azul del sistema.
    const grad = ctx.createLinearGradient(0, 4, 0, 52);
    grad.addColorStop(0, '#5ac8fa'); grad.addColorStop(1, '#007aff');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(4, 4, 48, 48, 12);
    ctx.fill();
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
 * Vacía todos los cachés de dibujo. Hay que llamarla cuando se cambian los
 * colores del terreno desde el catálogo, que se hornean con ellos. Las hojas
 * de sprites cargadas se quedan: sólo se vuelven a recortar.
 */
export function clearSpriteCaches() {
  tileCache.clear();
  tileSheets.clear();
  terrCache.clear();
  resCache.clear();
  unitCache.clear();
  buildCache.clear();
  iconCache.clear();
  boundsCache.clear();
}

export { HW, HH };
