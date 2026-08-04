// Captura los modelos del juego a PNG usando el visor (tools/viewer.html).
//
//   node tools/snapshot-models.mjs [carpeta] [tipo...]
//
// Sin argumentos captura la rejilla de todos los tipos en ./model-shots;
// con tipos concretos (p. ej. `knight towncenter tree`) sólo esos. Necesita
// el servidor local en marcha (npm start) y Playwright instalado en algún
// sitio alcanzable (npx playwright, npm i -D playwright o el del sistema);
// el juego en sí no lo necesita para nada.

import { mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const outDir = args[0] && !args[0].match(/^[a-z]+$/) ? args[0] : './model-shots';
const only = args.filter((a) => a.match(/^[a-z]+$/));

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Hace falta Playwright para capturar: npm i -D playwright');
  process.exit(1);
}

const BASE = process.env.GAME_URL || 'http://localhost:8000';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1700, height: 1300 } });
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));

// Los tipos se leen del propio juego para no mantener listas duplicadas.
await page.goto(`${BASE}/tools/viewer.html`, { waitUntil: 'networkidle' });
const TYPES = await page.evaluate(async () => {
  const { UNITS, BUILD_ORDER, RESOURCE_NODES } = await import('../js/config.js');
  return {
    unit: Object.keys(UNITS),
    building: BUILD_ORDER,
    node: [...Object.keys(RESOURCE_NODES), 'stump'],
  };
});

for (const [kind, types] of Object.entries(TYPES)) {
  for (const type of types) {
    if (only.length && !only.includes(type)) continue;
    await page.goto(`${BASE}/tools/viewer.html?kind=${kind}&type=${type}&zoom=4&res=2`,
      { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__viewerReady);
    const grid = await page.$('#grid');
    await grid.screenshot({ path: `${outDir}/${kind}-${type}.png` });
    console.log(`${outDir}/${kind}-${type}.png`);
  }
}

await browser.close();
