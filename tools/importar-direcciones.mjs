// Añade a una unidad ya importada las posturas de otras orientaciones.
//
//   node tools/importar-direcciones.mjs <tipo> <rosa.jpg>
//
// La imagen es una rosa de 3×3 celdas como la del catálogo, una postura por
// dirección (assets/fuentes/aldeano-direcciones.jpg). De ella se toman las
// que el juego dibuja y no tiene aún: ↓, →, ↗ y ↑ (las de la izquierda salen
// volteadas y ↘ conserva su ciclo de andar). De cada celda:
//   - se separa la figura del fondo claro de la celda y de la flecha de la
//     esquina, quedándose con lo unido a su centro;
//   - la sombra gris del suelo marca los pies (el ancla) y pasa a ser la
//     sombra translúcida del juego;
//   - se reduce a la altura de referencia de la unidad (`anim.altura`);
//   - el azul del uniforme se pinta con los tres tonos de cada jugador.
// Como es una sola postura, en el ciclo de andar alterna con ella misma un
// píxel más arriba, para que al menos bote en vez de deslizarse.
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

const [tipo, fuente] = process.argv.slice(2);
if (!tipo || !fuente) {
  console.error('Uso: node tools/importar-direcciones.mjs <tipo> <rosa.jpg>');
  process.exit(1);
}
// Celdas de la rosa (en píxeles de la imagen) y la orientación que dan.
const COLS = [[65, 381], [412, 728], [759, 1074]];
const FILAS = [[283, 598], [634, 951], [987, 1303]];
const CELDAS = [
  { col: 1, fila: 2, cara: 1 }, // ↓
  { col: 2, fila: 1, cara: 7 }, // →
  { col: 2, fila: 0, cara: 6 }, // ↗
  { col: 1, fila: 0, cara: 5 }, // ↑
];

const BASE = process.env.GAME_URL || 'http://localhost:8000';
const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));
const { PLAYER_COLORS } = await import('../js/config.js');
const anim = indice.anim?.[tipo];
if (!anim || !anim.altura) { console.error(`«${tipo}» no tiene animación importada con altura`); process.exit(1); }
const nFotos = Math.max(...(Array.isArray(anim.andar) ? anim.andar : [anim.andar - 1]), anim.quieto, ...anim.golpe) + 1;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const url = `data:image/jpeg;base64,${(await readFile(fuente)).toString('base64')}`;

const res = await page.evaluate(async ({ url, COLS, FILAS, CELDAS, altura, colores }) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.width, H = img.height;
  const c0 = document.createElement('canvas');
  c0.width = W; c0.height = H;
  const x0 = c0.getContext('2d');
  x0.drawImage(img, 0, 0);
  const d = x0.getImageData(0, 0, W, H).data;
  const rgb = (x, y) => { const k = (y * W + x) * 4; return [d[k], d[k + 1], d[k + 2]]; };
  // Fondo de la celda: casi blanco y sin color.
  // Con margen: el JPG mezcla el borde de la figura con el fondo y deja un
  // halo claro que no es de la figura.
  const fondo = ([r, g, b]) => Math.min(r, g, b) > 178 && Math.max(r, g, b) - Math.min(r, g, b) < 26;
  const neutro = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 22;

  const hsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    const h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    return [h * 60, s, l];
  };
  // También el azul apagado de las sombras del uniforme.
  const azul = (r, g, b) => { const [h, s] = hsl(r, g, b); return h >= 190 && h <= 250 && s > 0.07 && b > r + 10; };
  const luz = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  const fotos = [];
  for (const C of CELDAS) {
    const [xa, xb] = COLS[C.col], [ya, yb] = FILAS[C.fila];
    const w0 = xb - xa, h0 = yb - ya;
    // Lo que no es fondo, y de ello lo unido al centro de la celda.
    const m = new Uint8Array(w0 * h0);
    for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) if (!fondo(rgb(xa + x, ya + y))) m[y * w0 + x] = 1;
    const vis = new Uint8Array(w0 * h0);
    let semilla = Math.floor(h0 / 2) * w0 + Math.floor(w0 / 2);
    while (!m[semilla] && semilla < w0 * h0 - w0) semilla += w0;
    const pila = [semilla]; vis[semilla] = 1;
    while (pila.length) {
      const k = pila.pop(), x = k % w0;
      for (const n of [k - 1, k + 1, k - w0, k + w0]) {
        if (n < 0 || n >= w0 * h0 || vis[n] || !m[n] || Math.abs((n % w0) - x) > 1) continue;
        vis[n] = 1; pila.push(n);
      }
    }
    // Fuera la franja del borde que aún es clara: lo que toca el fondo y es
    // más claro que la figura.
    for (let k = 0; k < w0 * h0; k++) {
      if (!vis[k]) continue;
      const x = k % w0, y = (k - x) / w0;
      const toca = [k - 1, k + 1, k - w0, k + w0].some((n) => n >= 0 && n < w0 * h0 && !vis[n]);
      if (toca && luz(...rgb(xa + x, ya + y)) > 165) vis[k] = 2;
    }
    for (let k = 0; k < w0 * h0; k++) if (vis[k] === 2) vis[k] = 0;
    // Caja, sombra (gris neutro en el cuarto de abajo) y pies.
    let t = h0, bt = 0, l = w0, r = 0;
    for (let k = 0; k < w0 * h0; k++) if (vis[k]) { const x = k % w0, y = (k - x) / w0; if (y < t) t = y; if (y > bt) bt = y; if (x < l) l = x; if (x > r) r = x; }
    const esSombra = (x, y) => {
      if (y < t + (bt - t) * 0.72) return false;
      const c = rgb(xa + x, ya + y);
      return neutro(c) && luz(...c) > 110 && luz(...c) < 200;
    };
    let sx = 0, sy = 0, n = 0;
    for (let y = t; y <= bt; y++) for (let x = l; x <= r; x++) if (vis[y * w0 + x] && esSombra(x, y)) { sx += x; sy += y; n++; }
    const pies = [sx / n, sy / n];
    const esc = altura / (pies[1] - t);

    const w = Math.ceil((r + 1 - l) * esc) + 4, h = Math.ceil((bt + 1 - t) * esc) + 4;
    const cuerpo = new Float32Array(w * h * 4), sombra = new Float32Array(w * h), total = new Float32Array(w * h);
    for (let y = t; y <= bt; y++) {
      for (let x = l; x <= r; x++) {
        const o = Math.floor((y - t) * esc + 2) * w + Math.floor((x - l) * esc + 2);
        total[o]++;
        if (!vis[y * w0 + x]) continue;
        if (esSombra(x, y)) { sombra[o]++; continue; }
        const [R, G, B] = rgb(xa + x, ya + y);
        cuerpo[o * 4] += R; cuerpo[o * 4 + 1] += G; cuerpo[o * 4 + 2] += B; cuerpo[o * 4 + 3]++;
      }
    }
    const px = new Uint8ClampedArray(w * h * 4);
    for (let o = 0; o < w * h; o++) {
      const nn = cuerpo[o * 4 + 3];
      if (total[o] && nn / total[o] >= 0.5) {
        px[o * 4] = cuerpo[o * 4] / nn; px[o * 4 + 1] = cuerpo[o * 4 + 1] / nn; px[o * 4 + 2] = cuerpo[o * 4 + 2] / nn; px[o * 4 + 3] = 255;
      } else if (total[o] && (sombra[o] + nn) / total[o] >= 0.5) {
        px[o * 4 + 3] = 90;
      }
    }
    fotos.push({ cara: C.cara, w, h, px, ox: (pies[0] - l) * esc + 2, oy: (pies[1] - t) * esc + 2 });
  }

  // Tonos del azul, para repartirlos en los tres del jugador.
  const ls = [];
  for (const f of fotos) for (let o = 0; o < f.w * f.h; o++) { const p = f.px; if (p[o * 4 + 3] === 255 && azul(p[o * 4], p[o * 4 + 1], p[o * 4 + 2])) ls.push(luz(p[o * 4], p[o * 4 + 1], p[o * 4 + 2])); }
  ls.sort((a, b) => a - b);
  const lmin = ls[Math.floor(ls.length * 0.05)], lmax = ls[Math.floor(ls.length * 0.95)];
  const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const mezcla = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

  const hojas = [];
  for (const col of colores) {
    const oscuro = hex(col.dark), base = hex(col.main), claro = hex(col.light);
    // Dos por orientación: la postura y la misma un píxel más arriba.
    const alto = Math.max(...fotos.map((f) => f.h)) + 1;
    const c = document.createElement('canvas');
    c.width = fotos.reduce((s, f) => s + (f.w + 1) * 2, 0); c.height = alto;
    const ctx = c.getContext('2d');
    let x = 0; const sitios = [];
    for (const f of fotos) {
      const p = new Uint8ClampedArray(f.px);
      for (let o = 0; o < f.w * f.h; o++) {
        if (p[o * 4 + 3] !== 255 || !azul(p[o * 4], p[o * 4 + 1], p[o * 4 + 2])) continue;
        const k = Math.min(1, Math.max(0, (luz(p[o * 4], p[o * 4 + 1], p[o * 4 + 2]) - lmin) / (lmax - lmin)));
        const v = k < 0.5 ? mezcla(oscuro, base, k * 2) : mezcla(base, claro, (k - 0.5) * 2);
        p[o * 4] = v[0]; p[o * 4 + 1] = v[1]; p[o * 4 + 2] = v[2];
      }
      // La sombra no bota: se pinta en su sitio y el cuerpo encima, subido.
      const soloSombra = new Uint8ClampedArray(p), soloCuerpo = new Uint8ClampedArray(p);
      for (let o = 0; o < f.w * f.h; o++) { if (p[o * 4 + 3] === 255) soloSombra[o * 4 + 3] = 0; else soloCuerpo[o * 4 + 3] = 0; }
      const capa = (datos) => { const cc = document.createElement('canvas'); cc.width = f.w; cc.height = f.h; cc.getContext('2d').putImageData(new ImageData(datos, f.w, f.h), 0, 0); return cc; };
      const cs = capa(soloSombra), cb = capa(soloCuerpo);
      for (const sube of [0, 1]) {
        ctx.drawImage(cs, x, 1);
        ctx.drawImage(cb, x, 1 - sube * 2);
        sitios.push({ cara: f.cara, sube, e: [x, 0, f.w, f.h + 1, f.ox, f.oy + 1] });
        x += f.w + 1;
      }
    }
    hojas.push({ url: c.toDataURL('image/png'), sitios });
  }
  return hojas;
}, { url, COLS, FILAS, CELDAS, altura: anim.altura, colores: PLAYER_COLORS });
await browser.close();

// Los fotogramas de andar alternan quieta y subida; el de quieto y los de
// golpe, la quieta.
const andar = Array.isArray(anim.andar) ? anim.andar : [...Array(anim.andar).keys()];
res.forEach((h, color) => {
  const nombre = `${tipo}-dir-${color}.png`;
  let i = indice.hojas.indexOf(nombre);
  if (i < 0) { i = indice.hojas.length; indice.hojas.push(nombre); }
  for (let f = 0; f < nFotos; f++) {
    const sube = andar.indexOf(f) % 2 === 1 && f !== anim.quieto ? 1 : 0;
    for (const s of h.sitios.filter((q) => q.sube === sube)) {
      const [x, y, w, hh, ox, oy] = s.e;
      indice.sprites[`u|${tipo}|${color}|${s.cara}|${f}`] = [i, x, y, w, hh, +(ox / indice.res).toFixed(2), +(oy / indice.res).toFixed(2)];
    }
  }
});
for (const [color, h] of res.entries()) await writeFile(`${DIR}/${tipo}-dir-${color}.png`, Buffer.from(h.url.split(',')[1], 'base64'));
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
console.log(`${tipo}: ${CELDAS.length} orientaciones nuevas, ${res.length} colores`);
