// Importa el dibujo de un árbol y lo mete en los atlas como el árbol del mapa.
//
//   node tools/importar-arbol.mjs [dibujo.jpg]
//
// El dibujo trae el árbol plantado en una loseta de hierba en bloque, sobre
// una cuadrícula clara, como assets/fuentes/arbol.jpg. Se queda con la copa, el
// tronco y las raíces y tira todo lo demás:
//   - el fondo, por ser claro y azulado;
//   - la loseta: por debajo de donde empieza su cara de arriba sólo se guarda
//     lo marrón (tronco y raíces), y nada por debajo de la cara, que es la
//     tierra del canto.
// Lo ancla en el pie del tronco, lo reduce a la altura del árbol de antes en
// píxeles duros, le pone la sombra en el suelo y saca cuatro variantes
// (volteado, algo mayor o menor y de otro verde) para que el bosque no se
// repita, cada una con su versión casi talada (`r|tree|0..3|0` y `|1`). El
// tocón sigue como estaba.
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

const fuente = process.argv[2] || 'assets/fuentes/arbol.jpg';
// Medidas del dibujo, en sus píxeles: dónde acaba la copa y empieza la cara
// de la loseta, hasta dónde llega esa cara, y el pie del tronco (el ancla).
const CARA_DESDE = 716, CARA_HASTA = 896, PIE = [446, 850];
// Alto del árbol, del pie a lo más alto, en píxeles de mundo.
const ALTO = 74;
// Variantes: espejo, escala y tono (multiplica el verde).
const VIVOS = [
  { espejo: false, esc: 1, verde: 1 },
  { espejo: true, esc: 0.92, verde: 0.94 },
  { espejo: false, esc: 1.06, verde: 1.05 },
  { espejo: true, esc: 0.97, verde: 0.9 },
];
// Casi talado (le queda menos de un tercio): el mismo, más pequeño y apagado.
const AGOTADOS = VIVOS.map((v) => ({ ...v, esc: v.esc * 0.8, verde: v.verde * 0.82 }));
const VARIANTES = [...VIVOS, ...AGOTADOS];

const BASE = process.env.GAME_URL || 'http://localhost:8000';
const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const url = `data:image/jpeg;base64,${(await readFile(fuente)).toString('base64')}`;

const res = await page.evaluate(async ({ url, CARA_DESDE, CARA_HASTA, PIE, ALTO, VARIANTES, RES }) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.width, H = img.height;
  const c0 = document.createElement('canvas');
  c0.width = W; c0.height = H;
  const x0 = c0.getContext('2d');
  x0.drawImage(img, 0, 0);
  const d = x0.getImageData(0, 0, W, H).data;

  const fondo = (i) => d[i + 2] >= d[i + 1] - 4 && d[i + 2] > 150;
  const marron = (i) => d[i] > d[i + 1] + 4 && d[i] > d[i + 2] + 18 && d[i] > 55;
  // Máscara del árbol.
  const m = new Uint8Array(W * H);
  let top = H;
  for (let y = 0; y < CARA_HASTA; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (fondo(i)) continue;
      if (y >= CARA_DESDE && !marron(i)) continue;
      m[y * W + x] = 1;
    }
  }
  // Fuera las motas sueltas (piedrecitas y briznas de la loseta que pasan por
  // marrones): se queda sólo lo unido al tronco.
  const vis = new Uint8Array(W * H);
  const pila = [PIE[1] * W + PIE[0]];
  // Si el pie cae en un hueco, busca el píxel de tronco más cercano encima.
  while (!m[pila[0]] && pila[0] > W) pila[0] -= W;
  vis[pila[0]] = 1;
  while (pila.length) {
    const k = pila.pop();
    const x = k % W, y = (k - x) / W;
    if (y < top) top = y;
    for (const n of [k - 1, k + 1, k - W, k + W]) {
      if (n < 0 || n >= W * H || vis[n] || !m[n]) continue;
      if (Math.abs((n % W) - x) > 1) continue;
      vis[n] = 1; pila.push(n);
    }
  }

  const base = (RES * ALTO) / (PIE[1] - top);
  const hojas = [];
  for (const V of VARIANTES) {
    const esc = base * V.esc;
    // Caja del árbol en el dibujo.
    let l = W, r = 0;
    for (let k = 0; k < W * H; k++) if (vis[k]) { const x = k % W; if (x < l) l = x; if (x > r) r = x; }
    const mg = Math.ceil(ALTO * RES * 0.1);
    const w = Math.ceil((r + 1 - l) * esc) + 2 * mg, h = Math.ceil((PIE[1] + 20 - top) * esc) + 2 * mg;
    const suma = new Float32Array(w * h * 4), total = new Float32Array(w * h);
    const ox = (x) => (V.espejo ? (r - x) : (x - l)) * esc + mg;
    for (let y = top; y < PIE[1] + 20 && y < H; y++) {
      for (let x = l; x <= r; x++) {
        const o = Math.floor((y - top) * esc + mg) * w + Math.floor(ox(x));
        total[o]++;
        if (!vis[y * W + x]) continue;
        const i = (y * W + x) * 4;
        suma[o * 4] += d[i]; suma[o * 4 + 1] += d[i + 1]; suma[o * 4 + 2] += d[i + 2]; suma[o * 4 + 3]++;
      }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const ax = ox(PIE[0]), ay = (PIE[1] - top) * esc + mg;
    // Sombra en el suelo: elipse aplanada, algo corrida abajo a la derecha.
    ctx.fillStyle = 'rgba(0, 0, 0, .28)';
    ctx.beginPath();
    ctx.ellipse(ax + w * 0.06, ay + 1, (r - l) * esc * 0.34, (r - l) * esc * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    const im = ctx.getImageData(0, 0, w, h);
    for (let o = 0; o < w * h; o++) {
      const n = suma[o * 4 + 3];
      if (!total[o] || n / total[o] < 0.5) continue;
      let R = suma[o * 4] / n, G = suma[o * 4 + 1] / n, B = suma[o * 4 + 2] / n;
      if (G > R && G > B) G = Math.min(255, G * V.verde);
      im.data[o * 4] = R; im.data[o * 4 + 1] = G; im.data[o * 4 + 2] = B; im.data[o * 4 + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    hojas.push({ url: c.toDataURL('image/png'), w, h, ax, ay });
  }
  return hojas;
}, { url, CARA_DESDE, CARA_HASTA, PIE, ALTO, VARIANTES, RES: indice.res });
await browser.close();

// En una hoja propia, uno al lado del otro.
const nombre = 'arbol.png';
let i = indice.hojas.indexOf(nombre);
if (i < 0) { i = indice.hojas.length; indice.hojas.push(nombre); }
const pagina = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p2 = await pagina.newPage();
const hoja = await p2.evaluate(async (hs) => {
  const imgs = await Promise.all(hs.map(async (h) => { const im = new Image(); im.src = h.url; await im.decode(); return im; }));
  const c = document.createElement('canvas');
  c.width = hs.reduce((s, h) => s + h.w + 1, 0); c.height = Math.max(...hs.map((h) => h.h));
  const ctx = c.getContext('2d');
  let x = 0; const xs = [];
  imgs.forEach((im, k) => { ctx.drawImage(im, x, 0); xs.push(x); x += hs[k].w + 1; });
  return { url: c.toDataURL('image/png'), xs };
}, res);
await pagina.close();
res.forEach((h, k) => {
  const v = k % VIVOS.length, agotado = k >= VIVOS.length ? 1 : 0;
  indice.sprites[`r|tree|${v}|${agotado}`] = [i, hoja.xs[v], 0, h.w, h.h, +(h.ax / indice.res).toFixed(2), +(h.ay / indice.res).toFixed(2)];
});
await writeFile(`${DIR}/${nombre}`, Buffer.from(hoja.url.split(',')[1], 'base64'));
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
console.log(`${DIR}/${nombre}: ${res.length} variantes`);
