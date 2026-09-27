// Escribe las hojas del explorador dibujado por código (tools/dibujar-jinete.html).
//
//   node tools/dibujar-jinete.mjs [tipo]
//
// Por defecto sustituye al explorador (`scout`). Guarda una hoja por color de
// jugador en assets/sprites/<tipo>-<color>.png y apunta en indice.json sus
// cinco orientaciones con sus nueve fotogramas: 0-5 trote, 6-7 golpe y 8
// parado. Necesita el servidor local en marcha (npm start) y Playwright.

import { readFile, writeFile } from 'node:fs/promises';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Hace falta Playwright: npm i -D playwright');
  process.exit(1);
}

const tipo = process.argv[2] || 'scout';
const BASE = process.env.GAME_URL || 'http://localhost:8000';
const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));
const { PLAYER_COLORS } = await import('../js/config.js');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));
await page.goto(`${BASE}/tools/dibujar-jinete.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__listo, null, { timeout: 120000 });

for (const k of Object.keys(indice.sprites)) if (k.startsWith(`u|${tipo}|`)) delete indice.sprites[k];
for (let color = 0; color < PLAYER_COLORS.length; color++) {
  const h = await page.evaluate((c) => window.hojaJinete(c), color);
  const nombre = `${tipo}-${color}.png`;
  let i = indice.hojas.indexOf(nombre);
  if (i < 0) { i = indice.hojas.length; indice.hojas.push(nombre); }
  for (const { cara, f, e } of h.sitios) {
    const [x, y, w, hh, ox, oy] = e;
    indice.sprites[`u|${tipo}|${color}|${cara}|${f}`] = [i, x, y, w, hh, +(ox / indice.res).toFixed(2), +(oy / indice.res).toFixed(2)];
  }
  await writeFile(`${DIR}/${nombre}`, Buffer.from(h.url.split(',')[1], 'base64'));
  console.log(`${DIR}/${nombre}`);
}
indice.anim = { ...(indice.anim || {}), [tipo]: { andar: [0, 1, 2, 3, 4, 5], quieto: 8, golpe: [6, 7] } };
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
await browser.close();
