// Las piezas que se hacen en el taller: el vocabulario con el que se visten los
// edificios, ampliable desde dentro del juego.
//
// Una pieza del juego (`caja`, `cilindro`, `tejado`) es código. Una pieza propia
// es **datos**: una lista de piezas del juego con su sitio, su tamaño y su
// material, guardada con un nombre. Al darla de alta pasa a estar en el catálogo
// como una más, así que un edificio la lleva igual que llevaría una caja, y —eso
// es lo suyo— **queda enlazada**: cambiar la pieza cambia de golpe todos los
// edificios que la usen.
//
// Como los modelos, viven en la nube cuando hay proyecto detrás, así que lo que
// se haga aquí lo ve todo el mundo. Y como los modelos, no se anidan ni se
// inventan piezas del juego: una pieza propia se compone sólo con las de serie.
//
// Este módulo tiene que cargarse **antes** que los modelos: si un edificio lleva
// una pieza propia y esa pieza aún no está de alta, el validador de modelos la
// tiraría por no existir.

import {
  PARTS, FIELDS, MATERIAL_KEYS, MINE, isMine,
  registerPiece, unregisterPiece, pieceMesh, meshBounds,
} from '../gfx3d/parts.js';
import { cloudEnabled, pullParts, pushPart, removePart } from './cloud.js';

const STORAGE_KEY = 'aor-pieces';
const PENDING_KEY = 'aor-pieces-pending';

/** Cuántas piezas del juego caben en una propia. */
export const MAX_PIECE_PARTS = 60;
/** Cuántas piezas propias caben en total. */
export const MAX_PIECES = 40;

/** Las piezas propias, por su clave. */
let pieces = new Map();
/** Las que he tocado y la nube todavía no sabe. */
let pending = new Set();
let syncing = null;

// --- Validación --------------------------------------------------------------

const num = (v, min, max, def, step) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const paso = Math.max(1e-6, step || 0.01);
  return Math.min(max, Math.max(min, Math.round(n / paso) * paso));
};

/**
 * Una clave de pieza válida. Es lo que va dentro del modelo de cada edificio y
 * lo que manda la base de datos, así que se acota a lo mismo que allí.
 */
function cleanKey(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return /^[a-z][a-z0-9-]{2,31}$/.test(k) ? k : null;
}

/** El nombre que se lee en el catálogo. */
function cleanLabel(raw, fallback) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return t || fallback;
}

/**
 * Una pieza del juego dentro de una propia. Se recorta igual que en un modelo, y
 * de paso se cae cualquier pieza propia que alguien intente meter dentro: no se
 * anidan.
 */
function cleanSub(raw) {
  if (!raw || typeof raw !== 'object' || isMine(raw.k)) return null;
  const spec = PARTS[raw.k];
  if (!spec || spec.mine) return null;
  const p = { k: raw.k };
  for (const key of spec.fields) {
    const f = FIELDS[key];
    if (!f) continue;
    if (f.type === 'choice') {
      const ok = f.options.some(([v]) => v === raw[key]);
      p[key] = ok ? raw[key] : spec.def[key];
    } else {
      p[key] = num(raw[key], f.min, f.max, spec.def[key], f.step);
    }
  }
  p.m = MATERIAL_KEYS.includes(raw.m) ? raw.m : spec.def.m;
  if (raw.rough) p.rough = true;
  if (raw.noshadow) p.noshadow = true;
  return p;
}

/** Una pieza propia entera, tal y como se guarda: `{ key, label, parts }`. */
export function cleanPiece(raw, key = null) {
  if (!raw || typeof raw !== 'object') return null;
  const k = cleanKey(key || raw.key);
  if (!k) return null;
  const parts = [];
  for (const sub of Array.isArray(raw.parts) ? raw.parts.slice(0, MAX_PIECE_PARTS) : []) {
    const c = cleanSub(sub);
    if (c) parts.push(c);
  }
  return { key: k, label: cleanLabel(raw.label, k), parts };
}

/**
 * Lo que ocupa una pieza, en casillas. Es el tamaño con el que nace al ponerla
 * en un edificio: puesta a su talla se ve como se modeló.
 */
export function pieceSize(def) {
  const tris = pieceMesh(def, { M: {}, C: { main: '#888' }, s: 2 });
  if (!tris.length) return { w: 1, d: 1, h: 1 };
  const b = meshBounds(tris);
  const acota = (v) => Math.min(8, Math.max(0.05, Math.round(v * 100) / 100));
  return { w: acota(b.x1 - b.x0), d: acota(b.y1 - b.y0), h: acota(b.z1 - b.z0) };
}

// --- Alta en el dibujante ----------------------------------------------------

/** Pone al día el catálogo del dibujante con lo que haya guardado. */
function applyRegistry() {
  for (const k of Object.keys(PARTS)) {
    if (isMine(k) && !pieces.has(k.slice(MINE.length))) unregisterPiece(k.slice(MINE.length));
  }
  for (const def of pieces.values()) registerPiece({ ...def, talla: pieceSize(def) });
}

// --- Guardar y cargar --------------------------------------------------------

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...pieces.values()]));
    if (cloudEnabled()) localStorage.setItem(PENDING_KEY, JSON.stringify([...pending]));
  } catch { /* sin espacio o modo privado: se sigue jugando con lo que hay */ }
}

function markPending(key) {
  if (!cloudEnabled()) return;
  pending.add(key);
}

/**
 * Lee del navegador lo que hubiera y da de alta las piezas. Va antes que los
 * modelos: si no, un edificio que lleve una pieza propia la perdería al leerse.
 */
export function loadPieces() {
  pieces = new Map();
  pending = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    for (const p of Array.isArray(raw) ? raw.slice(0, MAX_PIECES) : []) {
      const c = cleanPiece(p);
      if (c) pieces.set(c.key, c);
    }
  } catch { /* lo que no se entienda, como si no estuviera */ }
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    for (const k of Array.isArray(raw) ? raw : []) if (pieces.has(k)) pending.add(k);
  } catch { /* ídem */ }
  applyRegistry();
}

/** Todas las piezas propias, en orden de nombre. */
export function allPieces() {
  return [...pieces.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function getPiece(key) { return pieces.get(key) || null; }
export function hasPiece(key) { return pieces.has(key); }

/** Cuántas piezas he tocado y la nube todavía no sabe. */
export function pendingPieces() { return pending.size; }

/** Guarda una pieza (nueva o rehecha) y la deja de alta en el catálogo. */
export function savePiece(raw, key = null) {
  const def = cleanPiece(raw, key);
  if (!def) return null;
  if (!pieces.has(def.key) && pieces.size >= MAX_PIECES) return null;
  pieces.set(def.key, def);
  markPending(def.key);
  applyRegistry();
  save();
  return def;
}

/**
 * Quita una pieza. Lo que la llevara puesta deja de dibujarse, así que quien
 * llame tiene que avisar de cuántos edificios la usan antes de llegar aquí.
 */
export function deletePiece(key) {
  if (!pieces.has(key)) return false;
  pieces.delete(key);
  markPending(key);
  applyRegistry();
  save();
  return true;
}

/** Una clave libre a partir de un nombre, para no pisar otra pieza. */
export function freeKey(label) {
  const base = cleanKey(String(label || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    || 'pieza';
  if (!pieces.has(base)) return base;
  for (let i = 2; i < 99; i++) if (!pieces.has(`${base}-${i}`)) return `${base}-${i}`;
  return null;
}

// --- Nube --------------------------------------------------------------------

/**
 * Pone de acuerdo las piezas de este navegador con las de la nube. Igual que con
 * los modelos: primero sale lo mío y luego se trae lo que haya, y lo mío que aún
 * no ha salido manda sobre lo que diga la nube.
 *
 * Devuelve `{ state, changed, pending, reason }`, donde `changed` son las piezas
 * que se dibujan distinto a partir de ahora: quien llame tiene que rehacer los
 * edificios que las lleven.
 */
export function syncPieces() {
  if (!cloudEnabled()) return Promise.resolve({ state: 'off', changed: [], pending: 0, reason: null });
  if (syncing) return syncing;
  syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  let failed = null, why = null;
  for (const key of [...pending]) {
    const mine = pieces.get(key);
    const { ok, error, reason } = mine ? await pushPart(mine) : await removePart(key);
    if (ok) pending.delete(key);
    else { failed = error; why = reason; }
  }

  const { parts, error, reason } = await pullParts();
  if (!parts) {
    save();
    return {
      state: 'error', changed: [], pending: pending.size,
      error: failed || error, reason: why || reason,
    };
  }

  const next = new Map();
  for (const row of parts.slice(0, MAX_PIECES)) {
    const c = cleanPiece(row);
    if (c && !next.has(c.key)) next.set(c.key, c);
  }
  for (const key of pending) {
    if (pieces.has(key)) next.set(key, pieces.get(key));
    else next.delete(key);
  }

  const changed = [];
  for (const key of new Set([...pieces.keys(), ...next.keys()])) {
    const antes = pieces.get(key);
    const ahora = next.get(key);
    if (JSON.stringify(antes ?? null) !== JSON.stringify(ahora ?? null)) changed.push(key);
  }
  pieces = next;
  applyRegistry();
  save();
  return {
    state: failed ? 'error' : 'ok',
    changed,
    pending: pending.size,
    error: failed || null,
    reason: why,
  };
}
