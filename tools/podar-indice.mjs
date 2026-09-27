// Quita del índice de sprites las hojas que ya no usa ningún sprite, y borra
// sus archivos, para que la partida no las descargue.
//
//   node tools/podar-indice.mjs
//
// Las hojas se renumeran; las claves de los sprites no cambian.

import { readFile, writeFile, unlink } from 'node:fs/promises';

const DIR = 'assets/sprites';
const indice = JSON.parse(await readFile(`${DIR}/indice.json`, 'utf8'));
const usadas = new Set(Object.values(indice.sprites).map((e) => e[0]));
const nuevas = [], mapa = new Map();
indice.hojas.forEach((h, i) => { if (usadas.has(i)) { mapa.set(i, nuevas.length); nuevas.push(h); } });
for (const e of Object.values(indice.sprites)) e[0] = mapa.get(e[0]);
const fuera = indice.hojas.filter((_, i) => !usadas.has(i));
indice.hojas = nuevas;
await writeFile(`${DIR}/indice.json`, JSON.stringify(indice));
for (const h of fuera) { await unlink(`${DIR}/${h}`).catch(() => {}); console.log(`fuera ${h}`); }
console.log(`${nuevas.length} hojas en uso`);
