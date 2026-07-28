// Punto de entrada en Netlify para la sala de espera.
// Toda la lógica está en lobby-core.mjs; aquí sólo se conecta con el
// almacenamiento (Netlify Blobs) y con el formato HTTP.

import { getStore } from '@netlify/blobs';
import { handle } from './lobby-core.mjs';

const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

/** Adapta Netlify Blobs a la interfaz sencilla que espera lobby-core. */
function blobStore() {
  const store = getStore({ name: 'lobby', consistency: 'strong' });
  return {
    async get(key) {
      try { return await store.get(key, { type: 'json' }); } catch { return null; }
    },
    async set(key, value) { await store.setJSON(key, value); },
    async del(key) { try { await store.delete(key); } catch { /* ya no estaba */ } },
    async list(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key);
    },
  };
}

export default async function lobby(req) {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'usa POST' }), { status: 405, headers: CORS });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'cuerpo JSON no válido' }), { status: 400, headers: CORS });
  }
  try {
    const { status, body: out } = await handle(blobStore(), body);
    return new Response(JSON.stringify(out), { status, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: CORS });
  }
}

export const config = { path: '/api/lobby' };
