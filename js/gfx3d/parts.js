// Piezas del taller de edificios: el vocabulario con el que se arma un modelo
// 3D desde dentro del juego.
//
// Los edificios de serie (buildings.js) son código; los que hace el jugador son
// **datos**: una lista de piezas con su sitio, su tamaño y su material. Aquí
// vive la tabla de piezas —qué campos tiene cada una y qué triángulos genera—
// y la función que convierte un diseño entero en malla, con sus tres etapas de
// obra. Al ser datos, un diseño se guarda, se copia, se valida y se le manda al
// otro jugador por la red.
//
// Las piezas se apoyan en las mismas primitivas del motor y en el mismo kit de
// obra que usan los edificios de serie, así que un edificio hecho a mano se
// hornea con la misma luz, la misma sombra y el mismo contorno: en la partida
// no se distingue de los demás.

import { PLAYER_COLORS } from '../config.js';
import { look } from '../data/appearance.js';
import {
  quad, box, cyl, sphere, limb, wheel, tone, srand, translate,
} from './engine.js';
import {
  gableRoof, hipRoof, battlements, roundTower, flag, scaffold, foundation,
  logPile, barrel,
} from './buildings.js';

// --- Materiales --------------------------------------------------------------

/*
 * Cada pieza pinta con un material, no con un color suelto: así el catálogo
 * puede recolorear un edificio entero cambiando un valor, igual que hace con
 * los de serie, y el diseño no guarda el mismo color repetido cien veces.
 */
export const MATERIALS = [
  { key: 'wall', label: 'Muro', def: '#d8cba6' },
  { key: 'wall2', label: 'Muro alto', def: '#c6c0ad' },
  { key: 'stone', label: 'Piedra', def: '#9a9a94' },
  { key: 'base', label: 'Basamento', def: '#ab9668' },
  { key: 'wood', label: 'Madera', def: '#8a6234' },
  { key: 'roof', label: 'Tejado', def: '#a8452f' },
  { key: 'thatch', label: 'Bálago', def: '#b09a62' },
  { key: 'door', label: 'Puerta', def: '#3b2a17' },
  { key: 'accent', label: 'Detalle', def: '#c9553f' },
  { key: 'chimney', label: 'Chimenea', def: '#5c5c58' },
  { key: 'ground', label: 'Empedrado', def: '#948763' },
  { key: 'soil', label: 'Tierra', def: '#8a6a3c' },
  { key: 'crop', label: 'Cultivo', def: '#a8c24a' },
  { key: 'glow', label: 'Fuego', def: '#ff9a3c' },
];

/** Material especial: se pinta con el color del jugador dueño del edificio. */
export const PLAYER_MAT = 'player';

export const MATERIAL_KEYS = [...MATERIALS.map((m) => m.key), PLAYER_MAT];

export const DEFAULT_PALETTE = Object.fromEntries(MATERIALS.map((m) => [m.key, m.def]));

/** Materiales que no reciben luz: el fuego de una fragua no se apaga en sombra. */
const UNLIT_MATS = new Set(['glow']);

function paletteOf(design, live) {
  // El catálogo puede haber recoloreado el edificio después de crearlo, así que
  // manda lo que diga LOOK; la paleta del diseño es el punto de partida. En el
  // taller (`live`) manda la paleta que se está tocando ahora mismo, que aún no
  // ha llegado a ninguna otra parte.
  const saved = !live && design.id ? look('building', design.id) : null;
  return { ...DEFAULT_PALETTE, ...(design.palette || {}), ...(saved || {}) };
}

// --- Campos editables --------------------------------------------------------

/*
 * Rangos y etiquetas de cada campo. El estudio construye sus controles con
 * esto y el validador recorta con esto mismo, de modo que no hay forma de
 * guardar un diseño con una viga de mil casillas.
 */
export const FIELDS = {
  x: { label: 'Posición X', min: -3, max: 11, step: 0.05 },
  y: { label: 'Posición Y', min: -3, max: 11, step: 0.05 },
  z: { label: 'Altura del suelo', min: 0, max: 9, step: 0.05 },
  w: { label: 'Ancho (x)', min: 0.04, max: 10, step: 0.05 },
  d: { label: 'Fondo (y)', min: 0.04, max: 10, step: 0.05 },
  h: { label: 'Alto', min: 0.04, max: 8, step: 0.05 },
  r: { label: 'Radio', min: 0.02, max: 5, step: 0.02 },
  r0: { label: 'Radio abajo', min: 0, max: 5, step: 0.02 },
  r1: { label: 'Radio arriba', min: 0, max: 5, step: 0.02 },
  rise: { label: 'Pendiente', min: 0.02, max: 4, step: 0.05 },
  over: { label: 'Alero', min: 0, max: 0.8, step: 0.02 },
  len: { label: 'Largo', min: 0.05, max: 10, step: 0.05 },
  th: { label: 'Grueso', min: 0.02, max: 1, step: 0.02 },
  yaw: { label: 'Giro', min: 0, max: 355, step: 5, unit: '°' },
  pitch: { label: 'Inclinación', min: -90, max: 90, step: 5, unit: '°' },
  seg: { label: 'Lados', min: 3, max: 16, step: 1 },
  flat: { label: 'Achatado', min: 0.2, max: 2, step: 0.05 },
  steps: { label: 'Peldaños', min: 2, max: 12, step: 1 },
  n: { label: 'Cantidad', min: 1, max: 12, step: 1 },
  axis: {
    label: 'Eje', type: 'choice',
    options: [['x', 'A lo largo de X'], ['y', 'A lo largo de Y']],
  },
  face: {
    label: 'Cara', type: 'choice',
    options: [['x', 'Derecha (+X)'], ['y', 'Izquierda (+Y)']],
  },
};

/** Banderas que puede llevar cualquier pieza. */
export const FLAGS = [
  { key: 'rough', label: 'Textura', hint: 'Varía el tono al azar: paja, roca, follaje.' },
  { key: 'noshadow', label: 'Sin sombra', hint: 'No arroja sombra al suelo: detalles finos.' },
];

const rad = (deg) => ((deg || 0) * Math.PI) / 180;

/** Color con el que se pinta una pieza. */
function matColor(p, c) {
  if (p.m === PLAYER_MAT) return c.C.main;
  return c.M[p.m] || DEFAULT_PALETTE[p.m] || '#9a9a94';
}

/** Opciones de cara comunes (textura, sombra, luz) para las primitivas. */
function matOpts(p) {
  const o = {};
  if (p.rough) o.rough = 0.14;
  if (p.noshadow) o.noshadow = true;
  if (UNLIT_MATS.has(p.m)) { o.unlit = true; o.noshadow = true; }
  return o;
}

/** Construye una pieza aparte y la sube a su cota: el kit de obra empieza en 0. */
function lifted(out, z, fn) {
  const tmp = [];
  fn(tmp);
  if (z) translate(tmp, 0, 0, z);
  for (const t of tmp) out.push(t);
}

// --- La tabla de piezas ------------------------------------------------------

/*
 * `fields` es el orden en que salen los controles; `def` los valores con los que
 * nace la pieza (en casillas, sobre una huella de 2×2, que luego el estudio
 * centra donde haga falta).
 */
export const PARTS = {
  box: {
    label: 'Caja', glyph: '■',
    hint: 'Muros, torreones, cajones, mostradores: el ladrillo de todo.',
    fields: ['x', 'y', 'z', 'w', 'd', 'h', 'yaw'],
    def: { x: 1, y: 1, z: 0, w: 1.2, d: 1.2, h: 0.8, yaw: 0, m: 'wall' },
    build(out, p, c) {
      box(out, p.x, p.y, p.z, p.w, p.d, p.h, matColor(p, c), { ...matOpts(p), yaw: rad(p.yaw) });
    },
  },

  cyl: {
    label: 'Cilindro', glyph: '▮',
    hint: 'Torres, columnas y postes. Con el radio de arriba a cero sale un cono.',
    fields: ['x', 'y', 'z', 'r0', 'r1', 'h', 'seg'],
    def: { x: 1, y: 1, z: 0, r0: 0.4, r1: 0.36, h: 1, seg: 9, m: 'stone' },
    build(out, p, c) {
      cyl(out, p.x, p.y, p.z, p.r0, p.r1, p.h, matColor(p, c), { ...matOpts(p), seg: p.seg });
    },
  },

  dome: {
    label: 'Cúpula', glyph: '●',
    hint: 'Esfera achatable: cúpulas, sacos, montones, pajares.',
    fields: ['x', 'y', 'z', 'r', 'flat', 'seg'],
    def: { x: 1, y: 1, z: 0, r: 0.4, flat: 1, seg: 8, m: 'wall' },
    build(out, p, c) {
      // El estudio cuenta la z desde la base de la pieza, no desde su centro.
      sphere(out, p.x, p.y, p.z + p.r * p.flat, p.r, matColor(p, c),
        { ...matOpts(p), rings: 4, seg: p.seg, flat: p.flat });
    },
  },

  gable: {
    label: 'Tejado a dos aguas', glyph: '⌂',
    hint: 'El tejado de siempre, por hiladas. La cumbrera corre por el eje elegido.',
    fields: ['x', 'y', 'z', 'w', 'd', 'rise', 'over', 'axis'],
    def: { x: 1, y: 1, z: 0.8, w: 1.3, d: 1.3, rise: 0.55, over: 0.14, axis: 'x', m: 'roof' },
    build(out, p, c) {
      const col = matColor(p, c);
      gableRoof(out, p.x - p.w / 2, p.y - p.d / 2, p.x + p.w / 2, p.y + p.d / 2,
        p.z, p.rise, col, { wall: tone(col, -0.1) },
        { courses: 5, overhang: p.over, axis: p.axis });
    },
  },

  hip: {
    label: 'Tejado a cuatro aguas', glyph: '◆',
    hint: 'Piramidal si la planta es cuadrada: centros urbanos, pabellones, torres.',
    fields: ['x', 'y', 'z', 'w', 'd', 'rise', 'over'],
    def: { x: 1, y: 1, z: 0.8, w: 1.4, d: 1.4, rise: 0.6, over: 0.16, m: 'roof' },
    build(out, p, c) {
      hipRoof(out, p.x - p.w / 2, p.y - p.d / 2, p.x + p.w / 2, p.y + p.d / 2,
        p.z, p.rise, matColor(p, c), { courses: 4, overhang: p.over });
    },
  },

  panel: {
    label: 'Faldón', glyph: '◣',
    hint: 'Un plano inclinado: tejados de una sola agua, toldos, rampas, puentes.',
    fields: ['x', 'y', 'z', 'w', 'd', 'rise', 'axis'],
    def: { x: 1, y: 1, z: 0.7, w: 1.4, d: 1.2, rise: 0.25, axis: 'x', m: 'thatch' },
    build(out, p, c) {
      const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2;
      const y0 = p.y - p.d / 2, y1 = p.y + p.d / 2;
      const o = matOpts(p), col = matColor(p, c);
      if (p.axis === 'x') {
        quad(out, [x0, y0, p.z], [x1, y0, p.z + p.rise], [x1, y1, p.z + p.rise], [x0, y1, p.z], col, o);
      } else {
        quad(out, [x0, y0, p.z], [x1, y0, p.z], [x1, y1, p.z + p.rise], [x0, y1, p.z + p.rise], col, o);
      }
    },
  },

  beam: {
    label: 'Viga', glyph: '╱',
    hint: 'Un madero orientado: entramados, postes, mástiles, pértigas.',
    fields: ['x', 'y', 'z', 'len', 'yaw', 'pitch', 'th'],
    def: { x: 1, y: 1, z: 0, len: 0.9, yaw: 0, pitch: 90, th: 0.05, m: 'wood' },
    build(out, p, c) {
      const yw = rad(p.yaw), pt = rad(p.pitch);
      const b = [
        p.x + p.len * Math.cos(pt) * Math.cos(yw),
        p.y + p.len * Math.cos(pt) * Math.sin(yw),
        p.z + p.len * Math.sin(pt),
      ];
      limb(out, [p.x, p.y, p.z], b, p.th, matColor(p, c), matOpts(p));
    },
  },

  wheel: {
    label: 'Rueda', glyph: '◎',
    hint: 'Disco de eje horizontal: ruedas, aspas de molino, dianas, escudos.',
    fields: ['x', 'y', 'z', 'r', 'th', 'axis', 'seg'],
    def: { x: 1, y: 1, z: 0, r: 0.25, th: 0.06, axis: 'y', seg: 10, m: 'wood' },
    build(out, p, c) {
      wheel(out, p.x, p.y, p.z + p.r, p.r, p.th, matColor(p, c),
        { ...matOpts(p), axis: p.axis, seg: p.seg });
    },
  },

  crest: {
    label: 'Almenas', glyph: '⊓',
    hint: 'Corona un rectángulo con su antepecho y sus merlones.',
    fields: ['x', 'y', 'z', 'w', 'd'],
    def: { x: 1, y: 1, z: 1, w: 1.2, d: 1.2, m: 'stone' },
    build(out, p, c) {
      battlements(out, p.x - p.w / 2, p.y - p.d / 2, p.x + p.w / 2, p.y + p.d / 2,
        p.z, { wall: matColor(p, c) });
    },
  },

  tower: {
    label: 'Torreón', glyph: '▲',
    hint: 'Torre redonda entera, con su cornisa, sus almenas y su saetera.',
    fields: ['x', 'y', 'z', 'r', 'h'],
    def: { x: 1, y: 1, z: 0, r: 0.4, h: 1.4, m: 'stone' },
    build(out, p, c) {
      lifted(out, p.z, (o) => roundTower(o, p.x, p.y, p.r, p.h, { wall: matColor(p, c) }));
    },
  },

  door: {
    label: 'Puerta', glyph: '▯',
    hint: 'Se pega sobre una cara: ponla justo en el plano del muro que mira a la cámara.',
    fields: ['x', 'y', 'z', 'w', 'h', 'face'],
    def: { x: 2, y: 1, z: 0, w: 0.45, h: 0.6, face: 'x', m: 'door' },
    build(out, p, c) {
      const e = 0.015, col = matColor(p, c), wood = c.M.wood;
      const o = { bias: 0.05, noshadow: true };
      if (p.face === 'x') {
        quad(out, [p.x + e, p.y - p.w / 2, p.z], [p.x + e, p.y + p.w / 2, p.z],
          [p.x + e, p.y + p.w / 2, p.z + p.h], [p.x + e, p.y - p.w / 2, p.z + p.h], col, o);
        for (const s of [-1, 1]) {
          limb(out, [p.x + e, p.y + s * (p.w / 2 + 0.03), p.z],
            [p.x + e, p.y + s * (p.w / 2 + 0.03), p.z + p.h + 0.03], 0.03, wood, { noshadow: true });
        }
        limb(out, [p.x + e, p.y - p.w / 2 - 0.05, p.z + p.h + 0.03],
          [p.x + e, p.y + p.w / 2 + 0.05, p.z + p.h + 0.03], 0.035, wood, { noshadow: true });
      } else {
        quad(out, [p.x - p.w / 2, p.y + e, p.z], [p.x + p.w / 2, p.y + e, p.z],
          [p.x + p.w / 2, p.y + e, p.z + p.h], [p.x - p.w / 2, p.y + e, p.z + p.h], col, o);
        for (const s of [-1, 1]) {
          limb(out, [p.x + s * (p.w / 2 + 0.03), p.y + e, p.z],
            [p.x + s * (p.w / 2 + 0.03), p.y + e, p.z + p.h + 0.03], 0.03, wood, { noshadow: true });
        }
        limb(out, [p.x - p.w / 2 - 0.05, p.y + e, p.z + p.h + 0.03],
          [p.x + p.w / 2 + 0.05, p.y + e, p.z + p.h + 0.03], 0.035, wood, { noshadow: true });
      }
    },
  },

  window: {
    label: 'Ventana', glyph: '▣',
    hint: 'Hueco oscuro con dintel. El material es el del marco.',
    fields: ['x', 'y', 'z', 'w', 'h', 'face'],
    def: { x: 2, y: 1, z: 0.5, w: 0.22, h: 0.24, face: 'x', m: 'wood' },
    build(out, p, c) {
      const e = 0.015, frame = matColor(p, c);
      const dark = { bias: 0.05, noshadow: true, unlit: true };
      if (p.face === 'x') {
        quad(out, [p.x + e, p.y - p.w / 2, p.z], [p.x + e, p.y + p.w / 2, p.z],
          [p.x + e, p.y + p.w / 2, p.z + p.h], [p.x + e, p.y - p.w / 2, p.z + p.h], '#241d14', dark);
        limb(out, [p.x + e, p.y - p.w / 2 - 0.02, p.z + p.h],
          [p.x + e, p.y + p.w / 2 + 0.02, p.z + p.h], 0.02, frame, { noshadow: true });
      } else {
        quad(out, [p.x - p.w / 2, p.y + e, p.z], [p.x + p.w / 2, p.y + e, p.z],
          [p.x + p.w / 2, p.y + e, p.z + p.h], [p.x - p.w / 2, p.y + e, p.z + p.h], '#241d14', dark);
        limb(out, [p.x - p.w / 2 - 0.02, p.y + e, p.z + p.h],
          [p.x + p.w / 2 + 0.02, p.y + e, p.z + p.h], 0.02, frame, { noshadow: true });
      }
    },
  },

  flag: {
    label: 'Estandarte', glyph: '⚑',
    hint: 'Siempre del color del jugador: es como se ve de quién es el edificio.',
    fields: ['x', 'y', 'z', 'h'],
    def: { x: 1, y: 1, z: 1, h: 0.55, m: PLAYER_MAT },
    build(out, p, c) {
      flag(out, p.x, p.y, p.z, p.h, matColor(p, c));
    },
  },

  stairs: {
    label: 'Escalinata', glyph: '▟',
    hint: 'Peldaños que suben hacia el fondo: entradas y basamentos.',
    fields: ['x', 'y', 'z', 'w', 'd', 'h', 'steps', 'axis'],
    def: { x: 1, y: 1, z: 0, w: 0.8, d: 0.5, h: 0.3, steps: 3, axis: 'x', m: 'base' },
    build(out, p, c) {
      const col = matColor(p, c), o = matOpts(p);
      const n = Math.round(p.steps);
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / n;                 // altura acumulada
        const depth = p.d * (1 - i / n);       // cada peldaño llega menos lejos
        if (p.axis === 'x') {
          const near = p.x + p.d / 2 - (p.d - depth);
          box(out, near - depth / 2, p.y, p.z, depth, p.w, p.h * t, col, o);
        } else {
          const near = p.y + p.d / 2 - (p.d - depth);
          box(out, p.x, near - depth / 2, p.z, p.w, depth, p.h * t, col, o);
        }
      }
    },
  },

  fence: {
    label: 'Cerca', glyph: 'Ⅲ',
    hint: 'Postes con dos travesaños: corrales, huertos, empalizadas bajas.',
    fields: ['x', 'y', 'z', 'len', 'yaw', 'h'],
    def: { x: 0.4, y: 1, z: 0, len: 1.2, yaw: 0, h: 0.3, m: 'wood' },
    build(out, p, c) {
      const col = matColor(p, c);
      const bx = p.x + p.len * Math.cos(rad(p.yaw)), by = p.y + p.len * Math.sin(rad(p.yaw));
      const n = Math.max(1, Math.round(p.len / 0.45));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = p.x + (bx - p.x) * t, py = p.y + (by - p.y) * t;
        limb(out, [px, py, p.z], [px, py, p.z + p.h], 0.025, col, matOpts(p));
      }
      for (const k of [0.45, 0.85]) {
        limb(out, [p.x, p.y, p.z + p.h * k], [bx, by, p.z + p.h * k], 0.018,
          tone(col, 0.1), { noshadow: true });
      }
    },
  },

  logs: {
    label: 'Pila de troncos', glyph: '≡',
    hint: 'Madera apilada: campamentos, aserraderos, patios de obra.',
    fields: ['x', 'y', 'z', 'len', 'n'],
    def: { x: 1, y: 1, z: 0, len: 0.8, n: 6, m: 'wood' },
    build(out, p, c) {
      lifted(out, p.z, (o) => logPile(o, p.x, p.y, p.len, Math.round(p.n), matColor(p, c)));
    },
  },

  barrel: {
    label: 'Barril', glyph: '◍',
    hint: 'Un tonel; repítelo para llenar un almacén o un mercado.',
    fields: ['x', 'y', 'z'],
    def: { x: 1, y: 1, z: 0, m: 'wood' },
    build(out, p, c) {
      lifted(out, p.z, (o) => barrel(o, p.x, p.y, matColor(p, c)));
    },
  },
};

export const PART_KEYS = Object.keys(PARTS);

// --- De diseño a malla -------------------------------------------------------

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

/**
 * Recorta la obra a media altura: los triángulos que quedan del todo por encima
 * del corte se van y a los demás se les baja lo que sobresale. Es lo que
 * convierte cualquier diseño en una etapa "a medias" creíble sin que su autor
 * tenga que modelarla.
 */
function clampZ(tris, cut) {
  const out = [];
  for (const t of tris) {
    if (t.p[0][2] > cut && t.p[1][2] > cut && t.p[2][2] > cut) continue;
    out.push({ ...t, p: t.p.map((v) => (v[2] > cut ? [v[0], v[1], cut] : v)) });
  }
  return out;
}

function meshHeight(groups) {
  let max = 0;
  for (const g of groups) {
    for (const t of g.tris) for (const v of t.p) if (v[2] > max) max = v[2];
  }
  return max;
}

/**
 * Malla de un diseño repartida por piezas: `[{ part, tris }]`. El estudio la
 * usa para saber qué pieza hay bajo el ratón y para resaltar la elegida; el
 * juego se queda sólo con los triángulos.
 */
export function designParts(design, colorIdx = 0, stage = 2, live = false) {
  const M = paletteOf(design, live);
  const C = PLAYER_COLORS[colorIdx] || PLAYER_COLORS[0];
  const s = design.size || 2;
  const c = { M, C, s };
  srand(hash(design.id || design.name || 'x') + stage * 7 + 1);

  if (stage === 0) {
    const tris = [];
    foundation(tris, 0.2, 0.2, s - 0.2, s - 0.2, { wood: M.wood, stone: M.stone });
    return [{ part: null, tris }];
  }

  const groups = [];
  for (const part of design.parts || []) {
    const spec = PARTS[part.k];
    if (!spec) continue;
    const tris = [];
    try {
      spec.build(tris, part, c);
    } catch {
      // Una pieza con valores imposibles no puede tumbar el edificio entero.
    }
    groups.push({ part, tris });
  }

  if (stage === 1) {
    // Obra a medias: el modelo cortado por la mitad y el andamio alrededor.
    const cut = Math.max(0.3, meshHeight(groups) * 0.55);
    for (const g of groups) g.tris = clampZ(g.tris, cut);
    const tris = [];
    scaffold(tris, 0.2, 0.2, s - 0.2, s - 0.2, cut, { wood: M.wood });
    groups.push({ part: null, tris });
  }

  return groups;
}

/** Malla completa de un diseño, lista para hornear. */
export function designMesh(design, colorIdx = 0, stage = 2, live = false) {
  const out = [];
  for (const g of designParts(design, colorIdx, stage, live)) {
    for (const t of g.tris) out.push(t);
  }
  return out;
}

/** Cuántos triángulos gasta un diseño: el estudio lo enseña como presupuesto. */
export function triangleCount(design) {
  let n = 0;
  for (const g of designParts(design, 0, 2)) n += g.tris.length;
  return n;
}
