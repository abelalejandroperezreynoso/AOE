// Servidor de desarrollo: sirve el juego y la sala de espera en un solo
// proceso, sin dependencias. Para jugar en local o en una red local:
//
//   node tools/dev-server.mjs [puerto]
//
// En producción no se usa: Netlify sirve los archivos estáticos y
// netlify/functions/lobby.mjs se encarga de la sala.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../netlify/functions/lobby-core.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

// Almacén en memoria con la misma interfaz que usa lobby-core.
const mem = new Map();
const store = {
  async get(key) { return mem.has(key) ? JSON.parse(mem.get(key)) : null; },
  async set(key, value) { mem.set(key, JSON.stringify(value)); },
  async del(key) { mem.delete(key); },
  async list(prefix) { return [...mem.keys()].filter((k) => k.startsWith(prefix)); },
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (c) => {
    data += c;
    if (data.length > 1e6) { reject(new Error('cuerpo demasiado grande')); req.destroy(); }
  });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/lobby') {
    if (req.method !== 'POST') { res.writeHead(405).end('{"error":"usa POST"}'); return; }
    try {
      const { status, body } = await handle(store, JSON.parse(await readBody(req) || '{}'));
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(err?.message || err) }));
    }
    return;
  }

  // Archivos estáticos, sin salir de la carpeta del proyecto.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][/\\])+/, '');
  let file = join(ROOT, rel === sep || rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('prohibido'); return; }
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('no encontrado');
  }
});

server.listen(PORT, () => {
  console.log(`Age of Realms II en http://localhost:${PORT}`);
  console.log('Sala de espera en memoria: se vacía al reiniciar el proceso.');
});
