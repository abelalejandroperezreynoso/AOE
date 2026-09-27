// Mete como ciclo de andar de una orientación varios fotogramas sueltos.
//
//   node tools/importar-fotogramas.mjs <tipo> <cara> [--espejo] [--quieto N] img1 img2 ...
//
// Cada imagen es un fotograma dibujado sobre fondo claro, aunque traiga
// encima una cuadrícula (como las que salen del botón «Descargar PNG» de la
// lupa y se retocan fuera), con una sombra gris bajo los pies. Por ejemplo,
// assets/fuentes/aldeano-andar-*.png. De cada una:
//   - el fondo y las líneas de la cuadrícula se quitan: claros y sin color;
//   - la sombra es gris y *continua* (las líneas son rayas finas): se
//     reconoce por la densidad de gris a su alrededor, y marca los pies;
//   - se reduce a la altura de referencia de la unidad (`anim.altura`) por
//     mayoría de píxeles, en píxeles duros;
//   - el azul de la ropa se pinta con los tres tonos de cada jugador.
// `cara` es la orientación del juego que ocupan (0 ↘, 1 ↓, 5 ↑, 6 ↗, 7 →);
// con --espejo se voltean antes, para dibujos que miran al otro lado (↙ → ↘).
// `--quieto N` dice qué fotograma (de 0) sirve de postura quieta.
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
const flag = (n) => { const i = args.indexOf(`--${n}`); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const espejo = flag('espejo');
const quieto = Number(opt('quieto', '0'));
const [tipo, caraTxt, ...fuentes] = args;
const cara = Number(caraTxt);
if (!tipo || !fuentes.length || ![0, 1, 5, 6, 7].includes(cara)) {
  console.error('Uso: node tools/importar-fotogramas.mjs <tipo> <cara 0|1|5|6|7> [--espejo] [--quieto N] img...');
  process.exit(1);
}

const BASE = process.env.GAME_URL || 'http://localhost:8000';
const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));
const { PLAYER_COLORS } = await import('../js/config.js');
const anim = indice.anim?.[tipo];
if (!anim?.altura) { console.error(`«${tipo}» no tiene altura de referencia en el índice`); process.exit(1); }

const imagenes = [];
for (const f of fuentes) {
  const tipoMime = f.endsWith('.jpg') || f.endsWith('.jpeg') ? 'jpeg' : 'png';
  imagenes.push(`data:image/${tipoMime};base64,${(await readFile(f)).toString('base64')}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate(async ({ imagenes, altura, espejo, colores }) => {
  const luz = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = (r, g, b) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b));
  const hsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    const h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    return [h * 60, s, l];
  };
  const azul = (r, g, b) => { const [h, s] = hsl(r, g, b); return h >= 190 && h <= 250 && s > 0.12 && b > r + 12; };

  const fotos = [];
  for (const url of imagenes) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = img.width, H = img.height;
    const c0 = document.createElement('canvas');
    c0.width = W; c0.height = H;
    const x0 = c0.getContext('2d');
    if (espejo) { x0.translate(W, 0); x0.scale(-1, 1); }
    x0.drawImage(img, 0, 0);
    const d = x0.getImageData(0, 0, W, H).data;

    // Clase de cada píxel: 0 fondo (o línea de la cuadrícula), 1 gris, 2 figura.
    const cl = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) {
      const r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2], L = luz(r, g, b), S = sat(r, g, b);
      if (S < 0.09 && L > 222) cl[k] = 0;
      else if (S < 0.1 && L > 120) cl[k] = 1;
      else cl[k] = 2;
    }
    // Gris denso (la sombra) frente a gris ralo (las líneas): proporción de
    // grises en una ventana, con una tabla de sumas.
    const R = Math.max(4, Math.round(W / 90));
    const tabla = (clase) => {
      const sum = new Int32Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) {
        let fila = 0;
        for (let x = 0; x < W; x++) { fila += cl[y * W + x] === clase ? 1 : 0; sum[(y + 1) * (W + 1) + x + 1] = sum[y * (W + 1) + x + 1] + fila; }
      }
      return (x, y) => {
        const a = Math.max(0, x - R), b = Math.max(0, y - R), e = Math.min(W, x + R + 1), f = Math.min(H, y + R + 1);
        return (sum[f * (W + 1) + e] - sum[b * (W + 1) + e] - sum[f * (W + 1) + a] + sum[b * (W + 1) + a]) / ((e - a) * (f - b));
      };
    };
    const dens = tabla(1);
    // Caja de la figura. Cuenta sólo lo que tiene más figura alrededor: los
    // cruces de la cuadrícula, que en un JPEG salen oscuros, quedan sueltos y
    // agrandarían la caja, y con ella la altura, encogiendo el dibujo.
    const densFigura = tabla(2);
    let t = H, bt = 0, l = W, r = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cl[y * W + x] === 2 && densFigura(x, y) > 0.15) { if (y < t) t = y; if (y > bt) bt = y; if (x < l) l = x; if (x > r) r = x; }
    // Sombra: gris denso en el cuarto de abajo de la figura o por debajo.
    const esSombra = (x, y) => cl[y * W + x] === 1 && y > t + (bt - t) * 0.72 && dens(x, y) > 0.55;
    let sx = 0, sy = 0, n = 0, sb = bt, sl = l, sr = r;
    for (let y = Math.floor(t + (bt - t) * 0.72); y < H; y++) {
      for (let x = 0; x < W; x++) if (esSombra(x, y)) { sx += x; sy += y; n++; if (y > sb) sb = y; if (x < sl) sl = x; if (x > sr) sr = x; }
    }
    if (!n) return { error: 'Sin sombra en un fotograma' };
    const pies = [sx / n, sy / n];
    const esc = altura / (pies[1] - t);
    const L0 = Math.min(l, sl), R0 = Math.max(r, sr), B0 = Math.max(bt, sb);
    const w = Math.ceil((R0 + 1 - L0) * esc) + 2, h = Math.ceil((B0 + 1 - t) * esc) + 2;
    const cuerpo = new Float32Array(w * h * 4), sombra = new Float32Array(w * h), total = new Float32Array(w * h);
    for (let y = t; y <= B0; y++) {
      for (let x = L0; x <= R0; x++) {
        const o = Math.floor((y - t) * esc + 1) * w + Math.floor((x - L0) * esc + 1);
        total[o]++;
        const k = y * W + x;
        if (cl[k] === 2) { cuerpo[o * 4] += d[k * 4]; cuerpo[o * 4 + 1] += d[k * 4 + 1]; cuerpo[o * 4 + 2] += d[k * 4 + 2]; cuerpo[o * 4 + 3]++; }
        else if (esSombra(x, y)) sombra[o]++;
      }
    }
    const px = new Uint8ClampedArray(w * h * 4);
    for (let o = 0; o < w * h; o++) {
      const m = cuerpo[o * 4 + 3];
      if (total[o] && m / total[o] >= 0.45) {
        px[o * 4] = cuerpo[o * 4] / m; px[o * 4 + 1] = cuerpo[o * 4 + 1] / m; px[o * 4 + 2] = cuerpo[o * 4 + 2] / m; px[o * 4 + 3] = 255;
      } else if (total[o] && (sombra[o] + m) / total[o] >= 0.5) px[o * 4 + 3] = 90;
    }
    fotos.push({ w, h, px, ox: (pies[0] - L0) * esc + 1, oy: (pies[1] - t) * esc + 1 });
  }

  const ls = [];
  for (const f of fotos) for (let o = 0; o < f.w * f.h; o++) { const p = f.px; if (p[o * 4 + 3] === 255 && azul(p[o * 4], p[o * 4 + 1], p[o * 4 + 2])) ls.push(luz(p[o * 4], p[o * 4 + 1], p[o * 4 + 2])); }
  ls.sort((a, b) => a - b);
  const lmin = ls[Math.floor(ls.length * 0.05)], lmax = ls[Math.floor(ls.length * 0.95)];
  const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const mezcla = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const hojas = [];
  for (const col of colores) {
    const [os, ba, cl] = [hex(col.dark), hex(col.main), hex(col.light)];
    const c = document.createElement('canvas');
    c.width = fotos.reduce((s, f) => s + f.w + 1, 0); c.height = Math.max(...fotos.map((f) => f.h));
    const ctx = c.getContext('2d');
    let x = 0; const sitios = [];
    for (const f of fotos) {
      const p = new Uint8ClampedArray(f.px);
      for (let o = 0; o < f.w * f.h; o++) {
        if (p[o * 4 + 3] !== 255 || !azul(p[o * 4], p[o * 4 + 1], p[o * 4 + 2])) continue;
        const k = Math.min(1, Math.max(0, (luz(p[o * 4], p[o * 4 + 1], p[o * 4 + 2]) - lmin) / (lmax - lmin)));
        const v = k < 0.5 ? mezcla(os, ba, k * 2) : mezcla(ba, cl, (k - 0.5) * 2);
        p[o * 4] = v[0]; p[o * 4 + 1] = v[1]; p[o * 4 + 2] = v[2];
      }
      ctx.putImageData(new ImageData(p, f.w, f.h), x, 0);
      sitios.push([x, 0, f.w, f.h, f.ox, f.oy]);
      x += f.w + 1;
    }
    hojas.push({ url: c.toDataURL('image/png'), sitios });
  }
  return { hojas };
}, { imagenes, altura: anim.altura, espejo, colores: PLAYER_COLORS });
await browser.close();
if (res.error) { console.error(res.error); process.exit(1); }

const n = fuentes.length;
res.hojas.forEach((h, color) => {
  const nombre = `${tipo}-andar-${cara}-${color}.png`;
  let i = indice.hojas.indexOf(nombre);
  if (i < 0) { i = indice.hojas.length; indice.hojas.push(nombre); }
  const e = (k) => { const [x, y, w, hh, ox, oy] = h.sitios[k]; return [i, x, y, w, hh, +(ox / indice.res).toFixed(2), +(oy / indice.res).toFixed(2)]; };
  // Fotogramas 0..n-1: el andar; n: la postura quieta y el golpe.
  for (let k = 0; k < n; k++) indice.sprites[`u|${tipo}|${color}|${cara}|${k}`] = e(k);
  indice.sprites[`u|${tipo}|${color}|${cara}|${n}`] = e(quieto);
});
for (const [color, h] of res.hojas.entries()) await writeFile(`${DIR}/${tipo}-andar-${cara}-${color}.png`, Buffer.from(h.url.split(',')[1], 'base64'));
indice.anim[tipo] = { ...anim, andar: [...Array(n).keys()], quieto: n, golpe: [n, n] };
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
console.log(`${tipo}: ${n} fotogramas de andar en la orientación ${cara}${espejo ? ' (volteados)' : ''}, quieto el ${quieto}`);
