// Los edificios que hace el jugador en el taller.
//
// Un diseño es un objeto de datos: su ficha (nombre, coste, resistencia, qué
// hace) y la lista de piezas de su modelo 3D. Aquí se guardan, se validan y se
// **dan de alta como edificios de verdad**: al registrarse entran en la misma
// tabla `BUILDINGS` que la casa o el castillo, así que el juego los construye,
// los dibuja, los ataca y los cuenta sin saber que los hizo alguien.
//
// Todo lo que entra pasa por el validador, venga del almacenamiento del
// navegador o del otro jugador por la red: un diseño corrupto o malicioso se
// queda en un edificio soso, nunca en una partida rota.

import { BUILDINGS, BUILD_ORDER, UNITS, RESOURCES, AGES } from '../config.js';
import { LOOK } from './appearance.js';
import { PARTS, FIELDS, MATERIAL_KEYS, DEFAULT_PALETTE } from '../gfx3d/parts.js';
import { BUILTIN_DESIGNS } from './builtin-designs.js';

const STORAGE_KEY = 'aor-designs-v1';

/*
 * Los edificios de serie, tal y como están antes de que se dé de alta ningún
 * diseño: son los que un diseño puede re-vestir. Se toma la lista aquí, en la
 * carga del módulo, justo por eso: después se le añaden los del taller y ya no
 * serviría.
 */
export const STOCK_BUILDINGS = Object.keys(BUILDINGS);

/** Topes: un diseño desmedido no puede reventar ni la memoria ni la red. */
export const MAX_DESIGNS = 24;
export const MAX_PARTS = 200;
const MAX_NAME = 28;
const MAX_DESC = 120;

/** Qué hace el edificio en la partida, además de ocupar sitio. */
export const ROLES = {
  decor: {
    label: 'Sin función', short: 'Decorativo',
    hint: 'Sólo adorna la aldea y estorba al enemigo. Se puede reparar y derribar como cualquier otro.',
  },
  house: {
    label: 'Da población', short: 'Población',
    hint: 'Sube el límite de población, como una casa.',
  },
  store: {
    label: 'Almacén', short: 'Almacén',
    hint: 'Los aldeanos descargan aquí los recursos que elijas, sin volver al centro urbano.',
  },
  defense: {
    label: 'Defensa', short: 'Defensa',
    hint: 'Dispara flechas a los enemigos que se acerquen, como una torre.',
  },
  train: {
    label: 'Entrena unidades', short: 'Militar',
    hint: 'Fabrica las unidades que elijas y tiene punto de reunión, como un cuartel.',
  },
};

/** Campos de la ficha, con sus topes. El estudio monta sus controles con esto. */
export const STAT_FIELDS = [
  { key: 'time', label: 'Tiempo de construcción', min: 1, max: 600, step: 1, unit: 's' },
  { key: 'hp', label: 'Puntos de vida', min: 1, max: 20000, step: 10 },
  { key: 'armor', label: 'Armadura', min: 0, max: 100, step: 1 },
  { key: 'pArmor', label: 'Armadura antiproyectiles', min: 0, max: 100, step: 1 },
  { key: 'los', label: 'Visión', min: 1, max: 30, step: 0.5, unit: 'casillas' },
];

export const ROLE_FIELDS = {
  house: [{ key: 'pop', label: 'Población que da', min: 1, max: 200, step: 1 }],
  defense: [
    { key: 'attack', label: 'Ataque', min: 1, max: 500, step: 1 },
    { key: 'range', label: 'Alcance', min: 1, max: 25, step: 0.5, unit: 'casillas' },
    { key: 'rof', label: 'Cadencia', min: 0.2, max: 20, step: 0.1, unit: 's' },
    { key: 'arrows', label: 'Flechas por descarga', min: 1, max: 20, step: 1 },
  ],
};

// --- Estado ------------------------------------------------------------------

/*
 * Dos listas: los que vienen con el juego (builtin-designs.js, iguales en todos
 * los dispositivos) y los que ha hecho quien juega (guardados en su navegador).
 * Las dos se dan de alta igual; lo único que las distingue es que las primeras
 * no se pueden tocar desde el taller, porque no son de un navegador.
 */
let builtin = [];
let designs = [];
const registered = new Set();
let version = 0;

/**
 * Cambia cada vez que la lista de edificios personalizados se toca. El
 * protocolo de red la mira para rehacer su tabla de tipos: los índices que
 * viajan por el cable tienen que significar lo mismo en los dos lados.
 */
export function designsVersion() { return version; }

/** Todos los edificios del taller: primero los del juego, luego los del jugador. */
export function allDesigns() { return [...builtin, ...designs]; }

/** Sólo los que ha hecho quien juega, que son los que se pueden tocar. */
export function myDesigns() { return designs; }

export function getDesign(id) { return allDesigns().find((d) => d.id === id) || null; }

/** ¿Viene con el juego? Entonces es de todos y no se edita desde el taller. */
export const isBuiltin = (id) => typeof id === 'string' && id.startsWith('b_');

/*
 * Los identificadores llevan prefijo para no chocar nunca con los edificios de
 * serie: `b_` los que trae el juego y `c_` los que hace cada quien. Como el
 * alta va en orden de identificador, además salen siempre en el mismo orden en
 * cualquier dispositivo, que es lo que necesita el protocolo de red.
 */
const isDesignId = (id) => typeof id === 'string' && /^[bc]_[a-z0-9]{4,12}$/.test(id);

function newId() {
  let id;
  do {
    id = `c_${Math.random().toString(36).slice(2, 9)}`;
  } while (!isDesignId(id) || getDesign(id) || BUILDINGS[id]);
  return id;
}

// --- Validación --------------------------------------------------------------

const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

const clean = (v, max) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);

function num(v, min, max, fallback, step) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const c = Math.min(max, Math.max(min, n));
  if (!step) return c;
  // Se redondea al escalón del campo para que no entren valores con veinte
  // decimales que luego no se pueden reproducir desde la interfaz. Y luego a
  // cuatro decimales, porque multiplicar por el escalón vuelve a dejar cola
  // binaria (0,05 × 48 = 2,4000000000000004) y esa cola acaba en lo guardado,
  // en lo que viaja por la red y en el texto que se comparte.
  return Math.round(Math.round(c / step) * step * 1e4) / 1e4;
}

/** Una pieza válida: tipo conocido, sólo sus campos y todos dentro de rango. */
function cleanPart(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const spec = PARTS[raw.k];
  if (!spec) return null;
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

/** Un diseño válido, con todos sus campos en su sitio. */
export function cleanDesign(raw, keepId = true) {
  if (!raw || typeof raw !== 'object') return null;
  const role = ROLES[raw.role] ? raw.role : 'decor';
  const d = {
    id: keepId && isDesignId(raw.id) ? raw.id : newId(),
    name: clean(raw.name, MAX_NAME) || 'Edificio sin nombre',
    desc: clean(raw.desc, MAX_DESC) || 'Edificio hecho en el taller.',
    size: num(raw.size, 1, 4, 2, 1),
    age: num(raw.age, 0, AGES.length - 1, 0, 1),
    role,
    cost: {},
    time: num(raw.time, 1, 600, 20, 1),
    hp: num(raw.hp, 1, 20000, 400, 1),
    armor: num(raw.armor, 0, 100, 0, 1),
    pArmor: num(raw.pArmor, 0, 100, 3, 1),
    los: num(raw.los, 1, 30, 4, 0.5),
    palette: {},
    parts: [],
  };
  // Un diseño puede ser un edificio nuevo o el aspecto de uno que ya existe.
  // En el segundo caso su ficha no pinta nada: los valores los pone el
  // edificio original, y de aquí sale sólo el modelo.
  if (STOCK_BUILDINGS.includes(raw.replaces)) d.replaces = raw.replaces;

  for (const r of RESOURCES) d.cost[r] = num(raw.cost?.[r], 0, 5000, 0, 1);
  if (!RESOURCES.some((r) => d.cost[r] > 0)) d.cost.wood = 50;

  if (role === 'house') d.pop = num(raw.pop, 1, 200, 5, 1);
  if (role === 'store') {
    const list = Array.isArray(raw.dropoff) ? raw.dropoff.filter((r) => RESOURCES.includes(r)) : [];
    d.dropoff = [...new Set(list)];
    if (!d.dropoff.length) d.dropoff = ['food'];
  }
  if (role === 'defense') {
    d.attack = num(raw.attack, 1, 500, 6, 1);
    d.range = num(raw.range, 1, 25, 7, 0.5);
    d.rof = num(raw.rof, 0.2, 20, 2, 0.1);
    d.arrows = num(raw.arrows, 1, 20, 1, 1);
  }
  if (role === 'train') {
    const list = Array.isArray(raw.trains) ? raw.trains.filter((t) => UNITS[t]) : [];
    d.trains = [...new Set(list)];
    if (!d.trains.length) d.trains = ['militia'];
  }

  for (const [key, def] of Object.entries(DEFAULT_PALETTE)) {
    d.palette[key] = isHexColor(raw.palette?.[key]) ? raw.palette[key].toLowerCase() : def;
  }

  const parts = Array.isArray(raw.parts) ? raw.parts.slice(0, MAX_PARTS) : [];
  for (const p of parts) {
    const c = cleanPart(p);
    if (c) d.parts.push(c);
  }
  return d;
}

// --- Alta en el juego --------------------------------------------------------

/** La ficha de `BUILDINGS` que le corresponde a un diseño. */
function definitionOf(d) {
  const cost = {};
  for (const r of RESOURCES) if (d.cost[r] > 0) cost[r] = d.cost[r];
  const def = {
    name: d.name, desc: d.desc, cost, time: d.time, hp: d.hp, size: d.size,
    los: d.los, age: d.age, armor: d.armor, pArmor: d.pArmor, custom: true,
  };
  if (d.role === 'house') def.pop = d.pop;
  if (d.role === 'store') def.dropoff = [...d.dropoff];
  if (d.role === 'defense') {
    def.attack = d.attack; def.range = d.range; def.rof = d.rof;
    def.arrows = d.arrows; def.pierce = true;
  }
  if (d.role === 'train') def.trains = [...d.trains];
  return def;
}

/** Sólo los materiales que el diseño usa de verdad: el catálogo no pregunta de más. */
function usedMaterials(d) {
  const used = new Set();
  for (const p of d.parts) if (p.m && DEFAULT_PALETTE[p.m] !== undefined) used.add(p.m);
  // La madera sale en los marcos de puertas y ventanas y en el andamio de la
  // obra, aunque ninguna pieza la pida por su nombre.
  used.add('wood');
  used.add('stone');
  return used;
}

/** El modelo con el que se dibuja cada edificio de serie re-vestido. */
const models = new Map();

/** Los colores originales de los que se han re-vestido, para poder devolverlos. */
const stockLooks = new Map();

/** El diseño con el que se dibuja un edificio, sea propio o re-vestido. */
export function modelForBuilding(type) {
  return models.get(type) || getDesign(type) || null;
}

/**
 * Vuelve a dar de alta todos los diseños. Se hace de una vez y en orden de
 * identificador para que la tabla de edificios salga igual en cualquier
 * dispositivo: en multijugador los tipos viajan como un número de índice.
 */
function applyRegistry() {
  for (const id of registered) {
    delete BUILDINGS[id];
    delete LOOK.building[id];
    const i = BUILD_ORDER.indexOf(id);
    if (i >= 0) BUILD_ORDER.splice(i, 1);
  }
  registered.clear();
  // Los edificios re-vestidos recuperan sus colores de fábrica antes de volver
  // a repartir: si se quita el diseño que vestía a la casa, la casa vuelve a
  // ser la de siempre.
  for (const [type, look] of stockLooks) LOOK.building[type] = look;
  models.clear();

  for (const d of allDesigns().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const palette = {};
    for (const m of usedMaterials(d)) palette[m] = d.palette[m];
    if (d.replaces) {
      // No es un edificio nuevo: es el aspecto de uno que ya existe.
      if (!stockLooks.has(d.replaces)) stockLooks.set(d.replaces, LOOK.building[d.replaces]);
      models.set(d.replaces, d);
      LOOK.building[d.replaces] = palette;
      continue;
    }
    BUILDINGS[d.id] = definitionOf(d);
    LOOK.building[d.id] = palette;
    BUILD_ORDER.push(d.id);
    registered.add(d.id);
  }
  version++;
}

/*
 * Campos de una pieza que son medidas y hay que escalar al cambiar la huella;
 * los demás (giros, número de lados, peldaños) no se tocan.
 */
const SCALED_FIELDS = ['x', 'y', 'z', 'w', 'd', 'h', 'r', 'r0', 'r1', 'rise', 'over', 'len', 'th'];

/**
 * Lleva un diseño a otra huella, estirando o encogiendo el modelo entero. Es lo
 * que pasa al ponerle a un diseño el aspecto de un edificio que ya existe: la
 * huella la manda el edificio, no el diseño, así que el modelo se ajusta a ella
 * y lo que se ve en el taller es lo que se verá en la partida.
 */
export function resizeDesign(design, size) {
  const from = design.size || 2;
  const to = Math.min(4, Math.max(1, Math.round(size)));
  if (to === from) return design;
  const k = to / from;
  const scaled = { ...design, size: to, parts: design.parts.map((p) => ({ ...p })) };
  for (const p of scaled.parts) {
    for (const key of SCALED_FIELDS) {
      if (p[key] === undefined) continue;
      const f = FIELDS[key];
      p[key] = num(p[key] * k, f.min, f.max, p[key], f.step);
    }
  }
  return scaled;
}

// --- Guardar y cargar --------------------------------------------------------

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(designs));
  } catch { /* sin espacio o modo privado: se sigue jugando con lo que hay */ }
}

/** Carga los del juego y los guardados, y los da de alta. Se llama al arrancar. */
export function loadDesigns() {
  builtin = [];
  for (const item of Array.isArray(BUILTIN_DESIGNS) ? BUILTIN_DESIGNS : []) {
    const d = cleanDesign(item);
    // Los del juego pasan por el mismo validador que todo lo demás: un fallo al
    // pegar uno no puede tumbar el arranque de nadie.
    if (d && isBuiltin(d.id) && !getDesign(d.id)) builtin.push(d);
  }
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { raw = null; }
  designs = [];
  if (Array.isArray(raw)) {
    for (const item of raw.slice(0, MAX_DESIGNS)) {
      const d = cleanDesign(item);
      if (d && !isBuiltin(d.id) && !getDesign(d.id)) designs.push(d);
    }
  }
  applyRegistry();
  return allDesigns();
}

/** Guarda un diseño (nuevo o editado) y lo deja listo para construir. */
export function saveDesign(raw) {
  const d = cleanDesign(raw);
  if (!d || isBuiltin(d.id)) return null;
  const i = designs.findIndex((x) => x.id === d.id);
  if (i >= 0) designs[i] = d;
  else {
    if (designs.length >= MAX_DESIGNS) return null;
    designs.push(d);
  }
  applyRegistry();
  save();
  return d;
}

export function deleteDesign(id) {
  if (isBuiltin(id)) return false;
  const i = designs.findIndex((d) => d.id === id);
  if (i < 0) return false;
  designs.splice(i, 1);
  applyRegistry();
  save();
  return true;
}

/** Copia de un diseño con identificador nuevo: duplicar para probar variantes. */
export function duplicateDesign(id) {
  const d = getDesign(id);
  if (!d || designs.length >= MAX_DESIGNS) return null;
  return saveDesign({ ...structuredClone(d), id: null, name: `${d.name} (copia)`.slice(0, MAX_NAME) });
}

export function canAddDesign() { return designs.length < MAX_DESIGNS; }

// --- Multijugador ------------------------------------------------------------

/** Los diseños tal cual, para mandárselos a los demás jugadores. */
export function exportDesigns() {
  return JSON.parse(JSON.stringify(designs));
}

/*
 * Los edificios propios viajan al invitado por el canal de datos, en un solo
 * mensaje junto a la señal de empezar. Un canal WebRTC no es sitio para medio
 * megabyte, así que se manda lo que quepa en este presupuesto y el resto se
 * queda en casa: la partida arranca igual, sencillamente con menos edificios
 * raros. Con diseños de tamaño normal caben todos de sobra.
 */
const SHARE_BUDGET = 48000;

/**
 * Los diseños que caben en un mensaje de red, en orden de identificador. Van
 * también los que trae el juego: si el anfitrión tiene una versión con
 * edificios que el invitado no conoce, la tabla de tipos tiene que salir igual
 * en los dos lados o las instantáneas se leerían mal.
 */
export function shareableDesigns() {
  const out = [];
  let size = 0;
  for (const d of allDesigns().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const bytes = JSON.stringify(d).length;
    if (size + bytes > SHARE_BUDGET) break;
    size += bytes;
    out.push(JSON.parse(JSON.stringify(d)));
  }
  return out;
}

/**
 * Adopta los edificios del anfitrión durante una partida en red. Los propios se
 * quedan guardados en el navegador y vuelven al recargar la página: lo que se
 * cambia aquí es sólo qué hay dado de alta mientras dure la partida, porque los
 * dos lados tienen que tener exactamente la misma tabla de edificios.
 */
export function adoptDesigns(incoming) {
  builtin = [];
  designs = [];
  if (Array.isArray(incoming)) {
    for (const item of incoming.slice(0, MAX_DESIGNS * 2)) {
      const d = cleanDesign(item);
      if (!d || getDesign(d.id)) continue;
      if (isBuiltin(d.id)) builtin.push(d);
      else designs.push(d);
    }
  }
  applyRegistry();
  return allDesigns();
}

// --- Plantillas --------------------------------------------------------------

/*
 * Con qué empieza un edificio nuevo. Un lienzo en blanco delante de dieciséis
 * piezas asusta; media docena de puntos de partida enseñan cómo se monta uno y
 * se retocan enseguida.
 */
export const TEMPLATES = [
  {
    key: 'empty', label: 'En blanco',
    hint: 'Una huella vacía sobre la que empezar de cero.',
    make: () => ({ name: 'Edificio nuevo', size: 2, parts: [] }),
  },
  {
    key: 'hut', label: 'Cabaña',
    hint: 'Zócalo, muros, tejado a dos aguas, puerta, ventana y chimenea.',
    make: () => ({
      name: 'Cabaña', size: 2, role: 'house', pop: 5,
      cost: { wood: 30 }, time: 14, hp: 350, los: 4,
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
      name: 'Torreón', size: 2, role: 'defense',
      attack: 6, range: 7, rof: 2, arrows: 1,
      cost: { wood: 25, stone: 125 }, time: 25, hp: 850, los: 8, armor: 3, pArmor: 6,
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
      name: 'Cobertizo', size: 2, role: 'store', dropoff: ['wood'],
      cost: { wood: 80 }, time: 18, hp: 450, los: 5,
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
    hint: 'Planta de tres casillas con entramado, porche y tejado a cuatro aguas.',
    make: () => ({
      name: 'Casa grande', size: 3, role: 'house', pop: 10,
      cost: { wood: 120 }, time: 28, hp: 700, los: 5,
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

/** Un diseño nuevo a partir de una plantilla, ya validado y con identificador. */
export function designFromTemplate(key) {
  const t = TEMPLATES.find((x) => x.key === key) || TEMPLATES[0];
  return cleanDesign({ ...t.make(), id: null }, false);
}
