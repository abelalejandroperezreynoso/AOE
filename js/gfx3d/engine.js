// Motor de pre-renderizado: modelos 3D de polígonos bajos rasterizados por
// software a sprites isométricos 2D, igual que hacía el juego clásico con sus
// modelos de estudio. Todo ocurre en tiempo de carga (y bajo demanda): el juego
// en marcha sólo copia mapas de bits ya horneados.
//
// La cámara es la dimétrica 2:1 del propio juego: un punto (x, y, z) del mundo
// —x e y en casillas, z hacia arriba en la misma unidad de longitud— se
// proyecta a pantalla igual que el resto del renderizador, así que los sprites
// encajan en la rejilla sin ajuste ninguno.

import { TILE_W, TILE_H } from '../config.js';

export const HW = TILE_W / 2; // 32 px por casilla en x de pantalla
export const HH = TILE_H / 2; // 16 px por casilla en y de pantalla
// Altura en pantalla de una unidad de longitud vertical. Con la inclinación de
// 30° que da la proporción 2:1, una longitud vertical se acorta cos(30°) del
// paso horizontal (64/√2 px por unidad): eso es lo que hace que un cubo del
// mundo parezca un cubo y no una caja estirada.
export const VZ = Math.round((TILE_W / Math.SQRT2) * Math.cos(Math.PI / 6)); // 39

// El sol: alto y por la derecha de la pantalla, como en el clásico, de modo que
// los techos quedan a plena luz, la cara sureste a media y la suroeste en
// sombra.
const SUN = normalize([0.346, -0.456, 0.82]); // apunta HACIA el sol
const AMBIENT = 0.44;
const DIFFUSE = 0.62;
/*
 * La sombra arrojada va aparte de la luz, como en el original (sus sombras
 * están pintadas, no calculadas): cae hacia abajo a la izquierda de la
 * pantalla y acortada, para que un árbol de dos casillas de alto no tape media
 * pantalla. Es el desplazamiento en el suelo por unidad de altura.
 */
const SHADOW_DX = 0.1;
const SHADOW_DY = 0.52;
const SHADOW_ALPHA = 96;

// Resolución del horneado: píxeles de lienzo por píxel de mundo. A 2× los
// sprites salen nítidos en pantallas densas y al ampliar la cámara se ven los
// píxeles gordos, que es justo como envejecía el original al acercarse.
const OUT = 2;
// Sobremuestreo del rasterizador antes de reducir: da el borde limpio y el
// interior suavizado de un render de estudio sin depender del antialias del
// navegador (que no existe en un z-buffer propio).
const SS = 2;

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

// --- Colores -----------------------------------------------------------------

const rgbCache = new Map();

/** '#rrggbb' → [r, g, b]. Acepta también un array ya convertido. */
export function rgb(c) {
  if (Array.isArray(c)) return c;
  let v = rgbCache.get(c);
  if (v) return v;
  const n = parseInt(String(c).replace('#', ''), 16) || 0;
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(c, v);
  return v;
}

/** Aclara (k>0) u oscurece (k<0) un color rgb. */
export function tone(c, k) {
  c = rgb(c);
  if (k >= 0) {
    return [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k];
  }
  const m = 1 + k;
  return [c[0] * m, c[1] * m, c[2] * m];
}

/** Mezcla dos colores rgb. */
export function blend(a, b, t) {
  a = rgb(a); b = rgb(b);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// --- Azar repetible ----------------------------------------------------------

// Los modelos con vetas o follaje piden números al azar; van con semilla para
// que el mismo objeto se hornee siempre idéntico.
let seed = 1;
export function srand(s) { seed = (s * 9301 + 49297) % 233280 || 1; }
export function rand() {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}

// --- Construcción de mallas --------------------------------------------------
//
// Una malla es un array de triángulos { p: [[x,y,z]×3], c: [r,g,b], ... }.
// Banderas por triángulo:
//   unlit:    se pinta con su color tal cual, sin luz (brasas, estandartes).
//   noshadow: no arroja sombra al suelo.
//   bias:     empuja su profundidad para ganar a la cara en la que se apoya
//             (puertas, ventanas y demás "calcomanías").
//   rough:    varía el tono de la cara al azar (follaje, roca, bálago).

export function tri(out, a, b, c, color, o) {
  const t = { p: [a, b, c], c: rgb(color) };
  if (o) {
    if (o.unlit) t.unlit = true;
    if (o.noshadow) t.noshadow = true;
    if (o.bias) t.bias = o.bias;
    if (o.rough) t.c = tone(t.c, (rand() - 0.5) * o.rough);
  }
  out.push(t);
  return t;
}

export function quad(out, a, b, c, d, color, o) {
  // Las dos mitades con el mismo tono (rough se calcula una vez).
  const col = o && o.rough ? tone(color, (rand() - 0.5) * o.rough) : rgb(color);
  const o2 = o ? { ...o, rough: 0 } : undefined;
  tri(out, a, b, c, col, o2);
  tri(out, a, c, d, col, o2);
}

/** Caja centrada en (cx, cy), de z0 a z0+h, con giro opcional sobre z. */
export function box(out, cx, cy, z0, w, d, h, color, o) {
  const yaw = (o && o.yaw) || 0;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const P = (u, v, z) => [cx + u * cs - v * sn, cy + u * sn + v * cs, z];
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2, z1 = z0 + h;
  const a0 = P(x0, y0, z0), b0 = P(x1, y0, z0), c0 = P(x1, y1, z0), d0 = P(x0, y1, z0);
  const a1 = P(x0, y0, z1), b1 = P(x1, y0, z1), c1 = P(x1, y1, z1), d1 = P(x0, y1, z1);
  quad(out, a1, b1, c1, d1, color, o);            // tapa
  quad(out, b0, c0, c1, b1, color, o);            // cara +x
  quad(out, c0, d0, d1, c1, color, o);            // cara +y
  quad(out, a0, b0, b1, a1, color, o);            // cara -y
  quad(out, d0, a0, a1, d1, color, o);            // cara -x
  if (o && o.bottom) quad(out, d0, c0, b0, a0, color, o);
}

/** Cilindro (o cono truncado) vertical; r0 abajo, r1 arriba. */
export function cyl(out, cx, cy, z0, r0, r1, h, color, o) {
  const seg = (o && o.seg) || 8;
  const yaw = (o && o.yaw) || 0;
  for (let i = 0; i < seg; i++) {
    const a0 = yaw + (i / seg) * Math.PI * 2, a1 = yaw + ((i + 1) / seg) * Math.PI * 2;
    const p00 = [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, z0];
    const p01 = [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0, z0];
    const p10 = [cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1, z0 + h];
    const p11 = [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, z0 + h];
    quad(out, p00, p01, p11, p10, color, o);
    if (r1 > 0.001) tri(out, [cx, cy, z0 + h], p10, p11, color, o);
  }
}

/**
 * Superficie de revolución: perfil de pares [radio, z] girado alrededor del eje
 * vertical que pasa por (cx, cy). Vale para esferas, copas de árbol o rocas.
 */
export function lathe(out, cx, cy, profile, color, o) {
  const seg = (o && o.seg) || 8;
  const sq = (o && o.squash) || 1; // achatado en x/y (elipses)
  for (let j = 0; j < profile.length - 1; j++) {
    const [r0, z0] = profile[j], [r1, z1] = profile[j + 1];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p00 = [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0 * sq, z0];
      const p01 = [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0 * sq, z0];
      const p10 = [cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1 * sq, z1];
      const p11 = [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1 * sq, z1];
      if (r0 < 0.001) tri(out, p00, p11, p10, color, o);
      else if (r1 < 0.001) tri(out, p00, p01, p10, color, o);
      else quad(out, p00, p01, p11, p10, color, o);
    }
  }
}

/** Esfera (achatable) de pocos gajos: cabezas, follaje, piedras. */
export function sphere(out, cx, cy, cz, r, color, o) {
  const rings = (o && o.rings) || 4;
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + (i / rings) * Math.PI;
    prof.push([Math.cos(a) * r, cz + Math.sin(a) * r * ((o && o.flat) || 1)]);
  }
  lathe(out, cx, cy, prof, color, o);
}

/**
 * Miembro: caja orientada del punto a al punto b, de grosor 2r. Con esto se
 * posan brazos, piernas, lanzas o ramas sin necesidad de esqueleto.
 */
export function limb(out, a, b, r, color, o) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  const ax = [d[0] / len, d[1] / len, d[2] / len];
  // Un vector cualquiera no paralelo para montar la base ortonormal.
  const ref = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = [
    ax[1] * ref[2] - ax[2] * ref[1],
    ax[2] * ref[0] - ax[0] * ref[2],
    ax[0] * ref[1] - ax[1] * ref[0],
  ];
  u = normalize(u);
  const v = [
    ax[1] * u[2] - ax[2] * u[1],
    ax[2] * u[0] - ax[0] * u[2],
    ax[0] * u[1] - ax[1] * u[0],
  ];
  const r2 = (o && o.r2) !== undefined ? o.r2 : r; // grosor en el extremo b
  const corner = (p, rr, su, sv) => [
    p[0] + u[0] * rr * su + v[0] * rr * sv,
    p[1] + u[1] * rr * su + v[1] * rr * sv,
    p[2] + u[2] * rr * su + v[2] * rr * sv,
  ];
  const A = [corner(a, r, 1, 1), corner(a, r, -1, 1), corner(a, r, -1, -1), corner(a, r, 1, -1)];
  const B = [corner(b, r2, 1, 1), corner(b, r2, -1, 1), corner(b, r2, -1, -1), corner(b, r2, 1, -1)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(out, A[i], A[j], B[j], B[i], color, o);
  }
  quad(out, B[0], B[1], B[2], B[3], color, o);
  quad(out, A[3], A[2], A[1], A[0], color, o);
}

/**
 * Rueda: disco de eje horizontal. `axis` 'x' o 'y' es la dirección del eje;
 * el radio vive en el plano vertical perpendicular. Ruedas de asedio y carros,
 * aspas del molino, piedras de afilar.
 */
export function wheel(out, cx, cy, cz, r, th, color, o) {
  const seg = (o && o.seg) || 10;
  const ax = (o && o.axis) === 'x';
  const P = (a, s) => ax
    ? [cx + s * th / 2, cy + Math.cos(a) * r, cz + Math.sin(a) * r]
    : [cx + Math.cos(a) * r, cy + s * th / 2, cz + Math.sin(a) * r];
  const C = (s) => (ax ? [cx + s * th / 2, cy, cz] : [cx, cy + s * th / 2, cz]);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    quad(out, P(a0, -1), P(a1, -1), P(a1, 1), P(a0, 1), color, o);
    tri(out, C(1), P(a0, 1), P(a1, 1), color, o);
    tri(out, C(-1), P(a1, -1), P(a0, -1), color, o);
  }
}

// --- Transformaciones (mutan la malla; los constructores crean vértices nuevos)

export function mapVerts(tris, fn) {
  for (const t of tris) {
    for (let i = 0; i < 3; i++) t.p[i] = fn(t.p[i]);
  }
  return tris;
}

export function translate(tris, dx, dy, dz) {
  return mapVerts(tris, (p) => [p[0] + dx, p[1] + dy, p[2] + dz]);
}

/** Giro alrededor del eje vertical que pasa por (cx, cy). */
export function rotZ(tris, ang, cx = 0, cy = 0) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return mapVerts(tris, (p) => [
    cx + (p[0] - cx) * cs - (p[1] - cy) * sn,
    cy + (p[0] - cx) * sn + (p[1] - cy) * cs,
    p[2],
  ]);
}

/** Giro alrededor de un eje paralelo a x que pasa por (y=cy, z=cz): cabecear. */
export function rotX(tris, ang, cy = 0, cz = 0) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return mapVerts(tris, (p) => [
    p[0],
    cy + (p[1] - cy) * cs - (p[2] - cz) * sn,
    cz + (p[1] - cy) * sn + (p[2] - cz) * cs,
  ]);
}

/** Giro alrededor de un eje paralelo a y que pasa por (x=cx, z=cz): inclinar. */
export function rotY(tris, ang, cx = 0, cz = 0) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return mapVerts(tris, (p) => [
    cx + (p[0] - cx) * cs + (p[2] - cz) * sn,
    p[1],
    cz - (p[0] - cx) * sn + (p[2] - cz) * cs,
  ]);
}

export function scaleMesh(tris, s) {
  return mapVerts(tris, (p) => [p[0] * s, p[1] * s, p[2] * s]);
}

/**
 * Copia espejada respecto al plano y=0 (nuevos triángulos, los de entrada no
 * se tocan). Para modelar una mitad simétrica y doblarla:
 * `out.push(...mirrorY(mitad))`.
 */
export function mirrorY(tris) {
  return tris.map((t) => ({
    ...t,
    p: t.p.map((p) => [p[0], -p[1], p[2]]),
  }));
}

/**
 * Tubo: cadena de tramos por una lista de puntos, con juntas redondeadas.
 * Cuerdas, arcos, ramas, colas, penachos... `r` puede ser un número o una
 * función r(i) por punto, para tubos que se afinan.
 */
export function tube(out, pts, r, color, o) {
  const rad = typeof r === 'function' ? r : () => r;
  for (let i = 0; i < pts.length - 1; i++) {
    limb(out, pts[i], pts[i + 1], rad(i), color, { ...(o || {}), r2: rad(i + 1) });
    if (i > 0) sphere(out, pts[i][0], pts[i][1], pts[i][2], rad(i) * 1.15, color, { rings: 2, seg: 5, ...(o || {}) });
  }
}

// --- Rasterizador ------------------------------------------------------------

/** Punto del mundo a píxeles de pantalla, con la cámara dimétrica del juego. */
export function project(p) {
  return [(p[0] - p[1]) * HW, (p[0] + p[1]) * HH - p[2] * VZ];
}

/*
 * Profundidad a lo largo de la mirada de la cámara: menor = más cerca. La
 * cámara está en el lado de x+y grande, en alto y mirando hacia abajo, así que
 * acercarse a ella es crecer en x+y y en z; de ahí los dos signos negativos.
 */
/** Distancia a la cámara: menor, más cerca. */
export function depth(p) {
  return -(p[0] + p[1]) * 0.6116 - p[2] * 0.5018;
}

/**
 * Cuánta luz recibe una cara: iluminación plana, la normal siempre mirando a la
 * cámara (así las caras valen por los dos lados). El visor en vivo del taller la
 * usa también, de modo que lo que se ve mientras se modela está iluminado
 * exactamente igual que el sprite horneado.
 */
export function faceLight(t) {
  if (t.unlit) return 1;
  const [a, b, c] = t.p;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = normalize([
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ]);
  // La mirada (hacia dentro de la escena) es (-0.61, -0.61, -0.50).
  if (n[0] * -0.6116 + n[1] * -0.6116 + n[2] * -0.5018 > 0) n = [-n[0], -n[1], -n[2]];
  const lam = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
  return AMBIENT + DIFFUSE * lam;
}

// Búferes de trabajo reutilizados entre horneados: el más grande (un castillo)
// se queda reservado y el resto cabe dentro.
let bufW = 0, bufH = 0;
let zbuf = null, cbuf = null, sbuf = null;

function ensureBuffers(w, h) {
  if (w <= bufW && h <= bufH) return;
  bufW = Math.max(bufW, w); bufH = Math.max(bufH, h);
  zbuf = new Float32Array(bufW * bufH);
  cbuf = new Uint8ClampedArray(bufW * bufH * 4);
  sbuf = new Uint8Array(bufW * bufH);
}

/**
 * Hornea una malla y devuelve el sprite: { canvas, ox, oy, w, h } con las
 * medidas y el anclaje en píxeles de mundo, como espera drawSprite. El anclaje
 * es la proyección del origen del modelo: los pies de la unidad, la esquina
 * superior de la huella del edificio o el centro del rombo del recurso.
 */
export function bake(tris, opts = {}) {
  const pad = opts.pad !== undefined ? opts.pad : 2;
  // Resolución del horneado (píxeles de lienzo por píxel de mundo). El juego
  // usa la de serie; el visor de modelos pide más para inspeccionar de cerca.
  const res = opts.res || OUT;

  // Extensión en pantalla de la geometría y de su sombra.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tris) {
    for (const p of t.p) {
      const [sx, sy] = project(p);
      if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
      if (!t.noshadow && p[2] > 0.001) {
        const [hx, hy] = project([p[0] + SHADOW_DX * p[2], p[1] + SHADOW_DY * p[2], 0]);
        if (hx < minX) minX = hx; if (hx > maxX) maxX = hx;
        if (hy < minY) minY = hy; if (hy > maxY) maxY = hy;
      }
    }
  }
  if (minX > maxX) { minX = minY = 0; maxX = maxY = 1; }
  minX = Math.floor(minX) - pad; minY = Math.floor(minY) - pad;
  maxX = Math.ceil(maxX) + pad; maxY = Math.ceil(maxY) + pad;

  const outW = Math.max(1, (maxX - minX) * res);
  const outH = Math.max(1, (maxY - minY) * res);
  const W = outW * SS, H = outH * SS;
  ensureBuffers(W, H);
  zbuf.fill(1e9, 0, W * H);
  sbuf.fill(0, 0, W * H);
  cbuf.fill(0, 0, W * H * 4);

  const SC = res * SS;
  const toRX = (sx) => (sx - minX) * SC;
  const toRY = (sy) => (sy - minY) * SC;

  for (const t of tris) {
    // Sombra arrojada: la silueta aplastada sobre el suelo.
    if (!t.noshadow) {
      const q = t.p.map((p) => project([p[0] + SHADOW_DX * p[2], p[1] + SHADOW_DY * p[2], 0]));
      fillMask(q.map(([sx, sy]) => [toRX(sx), toRY(sy)]), W, H);
    }

    const light = faceLight(t);
    const r = Math.min(255, t.c[0] * light);
    const g = Math.min(255, t.c[1] * light);
    const bl = Math.min(255, t.c[2] * light);

    rasterTri(t, r, g, bl, toRX, toRY, W, H);
  }

  return compose(outW, outH, W, minX, minY, opts, res);
}

/** Marca en el búfer de sombra el triángulo 2D dado en coordenadas de raster. */
function fillMask(q, W, H) {
  let x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])));
  let x1 = Math.min(W - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])));
  let y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])));
  let y1 = Math.min(H - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])));
  if (x1 < x0 || y1 < y0) return;
  let [ax, ay] = q[0], [bx, by] = q[1], [cx, cy] = q[2];
  let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) return;
  if (area < 0) { [bx, by, cx, cy] = [cx, cy, bx, by]; area = -area; }
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    let row = y * W;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const w0 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
      const w1 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
      const w2 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) sbuf[row + x] = 1;
    }
  }
}

function rasterTri(t, r, g, b, toRX, toRY, W, H) {
  const P = t.p.map((p) => {
    const [sx, sy] = project(p);
    return [toRX(sx), toRY(sy), depth(p) - (t.bias || 0)];
  });
  let [A, B, C] = P;
  let area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
  if (Math.abs(area) < 1e-9) return;
  if (area < 0) { const tmp = B; B = C; C = tmp; area = -area; }
  const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
  const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
  const inv = 1 / area;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    const row = y * W;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const w0 = (C[0] - B[0]) * (py - B[1]) - (C[1] - B[1]) * (px - B[0]);
      if (w0 < 0) continue;
      const w1 = (A[0] - C[0]) * (py - C[1]) - (A[1] - C[1]) * (px - C[0]);
      if (w1 < 0) continue;
      const w2 = (B[0] - A[0]) * (py - A[1]) - (B[1] - A[1]) * (px - A[0]);
      if (w2 < 0) continue;
      const z = (w0 * A[2] + w1 * B[2] + w2 * C[2]) * inv;
      const i = row + x;
      if (z >= zbuf[i]) continue;
      zbuf[i] = z;
      const j = i * 4;
      cbuf[j] = r; cbuf[j + 1] = g; cbuf[j + 2] = b; cbuf[j + 3] = 255;
    }
  }
}

/**
 * Reduce el sobremuestreo, endurece el borde, dibuja el contorno oscuro y
 * recorta el lienzo a lo pintado. El resultado es la textura de un sprite
 * clásico: interior suavizado, borde a un bit y perfil oscurecido.
 */
function compose(outW, outH, W, minX, minY, opts, res) {
  const img = new ImageData(outW, outH);
  const d = img.data;
  const solid = new Uint8Array(outW * outH); // 1 geometría, 2 sombra
  let cx0 = outW, cy0 = outH, cx1 = -1, cy1 = -1;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let cov = 0, sh = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = (y * SS + sy) * W + x * SS;
        for (let sx = 0; sx < SS; sx++) {
          const i = row + sx;
          if (cbuf[i * 4 + 3]) {
            cov++;
            r += cbuf[i * 4]; g += cbuf[i * 4 + 1]; b += cbuf[i * 4 + 2];
          }
          if (sbuf[i]) sh++;
        }
      }
      const o = (y * outW + x) * 4;
      if (cov * 2 >= SS * SS) {
        // Cuantización ligera: el escalonado suave de una paleta de 256 colores.
        d[o] = Math.round(r / cov / 6) * 6;
        d[o + 1] = Math.round(g / cov / 6) * 6;
        d[o + 2] = Math.round(b / cov / 6) * 6;
        d[o + 3] = 255;
        solid[y * outW + x] = 1;
      } else if (sh * 2 >= SS * SS && !opts.noShadow) {
        d[o] = 8; d[o + 1] = 10; d[o + 2] = 6; d[o + 3] = SHADOW_ALPHA;
        solid[y * outW + x] = 2;
      } else {
        continue;
      }
      if (x < cx0) cx0 = x; if (x > cx1) cx1 = x;
      if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
    }
  }

  if (cx1 < 0) { cx0 = cy0 = 0; cx1 = cy1 = 0; }

  // Contorno: el píxel opaco que linda con el vacío (o con la sombra) se
  // oscurece. Es lo que separa al sprite del terreno, como en el original.
  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      if (solid[y * outW + x] !== 1) continue;
      const edge =
        (x === 0 || solid[y * outW + x - 1] !== 1) ||
        (x === outW - 1 || solid[y * outW + x + 1] !== 1) ||
        (y === 0 || solid[(y - 1) * outW + x] !== 1) ||
        (y === outH - 1 || solid[(y + 1) * outW + x] !== 1);
      if (!edge) continue;
      const o = (y * outW + x) * 4;
      d[o] *= 0.55; d[o + 1] *= 0.55; d[o + 2] *= 0.55;
    }
  }

  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const cropped = ctx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const src = ((y + cy0) * outW + cx0) * 4;
    cropped.data.set(d.subarray(src, src + cw * 4), y * cw * 4);
  }
  ctx.putImageData(cropped, 0, 0);

  return {
    canvas,
    ox: -minX - cx0 / res,
    oy: -minY - cy0 / res,
    w: cw / res,
    h: ch / res,
  };
}
