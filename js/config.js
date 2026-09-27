// Datos de la partida: unidades, edificios y tecnologías. Hay una sola edad,
// la Oscura: no se avanza y todo está disponible desde el principio.
// Todos los valores están equilibrados para partidas cortas (15-30 min).

export const TILE_W = 64;
export const TILE_H = 32;

export const RESOURCES = ['food', 'wood', 'gold', 'stone'];
export const RES_NAME = { food: 'Comida', wood: 'Madera', gold: 'Oro', stone: 'Piedra' };

export const POP_MAX = 200;

// Un color por jugador: hay ocho porque ese es el máximo que admite una
// partida, tanto contra la máquina como en red.
export const PLAYER_COLORS = [
  { name: 'Azul', main: '#3f7fd8', dark: '#22488a', light: '#8fc0ff' },
  { name: 'Rojo', main: '#d2453c', dark: '#7d221d', light: '#ff9a92' },
  { name: 'Verde', main: '#43a047', dark: '#215a24', light: '#9be79e' },
  { name: 'Amarillo', main: '#d9b330', dark: '#846a12', light: '#ffe58a' },
  { name: 'Morado', main: '#9455cf', dark: '#552c7d', light: '#d3a9f5' },
  { name: 'Naranja', main: '#e07a2a', dark: '#8a4310', light: '#ffc182' },
  { name: 'Turquesa', main: '#2aa79b', dark: '#12615a', light: '#8ee7dd' },
  { name: 'Gris', main: '#8b939e', dark: '#4c525a', light: '#d6dbe2' },
];

/** Jugadores que caben en una partida, uno por color. */
export const MAX_PLAYERS = PLAYER_COLORS.length;

// Tasas de recolección en unidades por segundo.
export const GATHER_RATE = { berries: 0.82, farm: 0.78, wood: 0.8, gold: 0.8, stone: 0.72, sheep: 1.0, deer: 0.9 };
export const CARRY_CAPACITY = 12;

// --- Unidades ---------------------------------------------------------------
// class: 'civilian' | 'infantry' | 'cavalry'
// armorClasses: etiquetas para el daño extra (bonus) de otras unidades.
export const UNITS = {
  villager: {
    name: 'Aldeano', class: 'civilian', cost: { food: 50 }, time: 14, pop: 1,
    hp: 30, attack: 3, armor: 0, pArmor: 0, range: 0.6, rof: 2.0, speed: 1.15, los: 5,
    radius: 0.3, desc: 'Recolecta recursos y construye edificios.',
    armorClasses: [],
  },
  militia: {
    name: 'Milicia', class: 'infantry', cost: { food: 60, gold: 20 }, time: 14, pop: 1,
    hp: 45, attack: 5, armor: 0, pArmor: 1, range: 0.7, rof: 2.0, speed: 1.05, los: 5,
    radius: 0.32, desc: 'Infantería básica, barata y resistente.',
    armorClasses: ['infantry'],
  },
  scout: {
    name: 'Explorador', class: 'cavalry', cost: { food: 80 }, time: 14, pop: 1,
    hp: 45, attack: 5, armor: 0, pArmor: 2, range: 0.8, rof: 2.0, speed: 1.7, los: 8,
    radius: 0.36, desc: 'Rapidísimo; ideal para explorar el mapa.',
    armorClasses: ['cavalry'],
  },
};

// --- Edificios --------------------------------------------------------------
export const BUILDINGS = {
  towncenter: {
    name: 'Centro urbano', cost: { wood: 275, stone: 100 }, time: 50, hp: 1400, size: 3,
    los: 9, pop: 5, dropoff: RESOURCES, trains: ['villager'],
    techs: ['loom'], attack: 5, range: 6, rof: 2.2, arrows: 1,
    desc: 'Crea aldeanos y almacena recursos.',
  },
  house: {
    name: 'Casa', cost: { wood: 25 }, time: 12, hp: 320, size: 2, los: 4, pop: 5,
    desc: 'Aumenta el límite de población en 5.',
  },
  mill: {
    name: 'Molino', cost: { wood: 100 }, time: 20, hp: 480, size: 2, los: 5,
    dropoff: ['food'], desc: 'Almacena comida y permite construir granjas.',
  },
  // La granja se comporta como en el juego original: la trabaja un solo aldeano,
  // que se coloca en el centro de la parcela, las unidades pasan por encima y,
  // al agotarse, su aldeano la replanta solo si hay madera.
  farm: {
    name: 'Granja', cost: { wood: 60 }, time: 12, hp: 160, size: 2, los: 2,
    farm: 320, req: 'mill', passable: true, single: true,
    desc: 'La cultiva un aldeano desde el centro. Al agotarse se replanta sola si hay madera.',
  },
  lumbercamp: {
    name: 'Campamento maderero', cost: { wood: 100 }, time: 20, hp: 480, size: 2, los: 5,
    dropoff: ['wood'], desc: 'Almacena madera cerca del bosque.',
  },
  miningcamp: {
    name: 'Campamento minero', cost: { wood: 100 }, time: 20, hp: 480, size: 2, los: 5,
    dropoff: ['gold', 'stone'], desc: 'Almacena oro y piedra cerca de las minas.',
  },
  barracks: {
    name: 'Cuartel', cost: { wood: 175 }, time: 30, hp: 720, size: 3, los: 6,
    trains: ['militia'],
    desc: 'Entrena la milicia.',
  },
};

// Orden en el que aparecen los botones de construcción.
export const BUILD_ORDER = [
  'house', 'mill', 'farm', 'lumbercamp', 'miningcamp', 'barracks', 'towncenter',
];

// --- Tecnologías ------------------------------------------------------------
// effects: [{ target: 'clase'|'tipo'|'building', stat, add }]
export const TECHS = {
  loom: {
    name: 'Telar', cost: { gold: 50 }, time: 20, building: 'towncenter',
    effects: [{ target: 'villager', stat: 'hp', add: 15 }, { target: 'villager', stat: 'pArmor', add: 1 }],
    desc: '+15 PV y +1 armadura de proyectil para los aldeanos.',
  },
};

// Recursos del mapa.
// `herd` marca los animales que se pueden domesticar: pasan al bando de quien
// tenga unidades cerca (dentro de `tame` casillas) y se pueden mover por el
// mapa como un rebaño, a `speed` casillas por segundo.
export const RESOURCE_NODES = {
  tree: { res: 'wood', amount: 100, rate: 'wood', blocking: true },
  gold: { res: 'gold', amount: 800, rate: 'gold', blocking: true },
  stone: { res: 'stone', amount: 500, rate: 'stone', blocking: true },
  berries: { res: 'food', amount: 200, rate: 'berries', blocking: true },
  sheep: { res: 'food', amount: 110, rate: 'sheep', blocking: false, herd: true, tame: 5, speed: 0.7 },
  deer: { res: 'food', amount: 140, rate: 'deer', blocking: false },
};

export const DIFFICULTIES = {
  easy: { name: 'Fácil', villagerTarget: 18, armyTarget: 8, attackEvery: 200, bonus: 1.0, reaction: 3 },
  normal: { name: 'Moderado', villagerTarget: 26, armyTarget: 14, attackEvery: 150, bonus: 1.15, reaction: 2 },
  hard: { name: 'Difícil', villagerTarget: 34, armyTarget: 22, attackEvery: 110, bonus: 1.35, reaction: 1.2 },
};

export const START_RESOURCES = { food: 250, wood: 250, gold: 150, stone: 200 };
