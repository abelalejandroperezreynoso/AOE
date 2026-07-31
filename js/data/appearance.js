// Aspecto de cada objeto del juego: los colores y el tamaño con los que se
// dibuja.
//
// sprites.js no lleva colores escritos a mano: los lee de aquí, así el
// catálogo puede cambiarlos en caliente. Cada valor es un color (#rrggbb) o un
// número, de forma que se guardan y se validan igual que el resto de datos
// editables.

import { shade } from '../utils.js';

// --- Tonos originales -------------------------------------------------------

/**
 * Muchas superficies se pintan en tres tonos (cara iluminada, cara base y cara
 * en sombra) y los originales están elegidos a mano, no calculados. Esta tabla
 * los conserva: mientras el color no se toque se usan tal cual, y en cuanto el
 * jugador elige otro se derivan los dos tonos que faltan.
 */
const RAMPS = {
  // Materiales de los edificios
  '#d8cba6': ['#eee2c1', '#b6a887'], // yeso
  '#8a6234': ['#a37b45', '#66492a'], // madera
  '#9a9a94': ['#bcbcb4', '#70706c'], // piedra
  '#ab9668': ['#cdb887', '#8e7a4f'], // basamento del centro urbano
  '#948763': ['#b3a37e', '#7d7052'], // empedrado del mercado
  '#5c5c58': ['#6d6d68', '#4c4c48'], // chimenea de la herrería
  '#8a6a3c': ['#a5854f', '#6d5330'], // tierra de labor
  '#a8c24a': ['#c0d868', '#7a9a34'], // surcos del cultivo
  '#8f8a80': ['#a9a49a', '#6f6a62'], // zócalo de piedra
  // Tejados
  '#b09a62': ['#c9b47c', '#8d7a4a'], // bálago (molino)
  '#94856a': ['#ada07f', '#6f6350'], // ripia de madera (casa)
  '#525d6b': ['#68737f', '#3c454f'], // yeso azulado de la casa
  '#c6c0ad': ['#ddd8c8', '#a49e8c'], // yeso claro del ala
  '#a08a55': ['#bda66d', '#7f6d40'], // bálago viejo de los cobertizos
  '#a8452f': ['#c2543a', '#8a3423'], // teja roja
  '#96442f': ['#a85a3d', '#7d3a2a'], // centro urbano
  '#7a3a2c': ['#8f4a37', '#5f2c21'], // cuartel
  '#4a6b3a': ['#5c8047', '#39522c'], // galería de tiro
  '#6d5a3c': ['#7d6947', '#5a4a31'], // establo
  '#4f5560': ['#616875', '#3d424b'], // taller de asedio
  '#5a4a31': ['#7d6947', '#6d5a3c'], // cobertizos de los campamentos
  '#43392e': ['#635546', '#54483a'], // herrería
  // Unidades y máquinas
  '#3e3a33': ['#4a453c', '#2c2926'], // calzas
  '#8c6b3a': ['#a58452', '#3a2c1c'], // guarda y empuñadura de la espada
  '#6b4f2c': ['#7d5c33', '#3f2f1c'], // armazón de las máquinas de asedio
  '#4a3720': ['#5c4629', '#2c2013'], // ruedas
  // Recursos
  '#5a4028': ['#8a6a45', '#41301e'], // corteza
  '#2f6b2c': ['#357a30', '#28602a'], // copa del árbol
};

/** Devuelve [claro, base, oscuro] para un color. */
export function ramp(color) {
  if (typeof color !== 'string') color = '#888888';
  const r = RAMPS[color];
  return r ? [r[0], color, r[1]] : [shade(color, 0.14), color, shade(color, -0.16)];
}

// --- Valores por defecto ----------------------------------------------------

const SKIN = '#d9a878', LEGS = '#3e3a33', HELM = '#a7a9b0';
const STONE = '#8f8a80';   // zócalo de piedra al pie de los muros
const CLOTH = '#b9a279';   // lino del jubón que asoma bajo la armadura
const LEATHER = '#7a5432'; // correas, cinturón y botas
const PLUME = '#e0dcd2';   // crin del penacho

const soldier = (extra) => ({
  skin: SKIN, legs: LEGS, helmet: HELM, cloth: CLOTH, leather: LEATHER, ...extra, scale: 1,
});

/**
 * Aspecto de cada tipo. Los campos que un objeto no tiene sencillamente no
 * aparecen, y el catálogo sólo ofrece los que existen: no tiene sentido
 * preguntar por la montura de un lancero.
 */
export const LOOK = {
  unit: {
    villager: {
      skin: SKIN, legs: LEGS, cloth: CLOTH, leather: LEATHER,
      metal: '#b9bcc4', wood: '#6b4d2c', scale: 1,
    },
    militia: soldier({ metal: '#c9ccd4', wood: '#8c6b3a' }),
    manatarms: soldier({ metal: '#c9ccd4', wood: '#8c6b3a' }),
    longswordsman: soldier({ metal: '#c9ccd4', wood: '#8c6b3a', plume: PLUME }),
    champion: soldier({ metal: '#c9ccd4', wood: '#8c6b3a', plume: PLUME }),
    spearman: soldier({ metal: '#d2d6de', wood: '#7a5c33' }),
    pikeman: soldier({ metal: '#d2d6de', wood: '#7a5c33' }),
    archer: soldier({ metal: '#d2d6de', wood: '#7a4f28' }),
    crossbowman: soldier({ metal: '#8d8f96', wood: '#5e4526' }),
    arbalester: soldier({ metal: '#8d8f96', wood: '#5e4526' }),
    skirmisher: soldier({ metal: '#d2d6de', wood: '#7a5c33' }),
    scout: soldier({ horse: '#8a6a4a', metal: '#c9ccd4', wood: '#8c6b3a' }),
    knight: soldier({ horse: '#4a3f38', metal: '#c9ccd4', wood: '#8c6b3a' }),
    cavalier: soldier({ horse: '#4a3f38', metal: '#c9ccd4', wood: '#8c6b3a', plume: PLUME }),
    ram: { wood: '#6b4f2c', metal: '#8d8f96', wheel: '#4a3720', scale: 1 },
    mangonel: { wood: '#6b4f2c', wheel: '#4a3720', scale: 1 },
    trebuchet: { wood: '#6b4f2c', wheel: '#4a3720', scale: 1 },
  },

  building: {
    towncenter: {
      wall: '#d8cba6', base: '#ab9668', roof: '#96442f', thatch: '#bd9d52',
      wood: '#8a6234', stone: STONE, door: '#3b2a17', ivy: '#3f6b32',
    },
    house: {
      wall: '#525d6b', wall2: '#c6c0ad', roof: '#94856a', wood: '#332a22',
      stone: '#9b968c', chimney: '#5c5c58', door: '#9a6a33', glow: '#ffc356',
      ivy: '#4a8a3a',
    },
    mill: { wall: '#d8cba6', roof: '#b09a62', wood: '#6b4f2c', stone: STONE, accent: '#ebe4c8' },
    lumbercamp: { wall: '#8a6234', roof: '#a08a55', accent: '#8f6a3c' },
    miningcamp: { wall: '#8a6234', roof: '#a08a55', accent: '#8c8f95' },
    farm: { soil: '#8a6a3c', crop: '#a8c24a', fence: '#5b4426' },
    barracks: { wall: '#d8cba6', roof: '#7a3a2c', wood: '#8a6234', stone: STONE, door: '#4d3620', accent: '#d8d8d0' },
    archeryrange: { wall: '#d8cba6', roof: '#4a6b3a', wood: '#8a6234', stone: STONE, door: '#4d3620', accent: '#d8d8d0' },
    stable: { wall: '#d8cba6', roof: '#6d5a3c', wood: '#8a6234', stone: STONE, door: '#4d3620', accent: '#d8d8d0' },
    siegeworkshop: { wall: '#d8cba6', roof: '#4f5560', wood: '#8a6234', stone: STONE, door: '#4d3620', accent: '#d8d8d0' },
    blacksmith: { wall: '#9a9a94', roof: '#43392e', wood: '#7a5c33', stone: STONE, chimney: '#5c5c58', accent: '#ff9a3c' },
    market: {
      ground: '#948763', wood: '#6b4f2c', counter: '#8a6a3c',
      stall1: '#c9553f', stall2: '#3f7fa8', stall3: '#c9a13f', stall4: '#6b8f4a',
    },
    tower: { wall: '#9a9a94', door: '#3b2a17' },
    castle: { wall: '#9a9a94', door: '#3b2a17' },
    wall: { wall: '#9a9a94' },
  },

  node: {
    tree: { trunk: '#5a4028', foliage: '#2f6b2c', scale: 1 },
    gold: { rock: '#8d7a4e', accent: '#ffd24a', scale: 1 },
    stone: { rock: '#8c8f95', accent: '#d6dae0', scale: 1 },
    berries: { bush: '#2e6b35', berry: '#c8324a', scale: 1 },
    sheep: { body: '#efe9dc', head: '#3b3a38', legs: '#6b6257', scale: 1 },
    deer: { body: '#a9723f', head: '#8f5f34', legs: '#6b6257', antlers: '#5e4326', scale: 1 },
  },
};

// Recambio para un tipo que no esté en la tabla (por ejemplo uno añadido más
// adelante): mejor dibujarlo con un aspecto genérico que no dibujarlo.
const FALLBACK = {
  unit: LOOK.unit.villager,
  building: { wall: '#d8cba6', roof: '#a8452f' },
  node: { rock: '#8c8f95', accent: '#d6dae0', scale: 1 },
};

/** Aspecto de un objeto. */
export function look(kind, type) {
  const bucket = LOOK[kind];
  return (bucket && bucket[type]) || FALLBACK[kind];
}

// --- Qué se puede editar ----------------------------------------------------

const color = (key, label) => ({ key, label, type: 'color', group: 'Aspecto' });
const scale = {
  key: 'scale', label: 'Tamaño', type: 'number', min: 0.6, max: 1.6, step: 0.05, group: 'Aspecto',
};

export const LOOK_FIELDS = {
  unit: [
    color('skin', 'Piel'), color('legs', 'Calzas'), color('helmet', 'Yelmo'),
    color('metal', 'Metal'), color('wood', 'Madera'), color('cloth', 'Jubón'),
    color('leather', 'Cuero'), color('plume', 'Penacho'), color('horse', 'Montura'),
    color('wheel', 'Ruedas'), scale,
  ],
  building: [
    color('wall', 'Muros'), color('wall2', 'Muros del ala'), color('base', 'Basamento'),
    color('stone', 'Zócalo'),
    color('roof', 'Tejado'), color('thatch', 'Bálago'), color('wood', 'Madera'), color('door', 'Puerta'),
    color('chimney', 'Chimenea'), color('glow', 'Ventanas'), color('ivy', 'Hiedra'),
    color('soil', 'Tierra'), color('crop', 'Cultivo'), color('fence', 'Cerca'),
    color('ground', 'Empedrado'), color('counter', 'Mostradores'), color('accent', 'Detalle'),
    color('stall1', 'Puesto 1'), color('stall2', 'Puesto 2'),
    color('stall3', 'Puesto 3'), color('stall4', 'Puesto 4'),
  ],
  node: [
    color('trunk', 'Tronco'), color('foliage', 'Hojas'), color('rock', 'Roca'),
    color('accent', 'Vetas'), color('bush', 'Mata'), color('berry', 'Bayas'),
    color('body', 'Cuerpo'), color('head', 'Cabeza'), color('legs', 'Patas'),
    color('antlers', 'Cuerna'), scale,
  ],
};
