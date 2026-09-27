// Importa el dibujo de un edificio terminado y lo mete en los atlas.
//
//   node tools/importar-edificio.mjs <tipo> <dibujo.png> [--semiancho N] [--sin-bandera]
//
// El dibujo trae el edificio en perspectiva isométrica (2:1) sobre fondo
// transparente, con la base entera a la vista. Por ejemplo,
// assets/fuentes/centro-urbano.png.
//
// Qué hace:
//   - busca la base: desde la esquina de abajo el contorno sube en pendiente
//     2:1 hasta las esquinas de los lados, donde las paredes se vuelven
//     verticales. Ese rombo es la huella del edificio: se escala para que
//     mida lo que ocupa en el mapa (`size` casillas) y se ancla por su esquina
//     de arriba, como el resto de edificios. Si la detección falla, se le da
//     el semiancho del rombo en píxeles del dibujo con --semiancho;
//   - le pone debajo una sombra suave de la huella para asentarlo en el suelo;
//   - le planta en lo más alto un banderín con el color de cada jugador, para
//     que se sepa de quién es (--sin-bandera lo quita);
//   - guarda una hoja por color (assets/sprites/<tipo>-<color>.png) y apunta en
//     indice.json la etapa terminada. Los cimientos y la obra siguen siendo
//     los de antes mientras no haya dibujo de ellos.
//
// Necesita el servidor local en marcha (npm start) y Playwright.

import { readFile, writeFile } from 'node:fs/promises';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Hace falta Playwright: npm i -D playwright');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : def; };
const semiancho = opt('semiancho', null);
const conBandera = !flag('sin-bandera');
const [tipo, fuente] = args;
if (!tipo || !fuente) {
  console.error('Uso: node tools/importar-edificio.mjs <tipo> <dibujo.png> [--semiancho N] [--sin-bandera]');
  process.exit(1);
}

const BASE = process.env.GAME_URL || 'http://localhost:8000';
const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));
const { PLAYER_COLORS, BUILDINGS, TILE_W } = await import('../js/config.js');
if (!BUILDINGS[tipo]) { console.error(`No hay edificio «${tipo}»`); process.exit(1); }
// Ancho de la huella en píxeles de hoja.
const anchoHuella = BUILDINGS[tipo].size * TILE_W * indice.res;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const url = `data:image/png;base64,${(await readFile(fuente)).toString('base64')}`;

const res = await page.evaluate(async ({ url, anchoHuella, semiancho, conBandera, colores }) => {
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

  // Caja del dibujo.
  let t = H, b = 0, l = W, r = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (A(x, y) > 128) {
    if (y < t) t = y; if (y > b) b = y; if (x < l) l = x; if (x > r) r = x;
  }
  b += 1; r += 1;

  // Esquina de abajo de la base y semiancho del rombo.
  const fila = (y) => { let a = -1, z = -1; for (let x = 0; x < W; x++) if (A(x, y) > 128) { if (a < 0) a = x; z = x; } return [a, z]; };
  const [a0, z0] = fila(b - 1);
  const xb = (a0 + z0 + 1) / 2, yb = b;
  let hw = semiancho ? Number(semiancho) : 0;
  if (!hw) {
    // Sube fila a fila mientras el contorno se sigue abriendo; donde deja de
    // crecer en 20 px seguidos están las esquinas de los lados.
    const media = (dd) => { const [a, z] = fila(yb - 1 - dd); return a < 0 ? 0 : (z + 1 - a) / 2; };
    for (let dd = 20; dd < yb - t; dd += 2) {
      if (media(dd) > 60 && media(dd + 20) - media(dd) < 4) { hw = media(dd); break; }
    }
  }
  if (!hw) return { error: 'No se encontró la base: pásale --semiancho' };

  const esc = anchoHuella / (2 * hw);
  // Esquina de arriba de la huella, en píxeles del dibujo.
  const top = [xb, yb - hw];

  // --- Reducción a píxeles duros ---------------------------------------------
  const margen = Math.ceil(anchoHuella * 0.08);
  const w = Math.ceil((r - l) * esc) + 2 * margen, h = Math.ceil((b - t) * esc) + 2 * margen;
  const suma = new Float32Array(w * h * 4), total = new Float32Array(w * h);
  const ox0 = margen - l * esc, oy0 = margen - t * esc;
  for (let y = t; y < b; y++) {
    for (let x = l; x < r; x++) {
      const o = Math.floor(oy0 + y * esc) * w + Math.floor(ox0 + x * esc);
      total[o]++;
      if (A(x, y) <= 128) continue;
      const i = (y * W + x) * 4;
      suma[o * 4] += d[i]; suma[o * 4 + 1] += d[i + 1]; suma[o * 4 + 2] += d[i + 2]; suma[o * 4 + 3]++;
    }
  }
  const px = new Uint8ClampedArray(w * h * 4);
  for (let o = 0; o < w * h; o++) {
    const n = suma[o * 4 + 3];
    if (total[o] && n / total[o] >= 0.5) {
      px[o * 4] = suma[o * 4] / n; px[o * 4 + 1] = suma[o * 4 + 1] / n; px[o * 4 + 2] = suma[o * 4 + 2] / n; px[o * 4 + 3] = 255;
    }
  }
  const ax = ox0 + top[0] * esc, ay = oy0 + top[1] * esc; // ancla en la hoja
  // Punto más alto, para el banderín.
  let cima = null;
  for (let y = 0; y < h && !cima; y++) {
    let a = -1, z = -1;
    for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3]) { if (a < 0) a = x; z = x; }
    if (a >= 0) cima = [Math.round((a + z) / 2), y];
  }

  const cuerpo = document.createElement('canvas');
  cuerpo.width = w; cuerpo.height = h;
  cuerpo.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);

  // Sombra de la huella: un rombo algo mayor, translúcido y corrido a la izquierda.
  const sombra = (ctx) => {
    const hwS = (anchoHuella / 2) * 1.06, dx = -anchoHuella * 0.04, dy = anchoHuella * 0.01;
    ctx.fillStyle = 'rgba(0, 0, 0, .28)';
    ctx.beginPath();
    ctx.moveTo(ax + dx, ay + dy - hwS * 0.03);
    ctx.lineTo(ax + dx + hwS, ay + dy + hwS / 2);
    ctx.lineTo(ax + dx, ay + dy + hwS + hwS * 0.03);
    ctx.lineTo(ax + dx - hwS, ay + dy + hwS / 2);
    ctx.closePath();
    ctx.fill();
  };

  // El banderín, en píxeles de hoja: mástil oscuro y paño con dos tonos.
  const alto = Math.round(anchoHuella * 0.09);
  const hojas = [];
  for (const col of colores) {
    const c = document.createElement('canvas');
    const extra = conBandera && cima && cima[1] < alto + 2 ? alto + 2 - cima[1] : 0;
    c.width = w; c.height = h + extra;
    const ctx = c.getContext('2d');
    ctx.translate(0, extra);
    sombra(ctx);
    ctx.drawImage(cuerpo, 0, 0);
    if (conBandera && cima) {
      const [mx, my] = cima;
      ctx.fillStyle = '#2b2b2e';
      ctx.fillRect(mx, my - alto, 2, alto + 2);
      const pw = Math.round(alto * 0.8), ph = Math.round(alto * 0.45);
      ctx.fillStyle = col.main;
      ctx.beginPath(); ctx.moveTo(mx + 2, my - alto); ctx.lineTo(mx + 2 + pw, my - alto + ph / 2); ctx.lineTo(mx + 2, my - alto + ph); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col.dark;
      ctx.fillRect(mx + 2, my - alto + ph - 2, Math.round(pw * 0.5), 2);
    }
    hojas.push({ url: c.toDataURL('image/png'), w: c.width, h: c.height, ox: ax, oy: ay + extra });
  }
  return { hojas, esc, hw };
}, { url, anchoHuella, semiancho, conBandera, colores: PLAYER_COLORS });
await browser.close();
if (res.error) { console.error(res.error); process.exit(1); }

res.hojas.forEach((h, color) => {
  const nombre = `${tipo}-${color}.png`;
  let i = indice.hojas.indexOf(nombre);
  if (i < 0) { i = indice.hojas.length; indice.hojas.push(nombre); }
  indice.sprites[`b|${tipo}|${color}|2`] = [i, 0, 0, h.w, h.h, +(h.ox / indice.res).toFixed(2), +(h.oy / indice.res).toFixed(2)];
});
for (const [color, h] of res.hojas.entries()) {
  await writeFile(`${DIR}/${tipo}-${color}.png`, Buffer.from(h.url.split(',')[1], 'base64'));
}
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
console.log(`${tipo}: base de ${Math.round(res.hw * 2)} px de ancho en el dibujo, escala ${res.esc.toFixed(3)}, ${res.hojas.length} colores`);
