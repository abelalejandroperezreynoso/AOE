// Modelos 3D importados: de un .usdz (con una capa por pose) o de un .obj
// (con su .mtl, suelto o en un .zip; uno por pose) a los sprites del juego.
//
// No hay motor 3D: el modelo se pinta una vez, con la misma perspectiva
// isométrica 2:1 del mapa, y se recorta en sprites con el formato del índice
// (ver sprites.js). Lo usan el catálogo, para enseñarlo al momento, y
// tools/importar-modelo.mjs, para dejarlo en assets/sprites: los dos llaman a
// `spritesDeModelo`, así que el juego recibe lo mismo que se vio.
//
// Coordenadas. El mundo se mide aquí en casillas, en un sistema de mano
// derecha: `e` hacia la derecha de la pantalla, `n` hacia el fondo y `h` hacia
// arriba. En la pantalla:
//
//     x = 45,25·e        y = −22,63·n − 39,19·h      (píxeles de mundo)
//
// que es la isométrica 2:1 de las losetas (TILE_W 64, TILE_H 32) vista desde
// 30° de altura. Las casillas del mapa (u, v) están giradas 45° respecto a
// (e, n): u = (e − n)/√2, v = (−e − n)/√2.

import { PLAYER_COLORS } from './config.js';
import { leerUsdc } from './usdz.js';

// --- Lectura de archivos ------------------------------------------------------

const texto = (bytes) => new TextDecoder().decode(bytes);

/**
 * Abre un .zip en el navegador, sin librerías: lee el directorio central y
 * descomprime cada archivo con `DecompressionStream` (Safari 16.4 en adelante).
 * Devuelve { nombre: Uint8Array }, con los nombres sin carpeta.
 */
export async function leerZip(buffer) {
  const b = new Uint8Array(buffer);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // Fin del directorio central: se busca su firma desde el final.
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('No parece un .zip');
  const total = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const archivos = {};
  for (let k = 0; k < total; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('El .zip está dañado');
    const metodo = dv.getUint16(p + 10, true);
    const tam = dv.getUint32(p + 20, true);
    const lNombre = dv.getUint16(p + 28, true), lExtra = dv.getUint16(p + 30, true), lNota = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nombre = texto(b.subarray(p + 46, p + 46 + lNombre));
    p += 46 + lNombre + lExtra + lNota;
    if (nombre.endsWith('/') || nombre.startsWith('__MACOSX/')) continue;
    const ini = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const datos = b.subarray(ini, ini + tam);
    let contenido;
    if (metodo === 0) contenido = datos.slice();
    else if (metodo === 8) {
      const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      contenido = new Uint8Array(await new Response(flujo).arrayBuffer());
    } else throw new Error(`${nombre}: compresión no admitida`);
    archivos[nombre.split('/').pop()] = contenido;
  }
  return archivos;
}

// CRC-32 para escribir el .zip del paquete.
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Escribe un .zip sin comprimir con { nombre: Uint8Array }. */
export function escribirZip(archivos) {
  const partes = [], central = [];
  let pos = 0;
  const enc = new TextEncoder();
  for (const [nombre, datos] of Object.entries(archivos)) {
    const n = enc.encode(nombre), crc = crc32(datos);
    const cab = new DataView(new ArrayBuffer(30));
    cab.setUint32(0, 0x04034b50, true); cab.setUint16(4, 20, true); cab.setUint16(6, 0x800, true);
    cab.setUint16(12, 0x21, true); // 1 de enero de 1980: el cero no es una fecha válida
    cab.setUint32(14, crc, true); cab.setUint32(18, datos.length, true); cab.setUint32(22, datos.length, true);
    cab.setUint16(26, n.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x800, true);
    dir.setUint16(14, 0x21, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, datos.length, true); dir.setUint32(24, datos.length, true);
    dir.setUint16(28, n.length, true); dir.setUint32(42, pos, true);
    partes.push(new Uint8Array(cab.buffer), n, datos);
    central.push(new Uint8Array(dir.buffer), n);
    pos += 30 + n.length + datos.length;
  }
  const tamCentral = central.reduce((s, x) => s + x.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, Object.keys(archivos).length, true); fin.setUint16(10, Object.keys(archivos).length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, pos, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: 'application/zip' });
}

/**
 * Reúne los archivos que se hayan elegido (un .usdz, un .zip, o los .obj con
 * su .mtl) en { nombre: Uint8Array }, descomprimiendo los .zip que haya. Un
 * .usdz se queda tal cual: así va entero en el paquete.
 */
export async function reunirArchivos(lista) {
  const archivos = {};
  for (const f of lista) {
    const datos = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) Object.assign(archivos, await leerZip(datos));
    else archivos[f.name] = datos;
  }
  return archivos;
}

// --- OBJ y MTL ----------------------------------------------------------------

/** Colores difusos de un .mtl: { material: [r, g, b] } en 0..1. */
function leerMtl(src) {
  const mats = {};
  let actual = null;
  for (const linea of src.split(/\r?\n/)) {
    const t = linea.trim().split(/\s+/);
    if (t[0] === 'newmtl') { actual = t.slice(1).join(' '); mats[actual] = { kd: [0.7, 0.7, 0.7] }; }
    else if (actual && t[0] === 'Kd') mats[actual].kd = t.slice(1, 4).map(Number);
    else if (actual && t[0] === 'map_Kd') mats[actual].textura = t.slice(1).join(' ');
  }
  return mats;
}

/**
 * Un material es «del jugador» —se pinta con su color— si su nombre lo dice
 * (jugador, equipo, player o team) o si es magenta: rojo y azul altos y poco
 * verde, que en Gravity Sketch se pinta sin tener que poner nombres. Es la
 * forma de marcar en el modelo qué partes llevan el color de cada bando.
 */
export const esDelJugador = (nombre, kd) => /jugador|equipo|player|team/i.test(nombre || '')
  || (!!kd && kd[0] > 0.7 && kd[2] > 0.7 && kd[1] < 0.35);

/** Completa una pose con lo que se mira de sus materiales. */
function pose(m) {
  const mats = Object.entries(m.materiales);
  return {
    ...m,
    texturas: mats.some(([, x]) => x.textura),
    delJugador: mats.some(([n, x]) => esDelJugador(n, x.kd)),
  };
}

/** Un .obj: vértices, normales y triángulos, cada uno con su material. */
function leerObj(src, mats) {
  const V = [], N = [], tris = [];
  let mat = null;
  for (const linea of src.split(/\r?\n/)) {
    const t = linea.trim().split(/\s+/);
    if (t[0] === 'v') V.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'vn') N.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'usemtl') mat = t.slice(1).join(' ');
    else if (t[0] === 'f') {
      // Índices 1..n, o negativos desde el final; el polígono se abanica.
      const pts = t.slice(1).map((x) => {
        const [vi, , ni] = x.split('/');
        const a = parseInt(vi, 10), b = ni ? parseInt(ni, 10) : 0;
        return [a < 0 ? V.length + a : a - 1, b ? (b < 0 ? N.length + b : b - 1) : -1];
      });
      for (let i = 1; i + 1 < pts.length; i++) tris.push({ p: [pts[0], pts[i], pts[i + 1]], mat });
    }
  }
  const materiales = {};
  for (const m of new Set(tris.map((t) => t.mat))) materiales[m] = mats[m] || { kd: [0.7, 0.7, 0.7] };
  return pose({ V, N, tris, materiales });
}

/**
 * Lee el modelo de entre los archivos y lo devuelve por poses:
 *
 *   { nombre, eje, poses: { quieto: {…}, andar1: {…}, … }, tris,
 *     texturas, delJugador }
 *
 *  - Un .usdz (o su .usdc): cada capa es una pose, con el nombre de la capa.
 *    El eje vertical lo dice el propio archivo.
 *  - Varios .obj: cada archivo es una pose, con el nombre del archivo.
 *  - Un solo .obj: es la pose quieta, se llame como se llame.
 *
 * `eje` es null cuando el archivo no lo dice (los .obj).
 */
export async function leerModelo(archivos) {
  const nombres = Object.keys(archivos);
  const base = (n) => n.replace(/\.[^.]+$/, '');
  const poses = {};
  let eje = null, nombre;
  let usdc = nombres.find((n) => /\.usdc$/i.test(n));
  const usdz = nombres.find((n) => /\.usdz$/i.test(n));
  if (usdz && !usdc) {
    const dentro = await leerZip(archivos[usdz]);
    usdc = Object.keys(dentro).find((n) => /\.usdc$/i.test(n));
    if (!usdc) throw new Error('El .usdz no trae la escena en binario (.usdc), que es la que se sabe leer');
    archivos = { ...archivos, [usdc]: dentro[usdc] };
  }
  if (usdc) {
    const r = leerUsdc(archivos[usdc]);
    eje = r.eje;
    nombre = base(usdz || usdc);
    for (const [capa, m] of Object.entries(r.capas)) poses[capa || 'quieto'] = pose(m);
  } else {
    const objs = nombres.filter((n) => /\.obj$/i.test(n));
    if (!objs.length) throw new Error('Falta el modelo: un .usdz o un .obj');
    const mats = {};
    for (const n of nombres) if (/\.mtl$/i.test(n)) Object.assign(mats, leerMtl(texto(archivos[n])));
    for (const n of objs) {
      const p = leerObj(texto(archivos[n]), mats);
      if (!p.tris.length) throw new Error(`${n} no tiene caras`);
      poses[objs.length === 1 ? 'quieto' : base(n)] = p;
    }
    nombre = objs.length === 1 ? base(objs[0]) : objs.map(base).join(', ');
  }
  const lista = Object.values(poses);
  return {
    nombre, eje, poses,
    tris: lista.reduce((t, p) => t + p.tris.length, 0),
    texturas: lista.some((p) => p.texturas),
    delJugador: lista.some((p) => p.delJugador),
  };
}

/**
 * Qué es cada pose por su nombre: `quieto`, `andar1`… y `golpe1`…, con o sin
 * guion o barra baja entre la palabra y el número (USD cambia los guiones por
 * `_`). La de referencia es la quieta, o la primera si no hay. Lo que no
 * encaja se ignora y se avisa.
 */
export function clasificarPoses(modelo) {
  const quieto = [], andar = [], golpe = [], otras = [];
  for (const n of Object.keys(modelo.poses)) {
    const m = n.toLowerCase().match(/^(quieto|estatico|andar|golpe)[_-]?(\d*)$/);
    if (!m) { otras.push(n); continue; }
    const num = Number(m[2] || 0);
    (m[1] === 'andar' ? andar : m[1] === 'golpe' ? golpe : quieto).push([num, n]);
  }
  const orden = (l) => l.sort((a, b) => a[0] - b[0]).map(([, n]) => n);
  const ref = orden(quieto)[0] || Object.keys(modelo.poses)[0];
  return { ref, andar: orden(andar), golpe: orden(golpe), otras: [...otras, ...orden(quieto).slice(1)] };
}

// --- Colocación ---------------------------------------------------------------

const PX_E = 45.2548, PX_N = 22.6274, PX_H = 39.1918; // píxeles de mundo por casilla
// Hacia dónde está el sol: a la derecha, algo por delante y alto. Las sombras
// caen a la izquierda, como las de los dibujos.
const LUZ = (() => { const l = [0.45, -0.25, 0.9], m = Math.hypot(...l); return l.map((x) => x / m); })();
const HACIA_CAMARA = [0, -0.866, 0.5];

/**
 * Pasa los vértices al mundo (e, n, h), aún sin escala: `eje` es el eje del
 * modelo que apunta hacia arriba ('z', el de 3ds Max y Blender, o 'y', el del
 * estándar de .obj) y `giro` son grados alrededor de la vertical. Sin girar,
 * lo que en el modelo es el frente (−Y con Z arriba, +Z con Y arriba) mira
 * hacia abajo de la pantalla.
 */
function orientar(modelo, eje, giro) {
  const r = (giro * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const pasa = (p) => {
    const [x, y, z] = p;
    const [e, n, h] = eje === 'y' ? [x, -z, y] : [x, y, z];
    return [e * c - n * s, e * s + n * c, h];
  };
  return { P: modelo.V.map(pasa), NN: modelo.N.map(pasa) };
}

const caja = (P) => {
  const k = { e0: Infinity, e1: -Infinity, n0: Infinity, n1: -Infinity, h0: Infinity, h1: -Infinity, u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
  for (const [e, n, h] of P) {
    const u = (e - n) / Math.SQRT2, v = (-e - n) / Math.SQRT2;
    if (e < k.e0) k.e0 = e; if (e > k.e1) k.e1 = e;
    if (n < k.n0) k.n0 = n; if (n > k.n1) k.n1 = n;
    if (h < k.h0) k.h0 = h; if (h > k.h1) k.h1 = h;
    if (u < k.u0) k.u0 = u; if (u > k.u1) k.u1 = u;
    if (v < k.v0) k.v0 = v; if (v > k.v1) k.v1 = v;
  }
  return k;
};

// --- Pintado -----------------------------------------------------------------

const mezcla = (a, b, t) => a + (b - a) * t;
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }

/**
 * Pinta el modelo ya colocado (P en casillas, con el ancla en el origen) a
 * `res` píxeles de hoja por píxel de mundo. Devuelve el lienzo en píxeles
 * duros —sin bordes a medias, como los dibujos— con su ancla, o null si no
 * queda nada que pintar.
 *
 *  - `corte`: altura en casillas por encima de la cual no se pinta (las
 *    etapas de obra de un edificio).
 *  - `color`: el del jugador, para los materiales suyos.
 *  - `sombra`: la proyección del modelo en el suelo, según el sol.
 *  - `aro`: una elipse con el color del jugador bajo los pies, para las
 *    unidades que no traen ningún material suyo.
 */
function pintar(modelo, P, NN, { res, corte = Infinity, color, sombra = true, aro = null }) {
  const SS = 3, k = res * SS; // se pinta a triple resolución y se reduce
  const pant = P.map(([e, n, h]) => [e * PX_E * k, (-n * PX_N - h * PX_H) * k, n * 0.866 - h * 0.5]);
  const pisa = (p) => { const t = p[2] / LUZ[2]; return [(p[0] - LUZ[0] * t) * PX_E * k, (-(p[1] - LUZ[1] * t) * PX_N) * k]; };
  const somb = sombra ? P.map((p) => pisa([p[0], p[1], Math.min(p[2], corte)])) : null;

  // Tamaño del lienzo: el modelo, su sombra, el aro y un margen.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const mete = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const [x, y] of pant) mete(x, y);
  if (somb) for (const [x, y] of somb) mete(x, y);
  if (aro) { mete(-aro.r * k, -aro.r * 0.5 * k); mete(aro.r * k, aro.r * 0.5 * k); }
  mete(0, 0);
  const m = 2 * k;
  const ox = Math.ceil(-x0 + m), oy = Math.ceil(-y0 + m);
  const W = Math.ceil((x1 - x0) + 2 * m), H = Math.ceil((y1 - y0) + 2 * m);
  if (W * H > 40e6) throw new Error('El modelo sale demasiado grande');

  const col = new Float32Array(W * H * 3);
  const prof = new Float32Array(W * H).fill(Infinity);
  const alfa = new Uint8Array(W * H);

  // Color de cada material, con el del jugador si es suyo.
  const tonos = {};
  for (const [nombre, mat] of Object.entries(modelo.materiales)) {
    if (esDelJugador(nombre, mat.kd) && color) {
      const lum = 0.3 * mat.kd[0] + 0.59 * mat.kd[1] + 0.11 * mat.kd[2];
      const [a, b] = [rgb(color.dark), rgb(color.main)];
      tonos[nombre] = a.map((x, i) => mezcla(x, b[i], Math.min(1, lum * 1.6)));
    } else tonos[nombre] = mat.kd;
  }

  // Luz de un punto con normal (nx, ny, nz). `fc` es la normal de su cara
  // vuelta hacia la cámara: si la del vértice no va del mismo lado, se le da
  // la vuelta. Los exportadores no siempre ordenan las caras igual, y así una
  // pieza sin grosor, como una chapa, se ve iluminada por las dos.
  const luz = (nx, ny, nz, fc) => {
    if (nx * fc[0] + ny * fc[1] + nz * fc[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const d = nx * LUZ[0] + ny * LUZ[1] + nz * LUZ[2];
    return 0.42 + 0.72 * Math.max(0, d);
  };

  for (const t of modelo.tris) {
    const [a, b, c] = t.p.map((q) => q[0]);
    const A = pant[a], B = pant[b], C = pant[c];
    // Normal de la cara, en el mundo.
    const pa = P[a], pb = P[b], pc = P[c];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    let fn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const fl = Math.hypot(...fn) || 1; fn = fn.map((x) => x / fl);
    const cara = Math.sign(fn[0] * HACIA_CAMARA[0] + fn[1] * HACIA_CAMARA[1] + fn[2] * HACIA_CAMARA[2]) || 1;
    const fc = fn.map((x) => x * cara);
    // Luz en cada vértice con su normal, si la trae, o con la de la cara.
    const L = t.p.map(([, ni]) => {
      const nv = ni >= 0 && NN[ni] ? NN[ni] : fn;
      const nl = Math.hypot(...nv) || 1;
      return luz(nv[0] / nl, nv[1] / nl, nv[2] / nl, fc);
    });
    const tono = tonos[t.mat] || [0.7, 0.7, 0.7];

    const bx0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]) + ox)), bx1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0]) + ox));
    const by0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]) + oy)), by1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1]) + oy));
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = by0; y <= by1; y++) {
      const py = y + 0.5 - oy;
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5 - ox;
        const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
        const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        if (corte !== Infinity && w0 * pa[2] + w1 * pb[2] + w2 * pc[2] > corte) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
        const o = y * W + x;
        if (z >= prof[o]) continue;
        prof[o] = z;
        const s = w0 * L[0] + w1 * L[1] + w2 * L[2];
        col[o * 3] = tono[0] * s; col[o * 3 + 1] = tono[1] * s; col[o * 3 + 2] = tono[2] * s;
        alfa[o] = 1;
      }
    }
  }

  // Sombra: los triángulos proyectados en el suelo, en un canal aparte.
  const sombraM = new Uint8Array(W * H);
  if (somb) {
    for (const t of modelo.tris) {
      const [A, B, C] = t.p.map((q) => somb[q[0]]);
      const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (Math.abs(area) < 1e-9) continue;
      const bx0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]) + ox)), bx1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0]) + ox));
      const by0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]) + oy)), by1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1]) + oy));
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const px = x + 0.5 - ox, py = y + 0.5 - oy;
          const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
          const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
          if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) sombraM[y * W + x] = 1;
        }
      }
    }
  }
  if (aro) {
    // Elipse de la huella de la unidad, bajo el modelo.
    const rx = aro.r * k, ry = rx * 0.5;
    for (let y = Math.max(0, Math.floor(oy - ry)); y <= Math.min(H - 1, Math.ceil(oy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(ox - rx)); x <= Math.min(W - 1, Math.ceil(ox + rx)); x++) {
        const dx = (x + 0.5 - ox) / rx, dy = (y + 0.5 - oy) / ry, d = dx * dx + dy * dy;
        if (d <= 1 && d >= 0.62) sombraM[y * W + x] = 2;
      }
    }
  }

  // Reducción a píxeles de hoja: cada uno es opaco si lo cubre al menos la
  // mitad de sus submuestras, con su color medio. Lo demás es sombra o nada.
  const w2 = Math.ceil(W / SS), h2 = Math.ceil(H / SS);
  const px = new Uint8ClampedArray(w2 * h2 * 4);
  const aroC = aro && color ? rgb(color.main) : null;
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      let n = 0, r = 0, g = 0, bl = 0, s = 0, ar = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const X = x * SS + sx, Y = y * SS + sy;
          if (X >= W || Y >= H) continue;
          const o = Y * W + X;
          if (alfa[o]) { n++; r += col[o * 3]; g += col[o * 3 + 1]; bl += col[o * 3 + 2]; }
          else if (sombraM[o] === 2) ar++;
          else if (sombraM[o]) s++;
        }
      }
      const i = (y * w2 + x) * 4, tot = SS * SS;
      if (n * 2 >= tot) {
        px[i] = Math.min(255, (r / n) * 255); px[i + 1] = Math.min(255, (g / n) * 255); px[i + 2] = Math.min(255, (bl / n) * 255); px[i + 3] = 255;
      } else if (aroC && ar * 2 >= tot) {
        px[i] = aroC[0] * 255; px[i + 1] = aroC[1] * 255; px[i + 2] = aroC[2] * 255; px[i + 3] = 230;
      } else if ((s + n + ar) * 2 >= tot) {
        px[i + 3] = 72; // la sombra, translúcida como la de los dibujos
      }
    }
  }
  // Contorno oscuro de un píxel alrededor de lo opaco, para que se lea sobre
  // la hierba como los dibujos.
  const opaco = (x, y) => x >= 0 && y >= 0 && x < w2 && y < h2 && px[(y * w2 + x) * 4 + 3] === 255;
  const borde = [];
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      if (opaco(x, y)) continue;
      if (opaco(x - 1, y) || opaco(x + 1, y) || opaco(x, y - 1) || opaco(x, y + 1)) borde.push((y * w2 + x) * 4);
    }
  }
  for (const i of borde) { px[i] = 34; px[i + 1] = 28; px[i + 2] = 24; px[i + 3] = 200; }

  const c = document.createElement('canvas');
  c.width = w2; c.height = h2;
  c.getContext('2d').putImageData(new ImageData(px, w2, h2), 0, 0);
  return { canvas: c, ox: ox / SS, oy: oy / SS };
}

/** El banderín de los edificios, como el de tools/importar-edificio.mjs. */
function banderin(s, color, anchoHuella) {
  const c = s.canvas, W = c.width, d = c.getContext('2d').getImageData(0, 0, W, c.height).data;
  let cima = null;
  for (let y = 0; y < c.height && !cima; y++) {
    let a = -1, z = -1;
    for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] === 255) { if (a < 0) a = x; z = x; }
    if (a >= 0) cima = [Math.round((a + z) / 2), y];
  }
  if (!cima) return s;
  const alto = Math.round(anchoHuella * 0.09);
  const extra = Math.max(0, alto + 2 - cima[1]);
  const n = document.createElement('canvas');
  n.width = W; n.height = c.height + extra;
  const ctx = n.getContext('2d');
  ctx.drawImage(c, 0, extra);
  const [mx, my] = [cima[0], cima[1] + extra];
  ctx.fillStyle = '#2b2b2e';
  ctx.fillRect(mx, my - alto, 2, alto + 2);
  const pw = Math.round(alto * 0.8), ph = Math.round(alto * 0.45);
  ctx.fillStyle = color.main;
  ctx.beginPath(); ctx.moveTo(mx + 2, my - alto); ctx.lineTo(mx + 2 + pw, my - alto + ph / 2); ctx.lineTo(mx + 2, my - alto + ph); ctx.closePath(); ctx.fill();
  ctx.fillStyle = color.dark;
  ctx.fillRect(mx + 2, my - alto + ph - 2, Math.round(pw * 0.5), 2);
  return { canvas: n, ox: s.ox, oy: s.oy + extra };
}

// --- Sprites ------------------------------------------------------------------

/** Píxeles de hoja por píxel de mundo de los sprites que salen de un modelo. */
export const RES_MODELO = 4;

// Las cinco orientaciones que se pintan; las otras tres salen volteadas (ver
// MIRROR en sprites.js). La 1 mira hacia abajo de la pantalla y cada paso son
// 45° en el sentido de las agujas del reloj visto desde arriba.
const CARAS = [0, 1, 5, 6, 7];

/**
 * Todos los sprites que sustituyen a un elemento del catálogo.
 *
 *   tipo: 'unit' | 'building' | 'node'     clave: la del elemento
 *   medida: { size } del edificio, o { altura } en píxeles de mundo de la
 *           unidad (de los pies a la cabeza), o nada para un recurso
 *   eje, giro: ver `orientar`
 *
 * Devuelve { sprites: { claveDelÍndice: { canvas, ox, oy } }, anim?, avisos }.
 * `ox`, `oy` van en píxeles de mundo, como en el índice; los lienzos, a
 * RES_MODELO.
 */
export function spritesDeModelo(modelo, { tipo, clave, medida = {}, eje = 'z', giro = 0 }) {
  const res = RES_MODELO;
  const sprites = {};
  const avisos = [];
  if (modelo.texturas) avisos.push('Las texturas aún no se usan: cada material sale con su color liso.');
  const final = (s) => ({ canvas: s.canvas, ox: s.ox / res, oy: s.oy / res });
  const poses = clasificarPoses(modelo);
  const ref = modelo.poses[poses.ref];

  if (tipo === 'building') {
    const size = medida.size || 2;
    const { P, NN } = orientar(ref, eje, giro);
    const k = caja(P);
    // Que quepa en la huella con un poco de aire, centrado en ella y con la
    // base en el suelo.
    const esc = (size * 0.94) / Math.max(k.u1 - k.u0, k.v1 - k.v0, 1e-9);
    const cu = (k.u0 + k.u1) / 2, cv = (k.v0 + k.v1) / 2;
    // Centro de la huella en (u, v) = (size/2, size/2) → en (e, n):
    const ce = 0, cn = -size / Math.SQRT2;
    const ce0 = (cu - cv) / Math.SQRT2, cn0 = -(cu + cv) / Math.SQRT2;
    const Q = P.map(([e, n, h]) => [(e - ce0) * esc + ce, (n - cn0) * esc + cn, (h - k.h0) * esc]);
    const alto = (k.h1 - k.h0) * esc;
    const anchoHuella = size * 64 * res;
    // Sin materiales del jugador, el edificio es igual para todos y sólo
    // cambia el banderín: se pinta una vez por etapa.
    const pintados = new Map();
    PLAYER_COLORS.forEach((color, ci) => {
      [0.12, 0.55, Infinity].forEach((f, etapa) => {
        const cual = `${etapa}|${ref.delJugador ? ci : ''}`;
        if (!pintados.has(cual)) pintados.set(cual, pintar(ref, Q, NN, { res, corte: f === Infinity ? Infinity : alto * f, color }));
        let s = pintados.get(cual);
        if (etapa === 2 && !ref.delJugador) s = banderin(s, color, anchoHuella);
        sprites[`b|${clave}|${ci}|${etapa}`] = final(s);
      });
    });
    if (Object.keys(modelo.poses).length > 1) avisos.push(`Un edificio es una sola pose: se usa «${poses.ref}».`);
    if (!ref.delJugador) avisos.push('Nada va en magenta ni en un material «jugador»: el color de cada bando va en un banderín.');
  } else if (tipo === 'unit') {
    const alturaPx = medida.altura || 38;
    // Los fotogramas: la pose quieta es el 0, luego las de andar y las de
    // golpe, por su número. Todas se colocan con la escala y el punto de los
    // pies de la quieta: así la figura no crece ni resbala entre poses.
    const fotos = [poses.ref, ...poses.andar, ...poses.golpe];
    const iAndar = poses.andar.map((_, k) => 1 + k);
    const iGolpe = poses.golpe.map((_, k) => 1 + poses.andar.length + k);
    const delJugador = modelo.delJugador;
    const aroDe = (r) => (delJugador ? null : { r: Math.max(6, Math.min(r, 20)) });
    for (const cara of CARAS) {
      // La cara 1 es el frente sin girar; cada cara más, 45° a la derecha.
      const g = giro - (cara - 1) * 45;
      const R = orientar(ref, eje, g);
      const k = caja(R.P);
      const esc = (alturaPx / PX_H) / Math.max(k.h1 - k.h0, 1e-9);
      const ce0 = (k.e0 + k.e1) / 2, cn0 = (k.n0 + k.n1) / 2;
      const r = Math.max(k.e1 - k.e0, k.n1 - k.n0) * esc * 0.5 * PX_E * 0.8;
      fotos.forEach((nombre, f) => {
        const p = modelo.poses[nombre];
        const { P, NN } = f === 0 ? R : orientar(p, eje, g);
        const Q = P.map(([e, n, h]) => [(e - ce0) * esc, (n - cn0) * esc, (h - k.h0) * esc]);
        if (delJugador) {
          PLAYER_COLORS.forEach((color, ci) => {
            sprites[`u|${clave}|${ci}|${cara}|${f}`] = final(pintar(p, Q, NN, { res, color }));
          });
        } else {
          // Sólo el aro cambia de color: se pinta una vez y se recolorea.
          const s = pintar(p, Q, NN, { res, color: PLAYER_COLORS[0], aro: aroDe(r) });
          PLAYER_COLORS.forEach((color, ci) => {
            sprites[`u|${clave}|${ci}|${cara}|${f}`] = final(ci ? recolorearAro(s, PLAYER_COLORS[0], color) : s);
          });
        }
      });
    }
    const n = Object.keys(modelo.poses).length;
    avisos.unshift(`${n} pose${n > 1 ? 's' : ''}: quieta «${poses.ref}»`
      + (poses.andar.length ? `, andar ${poses.andar.map((x) => `«${x}»`).join(' ')}` : ', sin andar')
      + (poses.golpe.length ? `, golpe ${poses.golpe.map((x) => `«${x}»`).join(' ')}.` : ', sin golpe.'));
    if (poses.otras.length) avisos.push(`No se usan (el nombre no dice qué pose es): ${poses.otras.map((x) => `«${x}»`).join(', ')}.`);
    if (poses.golpe.length > 2) avisos.push('El golpe usa dos poses: sobran las demás.');
    if (!delJugador) avisos.push('Nada va en magenta ni en un material «jugador»: el color de cada bando va en un aro a los pies.');
    // El juego usa dos fotogramas de golpe; con uno, se repite.
    const golpe = iGolpe.length ? [iGolpe[0], iGolpe[1] ?? iGolpe[0]] : [0, 0];
    const anim = { andar: iAndar.length ? iAndar : [0], quieto: 0, golpe, altura: alturaPx * 2 };
    return { sprites, anim, avisos };
  } else {
    // Un recurso: cuatro variantes, girado de 90 en 90 grados.
    for (let variante = 0; variante < 4; variante++) {
      const { P, NN } = orientar(ref, eje, giro + variante * 90);
      const k = caja(P);
      const esc = 0.9 / Math.max(k.u1 - k.u0, k.v1 - k.v0, 1e-9);
      const ce0 = (k.e0 + k.e1) / 2, cn0 = (k.n0 + k.n1) / 2;
      const Q = P.map(([e, n, h]) => [(e - ce0) * esc, (n - cn0) * esc, (h - k.h0) * esc]);
      sprites[`r|${clave}|${variante}|0`] = final(pintar(ref, Q, NN, { res }));
    }
    if (Object.keys(modelo.poses).length > 1) avisos.push(`Un recurso es una sola pose: se usa «${poses.ref}».`);
  }
  return { sprites, anim: null, avisos };
}

/**
 * Cambia el aro de un color de jugador a otro: son los píxeles con su color
 * y la opacidad del aro (ver `pintar`), que nada más en el sprite tiene.
 */
function recolorearAro(s, de, a) {
  const c = document.createElement('canvas');
  c.width = s.canvas.width; c.height = s.canvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(s.canvas, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  const [r0, g0, b0] = rgb(de.main).map((x) => Math.round(Math.min(255, x * 255)));
  const [r1, g1, b1] = rgb(a.main).map((x) => Math.round(Math.min(255, x * 255)));
  for (let i = 0; i < d.length; i += 4) {
    // Con margen: el lienzo guarda lo translúcido premultiplicado y al leerlo
    // puede mover una unidad arriba o abajo.
    if (Math.abs(d[i + 3] - 230) <= 2 && Math.abs(d[i] - r0) <= 3 && Math.abs(d[i + 1] - g0) <= 3 && Math.abs(d[i + 2] - b0) <= 3) {
      d[i] = r1; d[i + 1] = g1; d[i + 2] = b1;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, ox: s.ox, oy: s.oy };
}

// --- Hojas --------------------------------------------------------------------

/**
 * Coloca los sprites en hojas: una por color de jugador (acabada en
 * `-<color>.png`, que es lo que sprites.js usa para cargar sólo los colores
 * de la partida) y otra para lo que no lleva color. Estantes de hasta 2048 de
 * ancho. Devuelve [{ nombre, canvas, entradas: { clave: [x, y, w, h, ox, oy] } }].
 */
export function empaquetar(sprites, base) {
  const grupos = new Map();
  for (const [clave, s] of Object.entries(sprites)) {
    const partes = clave.split('|');
    const color = partes[0] === 'r' ? null : partes[2];
    const nombre = color === null ? `${base}.png` : `${base}-${color}.png`;
    if (!grupos.has(nombre)) grupos.set(nombre, []);
    grupos.get(nombre).push([clave, s]);
  }
  const hojas = [];
  for (const [nombre, lista] of grupos) {
    const MAX = 2048;
    let x = 0, y = 0, fila = 0, ancho = 0;
    const sitio = [];
    for (const [clave, s] of lista) {
      const w = s.canvas.width, h = s.canvas.height;
      if (x + w > MAX && x > 0) { x = 0; y += fila + 1; fila = 0; }
      sitio.push([clave, s, x, y]);
      x += w + 1; fila = Math.max(fila, h); ancho = Math.max(ancho, x);
    }
    const c = document.createElement('canvas');
    c.width = Math.max(1, ancho); c.height = Math.max(1, y + fila);
    const ctx = c.getContext('2d');
    const entradas = {};
    for (const [clave, s, sx, sy] of sitio) {
      ctx.drawImage(s.canvas, sx, sy);
      entradas[clave] = [sx, sy, s.canvas.width, s.canvas.height, +s.ox.toFixed(2), +s.oy.toFixed(2)];
    }
    hojas.push({ nombre, canvas: c, entradas });
  }
  return hojas;
}
