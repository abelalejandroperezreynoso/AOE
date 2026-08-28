// El taller, en la nube: lo que se rehace aquí lo ve todo el mundo.
//
// Los modelos del taller vivían sólo en el navegador de quien los hacía. Con un
// proyecto de Supabase detrás viven en una tabla, así que un edificio rehecho en
// el móvil sale igual en el ordenador y en el juego de cualquiera que entre.
//
// El juego no carga librerías —es parte de su gracia: no descarga nada—, así que
// se habla con Supabase por su API REST (PostgREST) con `fetch`, igual que la
// sala de espera habla con su función. Una tabla, una fila por edificio.
//
// Nada de aquí puede tumbar el juego: si no hay proyecto configurado, si no hay
// red o si la respuesta viene torcida, se devuelve un fallo tranquilo y el
// taller sigue funcionando contra el navegador, como siempre.

import { CLOUD_URL, CLOUD_KEY } from './cloud-config.js';

const TABLE = 'building_models';
/** Lo que se espera a la nube antes de seguir sin ella. */
const TIMEOUT = 8000;
/** Dónde se puede apuntar a otro proyecto sin tocar el código. */
const OVERRIDE_KEY = 'aor-cloud';

/** El proyecto al que hablar, o null si no hay ninguno configurado. */
function project() {
  let over = null;
  try { over = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || 'null'); } catch { over = null; }
  const url = String(over?.url || CLOUD_URL || '').trim().replace(/\/+$/, '');
  const key = String(over?.key || CLOUD_KEY || '').trim();
  return url && key ? { url, key } : null;
}

/** ¿Hay taller compartido? Si no, el juego va contra el navegador y ya está. */
export function cloudEnabled() { return !!project(); }

/**
 * Una llamada a la tabla. Devuelve `{ data }` si salió bien y `{ error }` si no;
 * nunca lanza, porque ninguna de estas llamadas es imprescindible para jugar.
 */
async function call(path, opts = {}) {
  const p = project();
  if (!p) return { error: 'sin proyecto' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${p.url}/rest/v1/${path}`, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        apikey: p.key,
        Authorization: `Bearer ${p.key}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      // El cuerpo de PostgREST dice qué restricción se ha saltado: se recorta
      // porque acaba en un aviso de una línea, no en la consola de nadie.
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return { error: `${res.status} ${detail}`.trim() };
    }
    const text = await res.text();
    return { data: text ? JSON.parse(text) : null };
  } catch (err) {
    return { error: err?.name === 'AbortError' ? 'la nube no contesta' : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Todos los modelos guardados. Devuelve la lista, o null si no se ha podido
 * preguntar: no es lo mismo «no hay ninguno» que «no me he enterado», y quien
 * llama tiene que poder distinguirlo para no borrar lo que tenía.
 */
export async function pullModels() {
  const { data, error } = await call(`${TABLE}?select=target,model`);
  if (error || !Array.isArray(data)) return null;
  return data.map((row) => row?.model).filter((m) => m && typeof m === 'object');
}

/**
 * Guarda (o rehace) la cara de un edificio. Va por `on_conflict` para que sea
 * la misma llamada la primera vez y las siguientes: de cada edificio hay una
 * fila y sólo una.
 */
export async function pushModel(model) {
  const { error } = await call(`${TABLE}?on_conflict=target`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ target: model.target, model }]),
  });
  return { ok: !error, error };
}

/** Quita la cara de un edificio: vuelve a dibujarse como venga en el código. */
export async function removeModel(target) {
  const { error } = await call(`${TABLE}?target=eq.${encodeURIComponent(target)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  return { ok: !error, error };
}
