// Saca los PNG del icono de la aplicación (icons/) desde tools/icon.html.
//
//   node tools/make-icons.mjs
//
// Como snapshot-models.mjs: necesita el servidor local en marcha (npm start)
// y Playwright alcanzable. Los PNG resultantes se suben al repositorio, así
// que sólo hay que volver a ejecutarlo si cambia el dibujo o el castillo.

import { mkdir, writeFile } from 'node:fs/promises';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Hace falta Playwright para dibujar los iconos: npm i -D playwright');
  process.exit(1);
}

const BASE = process.env.GAME_URL || 'http://localhost:8000';
// 180: pantalla de inicio del iPhone; 192 y 512: los que pide Android;
// 32: la pestaña del navegador.
const TAMAÑOS = [32, 180, 192, 512];

await mkdir('icons', { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));

for (const n of TAMAÑOS) {
  await page.goto(`${BASE}/tools/icon.html?size=${n}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__iconReady);
  const url = await page.evaluate(() => window.__iconPNG);
  const ruta = `icons/icon-${n}.png`;
  await writeFile(ruta, Buffer.from(url.split(',')[1], 'base64'));
  console.log(ruta);
}

await browser.close();
