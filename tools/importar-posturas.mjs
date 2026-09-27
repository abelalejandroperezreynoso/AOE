// Mete como sprites de una unidad posturas sueltas de pixel art, una por
// orientación, dibujadas sobre fondo transparente y sin sombra.
//
//   node tools/importar-posturas.mjs <tipo> [--res 6] <cara>=<img.png> ...
//
// `cara` es la orientación del juego (0 ↘, 1 ↓, 2 ↙, 3 ←, 4 ↖, 5 ↑, 6 ↗, 7 →); la
// misma imagen puede ir en varias. Las que no se den y tengan volteo (↙, ←, ↖)
// salen volteadas de la suya (↘, →, ↗). De cada imagen:
//   - la figura es lo opaco; los pies, el centro de sus filas de abajo;
//   - se amplía con filtro hasta la altura de referencia de las unidades a pie
//     (37,5 píxeles de mundo de los pies a la cabeza), a `--res` píxeles de hoja
//     por píxel de mundo: el pixel art se ve suave, sin bloques;
//   - debajo se le pone una sombra translúcida.
// Como es una sola postura, al andar alterna con ella misma un píxel de mundo
// más arriba (la sombra se queda en el suelo), para que bote en vez de
// deslizarse; quieta y golpe son la postura. No lleva color de jugador: se
// escribe una sola hoja, <tipo>-posturas-comun.png, para los ocho colores.
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
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const R = Number(opt('res', '6'));
const [tipo, ...pares] = args;
const caras = pares.map((p) => { const [c, f] = p.split('='); return { cara: Number(c), fuente: f }; });
if (!tipo || !caras.length || caras.some(({ cara, fuente }) => !(cara >= 0 && cara <= 7) || !fuente)) {
  console.error('Uso: node tools/importar-posturas.mjs <tipo> [--res 6] <cara>=<img.png> ...');
  process.exit(1);
}

const BASE = process.env.GAME_URL || 'http://localhost:8000';
const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));
if (!indice.sprites[`u|${tipo}|0|0|0`]) { console.error(`No hay sprites de «${tipo}» en el índice`); process.exit(1); }
// La altura de referencia, en píxeles de hoja a la resolución de serie.
const ALTURA = 75;

const fuentes = [...new Set(caras.map((c) => c.fuente))];
const imagenes = [];
for (const f of fuentes) imagenes.push(`data:image/png;base64,${(await readFile(f)).toString('base64')}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate(async ({ imagenes, altura, R }) => {
  const posturas = [];
  for (const url of imagenes) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = img.width, H = img.height;
    const c0 = document.createElement('canvas');
    c0.width = W; c0.height = H;
    const x0 = c0.getContext('2d');
    x0.drawImage(img, 0, 0);
    const d = x0.getImageData(0, 0, W, H).data;
    let t = H, b = -1, l = W, r = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) { t = Math.min(t, y); b = Math.max(b, y); l = Math.min(l, x); r = Math.max(r, x); }
    if (b < 0) return { error: 'Una imagen no tiene nada opaco' };
    // Pies: el centro de lo opaco en las tres filas de abajo.
    let sx = 0, n = 0;
    for (let y = b - 2; y <= b; y++) for (let x = l; x <= r; x++) if (d[(y * W + x) * 4 + 3] > 128) { sx += x + 0.5; n++; }
    const pies = [sx / n, b + 1];
    const k = altura / (pies[1] - t);          // píxeles de hoja por píxel del dibujo
    const bote = R;                            // un píxel de mundo
    const sombraW = (r + 1 - l) * k * 1.05, sombraH = Math.max(R * 3, sombraW * 0.28);
    const ancho = Math.ceil(Math.max((r + 1 - l) * k, sombraW) + 4);
    const alto = Math.ceil((b + 1 - t) * k + bote + sombraH / 2 + 4);
    const ox = ancho / 2 + ((pies[0] - (l + r + 1) / 2) * k);
    const oy = bote + (pies[1] - t) * k + 2;
    const hace = (arriba) => {
      const c = document.createElement('canvas');
      c.width = ancho; c.height = alto;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(ox, oy, sombraW / 2, sombraH / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const dx = ox - (pies[0] - l) * k, dy = oy - (pies[1] - t) * k - (arriba ? bote : 0);
      ctx.drawImage(c0, l, t, r + 1 - l, b + 1 - t, dx, dy, (r + 1 - l) * k, (b + 1 - t) * k);
      return c;
    };
    posturas.push({ lienzos: [hace(false), hace(true)], ox, oy });
  }
  // Una hoja con todas en fila: por cada postura, quieta y subida.
  const hoja = document.createElement('canvas');
  hoja.width = posturas.reduce((s, p) => s + (p.lienzos[0].width + 1) * 2, 0);
  hoja.height = Math.max(...posturas.map((p) => p.lienzos[0].height));
  const ctx = hoja.getContext('2d');
  let x = 0;
  const sitios = [];
  for (const p of posturas) {
    const par = [];
    for (const lz of p.lienzos) { ctx.drawImage(lz, x, 0); par.push([x, 0, lz.width, lz.height, p.ox, p.oy]); x += lz.width + 1; }
    sitios.push(par);
  }
  return { url: hoja.toDataURL('image/png'), sitios };
}, { imagenes, altura: ALTURA * R / indice.res, R });
await browser.close();
if (res.error) { console.error(res.error); process.exit(1); }

const nombre = `${tipo}-posturas-comun.png`;
let i = indice.hojas.indexOf(nombre);
if (i < 0) { i = indice.hojas.length; indice.hojas.push(nombre); }
indice.resHojas = { ...indice.resHojas, [nombre]: R };
const entrada = ([x, y, w, h, ox, oy]) => [i, x, y, w, h, +(ox / R).toFixed(2), +(oy / R).toFixed(2)];
for (const { cara, fuente } of caras) {
  const [quieta, subida] = res.sitios[fuentes.indexOf(fuente)];
  for (let color = 0; color < 8; color++) {
    // Andar: 0-3, alternando la postura y la postura subida; 4 y 5, el golpe.
    [quieta, subida, quieta, subida, quieta, quieta].forEach((s, f) => {
      indice.sprites[`u|${tipo}|${color}|${cara}|${f}`] = entrada(s);
    });
  }
}
indice.anim = { ...indice.anim, [tipo]: { andar: [0, 1, 2, 3], quieto: 0, golpe: [4, 5] } };
await writeFile(`${DIR}/${nombre}`, Buffer.from(res.url.split(',')[1], 'base64'));
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
console.log(`${tipo}: ${fuentes.length} posturas en ${caras.length} orientaciones, a ${R} píxeles por píxel de mundo`);
