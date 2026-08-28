// Cambios que el jugador hace a los datos del juego desde el catálogo.
//
// Se guardan en el navegador y se aplican sobre los objetos de config.js al
// arrancar, antes de que nadie los lea. Sólo se tocan los campos declarados en
// el esquema de más abajo: cualquier otra cosa guardada se descarta, de modo
// que un almacenamiento corrupto no puede romper la partida.

import { UNITS, BUILDINGS, RESOURCE_NODES, GATHER_RATE, RES_NAME } from '../config.js';
import { TERRAIN_COLORS, clearSpriteCaches } from '../sprites.js';
import { LOOK, LOOK_FIELDS } from './appearance.js';

const STORAGE_KEY = 'aor-overrides-v1';

// --- Qué se puede editar ----------------------------------------------------

const num = (key, label, opts = {}) => ({ key, label, type: 'number', min: 0, max: 9999, step: 1, ...opts });
const cost = (res) => num(`cost.${res}`, RES_NAME[res], { max: 5000, group: 'Coste' });

/** Campos comunes a las unidades. Los que no existan en un tipo se omiten. */
export const UNIT_FIELDS = [
  { key: 'name', label: 'Nombre', type: 'text', group: 'Ficha' },
  { key: 'desc', label: 'Descripción', type: 'text', group: 'Ficha', wide: true },
  cost('food'), cost('wood'), cost('gold'), cost('stone'),
  num('time', 'Tiempo de creación', { max: 300, step: 1, unit: 's', group: 'Coste' }),
  num('pop', 'Población', { max: 20, group: 'Coste' }),
  num('hp', 'Puntos de vida', { min: 1, max: 5000, group: 'Combate' }),
  num('attack', 'Ataque', { max: 500, group: 'Combate' }),
  num('armor', 'Armadura', { max: 100, group: 'Combate' }),
  num('pArmor', 'Armadura antiproyectiles', { max: 100, group: 'Combate' }),
  num('range', 'Alcance', { max: 20, step: 0.1, unit: 'casillas', group: 'Combate' }),
  num('minRange', 'Alcance mínimo', { max: 20, step: 0.1, unit: 'casillas', group: 'Combate' }),
  num('rof', 'Cadencia', { min: 0.2, max: 20, step: 0.1, unit: 's', group: 'Combate' }),
  num('splash', 'Radio de salpicadura', { max: 10, step: 0.1, unit: 'casillas', group: 'Combate' }),
  num('speed', 'Velocidad', { min: 0.1, max: 10, step: 0.05, unit: 'casillas/s', group: 'Movimiento' }),
  num('los', 'Visión', { min: 1, max: 30, step: 0.5, unit: 'casillas', group: 'Movimiento' }),
  num('radius', 'Radio', { min: 0.1, max: 2, step: 0.02, unit: 'casillas', group: 'Movimiento' }),
];

export const BUILDING_FIELDS = [
  { key: 'name', label: 'Nombre', type: 'text', group: 'Ficha' },
  { key: 'desc', label: 'Descripción', type: 'text', group: 'Ficha', wide: true },
  cost('food'), cost('wood'), cost('gold'), cost('stone'),
  num('time', 'Tiempo de construcción', { max: 600, unit: 's', group: 'Coste' }),
  num('hp', 'Puntos de vida', { min: 1, max: 20000, group: 'Combate' }),
  num('armor', 'Armadura', { max: 100, group: 'Combate' }),
  num('pArmor', 'Armadura antiproyectiles', { max: 100, group: 'Combate' }),
  num('attack', 'Ataque', { max: 500, group: 'Combate' }),
  num('range', 'Alcance', { max: 25, step: 0.5, unit: 'casillas', group: 'Combate' }),
  num('rof', 'Cadencia', { min: 0.2, max: 20, step: 0.1, unit: 's', group: 'Combate' }),
  num('arrows', 'Flechas por descarga', { max: 20, group: 'Combate' }),
  num('size', 'Tamaño', { min: 1, max: 8, unit: 'casillas', group: 'Otros' }),
  num('los', 'Visión', { min: 1, max: 30, step: 0.5, unit: 'casillas', group: 'Otros' }),
  num('pop', 'Población que da', { max: 200, group: 'Otros' }),
  num('farm', 'Comida de la granja', { max: 9999, group: 'Otros' }),
];

export const NODE_FIELDS = [
  num('amount', 'Cantidad', { min: 1, max: 20000, group: 'Yacimiento' }),
  // Sólo los tienen los animales de rebaño (las ovejas).
  num('tame', 'Radio para domesticar', { min: 1, max: 20, step: 0.5, unit: 'casillas', group: 'Rebaño' }),
  num('speed', 'Velocidad', { min: 0.1, max: 5, step: 0.05, unit: 'casillas/s', group: 'Rebaño' }),
];

export const TERRAIN_LABELS = {
  grass: 'Hierba', grass2: 'Hierba oscura', grass3: 'Hierba frondosa',
  dirt: 'Tierra', sand: 'Arena', water: 'Agua', shallow: 'Orilla', road: 'Camino',
};

export const NODE_LABELS = {
  tree: 'Árbol', gold: 'Mina de oro', stone: 'Cantera',
  berries: 'Arbustos de bayas', sheep: 'Oveja', deer: 'Ciervo',
};

export const RATE_LABELS = {
  wood: 'Talar madera', gold: 'Picar oro', stone: 'Picar piedra',
  berries: 'Recoger bayas', farm: 'Cultivar granja', sheep: 'Ovejas', deer: 'Caza',
};

/**
 * El aspecto se guarda en sus propios cajones ("unitLook", ...) porque cambia
 * cómo se dibuja un objeto, no cómo se comporta: así se puede restablecer el
 * aspecto sin tocar los números, y al revés.
 */
export const LOOK_KINDS = { unitLook: 'unit', buildingLook: 'building', nodeLook: 'node' };

const FIELDS_BY_KIND = {
  unit: UNIT_FIELDS, building: BUILDING_FIELDS, node: NODE_FIELDS,
  unitLook: LOOK_FIELDS.unit, buildingLook: LOOK_FIELDS.building, nodeLook: LOOK_FIELDS.node,
};

/** El objeto cuyos valores edita un cajón: la ficha del juego o su aspecto. */
export function targetFor(kind, type) {
  const sub = LOOK_KINDS[kind];
  if (sub) return LOOK[sub][type];
  if (kind === 'unit') return UNITS[type];
  if (kind === 'building') return BUILDINGS[type];
  if (kind === 'node') return RESOURCE_NODES[type];
  return null;
}

export function fieldsFor(kind, def) {
  const list = FIELDS_BY_KIND[kind] || [];
  // Sólo los campos que ese objeto tiene de verdad (un aldeano no lleva salpicadura).
  return list.filter((f) => getPath(def, f.key) !== undefined);
}

// --- Acceso por ruta ("cost.food") ------------------------------------------

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  let o = obj;
  for (const k of parts) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[last] = value;
}

// --- Estado -----------------------------------------------------------------

/** Un juego de cajones vacío, uno por cada familia de datos editables. */
const emptyBuckets = () => ({
  unit: {}, building: {}, node: {}, rate: {}, terrain: {},
  unitLook: {}, buildingLook: {}, nodeLook: {},
});

/** Valores originales, para poder restablecer y saber qué está cambiado. */
const defaults = emptyBuckets();
let overrides = emptyBuckets();
let captured = false;

function capture() {
  if (captured) return;
  captured = true;
  for (const [type, def] of Object.entries(UNITS)) {
    defaults.unit[type] = {};
    for (const f of fieldsFor('unit', def)) defaults.unit[type][f.key] = getPath(def, f.key);
  }
  for (const [type, def] of Object.entries(BUILDINGS)) {
    defaults.building[type] = {};
    for (const f of fieldsFor('building', def)) defaults.building[type][f.key] = getPath(def, f.key);
  }
  for (const [type, def] of Object.entries(RESOURCE_NODES)) {
    defaults.node[type] = { amount: def.amount };
  }
  for (const [key, value] of Object.entries(GATHER_RATE)) defaults.rate[key] = value;
  for (const [key, value] of Object.entries(TERRAIN_COLORS)) defaults.terrain[key] = value;
  for (const [kind, sub] of Object.entries(LOOK_KINDS)) {
    for (const [type, def] of Object.entries(LOOK[sub])) defaults[kind][type] = { ...def };
  }
}

/**
 * Vuelve a tomar los colores de fábrica de un edificio. Hace falta cuando el
 * taller le cambia la cara: su modelo y su paleta pasan a ser otros, mientras
 * que lo que cuesta y lo que aguanta sigue siendo lo suyo y no se vuelve a
 * tomar (si no, unos valores ya retocados en el catálogo pasarían por ser los
 * de fábrica).
 */
export function captureBuildingLook(type) {
  capture();
  const l = LOOK.building[type];
  if (l) defaults.buildingLook[type] = { ...l };
}

export function defaultValue(kind, type, key) {
  capture();
  if (kind === 'rate') return defaults.rate[type];
  if (kind === 'terrain') return defaults.terrain[type];
  return defaults[kind]?.[type]?.[key];
}

/** ¿Está este valor cambiado respecto al original? */
export function isChanged(kind, type, key) {
  const bucket = overrides[kind];
  if (!bucket) return false;
  if (kind === 'rate' || kind === 'terrain') return bucket[type] !== undefined;
  return bucket[type]?.[key] !== undefined;
}

export function countChanges() {
  let n = 0;
  for (const [kind, bucket] of Object.entries(overrides)) {
    for (const value of Object.values(bucket)) {
      n += (kind === 'rate' || kind === 'terrain') ? 1 : Object.keys(value).length;
    }
  }
  return n;
}

// --- Validación -------------------------------------------------------------

const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function sanitize(kind, type, key, value) {
  if (kind === 'terrain') return isHexColor(value) ? value.toLowerCase() : null;
  if (kind === 'rate') {
    if (String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
  }
  const def = targetFor(kind, type);
  if (!def) return null;
  const field = fieldsFor(kind, def).find((f) => f.key === key);
  if (!field) return null;
  if (field.type === 'color') return isHexColor(value) ? String(value).toLowerCase() : null;
  if (field.type === 'text') {
    const s = String(value).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120);
    return s || null;
  }
  // Un campo vacío (o con texto que el navegador ya descartó) no vale cero.
  if (String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(field.max, Math.max(field.min, n));
}

// --- Aplicar y guardar ------------------------------------------------------

/** Vuelca los cambios guardados sobre los objetos de configuración. */
function applyAll() {
  capture();
  for (const [type, values] of Object.entries(overrides.unit)) {
    if (!UNITS[type]) continue;
    for (const [key, value] of Object.entries(values)) setPath(UNITS[type], key, value);
  }
  for (const [type, values] of Object.entries(overrides.building)) {
    if (!BUILDINGS[type]) continue;
    for (const [key, value] of Object.entries(values)) setPath(BUILDINGS[type], key, value);
  }
  for (const [type, values] of Object.entries(overrides.node)) {
    if (!RESOURCE_NODES[type]) continue;
    for (const [key, value] of Object.entries(values)) RESOURCE_NODES[type][key] = value;
  }
  for (const [key, value] of Object.entries(overrides.rate)) {
    if (GATHER_RATE[key] !== undefined) GATHER_RATE[key] = value;
  }
  for (const [key, value] of Object.entries(overrides.terrain)) {
    if (TERRAIN_COLORS[key] !== undefined) TERRAIN_COLORS[key] = value;
  }
  for (const [kind, sub] of Object.entries(LOOK_KINDS)) {
    for (const [type, values] of Object.entries(overrides[kind])) {
      if (!LOOK[sub][type]) continue;
      for (const [key, value] of Object.entries(values)) LOOK[sub][type][key] = value;
    }
  }
  clearSpriteCaches();
}

/** Deja los datos como venían de fábrica y vuelve a aplicar lo guardado. */
function restoreDefaults() {
  capture();
  for (const [type, values] of Object.entries(defaults.unit)) {
    for (const [key, value] of Object.entries(values)) setPath(UNITS[type], key, value);
  }
  for (const [type, values] of Object.entries(defaults.building)) {
    for (const [key, value] of Object.entries(values)) setPath(BUILDINGS[type], key, value);
  }
  for (const [type, values] of Object.entries(defaults.node)) RESOURCE_NODES[type].amount = values.amount;
  for (const [key, value] of Object.entries(defaults.rate)) GATHER_RATE[key] = value;
  for (const [key, value] of Object.entries(defaults.terrain)) TERRAIN_COLORS[key] = value;
  for (const [kind, sub] of Object.entries(LOOK_KINDS)) {
    for (const [type, values] of Object.entries(defaults[kind])) {
      if (LOOK[sub][type]) Object.assign(LOOK[sub][type], values);
    }
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch { /* sin espacio o modo privado */ }
}

/** Carga lo guardado y lo aplica. Se llama una vez, al arrancar. */
export function loadOverrides() {
  capture();
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { raw = null; }
  overrides = emptyBuckets();
  if (raw && typeof raw === 'object') {
    for (const kind of Object.keys(overrides)) {
      const bucket = raw[kind];
      if (!bucket || typeof bucket !== 'object') continue;
      for (const [type, value] of Object.entries(bucket)) {
        if (kind === 'rate' || kind === 'terrain') {
          const clean = sanitize(kind, type, null, value);
          if (clean !== null && defaultValue(kind, type) !== undefined) overrides[kind][type] = clean;
        } else if (value && typeof value === 'object') {
          for (const [key, v] of Object.entries(value)) {
            const clean = sanitize(kind, type, key, v);
            if (clean !== null) {
              (overrides[kind][type] ||= {})[key] = clean;
            }
          }
        }
      }
    }
  }
  applyAll();
  return overrides;
}

/** Cambia un valor. Devuelve el valor que se guardó, ya validado, o null. */
export function setValue(kind, type, key, value) {
  const clean = sanitize(kind, type, key, value);
  if (clean === null) return null;
  if (kind === 'rate' || kind === 'terrain') {
    if (clean === defaultValue(kind, type)) delete overrides[kind][type];
    else overrides[kind][type] = clean;
  } else {
    if (clean === defaultValue(kind, type, key)) {
      if (overrides[kind][type]) {
        delete overrides[kind][type][key];
        if (!Object.keys(overrides[kind][type]).length) delete overrides[kind][type];
      }
    } else {
      (overrides[kind][type] ||= {})[key] = clean;
    }
  }
  restoreDefaults();
  applyAll();
  save();
  return clean;
}

/** Restablece un objeto completo (o todo el juego si no se indica tipo). */
export function reset(kind = null, type = null) {
  if (!kind) overrides = emptyBuckets();
  else if (type === null) overrides[kind] = {};
  else delete overrides[kind][type];
  restoreDefaults();
  applyAll();
  save();
}

/** Copia de los cambios, para mandárselos al otro jugador en multijugador. */
export function exportOverrides() {
  return JSON.parse(JSON.stringify(overrides));
}

/** Adopta los cambios del anfitrión durante una partida en red (no se guardan). */
export function adoptOverrides(incoming) {
  if (!incoming || typeof incoming !== 'object') return;
  const mine = exportOverrides();
  overrides = emptyBuckets();
  for (const kind of Object.keys(overrides)) {
    const bucket = incoming[kind];
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [type, value] of Object.entries(bucket)) {
      if (kind === 'rate' || kind === 'terrain') {
        const clean = sanitize(kind, type, null, value);
        if (clean !== null) overrides[kind][type] = clean;
      } else if (value && typeof value === 'object') {
        for (const [key, v] of Object.entries(value)) {
          const clean = sanitize(kind, type, key, v);
          if (clean !== null) (overrides[kind][type] ||= {})[key] = clean;
        }
      }
    }
  }
  restoreDefaults();
  applyAll();
  return mine; // por si hiciera falta restaurar lo propio más adelante
}
