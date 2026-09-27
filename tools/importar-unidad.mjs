// Importa una hoja de animación dibujada para una unidad y la mete en los atlas.
//
//   node tools/importar-unidad.mjs <tipo> <hoja.png> [--quieto N] [--golpe A,B]
//                                  [--andar 0,1,2,...]
//
// La hoja trae los fotogramas de andar en fila, sobre fondo transparente, con
// la figura mirando abajo a la derecha (la orientación 0) y una sombra gris
// bajo los pies. Por ejemplo, assets/fuentes/aldeano-andar.png.
//
// Qué hace:
//   - separa los fotogramas por las columnas vacías;
//   - busca la sombra (gris neutro al pie de cada fotograma): su centro son los
//     pies, el punto por el que se ancla la unidad, y ella pasa a ser la sombra
//     translúcida del juego;
//   - reduce la figura para que de los pies a la cabeza mida como la unidad a
//     la que sustituye, y la deja en píxeles duros, sin bordes a medias;
//   - pinta el verde del uniforme con el color de cada jugador, en sus tres
//     tonos, para que se sepa de quién es;
//   - guarda una hoja por color (assets/sprites/<tipo>-<color>.png) y apunta en
//     indice.json todos sus fotogramas y su animación.
//
// Como sólo hay una orientación dibujada, vale para todas: las que miran a la
// izquierda salen volteadas y las demás usan la misma. Necesita el servidor
// local en marcha (npm start) y Playwright.

import { readFile, writeFile } from 'node:fs/promises';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Hace falta Playwright: npm i -D playwright');
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const quieto = Number(opt('quieto', '0'));
const golpe = opt('golpe', `${quieto},${quieto}`).split(',').map(Number);
// Los fotogramas que recorre al andar, si no son todos: uno repetido en la
// hoja se nota como un tropiezo en cada zancada.
const andarLista = opt('andar', null);
const [tipo, fuente] = args;
if (!tipo || !fuente) {
  console.error('Uso: node tools/importar-unidad.mjs <tipo> <hoja.png> [--quieto N] [--golpe A,B] [--andar 0,1,...]');
  process.exit(1);
}

const BASE = process.env.GAME_URL || 'http://localhost:8000';
const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));
const { PLAYER_COLORS } = await import('../js/config.js');

// La altura de pies a cabeza de la unidad que se sustituye, en píxeles de hoja.
// Se apunta en el índice la primera vez: si se tomara de lo ya importado, cada
// reimportación la movería un poco.
const vieja = indice.sprites[`u|${tipo}|0|0|0`];
if (!vieja) { console.error(`No hay sprites de «${tipo}» en el índice`); process.exit(1); }
const altura = indice.anim?.[tipo]?.altura ?? vieja[6] * indice.res;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const url = `data:image/png;base64,${(await readFile(fuente)).toString('base64')}`;

const res = await page.evaluate(async ({ url, altura, colores }) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.width, H = img.height;
  const c0 = document.createElement('canvas');
  c0.width = W; c0.height = H;
  const x0 = c0.getContext('2d');
  x0.drawImage(img, 0, 0);
  const d = x0.getImageData(0, 0, W, H).data;
  const A = (x, y) => d[(y * W + x) * 4 + 3];

  // --- Fotogramas: tramos de columnas con algo opaco -------------------------
  const tramos = [];
  let desde = -1;
  for (let x = 0; x <= W; x++) {
    let hay = false;
    if (x < W) for (let y = 0; y < H; y++) if (A(x, y) > 128) { hay = true; break; }
    if (hay && desde < 0) desde = x;
    if (!hay && desde >= 0) { if (x - desde > 20) tramos.push([desde, x]); desde = -1; }
  }
  const cajas = tramos.map(([a, z]) => {
    let t = H, b = 0;
    for (let x = a; x < z; x++) for (let y = 0; y < H; y++) if (A(x, y) > 128) { if (y < t) t = y; if (y > b) b = y; }
    return { a, z, t, b: b + 1 };
  });

  // --- Sombra: gris neutro en la cuarta parte de abajo -----------------------
  const esSombra = (x, y, caja) => {
    const i = (y * W + x) * 4;
    const r = d[i], g = d[i + 1], bl = d[i + 2];
    return d[i + 3] > 128 && y > caja.t + (caja.b - caja.t) * 0.75
      && Math.abs(r - g) < 12 && Math.abs(g - bl) < 12 && r > 50 && r < 115;
  };
  for (const k of cajas) {
    let sx = 0, sy = 0, n = 0;
    for (let y = k.t; y < k.b; y++) for (let x = k.a; x < k.z; x++) if (esSombra(x, y, k)) { sx += x; sy += y; n++; }
    k.pies = [sx / n, sy / n];
  }
  // Una sola escala para todos, con la altura media de pies a cabeza.
  const media = cajas.reduce((s, k) => s + (k.pies[1] - k.t), 0) / cajas.length;
  const esc = altura / media;

  // --- Reducción a píxeles duros ---------------------------------------------
  const fotos = cajas.map((k) => {
    const w = Math.ceil((k.z - k.a) * esc) + 2, h = Math.ceil((k.b - k.t) * esc) + 2;
    const cuerpo = new Float32Array(w * h * 4); // suma de color y cuenta
    const sombra = new Float32Array(w * h);
    const total = new Float32Array(w * h);
    for (let y = k.t; y < k.b; y++) {
      for (let x = k.a; x < k.z; x++) {
        const ox = Math.floor((x - k.a) * esc) + 1, oy = Math.floor((y - k.t) * esc) + 1;
        const o = oy * w + ox;
        total[o]++;
        if (A(x, y) <= 128) continue;
        if (esSombra(x, y, k)) { sombra[o]++; continue; }
        const i = (y * W + x) * 4;
        cuerpo[o * 4] += d[i]; cuerpo[o * 4 + 1] += d[i + 1]; cuerpo[o * 4 + 2] += d[i + 2]; cuerpo[o * 4 + 3]++;
      }
    }
    const px = new Uint8ClampedArray(w * h * 4);
    for (let o = 0; o < w * h; o++) {
      const n = cuerpo[o * 4 + 3];
      if (total[o] && n / total[o] >= 0.5) {
        px[o * 4] = cuerpo[o * 4] / n; px[o * 4 + 1] = cuerpo[o * 4 + 1] / n; px[o * 4 + 2] = cuerpo[o * 4 + 2] / n; px[o * 4 + 3] = 255;
      } else if (total[o] && (sombra[o] + n) / total[o] >= 0.5) {
        px[o * 4 + 3] = 90; // la sombra del juego: negro translúcido
      }
    }
    return {
      w, h, px,
      ox: (k.pies[0] - k.a) * esc + 1, oy: (k.pies[1] - k.t) * esc + 1,
    };
  });

  // --- Color de jugador sobre el verde ---------------------------------------
  const hsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    const h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    return [h * 60, s, l];
  };
  const verde = (r, g, b) => { const [h, s] = hsl(r, g, b); return h >= 55 && h <= 170 && s > 0.2; };
  const luz = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const ls = [];
  for (const f of fotos) {
    for (let o = 0; o < f.w * f.h; o++) {
      const p = f.px;
      if (p[o * 4 + 3] === 255 && verde(p[o * 4], p[o * 4 + 1], p[o * 4 + 2])) ls.push(luz(p[o * 4], p[o * 4 + 1], p[o * 4 + 2]));
    }
  }
  ls.sort((a, b) => a - b);
  const lmin = ls[Math.floor(ls.length * 0.05)], lmax = ls[Math.floor(ls.length * 0.95)];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mezcla = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  const hojas = [];
  for (const col of colores) {
    const oscuro = hex(col.dark), base = hex(col.main), claro = hex(col.light);
    const alto = Math.max(...fotos.map((f) => f.h));
    const ancho = fotos.reduce((s, f) => s + f.w + 1, 0);
    const c = document.createElement('canvas');
    c.width = ancho; c.height = alto;
    const ctx = c.getContext('2d');
    let x = 0;
    const sitios = [];
    for (const f of fotos) {
      const p = new Uint8ClampedArray(f.px);
      for (let o = 0; o < f.w * f.h; o++) {
        if (p[o * 4 + 3] !== 255 || !verde(p[o * 4], p[o * 4 + 1], p[o * 4 + 2])) continue;
        const t = Math.min(1, Math.max(0, (luz(p[o * 4], p[o * 4 + 1], p[o * 4 + 2]) - lmin) / (lmax - lmin)));
        const v = t < 0.5 ? mezcla(oscuro, base, t * 2) : mezcla(base, claro, (t - 0.5) * 2);
        p[o * 4] = v[0]; p[o * 4 + 1] = v[1]; p[o * 4 + 2] = v[2];
      }
      ctx.putImageData(new ImageData(p, f.w, f.h), x, 0);
      sitios.push([x, 0, f.w, f.h, f.ox, f.oy]);
      x += f.w + 1;
    }
    hojas.push({ url: c.toDataURL('image/png'), sitios });
  }
  return { hojas, n: fotos.length, esc };
}, { url, altura, colores: PLAYER_COLORS });
await browser.close();

// --- Índice -------------------------------------------------------------------
for (const k of Object.keys(indice.sprites)) if (k.startsWith(`u|${tipo}|`)) delete indice.sprites[k];
const CARAS = [0, 1, 5, 6, 7];
res.hojas.forEach((h, color) => {
  const nombre = `${tipo}-${color}.png`;
  let i = indice.hojas.indexOf(nombre);
  if (i < 0) { i = indice.hojas.length; indice.hojas.push(nombre); }
  h.sitios.forEach(([x, y, w, hh, ox, oy], f) => {
    const e = [i, x, y, w, hh, +(ox / indice.res).toFixed(2), +(oy / indice.res).toFixed(2)];
    for (const cara of CARAS) indice.sprites[`u|${tipo}|${color}|${cara}|${f}`] = e;
  });
});
const andar = andarLista ? andarLista.split(',').map(Number) : res.n;
indice.anim = { ...(indice.anim || {}), [tipo]: { andar, quieto, golpe, altura } };

for (const [color, h] of res.hojas.entries()) {
  await writeFile(`${DIR}/${tipo}-${color}.png`, Buffer.from(h.url.split(',')[1], 'base64'));
}
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
console.log(`${tipo}: ${res.n} fotogramas, escala ${res.esc.toFixed(3)}, ${res.hojas.length} colores`);
