// Los modelos con los que el jugador re-viste los edificios del juego.
//
// El taller no fabrica edificios nuevos: **cambia la cara de los que ya hay**.
// Un modelo es un objeto de datos —a qué edificio viste y con qué piezas se
// arma— y lo único que cambia es cómo se dibuja ese edificio: lo que cuesta,
// lo que aguanta, lo que entrena y las casillas que ocupa los sigue poniendo el
// juego (y el catálogo, si se retocan allí). Así el taller no puede desequilibrar
// una partida, sólo darle otro aire.
//
// Con un proyecto de Supabase configurado (`cloud-config.js`) los modelos dejan
// de ser de un navegador: se guardan en una tabla y los ve todo el mundo, en
// cualquier dispositivo. El navegador se queda de copia, para que el juego
// arranque al instante y funcione igual sin cobertura.
//
// Todo lo que entra pasa por el validador, venga del almacenamiento del
// navegador o del otro jugador por la red: un modelo corrupto o malicioso se
// queda en un edificio soso, nunca en una partida rota.

import { BUILDINGS } from '../config.js';
import { LOOK } from './appearance.js';
import {
  PARTS, FIELDS, TILT_FIELDS, MATERIAL_KEYS, DEFAULT_PALETTE, PIECE_FIELDS, PIECE_DEF, isMineKey,
} from '../gfx3d/parts.js';
import { BUILTIN_DESIGNS } from './builtin-designs.js';
import { cloudEnabled, pullModels, pushModel, removeModel } from './cloud.js';

const STORAGE_KEY = 'aor-designs-v2';
/*
 * Qué edificios he tocado yo y todavía no han llegado a la nube. Sin esto, un
 * cambio hecho sin cobertura se perdería en cuanto la nube contestara con lo
 * que ella tiene: así se manda en cuanto se puede y, mientras tanto, lo mío
 * manda sobre lo suyo.
 */
const PENDING_KEY = 'aor-designs-pending-v1';

/**
 * Los edificios del juego: los únicos a los que se les puede cambiar la cara.
 * La lista es fija —el taller no da de alta ninguno nuevo—, así que la tabla de
 * edificios es la misma en cualquier dispositivo y en cualquier momento, que es
 * justo lo que necesita el protocolo de red.
 */
export const STOCK_BUILDINGS = Object.keys(BUILDINGS);

/** Tope de piezas: un modelo desmedido no puede reventar ni la memoria ni la red. */
export const MAX_PARTS = 200;

// --- Estado ------------------------------------------------------------------

/*
 * Dos listas: los modelos que vienen con el juego (builtin-designs.js, iguales
 * en todos los dispositivos) y los que ha hecho quien juega (guardados en su
 * navegador). De cada edificio hay como mucho uno de cada, y el propio manda
 * sobre el de fábrica mientras lo tenga.
 */
let builtin = new Map();
let designs = new Map();

/** Todos los modelos en vigor, uno por edificio. */
export function allDesigns() {
  return STOCK_BUILDINGS.map((t) => designs.get(t) || builtin.get(t)).filter(Boolean);
}

/** Sólo los que ha hecho quien juega. */
function myDesigns() { return STOCK_BUILDINGS.map((t) => designs.get(t)).filter(Boolean); }

/** El modelo en vigor de un edificio, sea propio o de los que trae el juego. */
export function getDesign(type) { return designs.get(type) || builtin.get(type) || null; }

/** ¿Le ha hecho el jugador un modelo a este edificio? */
export const isCustom = (type) => designs.has(type);

/** ¿Trae el juego un modelo para este edificio? */
export const isBuiltin = (type) => builtin.has(type);

/**
 * Con qué se dibuja un edificio. Sin modelo devuelve null y el juego usa el
 * suyo de siempre, el que está escrito en `gfx3d/buildings.js`.
 */
export function modelForBuilding(type) { return getDesign(type); }

// --- Validación --------------------------------------------------------------

const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function num(v, min, max, fallback, step) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const c = Math.min(max, Math.max(min, n));
  if (!step) return c;
  // Se redondea a la rejilla fina del campo para que no entren valores con
  // veinte decimales que luego no se pueden reproducir desde la interfaz. Fina
  // y no la del botón: lo que se afina a mano en la ficha, o con el paso corto
  // de la barra, tiene que sobrevivir a guardar. Y luego a cuatro decimales,
  // porque multiplicar por el escalón vuelve a dejar cola binaria
  // (0,05 × 48 = 2,4000000000000004) y esa cola acaba en lo guardado, en lo que
  // viaja por la red y en el texto que se comparte.
  return Math.round(Math.round(c / step) * step * 1e4) / 1e4;
}

/** Una pieza válida: tipo conocido, sólo sus campos y todos dentro de rango. */
function cleanPart(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const spec = PARTS[raw.k];
  /*
   * Una pieza del taller que todavía no está de alta **no es un modelo roto**:
   * es una referencia sin resolver. Puede que las piezas aún no hayan llegado de
   * la nube, o que este navegador se haya quedado sin ellas; la pieza sigue
   * existiendo, y volverá. Si aquí se tirara, el modelo se guardaría pelado y al
   * subir se llevaría la pieza por delante en el edificio de todo el mundo, que
   * es una pérdida de verdad y silenciosa. Así que se conserva: no se dibuja
   * mientras falte —eso lo resuelve `designParts` saltándosela— y vuelve a verse
   * en cuanto la pieza esté.
   *
   * Cómo se pone una pieza propia se sabe sin tenerla: es el mismo juego de
   * mandos para todas (`PIECE_FIELDS`). Lo que no se acepta es un `mia:` con
   * cualquier cosa detrás, que ése sí es basura.
   */
  if (!spec && !isMineKey(raw.k)) return null;
  const fields = spec ? spec.fields : PIECE_FIELDS;
  const def = spec ? spec.def : PIECE_DEF;
  const p = { k: raw.k };
  for (const key of fields) {
    const f = FIELDS[key];
    if (!f) continue;
    if (f.type === 'choice') {
      const ok = f.options.some(([v]) => v === raw[key]);
      p[key] = ok ? raw[key] : def[key];
    } else {
      p[key] = num(raw[key], f.min, f.max, def[key], f.pelo || f.fino || f.step);
    }
  }
  /*
   * Los giros de fuera son de todas las piezas, así que no están en la lista
   * de campos de ninguna; y sólo se guardan si giran, para que un modelo lleno
   * de piezas derechas no cargue con tres ceros por pieza.
   */
  for (const key of TILT_FIELDS) {
    const f = FIELDS[key];
    const v = num(raw[key], f.min, f.max, 0, f.pelo || f.fino || f.step);
    if (v) p[key] = v;
  }
  p.m = MATERIAL_KEYS.includes(raw.m) ? raw.m : def.m;
  if (raw.rough) p.rough = true;
  if (raw.noshadow) p.noshadow = true;
  return p;
}

/**
 * Un modelo válido para un edificio del juego. `target` manda: si el modelo se
 * hizo sobre otra huella —uno traído de fuera, o el mismo modelo llevado a otro
 * edificio— se estira o encoge hasta la del edificio que va a vestir, de modo
 * que lo que se ve en el taller es lo que se verá en la partida.
 *
 * `to` fuerza el edificio destino; sin él manda el que traiga el propio modelo.
 * Se acepta `replaces` como nombre antiguo de `target`: los modelos que se
 * compartieron antes siguen entrando.
 */
function cleanDesign(raw, to = null) {
  if (!raw || typeof raw !== 'object') return null;
  const target = STOCK_BUILDINGS.includes(to) ? to
    : [raw.target, raw.replaces].find((t) => STOCK_BUILDINGS.includes(t));
  if (!target) return null;

  const d = { target, size: BUILDINGS[target].size, palette: {}, parts: [] };
  for (const [key, def] of Object.entries(DEFAULT_PALETTE)) {
    d.palette[key] = isHexColor(raw.palette?.[key]) ? raw.palette[key].toLowerCase() : def;
  }
  const parts = Array.isArray(raw.parts) ? raw.parts.slice(0, MAX_PARTS) : [];
  for (const p of parts) {
    const c = cleanPart(p);
    if (c) d.parts.push(c);
  }
  const from = num(raw.size, 1, 8, d.size, 1);
  return from === d.size ? d : resizeDesign(d, d.size, from);
}

// --- Alta en el juego --------------------------------------------------------

/** Los colores originales de los edificios vestidos, para poder devolverlos. */
const stockLooks = new Map();

/** Sólo los materiales que el modelo usa de verdad: el catálogo no pregunta de más. */
function paletteOf(d) {
  const used = new Set(d.parts.map((p) => p.m).filter((m) => DEFAULT_PALETTE[m] !== undefined));
  // La madera sale en los marcos de puertas y ventanas y en el andamio de la
  // obra, aunque ninguna pieza la pida por su nombre.
  used.add('wood');
  used.add('stone');
  const palette = {};
  for (const m of used) palette[m] = d.palette[m];
  return palette;
}

/**
 * Deja los edificios con la cara que les toca: la de su modelo, o la suya de
 * fábrica si se acaba de quitar el que tenían.
 */
function applyRegistry() {
  for (const [type, look] of stockLooks) LOOK.building[type] = look;
  for (const d of allDesigns()) {
    if (!stockLooks.has(d.target)) stockLooks.set(d.target, LOOK.building[d.target]);
    LOOK.building[d.target] = paletteOf(d);
  }
}

/*
 * Campos de una pieza que son medidas y hay que escalar al cambiar la huella;
 * los demás (giros, número de lados, peldaños) no se tocan.
 */
const SCALED_FIELDS = ['x', 'y', 'z', 'w', 'd', 'h', 'r', 'r0', 'r1', 'rise', 'over', 'len', 'th'];

/**
 * Lleva un modelo a otra huella, estirando o encogiendo el modelo entero. Es lo
 * que pasa al llevar un modelo a un edificio de otro tamaño: la huella la manda
 * el edificio, nunca el modelo.
 */
function resizeDesign(design, size, fromSize = null) {
  const from = fromSize || design.size || 2;
  const to = Math.min(8, Math.max(1, Math.round(size)));
  if (to === from) return design;
  const k = to / from;
  const scaled = { ...design, size: to, parts: design.parts.map((p) => ({ ...p })) };
  for (const p of scaled.parts) {
    for (const key of SCALED_FIELDS) {
      if (p[key] === undefined) continue;
      const f = FIELDS[key];
      p[key] = num(p[key] * k, f.min, f.max, p[key], f.pelo || f.fino || f.step);
    }
  }
  return scaled;
}

// --- Guardar y cargar --------------------------------------------------------

/** Edificios que he tocado y que la nube todavía no sabe. */
let pending = new Set();
/** Se juega con los modelos de otro (multijugador): nada de esto es mío. */
let adopted = false;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(myDesigns()));
    /*
     * La lista de pendientes sólo significa algo con taller compartido. Sin él
     * no se escribe, y esa ausencia es justo lo que hace falta: el día que se
     * conecte un proyecto, lo que ya hubiera guardado aquí se da por mío y sin
     * enviar —y sube— en vez de darse por borrado por no estar en la nube.
     */
    if (cloudEnabled()) localStorage.setItem(PENDING_KEY, JSON.stringify([...pending]));
  } catch { /* sin espacio o modo privado: se sigue jugando con lo que hay */ }
}

/**
 * Apunta que este edificio lo he cambiado yo. Sin proyecto configurado no hay
 * nada que apuntar: lo del navegador ya es lo definitivo.
 */
function markPending(target) {
  if (!cloudEnabled()) return;
  pending.add(target);
}

/** Carga los del juego y los guardados, y los pone en vigor. Se llama al arrancar. */
export function loadDesigns() {
  builtin = new Map();
  for (const item of Array.isArray(BUILTIN_DESIGNS) ? BUILTIN_DESIGNS : []) {
    const d = cleanDesign(item);
    // Los del juego pasan por el mismo validador que todo lo demás: un fallo al
    // pegar uno no puede tumbar el arranque de nadie. Y de cada edificio hay
    // uno solo: el primero que aparezca en la lista.
    if (d && !builtin.has(d.target)) builtin.set(d.target, d);
  }
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { raw = null; }
  designs = new Map();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const d = cleanDesign(item);
      if (d && !designs.has(d.target)) designs.set(d.target, d);
    }
  }
  let rawPending = null;
  try { rawPending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { rawPending = null; }
  if (Array.isArray(rawPending)) {
    pending = new Set(rawPending.filter((t) => STOCK_BUILDINGS.includes(t)));
  } else {
    /*
     * La primera vez que este navegador ve un taller compartido —o si la lista
     * de pendientes se ha estropeado— lo que hay guardado aquí se da por mío y
     * sin enviar. Si no, la primera sincronización lo borraría por no estar en
     * la nube, y son los modelos que se hicieron antes de conectarla.
     */
    pending = new Set(designs.keys());
  }
  applyRegistry();
  return allDesigns();
}

/**
 * Guarda el modelo de un edificio. Sustituye al que hubiera: de cada edificio
 * hay una cara y sólo una.
 */
export function saveDesign(raw, to = null) {
  const d = cleanDesign(raw, to);
  if (!d) return null;
  designs.set(d.target, d);
  markPending(d.target);
  applyRegistry();
  save();
  return d;
}

/** Le devuelve a un edificio su aspecto anterior: el del juego, o el de fábrica. */
export function resetBuilding(type) {
  if (!designs.has(type)) return false;
  designs.delete(type);
  markPending(type);
  applyRegistry();
  save();
  return true;
}

// --- El taller compartido ----------------------------------------------------

/** ¿Hay proyecto detrás? El taller lo dice, para no prometer lo que no hay. */
export { cloudEnabled };

/** Cuántos cambios míos están esperando a salir. */
export function pendingCount() { return pending.size; }

/*
 * Que no se solapen dos sincronizaciones: la segunda se engancha a la primera.
 * Pasa en cuanto se guarda dos veces seguidas, que es lo normal modelando.
 */
let syncing = null;

/**
 * Pone de acuerdo el taller de este navegador con el de la nube: primero manda
 * lo mío que aún no había salido y luego se trae lo que haya, que puede venir
 * de otro dispositivo o de otra persona.
 *
 * Nunca lanza. Devuelve en qué ha quedado la cosa:
 *   state    'off' sin proyecto · 'ok' al día · 'error' no se ha podido
 *   changed  qué edificios han cambiado de cara (hay que rehacer sus colores)
 *   pending  cuántos cambios míos siguen esperando
 *   reason   si falló: 'table' falta la tabla · 'auth' la clave · 'net' la red
 *
 * No se llama con una partida en marcha: cambiar los modelos a mitad de partida
 * dejaría edificios que se dibujan de otra forma de un fotograma al siguiente.
 */
export function syncDesigns() {
  if (!cloudEnabled() || adopted) {
    return Promise.resolve({ state: 'off', changed: [], pending: 0, reason: null });
  }
  if (syncing) return syncing;
  syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  let failed = null, why = null;
  // Lo mío primero: si sale, deja de ser mío y pasa a ser de todos.
  for (const target of [...pending]) {
    const mine = designs.get(target);
    const { ok, error, reason } = mine ? await pushModel(mine) : await removeModel(target);
    if (ok) pending.delete(target);
    else { failed = error; why = reason; }
  }

  const { models, error, reason } = await pullModels();
  if (!models) {
    save();
    return {
      state: 'error', changed: [], pending: pending.size,
      error: failed || error, reason: why || reason,
    };
  }

  const next = new Map();
  for (const row of models) {
    const d = cleanDesign(row);
    if (d && !next.has(d.target)) next.set(d.target, d);
  }
  // Lo que yo he tocado y aún no ha salido manda sobre lo que diga la nube: es
  // más nuevo que lo que ella tiene, y si no se perdería al recibir.
  for (const target of pending) {
    if (designs.has(target)) next.set(target, designs.get(target));
    else next.delete(target);
  }

  // Qué edificios se dibujan distinto a partir de ahora: quien llame tiene que
  // rehacerles los colores y los sprites, y sólo a ésos.
  const changed = [];
  for (const target of new Set([...designs.keys(), ...next.keys()])) {
    const before = designs.get(target);
    const after = next.get(target);
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) changed.push(target);
  }
  designs = next;
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

// --- Multijugador ------------------------------------------------------------

/*
 * Los modelos del anfitrión viajan al invitado por el canal de datos, en un solo
 * mensaje junto a la señal de empezar. Un canal WebRTC no es sitio para medio
 * megabyte, así que se manda lo que quepa en este presupuesto y el resto se
 * queda en casa: la partida arranca igual, sencillamente con algún edificio con
 * su cara de siempre. Con modelos de tamaño normal caben todos de sobra.
 */
const SHARE_BUDGET = 48000;

/**
 * Los modelos que caben en un mensaje de red. Van también los que trae el
 * juego: si el anfitrión tiene una versión con edificios ya re-vestidos que el
 * invitado no conoce, así los dos ven lo mismo en el mapa.
 */
export function shareableDesigns() {
  const out = [];
  let size = 0;
  for (const d of allDesigns()) {
    const bytes = JSON.stringify(d).length;
    if (size + bytes > SHARE_BUDGET) break;
    size += bytes;
    out.push(JSON.parse(JSON.stringify(d)));
  }
  return out;
}

/**
 * Adopta las caras de los edificios del anfitrión durante una partida en red.
 * Los modelos propios se quedan guardados en el navegador y vuelven al recargar
 * la página: lo que se cambia aquí es sólo lo que se ve mientras dure la
 * partida. Como el taller no da de alta edificios, la tabla de tipos no se
 * mueve y esto no puede descuadrar una instantánea.
 */
export function adoptDesigns(incoming) {
  // Lo adoptado es prestado y no sale de esta partida: se cierra la puerta a la
  // nube para que no acabe guardado como si fuera de aquí. Lo propio sigue en el
  // navegador y vuelve al recargar la página, que es como se sale de una partida.
  adopted = true;
  builtin = new Map();
  designs = new Map();
  if (Array.isArray(incoming)) {
    for (const item of incoming.slice(0, STOCK_BUILDINGS.length * 2)) {
      const d = cleanDesign(item);
      if (d && !designs.has(d.target)) designs.set(d.target, d);
    }
  }
  applyRegistry();
  return allDesigns();
}

// --- Plantillas --------------------------------------------------------------

/*
 * Con qué empieza un edificio al que se le va a cambiar la cara. Su modelo de
 * serie está escrito en código, no en piezas, así que no se puede abrir y
 * retocar: se empieza por una de estas y se lleva desde ahí a donde se quiera.
 * Todas se ajustan solas a la huella del edificio que vayan a vestir.
 */
export const TEMPLATES = [
  {
    key: 'empty', label: 'En blanco',
    hint: 'La huella vacía, para levantarlo pieza a pieza desde cero.',
    make: () => ({ size: 2, parts: [] }),
  },
  {
    key: 'hut', label: 'Cabaña',
    hint: 'Zócalo, muros, tejado a dos aguas, puerta, ventana y chimenea.',
    make: () => ({
      size: 2,
      parts: [
        { k: 'box', x: 1, y: 1, z: 0, w: 1.7, d: 1.7, h: 0.15, yaw: 0, m: 'stone' },
        { k: 'box', x: 1, y: 1, z: 0.15, w: 1.6, d: 1.6, h: 0.7, yaw: 0, m: 'wall' },
        { k: 'gable', x: 1, y: 1, z: 0.85, w: 1.6, d: 1.6, rise: 0.5, over: 0.14, axis: 'x', m: 'roof' },
        { k: 'door', x: 1.8, y: 1, z: 0, w: 0.4, h: 0.5, face: 'x', m: 'door' },
        { k: 'window', x: 0.7, y: 1.8, z: 0.45, w: 0.2, h: 0.2, face: 'y', m: 'wood' },
        { k: 'box', x: 0.5, y: 0.55, z: 0.85, w: 0.15, d: 0.15, h: 0.7, yaw: 0, m: 'chimney' },
      ],
    }),
  },
  {
    key: 'keep', label: 'Torreón',
    hint: 'Torre redonda con almenas, puerta y estandarte.',
    make: () => ({
      size: 2,
      parts: [
        { k: 'tower', x: 1, y: 1, z: 0, r: 0.56, h: 1.6, m: 'stone' },
        { k: 'door', x: 1.6, y: 1, z: 0, w: 0.3, h: 0.4, face: 'x', m: 'door' },
        { k: 'flag', x: 1, y: 1, z: 1.8, h: 0.5, m: 'player' },
      ],
    }),
  },
  {
    key: 'shed', label: 'Cobertizo',
    hint: 'Cuatro postes, techo de una agua y material apilado.',
    make: () => ({
      size: 2,
      parts: [
        { k: 'box', x: 1, y: 1, z: 0, w: 1.9, d: 1.9, h: 0.05, yaw: 0, m: 'soil', noshadow: true },
        { k: 'beam', x: 0.3, y: 0.3, z: 0, len: 0.75, yaw: 0, pitch: 90, th: 0.06, m: 'wood' },
        { k: 'beam', x: 1.7, y: 0.3, z: 0, len: 0.75, yaw: 0, pitch: 90, th: 0.06, m: 'wood' },
        { k: 'beam', x: 0.3, y: 1.7, z: 0, len: 0.75, yaw: 0, pitch: 90, th: 0.06, m: 'wood' },
        { k: 'beam', x: 1.7, y: 1.7, z: 0, len: 0.75, yaw: 0, pitch: 90, th: 0.06, m: 'wood' },
        { k: 'panel', x: 1, y: 1, z: 0.75, w: 1.9, d: 1.9, rise: 0.2, axis: 'x', m: 'thatch', rough: true },
        { k: 'logs', x: 1.15, y: 1.3, z: 0, len: 0.8, n: 6, m: 'wood' },
        { k: 'barrel', x: 0.5, y: 1.5, z: 0, m: 'wood' },
      ],
    }),
  },
  {
    key: 'hall', label: 'Casa grande',
    hint: 'Entramado de madera, porche y tejado a cuatro aguas.',
    make: () => ({
      size: 3,
      parts: [
        { k: 'box', x: 1.5, y: 1.5, z: 0, w: 2.7, d: 2.7, h: 0.2, yaw: 0, m: 'base' },
        { k: 'box', x: 1.5, y: 1.5, z: 0.2, w: 2.4, d: 2.4, h: 0.6, yaw: 0, m: 'stone' },
        { k: 'box', x: 1.5, y: 1.5, z: 0.8, w: 2.5, d: 2.5, h: 0.6, yaw: 0, m: 'wall' },
        { k: 'beam', x: 2.75, y: 0.4, z: 0.8, len: 0.6, yaw: 0, pitch: 90, th: 0.04, m: 'wood' },
        { k: 'beam', x: 2.75, y: 1.5, z: 0.8, len: 0.6, yaw: 0, pitch: 90, th: 0.04, m: 'wood' },
        { k: 'beam', x: 2.75, y: 2.6, z: 0.8, len: 0.6, yaw: 0, pitch: 90, th: 0.04, m: 'wood' },
        { k: 'hip', x: 1.5, y: 1.5, z: 1.4, w: 2.6, d: 2.6, rise: 0.75, over: 0.22, m: 'roof' },
        { k: 'door', x: 2.75, y: 1.5, z: 0.2, w: 0.5, h: 0.6, face: 'x', m: 'door' },
        { k: 'window', x: 1.5, y: 2.75, z: 0.95, w: 0.25, h: 0.25, face: 'y', m: 'wood' },
        { k: 'stairs', x: 2.95, y: 1.5, z: 0, w: 0.7, d: 0.3, h: 0.2, steps: 2, axis: 'x', m: 'base' },
        { k: 'flag', x: 0.4, y: 0.4, z: 1.4, h: 0.6, m: 'player' },
      ],
    }),
  },
];

/** Un modelo nuevo para un edificio a partir de una plantilla, ya validado. */
export function designFromTemplate(key, target) {
  const t = TEMPLATES.find((x) => x.key === key) || TEMPLATES[0];
  return cleanDesign(t.make(), target);
}
