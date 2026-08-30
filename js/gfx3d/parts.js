// Piezas del taller de edificios: el vocabulario con el que se arma un modelo
// 3D desde dentro del juego.
//
// Los modelos de serie (buildings.js) son código; los que hace el jugador para
// re-vestir esos mismos edificios son **datos**: una lista de piezas con su
// sitio, su tamaño y su material. Aquí vive la tabla de piezas —qué campos
// tiene cada una y qué triángulos genera— y la función que convierte un modelo
// entero en malla, con sus tres etapas de obra. Al ser datos, un modelo se
// guarda, se copia, se valida y se le manda al otro jugador por la red.
//
// Las piezas se apoyan en las mismas primitivas del motor y en el mismo kit de
// obra que usan los edificios de serie, así que un edificio hecho a mano se
// hornea con la misma luz, la misma sombra y el mismo contorno: en la partida
// no se distingue de los demás.

import { PLAYER_COLORS, BUILDINGS } from '../config.js';
import { LOOK } from '../data/appearance.js';
import {
  tri, quad, box, cyl, sphere, limb, wheel, tone, srand, translate, scaleMesh,
  mapVerts, rotZ, rotX, rotY,
} from './engine.js';
import {
  gableRoof, hipRoof, battlements, roundTower, flag, scaffold, foundation,
  logPile, barrel,
} from './buildings.js';

// --- Materiales --------------------------------------------------------------

/*
 * Cada pieza pinta con un material, no con un color suelto: así el catálogo
 * puede recolorear un edificio entero cambiando un valor, igual que hace con
 * los de serie, y el modelo no guarda el mismo color repetido cien veces.
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
  // El catálogo puede haber recoloreado el edificio después de vestirlo, así que
  // manda lo que diga LOOK; la paleta del modelo es el punto de partida. En el
  // taller (`live`) manda la paleta que se está tocando ahora mismo, que aún no
  // ha llegado a ninguna otra parte.
  const saved = !live && design.target ? LOOK.building[design.target] : null;
  return { ...DEFAULT_PALETTE, ...(design.palette || {}), ...(saved || {}) };
}

/**
 * La huella sobre la que se dibuja: la manda el edificio vestido, no el modelo.
 * La casa mide dos casillas, se haya modelado sobre las que se haya modelado.
 */
export function renderSize(design) {
  const stock = design.target && BUILDINGS[design.target];
  return (stock && stock.size) || design.size || 2;
}

// --- Campos editables --------------------------------------------------------

/*
 * Rangos y etiquetas de cada campo. El taller construye sus controles con
 * esto y el validador recorta con esto mismo, de modo que no hay forma de
 * guardar un modelo con una viga de mil casillas.
 *
 * Dos escalones por campo: `step` es el que dan los botones —lo que se avanza
 * de un toque— y `fino` es la rejilla a la que se redondea al guardar. Antes
 * eran el mismo, y una pieza afinada a mano en la ficha volvía al escalón
 * gordo en cuanto se guardaba: un detalle de 0,03 se despertaba midiendo 0,05.
 * Con el fino aparte, los botones siguen yendo a pasos cómodos y lo pequeño se
 * puede dejar pequeño. Los campos que cuentan cosas —lados, peldaños, grados—
 * no tienen fino: su escalón ya es lo menudo que pueden ser.
 */
export const FIELDS = {
  x: { label: 'Posición X', min: -3, max: 11, step: 0.05, fino: 0.01 },
  y: { label: 'Posición Y', min: -3, max: 11, step: 0.05, fino: 0.01 },
  z: { label: 'Altura del suelo', min: 0, max: 9, step: 0.05, fino: 0.01 },
  w: { label: 'Ancho (x)', min: 0.01, max: 10, step: 0.05, fino: 0.01 },
  d: { label: 'Fondo (y)', min: 0.01, max: 10, step: 0.05, fino: 0.01 },
  h: { label: 'Alto', min: 0.01, max: 8, step: 0.05, fino: 0.01 },
  r: { label: 'Radio', min: 0.01, max: 5, step: 0.02, fino: 0.01 },
  r0: { label: 'Radio abajo', min: 0, max: 5, step: 0.02, fino: 0.01 },
  r1: { label: 'Radio arriba', min: 0, max: 5, step: 0.02, fino: 0.01 },
  rise: { label: 'Pendiente', min: 0.01, max: 4, step: 0.05, fino: 0.01 },
  over: { label: 'Alero', min: 0, max: 0.8, step: 0.02, fino: 0.01 },
  len: { label: 'Largo', min: 0.01, max: 10, step: 0.05, fino: 0.01 },
  th: { label: 'Grueso', min: 0.01, max: 1, step: 0.02, fino: 0.01 },
  yaw: { label: 'Giro', min: 0, max: 355, step: 5, unit: '°' },
  // Los tres giros de fuera: se le dan a la malla ya construida, alrededor del
  // ancla de la pieza, así que valen para todas por igual. La Z sólo se usa en
  // las que no traen `yaw` propio, para no tener dos mandos para lo mismo.
  rz: { label: 'Giro Z', min: 0, max: 355, step: 5, unit: '°' },
  rx: { label: 'Giro X', min: 0, max: 355, step: 5, unit: '°' },
  ry: { label: 'Giro Y', min: 0, max: 355, step: 5, unit: '°' },
  pitch: { label: 'Inclinación', min: -90, max: 90, step: 5, unit: '°' },
  seg: { label: 'Lados', min: 3, max: 16, step: 1 },
  flat: { label: 'Achatado', min: 0.05, max: 2, step: 0.05, fino: 0.01 },
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

/*
 * Los giros que puede llevar cualquier pieza, en el orden en que se aplican:
 * primero la vuelta sobre su eje vertical y después los dos vuelcos. Van sobre
 * la malla ya construida y alrededor del ancla —donde la pieza dice estar—, de
 * modo que una pieza se tumba sobre su base y no se va a otro sitio. No están
 * en la lista de campos de ninguna pieza porque son de todas.
 */
export const TILT_FIELDS = ['rz', 'rx', 'ry'];

/** Le da a una malla ya construida los giros de fuera de su pieza. */
export function tiltMesh(tris, p) {
  if (!tris.length) return;
  const x = p.x || 0, y = p.y || 0, z = p.z || 0;
  if (p.rz) rotZ(tris, rad(p.rz), x, y);
  if (p.rx) rotX(tris, rad(p.rx), y, z);
  if (p.ry) rotY(tris, rad(p.ry), x, z);
}

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

/**
 * Deja una pieza construida en el origen donde toca: girada sobre su eje y
 * llevada a su sitio. Las que se arman a mano aquí abajo se construyen centradas
 * en (0,0) y apoyadas en z=0, que es mucho más fácil de leer, y terminan por
 * aquí.
 */
function place(out, tris, p) {
  if (p.yaw) rotZ(tris, rad(p.yaw));
  translate(tris, p.x, p.y, p.z);
  for (const t of tris) out.push(t);
}

/*
 * Cuerpos que el kit de obra no trae, porque los edificios de serie no los
 * necesitaban y el taller sí: con ellos se hace el detalle que con una caja y un
 * cilindro sale a martillazos.
 */

/** Cuña: una caja con la tapa caída de un lado. Rampas, contrafuertes, chaflanes. */
function wedgeMesh(p, col, o) {
  const t = [];
  const x0 = -p.w / 2, x1 = p.w / 2, y0 = -p.d / 2, y1 = p.d / 2;
  const a0 = [x0, y0, 0], b0 = [x1, y0, 0], c0 = [x1, y1, 0], d0 = [x0, y1, 0];
  const b1 = [x1, y0, p.h], c1 = [x1, y1, p.h];
  quad(t, a0, b0, c0, d0, col, o);   // el suelo
  quad(t, b0, c0, c1, b1, col, o);   // el testero alto
  quad(t, a0, b1, c1, d0, col, o);   // la rampa
  tri(t, a0, b0, b1, col, o);
  tri(t, d0, c0, c1, col, o);
  return t;
}

/** Bóveda: medio cilindro tumbado. Túneles, naves, puentes, tejados curvos. */
function vaultMesh(p, col, o) {
  const seg = Math.max(3, Math.round(p.seg || 8));
  const t = [];
  const hw = p.w / 2, hd = p.d / 2;
  const arco = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI;
    arco.push([Math.cos(a) * hd, Math.sin(a) * p.rise]);
  }
  for (let i = 0; i < seg; i++) {
    const [y0, z0] = arco[i], [y1, z1] = arco[i + 1];
    quad(t, [-hw, y0, z0], [hw, y0, z0], [hw, y1, z1], [-hw, y1, z1], col, o);
  }
  // Los dos testeros, en abanico desde el centro de su base.
  for (const sx of [-hw, hw]) {
    for (let i = 0; i < seg; i++) {
      tri(t, [sx, 0, 0], [sx, arco[i][0], arco[i][1]], [sx, arco[i + 1][0], arco[i + 1][1]], col, o);
    }
  }
  if (p.axis === 'y') rotZ(t, Math.PI / 2);
  return t;
}

/**
 * Teja: un canal curvo con su grueso, la teja árabe de toda la vida. Es media
 * bóveda de pared fina y sin testeros: el lomo por fuera, el canal por dentro
 * —más oscuro, que ahí no da la luz— y el canto vivo por los cuatro bordes,
 * que es lo que se ve de una teja apoyada sobre la de al lado.
 */
function tejaMesh(p, col, o) {
  const seg = Math.max(3, Math.round(p.seg || 6));
  const t = [];
  const hl = Math.max(0.01, p.len) / 2;
  const hw = Math.max(0.01, p.w) / 2;
  const rise = Math.max(0.01, p.rise);
  // El grueso no puede comerse la curva: si no, la teja se cierra sobre sí misma.
  const th = Math.max(0.004, Math.min(p.th, Math.min(hw, rise) * 0.7));
  const dentro = tone(col, -0.16);
  const arco = (rw, rz) => {
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI;
      pts.push([Math.cos(a) * rw, Math.sin(a) * rz]);
    }
    return pts;
  };
  const fuera = arco(hw, rise), canal = arco(hw - th, rise - th);
  for (let i = 0; i < seg; i++) {
    const [ay0, az0] = fuera[i], [ay1, az1] = fuera[i + 1];
    const [by0, bz0] = canal[i], [by1, bz1] = canal[i + 1];
    quad(t, [-hl, ay0, az0], [hl, ay0, az0], [hl, ay1, az1], [-hl, ay1, az1], col, o);
    quad(t, [-hl, by1, bz1], [hl, by1, bz1], [hl, by0, bz0], [-hl, by0, bz0], dentro, o);
    // Los cantos de los dos extremos, que es donde se ve el grueso.
    quad(t, [-hl, ay0, az0], [-hl, ay1, az1], [-hl, by1, bz1], [-hl, by0, bz0], dentro, o);
    quad(t, [hl, ay0, az0], [hl, by0, bz0], [hl, by1, bz1], [hl, ay1, az1], col, o);
  }
  // Y los dos bordes largos, donde apoya la siguiente.
  for (const k of [0, seg]) {
    const [ay, az] = fuera[k], [by, bz] = canal[k];
    quad(t, [-hl, ay, az], [hl, ay, az], [hl, by, bz], [-hl, by, bz], col, o);
  }
  if (p.axis === 'y') rotZ(t, Math.PI / 2);
  return t;
}

/**
 * Escama: la teja plana de frente redondo —pizarra, cola de castor—, la que se
 * pone solapada por hiladas hasta cubrir el faldón como las escamas de un pez.
 * Es una plancha con el frente en medio punto y el lomo un poco abombado: ese
 * bombeo es lo que le saca el brillo por arriba y la sombra en el solape, que
 * si no un tejado así se ve como una pared lisa con rayas.
 */
function escamaMesh(p, col, o) {
  const seg = Math.max(3, Math.round(p.seg || 8));
  const t = [];
  const hw = Math.max(0.01, p.w) / 2;
  const len = Math.max(0.02, p.len);
  const th = Math.max(0.004, p.th);
  const rise = Math.max(0, p.rise);
  const x0 = -len / 2;
  // El frente es un medio punto del ancho de la escama; con la escama más
  // corta que ancha se queda en lo que quepa, y sigue saliendo redondo.
  const r = Math.min(hw, len);
  const xc = Math.max(x0, len / 2 - r);
  const dentro = tone(col, -0.16);
  const X = (y) => xc + Math.sqrt(Math.max(0, r * r - Math.min(r, Math.abs(y)) ** 2));
  const Z = (y) => th + rise * Math.sqrt(Math.max(0, 1 - (y / hw) ** 2));
  for (let i = 0; i < seg; i++) {
    const y0 = -hw + ((2 * hw) / seg) * i, y1 = -hw + ((2 * hw) / seg) * (i + 1);
    const xa = X(y0), xb = X(y1), z0 = Z(y0), z1 = Z(y1);
    quad(t, [x0, y0, z0], [xa, y0, z0], [xb, y1, z1], [x0, y1, z1], col, o);      // el lomo
    quad(t, [x0, y0, 0], [xa, y0, 0], [xb, y1, 0], [x0, y1, 0], dentro, o);       // la panza
    quad(t, [xa, y0, 0], [xb, y1, 0], [xb, y1, z1], [xa, y0, z0], col, o);        // el frente
    quad(t, [x0, y0, 0], [x0, y1, 0], [x0, y1, z1], [x0, y0, z0], dentro, o);     // el canto de atrás
  }
  // Y los dos lados rectos, de atrás al arranque del medio punto.
  for (const sy of [-hw, hw]) {
    quad(t, [x0, sy, 0], [xc, sy, 0], [xc, sy, th], [x0, sy, th], col, o);
  }
  if (p.axis === 'y') rotZ(t, Math.PI / 2);
  return t;
}

/** Tubo: un cilindro hueco. Pozos, chimeneas, brocales, aljibes. */
function pipeMesh(p, col, o) {
  const seg = Math.max(3, Math.round(p.seg || 9));
  const ro = p.r, ri = Math.max(0.02, p.r - p.th);
  const dentro = tone(col, -0.14);   // el interior, en penumbra
  const t = [];
  const P = (r, a, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    quad(t, P(ro, a0, 0), P(ro, a1, 0), P(ro, a1, p.h), P(ro, a0, p.h), col, o);
    quad(t, P(ri, a0, 0), P(ri, a1, 0), P(ri, a1, p.h), P(ri, a0, p.h), dentro, o);
    quad(t, P(ri, a0, p.h), P(ri, a1, p.h), P(ro, a1, p.h), P(ro, a0, p.h), col, o);
  }
  return t;
}

/** Aro: una rosca tumbada. Cercos de pozo, zunchos, coronas, ruedas de molino. */
function ringMesh(p, col, o) {
  const seg = Math.max(4, Math.round(p.seg || 10));
  const lados = 5;
  const R = p.r, rr = Math.max(0.01, p.th / 2);
  const t = [];
  const P = (i, j) => {
    const A = (i / seg) * Math.PI * 2, B = (j / lados) * Math.PI * 2;
    const rad2 = R + Math.cos(B) * rr;
    return [Math.cos(A) * rad2, Math.sin(A) * rad2, rr + Math.sin(B) * rr];
  };
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < lados; j++) {
      quad(t, P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), col, o);
    }
  }
  return t;
}

/**
 * Arco: un paño con el hueco de medio punto. Puertas de muralla, acueductos,
 * claustros, soportales. Las jambas van en caja y el hueco por fajas, para que
 * ni se solapen entre sí —que el dibujo del taller no sabría ordenarlas— ni
 * hagan escalones en la rosca.
 */
function archMesh(p, col, o) {
  const seg = Math.max(3, Math.round(p.seg || 9));
  const hw = p.w / 2, hd = p.d / 2;
  const ro = Math.max(0.05, hw - p.th);              // medio hueco
  const arranque = Math.max(0, p.h - p.th - ro);     // dónde empieza a curvarse
  const t = [];
  // Las dos jambas, macizas de arriba abajo.
  for (const sx of [-1, 1]) {
    const ancho = hw - ro;
    if (ancho > 0.001) box(t, sx * (ro + ancho / 2), 0, 0, ancho, p.d, p.h, col, o);
  }
  // Y el hueco: cada faja va del intradós a la tapa.
  const alto = (u) => arranque + Math.sqrt(Math.max(0, ro * ro - u * u));
  for (let i = 0; i < seg; i++) {
    const u0 = -ro + (2 * ro * i) / seg, u1 = -ro + (2 * ro * (i + 1)) / seg;
    const b0 = alto(u0), b1 = alto(u1);
    quad(t, [u0, -hd, b0], [u1, -hd, b1], [u1, -hd, p.h], [u0, -hd, p.h], col, o);
    quad(t, [u0, hd, b0], [u1, hd, b1], [u1, hd, p.h], [u0, hd, p.h], col, o);
    quad(t, [u0, -hd, b0], [u0, hd, b0], [u1, hd, b1], [u1, -hd, b1], col, o);
    quad(t, [u0, -hd, p.h], [u1, -hd, p.h], [u1, hd, p.h], [u0, hd, p.h], col, o);
  }
  return t;
}

// --- La tabla de piezas ------------------------------------------------------

/*
 * `fields` es el orden en que salen los controles; `def` los valores con los que
 * nace la pieza (en casillas, sobre una huella de 2×2, que luego el taller
 * centra donde haga falta).
 */
/*
 * Deshacer una pieza compuesta en las sueltas que la forman.
 *
 * Algunas piezas del juego no son un cuerpo, sino varios: las almenas son un
 * antepecho y sus merlones, la escalinata son sus peldaños, la cerca son postes
 * y travesaños. Puestas en un modelo se mueven y se estiran de una vez, que es
 * lo cómodo el 90% de las veces; pero cuando lo que se quiere es correr *un*
 * merlón, no hay por dónde cogerlo.
 *
 * Por eso las compuestas traen un `explode(p)`: devuelve las piezas del taller
 * que dibujan lo mismo, cada una con su sitio y su tamaño, y ya se tocan de una
 * en una. No hay vuelta atrás automática —para eso está deshacer—, y lo que se
 * pinta sobre un cuerpo en vez de ser un cuerpo (la saetera del torreón) se
 * queda por el camino: cada pieza lo avisa en su `explodeNota`.
 *
 * Estos dos atajos arman las piezas que salen de ahí, llevándose de la original
 * el material y la textura, que es lo que hace que las sueltas se vean como se
 * veía la de antes.
 */
function caja(p, x, y, z, w, d, h) {
  const c = { k: 'box', x, y, z, w, d, h, yaw: 0, m: p.m };
  if (p.rough) c.rough = true;
  return c;
}

function viga(p, x, y, z, len, yaw, pitch, th) {
  const v = { k: 'beam', x, y, z, len, yaw, pitch, th, m: p.m };
  if (p.rough) v.rough = true;
  return v;
}

/** ¿Está hecha de otras piezas y se puede deshacer en ellas? */
export function canExplode(k) { return !!(PARTS[k] && PARTS[k].explode && !PARTS[k].mine); }

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

  brick: {
    label: 'Ladrillo', glyph: '▭',
    hint: 'Un ladrillo con su junta. Duplícalo para correr una hilada, rematar un canto o marcar un dintel.',
    fields: ['x', 'y', 'z', 'w', 'd', 'h', 'yaw'],
    def: { x: 1, y: 1, z: 0, w: 0.26, d: 0.12, h: 0.08, yaw: 0, m: 'wall' },
    build(out, p, c) {
      const col = matColor(p, c), o = { ...matOpts(p), yaw: rad(p.yaw) };
      /*
       * Dos cuerpos para que un ladrillo encima de otro se lea como dos y no
       * como un bloque: la junta, una losa fina y más apagada del tamaño de la
       * huella, y encima el ladrillo, un pelo metido por los cuatro lados.
       */
      const junta = Math.min(0.02, p.h * 0.3);
      box(out, p.x, p.y, p.z, p.w, p.d, junta, tone(col, -0.2), o);
      const mete = Math.min(0.012, Math.min(p.w, p.d) * 0.12);
      box(out, p.x, p.y, p.z + junta, Math.max(0.01, p.w - mete * 2),
        Math.max(0.01, p.d - mete * 2), Math.max(0.01, p.h - junta), col, o);
    },
  },

  wedge: {
    label: 'Cuña', glyph: '◺',
    hint: 'Una caja con la tapa caída de un lado: rampas, contrafuertes, chaflanes.',
    fields: ['x', 'y', 'z', 'w', 'd', 'h', 'yaw'],
    def: { x: 1, y: 1, z: 0, w: 0.8, d: 0.8, h: 0.5, yaw: 0, m: 'base' },
    build(out, p, c) {
      place(out, wedgeMesh(p, matColor(p, c), matOpts(p)), p);
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

  pipe: {
    label: 'Tubo', glyph: '◎',
    hint: 'Cilindro hueco: pozos, brocales, chimeneas, aljibes, torres abiertas.',
    fields: ['x', 'y', 'z', 'r', 'th', 'h', 'seg'],
    def: { x: 1, y: 1, z: 0, r: 0.3, th: 0.08, h: 0.45, seg: 9, m: 'stone' },
    build(out, p, c) {
      place(out, pipeMesh(p, matColor(p, c), matOpts(p)), p);
    },
  },

  dome: {
    label: 'Cúpula', glyph: '●',
    hint: 'Esfera achatable: cúpulas, sacos, montones, pajares.',
    fields: ['x', 'y', 'z', 'r', 'flat', 'seg'],
    def: { x: 1, y: 1, z: 0, r: 0.4, flat: 1, seg: 8, m: 'wall' },
    build(out, p, c) {
      // El taller cuenta la z desde la base de la pieza, no desde su centro.
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

  vault: {
    label: 'Bóveda', glyph: '◠',
    hint: 'Medio cilindro tumbado: túneles, naves, puentes, tejados curvos. La curva corre por el eje elegido.',
    fields: ['x', 'y', 'z', 'w', 'd', 'rise', 'axis', 'seg'],
    def: { x: 1, y: 1, z: 0, w: 1.2, d: 0.9, rise: 0.45, axis: 'x', seg: 8, m: 'stone' },
    build(out, p, c) {
      place(out, vaultMesh(p, matColor(p, c), matOpts(p)), p);
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

  teja: {
    label: 'Teja', glyph: '◡',
    hint: 'Una teja curva de canal. Duplícala para correr una hilada, o agrándala para un tejadillo o un caballete.',
    fields: ['x', 'y', 'z', 'len', 'w', 'rise', 'th', 'axis', 'seg'],
    def: { x: 1, y: 1, z: 0, len: 0.5, w: 0.22, rise: 0.09, th: 0.025, axis: 'x', seg: 6, m: 'roof' },
    build(out, p, c) {
      place(out, tejaMesh(p, matColor(p, c), matOpts(p)), p);
    },
  },

  escama: {
    label: 'Escama', glyph: '⌒',
    hint: 'Teja plana de frente redondo: pizarra, cola de castor. Duplícala y solápala por hiladas, cada una a medio paso de la de abajo.',
    fields: ['x', 'y', 'z', 'len', 'w', 'rise', 'th', 'axis', 'seg'],
    def: { x: 1, y: 1, z: 0, len: 0.26, w: 0.22, rise: 0.03, th: 0.02, axis: 'x', seg: 8, m: 'stone' },
    build(out, p, c) {
      place(out, escamaMesh(p, matColor(p, c), matOpts(p)), p);
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

  arch: {
    label: 'Arco', glyph: '∩',
    hint: 'Un paño con el hueco de medio punto: puertas de muralla, acueductos, soportales.',
    fields: ['x', 'y', 'z', 'w', 'd', 'h', 'th', 'yaw', 'seg'],
    def: { x: 1, y: 1, z: 0, w: 1.1, d: 0.3, h: 1, th: 0.22, yaw: 0, seg: 9, m: 'stone' },
    build(out, p, c) {
      place(out, archMesh(p, matColor(p, c), matOpts(p)), p);
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

  ring: {
    label: 'Aro', glyph: '○',
    hint: 'Una rosca tumbada: cercos de pozo, zunchos, coronas, argollas.',
    fields: ['x', 'y', 'z', 'r', 'th', 'seg'],
    def: { x: 1, y: 1, z: 0, r: 0.3, th: 0.08, seg: 9, m: 'wood' },
    build(out, p, c) {
      place(out, ringMesh(p, matColor(p, c), matOpts(p)), p);
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
    explode(p) {
      // Lo mismo que dibuja `battlements`, pero en piezas: el antepecho y sus
      // merlones. Las esquinas las pintan dos lados, así que se descartan las
      // repetidas: puestas dos veces se verían igual y estorbarían el doble.
      const out = [caja(p, p.x, p.y, p.z, p.w + 0.1, p.d + 0.1, 0.1)];
      const x0 = p.x - p.w / 2, y0 = p.y - p.d / 2, x1 = p.x + p.w / 2, y1 = p.y + p.d / 2;
      const step = 0.34;
      const bordes = [
        [[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]],
        [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]],
      ];
      const puestos = new Set();
      for (const [[ax, ay], [bx, by]] of bordes) {
        const len = Math.hypot(bx - ax, by - ay);
        const n = Math.max(2, Math.floor(len / step));
        for (let i = 0; i <= n; i += 2) {
          const t = i / n;
          const mx = ax + (bx - ax) * t, my = ay + (by - ay) * t;
          const sitio = `${mx.toFixed(3)},${my.toFixed(3)}`;
          if (puestos.has(sitio)) continue;
          puestos.add(sitio);
          out.push({ ...caja(p, mx, my, p.z + 0.1, 0.14, 0.14, 0.14), noshadow: true });
        }
      }
      return out;
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
    // La saetera es un hueco pintado sobre el fuste, no un cuerpo: al deshacer
    // la torre en piezas se queda por el camino, y el taller lo avisa.
    explodeNota: 'Pierde la saetera, que no es una pieza suelta.',
    explode(p) {
      const out = [
        { k: 'cyl', x: p.x, y: p.y, z: p.z, r0: p.r * 1.12, r1: p.r, h: p.h, seg: 10, m: p.m },
        { k: 'cyl', x: p.x, y: p.y, z: p.z + p.h, r0: p.r * 1.14, r1: p.r * 1.14, h: 0.08, seg: 10, m: p.m },
      ];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        out.push({
          ...caja(p, p.x + Math.cos(a) * p.r * 1.02, p.y + Math.sin(a) * p.r * 1.02,
            p.z + p.h + 0.08, 0.12, 0.12, 0.14),
          noshadow: true,
        });
      }
      return out;
    },
  },

  door: {
    label: 'Puerta', glyph: '□',
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
      const sd = p.d / n;
      /*
       * Cada peldaño es una losa suya, pegada a la siguiente y sin meterse
       * dentro de ella. Antes cada uno abarcaba desde el fondo, así que unos
       * quedaban metidos dentro de otros: el horneado lo resolvía con su
       * z-buffer, pero cualquier dibujo por orden de lejanía —el del propio
       * taller— no tiene forma de ordenar dos cuerpos que se solapan, y la
       * escalera salía deshecha. Con losas contiguas la silueta es la misma y
       * no hay nada que ordenar.
       */
      for (let i = 0; i < n; i++) {
        const rise = p.h * ((i + 1) / n);
        if (p.axis === 'x') {
          box(out, p.x + p.d / 2 - (i + 0.5) * sd, p.y, p.z, sd, p.w, rise, col, o);
        } else {
          box(out, p.x, p.y + p.d / 2 - (i + 0.5) * sd, p.z, p.w, sd, rise, col, o);
        }
      }
    },
    explode(p) {
      const out = [];
      const n = Math.round(p.steps), sd = p.d / n;
      for (let i = 0; i < n; i++) {
        const rise = p.h * ((i + 1) / n);
        out.push(p.axis === 'x'
          ? caja(p, p.x + p.d / 2 - (i + 0.5) * sd, p.y, p.z, sd, p.w, rise)
          : caja(p, p.x, p.y + p.d / 2 - (i + 0.5) * sd, p.z, p.w, sd, rise));
      }
      return out;
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
    explode(p) {
      const out = [];
      const bx = p.x + p.len * Math.cos(rad(p.yaw)), by = p.y + p.len * Math.sin(rad(p.yaw));
      const n = Math.max(1, Math.round(p.len / 0.45));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        out.push(viga(p, p.x + (bx - p.x) * t, p.y + (by - p.y) * t, p.z, p.h, 0, 90, 0.03));
      }
      for (const k of [0.45, 0.85]) {
        out.push({ ...viga(p, p.x, p.y, p.z + p.h * k, p.len, p.yaw, 0, 0.02), noshadow: true });
      }
      return out;
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
    explode(p) {
      const out = [];
      const n = Math.round(p.n);
      for (let i = 0; i < n; i++) {
        const z = 0.06 + Math.floor(i / 3) * 0.11;
        const off = (i % 3) * 0.12 - 0.12 + (Math.floor(i / 3) % 2) * 0.06;
        out.push(viga(p, p.x - p.len / 2, p.y + off, p.z + z, p.len, 0, 0, 0.06));
      }
      return out;
    },
  },

  barrel: {
    label: 'Barril', glyph: '◍',
    hint: 'Un tonel; repítelo para llenar un almacén o un mercado. Estíralo y sale una cuba, un bidón o un tonelete.',
    fields: ['x', 'y', 'z', 'r', 'h', 'seg'],
    def: { x: 1, y: 1, z: 0, r: 0.09, h: 0.18, seg: 7, m: 'wood' },
    build(out, p, c) {
      lifted(out, p.z, (o) => barrel(o, p.x, p.y, matColor(p, c),
        { ...matOpts(p), r: p.r, h: p.h, seg: p.seg }));
    },
  },
};

/** Las que trae el juego. Las propias van aparte, que se hacen y se deshacen. */
export const PART_KEYS = Object.keys(PARTS);

/*
 * El catálogo, partido en dos.
 *
 * **Básicas** son las de un solo cuerpo: una caja, un cilindro, una viga. Con
 * ellas se hace todo lo demás, y son las que se quieren delante cuando lo que
 * se está haciendo es una pieza del taller: ahí se busca el detalle, y el
 * detalle se saca de formas sueltas.
 *
 * **Compuestas** son las que ya traen varias en una —unas almenas, una cerca,
 * un torreón—. Puestas en un edificio ahorran media tarde; dentro de una pieza
 * del taller son un atajo que a veces viene bien, pero no es por donde se
 * empieza. Casi todas se pueden deshacer en sus partes (`explode`).
 */
const BASICAS = new Set([
  'box', 'brick', 'wedge', 'cyl', 'pipe', 'dome', 'gable', 'hip', 'vault',
  'panel', 'teja', 'escama', 'beam', 'arch', 'wheel', 'ring', 'barrel',
]);

/** ¿Es una pieza de un solo cuerpo? */
export function isBasic(k) { return BASICAS.has(k); }

export const BASIC_KEYS = PART_KEYS.filter(isBasic);
export const COMPOSITE_KEYS = PART_KEYS.filter((k) => !isBasic(k));

// --- Piezas propias ----------------------------------------------------------

/*
 * Además de las de arriba, que son código, el taller deja hacer piezas nuevas
 * componiéndolas con éstas: una reja, una ventana con su marco, un torreón
 * rematado. Una pieza propia es **datos** —una lista de piezas del juego— y se
 * da de alta aquí, así que el resto del juego no nota la diferencia:
 * `PARTS['mia:reja']` se dibuja, se hornea y se valida igual que la caja.
 *
 * No se anidan: una pieza propia se compone sólo con las del juego. Así no hay
 * forma de que una se contenga a sí misma, ni de que una cadena larga cueste
 * una eternidad de dibujar.
 */
export const MINE = 'mia:';

/** ¿Es una pieza de las que se hacen en el taller? */
export function isMine(k) { return typeof k === 'string' && k.startsWith(MINE); }

/** Los límites de una malla: lo que ocupa, para poder llevarla a otra caja. */
export function meshBounds(tris) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const t of tris) {
    for (const q of t.p) {
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[1] > y1) y1 = q[1];
      if (q[2] < z0) z0 = q[2];
      if (q[2] > z1) z1 = q[2];
    }
  }
  return tris.length ? { x0, y0, z0, x1, y1, z1 } : { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 };
}

/** La malla de una pieza propia en sus propias medidas, sin colocar. */
export function pieceMesh(def, c) {
  const tris = [];
  for (const sub of def.parts || []) {
    const spec = PARTS[sub.k];
    // Ni piezas que no existen ni piezas propias dentro de otra.
    if (!spec || spec.mine) continue;
    // Cada una en su montón, que los giros de fuera son suyos y no de la de al
    // lado; luego se juntan.
    const suyos = [];
    try { spec.build(suyos, sub, c); } catch { /* una rota no tumba a las demás */ }
    tiltMesh(suyos, sub);
    for (const t of suyos) tris.push(t);
  }
  return tris;
}

/*
 * Cómo se coloca una pieza propia dentro de un modelo: dónde va, en qué caja
 * cabe y cuánto se gira. Es el mismo juego de mandos para todas —lo que cambia
 * de una a otra es lo que llevan dentro, no cómo se ponen—, y por eso se pueden
 * nombrar aquí, sueltos de ninguna pieza en concreto: con ellos, un modelo que
 * mencione una pieza que todavía no ha llegado se sigue entendiendo entero.
 */
export const PIECE_FIELDS = ['x', 'y', 'z', 'w', 'd', 'h', 'yaw'];
export const PIECE_DEF = { x: 1, y: 1, z: 0, w: 1, d: 1, h: 1, yaw: 0, m: 'wall' };

/**
 * Una clave de pieza propia con la forma que debe tener. Sirve para reconocer
 * una referencia sin resolver —`mia:reja` en un modelo cuya pieza aún no está
 * de alta— y distinguirla de un `mia:` cualquiera colado a mano.
 */
export function isMineKey(k) {
  return isMine(k) && /^[a-z][a-z0-9-]{2,31}$/.test(k.slice(MINE.length));
}

/**
 * Da de alta una pieza propia, o la rehace si ya estaba. Al colocarla se la
 * lleva a la caja que se le pida —ancho, fondo y alto—, centrada en su sitio y
 * apoyada en su altura, para que se estire y se gire como cualquier otra.
 */
export function registerPiece(def) {
  const talla = def.talla || { w: 1, d: 1, h: 1 };
  PARTS[MINE + def.key] = {
    label: def.label,
    glyph: '◆',
    hint: 'Pieza hecha en el taller. Cambiarla cambia todo lo que la lleve.',
    mine: true,
    fields: PIECE_FIELDS,
    def: { ...PIECE_DEF, w: talla.w, d: talla.d, h: talla.h },
    build(out, p, c) {
      const tris = pieceMesh(def, c);
      if (!tris.length) return;
      const b = meshBounds(tris);
      const lw = Math.max(1e-4, b.x1 - b.x0);
      const ld = Math.max(1e-4, b.y1 - b.y0);
      const lh = Math.max(1e-4, b.z1 - b.z0);
      const sx = (p.w || lw) / lw, sy = (p.d || ld) / ld, sz = (p.h || lh) / lh;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      mapVerts(tris, (q) => [(q[0] - cx) * sx, (q[1] - cy) * sy, (q[2] - b.z0) * sz]);
      if (p.yaw) rotZ(tris, rad(p.yaw));
      translate(tris, p.x, p.y, p.z);
      for (const t of tris) out.push(t);
    },
  };
}

/** La quita del catálogo. Lo que la llevara puesta deja de dibujarse. */
export function unregisterPiece(key) { delete PARTS[MINE + key]; }

/** Las propias que hay dadas de alta ahora mismo. */
export function minePartKeys() { return Object.keys(PARTS).filter(isMine); }

// --- De modelo a malla -------------------------------------------------------

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
 * convierte cualquier modelo en una etapa "a medias" creíble sin que su autor
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
 * Malla de un modelo repartida por piezas: `[{ part, tris }]`. El taller la
 * usa para saber qué pieza hay bajo el ratón y para resaltar la elegida; el
 * juego se queda sólo con los triángulos.
 */
export function designParts(design, colorIdx = 0, stage = 2, live = false) {
  const M = paletteOf(design, live);
  const C = PLAYER_COLORS[colorIdx] || PLAYER_COLORS[0];
  const s = renderSize(design);
  // Si el modelo se hizo sobre otra huella (por ejemplo, uno de tres casillas
  // puesto a vestir la casa, que mide dos), se ajusta entero a la de verdad en
  // vez de salirse de ella. El validador lo deja ya adaptado; esto es la red de
  // seguridad para un modelo que se pase a mano desde la consola.
  const k = s / (design.size || s);
  const c = { M, C, s };
  srand(hash(design.target || 'x') + stage * 7 + 1);

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
      tiltMesh(tris, part);
      if (k !== 1) scaleMesh(tris, k);
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

/** Malla completa de un modelo, lista para hornear. */
export function designMesh(design, colorIdx = 0, stage = 2, live = false) {
  const out = [];
  for (const g of designParts(design, colorIdx, stage, live)) {
    for (const t of g.tris) out.push(t);
  }
  return out;
}

/** Cuántos triángulos gasta un modelo: el taller lo enseña como presupuesto. */
export function triangleCount(design) {
  let n = 0;
  for (const g of designParts(design, 0, 2)) n += g.tris.length;
  return n;
}
