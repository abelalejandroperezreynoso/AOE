// Importa losetas de terreno dibujadas y las mete en los atlas.
//
//   node tools/importar-terreno.mjs [paquete.jpg]
//
// El paquete es una hoja de losetas isométricas en bloque (cara de arriba y
// tierra por los lados) en una cuadrícula de 4 columnas, como
// assets/fuentes/terreno-hierba.jpg. De cada loseta se usa sólo la cara de
// arriba: se busca el rombo (de esquina a esquina por los lados, con la altura
// que manda la proporción 2:1) y se recorta al rombo del juego, un poco más
// grande para que las losetas vecinas se solapen y no quede junta.
//
// Qué loseta va a cada terreno lo dice ASIGNACION. Guarda assets/sprites/
// terreno.png y apunta en indice.json cada variante como `t|<terreno>|<n>`.
// Necesita el servidor local en marcha (npm start) y Playwright.

import { readFile, writeFile } from 'node:fs/promises';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Hace falta Playwright: npm i -D playwright');
  process.exit(1);
}

const fuente = process.argv[2] || 'assets/fuentes/terreno-hierba.jpg';
// Losetas por [fila, columna] del paquete. Las dos primeras filas son hierba
// lisa; la tercera, hierba seca, tréboles y dos de flores.
// Las lisas de verdad (sin matas) salen más a menudo que las de matas, que
// repetidas por todo el prado lo llenan de uves.
const LISA = [[0, 0], [0, 1], [1, 0], [1, 1], [0, 0], [1, 1], [0, 2], [1, 0]];
const ASIGNACION = {
  grass: LISA.map((c) => ({ c })),
  // La oscura es la misma hierba algo más apagada: no hay dibujo propio.
  grass2: LISA.map((c) => ({ c, luz: 0.9 })),
  // La frondosa lleva los tréboles, las flores y las matas.
  grass3: [[2, 1], [2, 2], [2, 3], [1, 2], [1, 3], [2, 1], [2, 3], [0, 3]].map((c) => ({ c })),
};
const COLUMNAS = 4, FILAS_LOSETAS = 3;

const BASE = process.env.GAME_URL || 'http://localhost:8000';
const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));
const { TILE_W, TILE_H } = await import('../js/config.js');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const url = `data:image/jpeg;base64,${(await readFile(fuente)).toString('base64')}`;

const res = await page.evaluate(async ({ url, asignacion, res, TILE_W, TILE_H, COLUMNAS, FILAS_LOSETAS }) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.width, H = img.height;
  const c0 = document.createElement('canvas');
  c0.width = W; c0.height = H;
  const x0 = c0.getContext('2d');
  x0.drawImage(img, 0, 0);
  const d = x0.getImageData(0, 0, W, H).data;
  // Verde de la hierba (y el amarillo de la seca): ni el gris de la
  // cuadrícula ni el marrón de la tierra.
  const esCara = (x, y) => {
    const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    return g > b + 25 && g >= r - 8 && g > 60;
  };

  // Celdas: 4 columnas iguales; las filas, por los tramos de filas con cara.
  const filas = [];
  let desde = -1;
  for (let y = 0; y <= H; y++) {
    let n = 0;
    if (y < H) for (let x = 0; x < W; x += 3) if (esCara(x, y)) n++;
    if (n > 20 && desde < 0) desde = y;
    if (n <= 20 && desde >= 0) { if (y - desde > 40) filas.push([desde, y]); desde = -1; }
  }
  const anchoCol = W / COLUMNAS;

  /** Rombo de la cara de arriba de la loseta [fila, columna]. */
  const rombo = ([f, c]) => {
    const [ya, yb] = filas[f];
    const xa = Math.floor(c * anchoCol), xb = Math.floor((c + 1) * anchoCol);
    let l = xb, r = xa, yl = 0, nl = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (esCara(x, y)) { if (x < l) l = x; if (x > r) r = x; }
    // La esquina izquierda: la altura media de la cara en sus tres primeras columnas.
    for (let y = ya; y < yb; y++) for (let x = l; x < l + 3; x++) if (esCara(x, y)) { yl += y; nl++; }
    const esquina = yl / nl, ancho = r + 1 - l;
    return { l, ancho, arriba: esquina - ancho / 4 };
  };

  // Cada rombo al tamaño del del juego, en píxeles de hoja, con un 3 % de más
  // por cada lado para que solape con sus vecinos.
  const extra = 0.03;
  const w = Math.round(TILE_W * res * (1 + 2 * extra)), h = Math.round(TILE_H * res * (1 + 2 * extra));
  const losetas = [];
  for (const [terreno, lista] of Object.entries(asignacion)) {
    lista.forEach(({ c, luz = 1 }, v) => {
      const R = rombo(c);
      const px = new Uint8ClampedArray(w * h * 4);
      for (let oy = 0; oy < h; oy++) {
        for (let ox = 0; ox < w; ox++) {
          // Dentro del rombo de salida.
          const u = (ox + 0.5) / w - 0.5, t = (oy + 0.5) / h - 0.5;
          if (Math.abs(u) * 2 + Math.abs(t) * 2 > 1) continue;
          // Al rombo del paquete, un pelo metido hacia dentro para no coger la tierra.
          const k = 0.93 / (1 + 2 * extra);
          const sx = R.l + R.ancho * (0.5 + u * k), sy = R.arriba + (R.ancho / 2) * (0.5 + t * k);
          // Media de los píxeles del paquete que caen en este.
          const paso = R.ancho / w * k;
          let sr = 0, sg = 0, sb = 0, n = 0;
          for (let a = -0.5; a < 0.5; a += 0.34) for (let b = -0.5; b < 0.5; b += 0.34) {
            const xx = Math.min(W - 1, Math.max(0, Math.floor(sx + a * paso))), yy = Math.min(H - 1, Math.max(0, Math.floor(sy + b * paso)));
            const i = (yy * W + xx) * 4; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
          }
          const o = (oy * w + ox) * 4;
          px[o] = (sr / n) * luz; px[o + 1] = (sg / n) * luz; px[o + 2] = (sb / n) * luz; px[o + 3] = 255;
        }
      }
      losetas.push({ terreno, v, px });
    });
  }
  // En una hoja: una fila por terreno.
  const terrenos = Object.keys(asignacion);
  const c = document.createElement('canvas');
  c.width = (w + 1) * 8; c.height = (h + 1) * terrenos.length;
  const ctx = c.getContext('2d');
  const sitios = [];
  for (const L of losetas) {
    const x = L.v * (w + 1), y = terrenos.indexOf(L.terreno) * (h + 1);
    ctx.putImageData(new ImageData(L.px, w, h), x, y);
    sitios.push([L.terreno, L.v, x, y]);
  }
  return { url: c.toDataURL('image/png'), sitios, w, h, filas: filas.length };
}, { url, asignacion: ASIGNACION, res: indice.res, TILE_W, TILE_H, COLUMNAS, FILAS_LOSETAS });
await browser.close();

if (res.filas < FILAS_LOSETAS) { console.error(`Sólo se encontraron ${res.filas} filas de losetas`); process.exit(1); }
const nombre = 'terreno.png';
let i = indice.hojas.indexOf(nombre);
if (i < 0) { i = indice.hojas.length; indice.hojas.push(nombre); }
for (const k of Object.keys(indice.sprites)) if (k.startsWith('t|')) delete indice.sprites[k];
// El anclaje de una loseta es el centro de su rombo.
for (const [terreno, v, x, y] of res.sitios) {
  indice.sprites[`t|${terreno}|${v}`] = [i, x, y, res.w, res.h, +(res.w / 2 / indice.res).toFixed(2), +(res.h / 2 / indice.res).toFixed(2)];
}
await writeFile(`${DIR}/${nombre}`, Buffer.from(res.url.split(',')[1], 'base64'));
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
console.log(`${DIR}/${nombre}: ${res.sitios.length} losetas de ${res.w}×${res.h}`);
