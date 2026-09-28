// Mete en los atlas los sprites de un modelo 3D importado en el catálogo.
//
//   node tools/importar-modelo.mjs <paquete.zip> [--eje z|y] [--giro N]
//   node tools/importar-modelo.mjs <modelo.usdz|.zip|.obj> --tipo unit|building|node --clave <clave>
//
// El paquete es lo que descarga el catálogo con «Descargar paquete» en la
// sección Modelo 3D: el .obj, su .mtl y `ajustes.json` con lo que se eligió
// allí (qué sustituye, qué eje va arriba y cuánto se giró). El modelo puede
// ser un .usdz, con una capa por pose, o uno o varios .obj, uno por pose. Los sprites se
// pintan con el mismo js/modelo3d.js que usó el catálogo, así que salen igual
// que en la vista previa. --eje y --giro pisan lo del paquete.
//
// Qué hace:
//   - quita del índice los sprites de ese elemento (de un recurso, sólo los
//     que no están agotados: el modelo no trae cómo queda) y pone los nuevos,
//     en hojas propias: assets/sprites/<clave>-modelo-<color>.png, o
//     <clave>-modelo.png para un recurso;
//   - a una unidad le deja la animación de un solo fotograma, que un modelo
//     no se mueve;
//   - borra las hojas que ya no use nadie;
//   - guarda el paquete en assets/fuentes/<clave>-modelo.zip, como el resto
//     de originales.
//
// Necesita el servidor local en marcha (npm start) y Playwright.

import { readFile, writeFile, unlink, copyFile } from 'node:fs/promises';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Hace falta Playwright: npm i -D playwright');
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const eje = opt('eje'), giro = opt('giro'), tipoArg = opt('tipo'), claveArg = opt('clave');
const [fuente] = args;
if (!fuente) {
  console.error('Uso: node tools/importar-modelo.mjs <paquete.zip> [--eje z|y] [--giro N]');
  process.exit(1);
}

const BASE = process.env.GAME_URL || 'http://localhost:8000';
const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));
const bytes = await readFile(fuente);
const esZip = /\.(zip|usdz)$/i.test(fuente);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ERROR EN PÁGINA:', e.message));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate(async ({ b64, esZip, nombre, forzado, indiceRes }) => {
  const m3 = await import('/js/modelo3d.js');
  const { BUILDINGS } = await import('/js/config.js');
  const sp = await import('/js/sprites.js');
  const datos = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const archivos = esZip ? await m3.leerZip(datos) : { [nombre]: datos };
  const ajustes = archivos['ajustes.json'] ? JSON.parse(new TextDecoder().decode(archivos['ajustes.json'])) : {};
  for (const [k, v] of Object.entries(forzado)) if (v !== undefined) ajustes[k] = v;
  if (!ajustes.tipo || !ajustes.clave) return { error: 'Faltan el tipo y la clave: el paquete no trae ajustes.json, pásalos con --tipo y --clave' };
  const modelo = await m3.leerModelo(archivos);
  ajustes.eje = ajustes.eje || modelo.eje || 'z';
  ajustes.giro = Number(ajustes.giro || 0);
  if (!ajustes.medida) {
    ajustes.medida = ajustes.tipo === 'building' ? { size: BUILDINGS[ajustes.clave]?.size }
      : ajustes.tipo === 'unit' ? { altura: await sp.alturaDeUnidad(ajustes.clave) } : {};
  }
  const { sprites, anim, avisos } = m3.spritesDeModelo(modelo, ajustes);
  if (anim) anim.altura = Math.round(ajustes.medida.altura * indiceRes * 100) / 100;
  const hojas = m3.empaquetar(sprites, `${ajustes.clave}-modelo`).map((h) => ({
    nombre: h.nombre, url: h.canvas.toDataURL('image/png'), entradas: h.entradas,
  }));
  return { ajustes, hojas, anim, avisos, resModelo: m3.RES_MODELO, tris: modelo.tris };
}, {
  b64: bytes.toString('base64'), esZip, nombre: fuente.split('/').pop(),
  forzado: { eje, giro: giro === undefined ? undefined : Number(giro), tipo: tipoArg, clave: claveArg },
  indiceRes: indice.res,
});
await browser.close();
if (res.error) { console.error(res.error); process.exit(1); }

const { tipo, clave } = res.ajustes;
const letra = { unit: 'u', building: 'b', node: 'r' }[tipo];
if (!letra) { console.error(`Tipo desconocido: ${tipo}`); process.exit(1); }
const prefijo = `${letra}|${clave}|`;

// Fuera lo de antes de este elemento (lo agotado de un recurso se queda).
const hojasAntes = new Set();
for (const k of Object.keys(indice.sprites)) {
  if (!k.startsWith(prefijo) || (letra === 'r' && k.endsWith('|1'))) continue;
  hojasAntes.add(indice.hojas[indice.sprites[k][0]]);
  delete indice.sprites[k];
}

// Lo nuevo, cada hoja con su resolución.
indice.resHojas ||= {};
for (const h of res.hojas) {
  let i = indice.hojas.indexOf(h.nombre);
  if (i < 0) { i = indice.hojas.length; indice.hojas.push(h.nombre); }
  indice.resHojas[h.nombre] = res.resModelo;
  for (const [k, [x, y, w, hh, ox, oy]] of Object.entries(h.entradas)) indice.sprites[k] = [i, x, y, w, hh, ox, oy];
  await writeFile(`${DIR}/${h.nombre}`, Buffer.from(h.url.split(',')[1], 'base64'));
}
if (res.anim) (indice.anim ||= {})[clave] = res.anim;

// Hojas que se han quedado sin sprites: fuera del índice y del disco. Los
// sprites apuntan a las hojas por su posición, así que se renumeran.
const usadas = new Set(Object.values(indice.sprites).map((e) => e[0]));
const huerfanas = indice.hojas.filter((n, i) => !usadas.has(i) && hojasAntes.has(n));
if (huerfanas.length) {
  const nuevas = indice.hojas.filter((n) => !huerfanas.includes(n));
  const mapa = new Map(indice.hojas.map((n, i) => [i, nuevas.indexOf(n)]));
  for (const e of Object.values(indice.sprites)) e[0] = mapa.get(e[0]);
  indice.hojas = nuevas;
  for (const n of huerfanas) {
    delete indice.resHojas[n];
    await unlink(`${DIR}/${n}`).catch(() => {});
  }
}
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
await copyFile(fuente, `assets/fuentes/${clave}-modelo.${fuente.split('.').pop().toLowerCase()}`);

console.log(`${clave} (${tipo}): ${res.tris} triángulos, eje ${res.ajustes.eje}, giro ${res.ajustes.giro}°, `
  + `${Object.values(res.hojas).reduce((n, h) => n + Object.keys(h.entradas).length, 0)} sprites en ${res.hojas.length} hojas`
  + (huerfanas.length ? `; hojas retiradas: ${huerfanas.join(', ')}` : ''));
for (const a of res.avisos) console.log(`  · ${a}`);
