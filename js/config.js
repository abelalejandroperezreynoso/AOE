// Datos de la partida: edades, unidades, edificios y tecnologías.
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

export const AGES = [
  { name: 'Edad Oscura', short: 'Oscura', cost: {}, time: 0, reqBuildings: 0 },
  { name: 'Edad Feudal', short: 'Feudal', cost: { food: 400 }, time: 35, reqBuildings: 1 },
  { name: 'Edad de los Castillos', short: 'Castillos', cost: { food: 700, gold: 200 }, time: 50, reqBuildings: 2 },
  { name: 'Edad Imperial', short: 'Imperial', cost: { food: 900, gold: 700 }, time: 65, reqBuildings: 2 },
];

// Tasas de recolección en unidades por segundo.
export const GATHER_RATE = { berries: 0.82, farm: 0.78, wood: 0.8, gold: 0.8, stone: 0.72, sheep: 1.0, deer: 0.9 };
export const CARRY_CAPACITY = 12;

// --- Unidades ---------------------------------------------------------------
// class: 'civilian' | 'infantry' | 'archer' | 'cavalry' | 'siege'
// armorClasses: etiquetas para el daño extra (bonus) de otras unidades.
export const UNITS = {
  villager: {
    name: 'Aldeano', class: 'civilian', cost: { food: 50 }, time: 14, pop: 1,
    hp: 30, attack: 3, armor: 0, pArmor: 0, range: 0.6, rof: 2.0, speed: 1.15, los: 5,
    radius: 0.3, age: 0, desc: 'Recolecta recursos y construye edificios.',
    armorClasses: [],
  },
  militia: {
    name: 'Milicia', class: 'infantry', cost: { food: 60, gold: 20 }, time: 14, pop: 1,
    hp: 45, attack: 5, armor: 0, pArmor: 1, range: 0.7, rof: 2.0, speed: 1.05, los: 5,
    radius: 0.32, age: 0, desc: 'Infantería básica, barata y resistente.',
    armorClasses: ['infantry'],
  },
  manatarms: {
    name: 'Hombre de armas', class: 'infantry', cost: { food: 60, gold: 20 }, time: 14, pop: 1,
    hp: 60, attack: 7, armor: 1, pArmor: 1, range: 0.7, rof: 2.0, speed: 1.05, los: 5,
    radius: 0.32, age: 1, desc: 'Milicia mejorada.', armorClasses: ['infantry'],
  },
  longswordsman: {
    name: 'Espadachín', class: 'infantry', cost: { food: 60, gold: 20 }, time: 14, pop: 1,
    hp: 80, attack: 10, armor: 1, pArmor: 1, range: 0.7, rof: 2.0, speed: 1.05, los: 5,
    radius: 0.32, age: 2, desc: 'Infantería pesada.', armorClasses: ['infantry'],
  },
  champion: {
    name: 'Campeón', class: 'infantry', cost: { food: 60, gold: 20 }, time: 14, pop: 1,
    hp: 105, attack: 13, armor: 2, pArmor: 2, range: 0.7, rof: 2.0, speed: 1.05, los: 5,
    radius: 0.32, age: 3, desc: 'La mejor infantería del juego.', armorClasses: ['infantry'],
  },
  spearman: {
    name: 'Lancero', class: 'infantry', cost: { food: 35, wood: 25 }, time: 12, pop: 1,
    hp: 45, attack: 3, armor: 0, pArmor: 0, range: 0.9, rof: 3.0, speed: 1.0, los: 5,
    radius: 0.32, age: 1, desc: 'Barato y letal contra caballería.',
    bonus: { cavalry: 15, siege: 5 }, armorClasses: ['infantry', 'spear'],
  },
  pikeman: {
    name: 'Piquero', class: 'infantry', cost: { food: 35, wood: 25 }, time: 12, pop: 1,
    hp: 55, attack: 4, armor: 0, pArmor: 0, range: 0.9, rof: 3.0, speed: 1.0, los: 5,
    radius: 0.32, age: 2, desc: 'Lancero mejorado, aún mejor contra jinetes.',
    bonus: { cavalry: 22, siege: 8 }, armorClasses: ['infantry', 'spear'],
  },
  archer: {
    name: 'Arquero', class: 'archer', cost: { wood: 25, gold: 45 }, time: 15, pop: 1,
    hp: 30, attack: 4, pierce: true, armor: 0, pArmor: 0, range: 4.5, rof: 2.0, speed: 1.0, los: 6,
    radius: 0.3, age: 1, desc: 'Ataca a distancia; frágil cuerpo a cuerpo.',
    armorClasses: ['archer'],
  },
  crossbowman: {
    name: 'Ballestero', class: 'archer', cost: { wood: 25, gold: 45 }, time: 15, pop: 1,
    hp: 35, attack: 5, pierce: true, armor: 0, pArmor: 0, range: 5, rof: 2.0, speed: 1.0, los: 7,
    radius: 0.3, age: 2, desc: 'Arquero mejorado.', armorClasses: ['archer'],
  },
  arbalester: {
    name: 'Arbaletero', class: 'archer', cost: { wood: 25, gold: 45 }, time: 15, pop: 1,
    hp: 40, attack: 6, pierce: true, armor: 0, pArmor: 0, range: 5.5, rof: 2.0, speed: 1.0, los: 7,
    radius: 0.3, age: 3, desc: 'Arquero de élite.', armorClasses: ['archer'],
  },
  skirmisher: {
    name: 'Guerrillero', class: 'archer', cost: { food: 25, wood: 35 }, time: 13, pop: 1,
    hp: 30, attack: 2, pierce: true, armor: 0, pArmor: 3, range: 4, rof: 3.0, speed: 1.0, los: 6,
    radius: 0.3, age: 1, desc: 'Contrarresta a los arqueros enemigos.',
    bonus: { archer: 4 }, armorClasses: ['archer'],
  },
  scout: {
    name: 'Explorador', class: 'cavalry', cost: { food: 80 }, time: 14, pop: 1,
    hp: 45, attack: 5, armor: 0, pArmor: 2, range: 0.8, rof: 2.0, speed: 1.7, los: 8,
    radius: 0.36, age: 0, desc: 'Rapidísimo; ideal para explorar el mapa.',
    armorClasses: ['cavalry'],
  },
  knight: {
    name: 'Caballero', class: 'cavalry', cost: { food: 60, gold: 75 }, time: 18, pop: 1,
    hp: 100, attack: 10, armor: 2, pArmor: 2, range: 0.8, rof: 1.8, speed: 1.45, los: 6,
    radius: 0.36, age: 2, desc: 'Caballería pesada, columna vertebral del ejército.',
    armorClasses: ['cavalry'],
  },
  cavalier: {
    name: 'Caballero pesado', class: 'cavalry', cost: { food: 60, gold: 75 }, time: 18, pop: 1,
    hp: 120, attack: 12, armor: 2, pArmor: 2, range: 0.8, rof: 1.8, speed: 1.45, los: 6,
    radius: 0.36, age: 3, desc: 'Caballero mejorado.', armorClasses: ['cavalry'],
  },
  ram: {
    name: 'Ariete', class: 'siege', cost: { wood: 160, gold: 75 }, time: 22, pop: 2,
    hp: 175, attack: 3, armor: 3, pArmor: 6, range: 0.9, rof: 3.0, speed: 0.65, los: 4,
    radius: 0.45, age: 2, desc: 'Demoledor de edificios.',
    bonus: { building: 45 }, armorClasses: ['siege'],
  },
  mangonel: {
    name: 'Manganel', class: 'siege', cost: { wood: 160, gold: 135 }, time: 24, pop: 2,
    hp: 50, attack: 26, armor: 0, pArmor: 4, range: 6.5, minRange: 1.5, rof: 5.0, speed: 0.6, los: 8,
    radius: 0.45, age: 2, splash: 1.2, desc: 'Daño en área devastador. Cuidado con el fuego amigo.',
    bonus: { building: 20 }, armorClasses: ['siege'],
  },
  trebuchet: {
    name: 'Trabuquete', class: 'siege', cost: { wood: 200, gold: 200 }, time: 30, pop: 2,
    hp: 150, attack: 40, armor: 1, pArmor: 8, range: 9, minRange: 2, rof: 6.0, speed: 0.5, los: 10,
    radius: 0.5, age: 3, splash: 0.9, desc: 'Artillería de asedio de largo alcance.',
    bonus: { building: 150 }, armorClasses: ['siege'],
  },
};

// --- Edificios --------------------------------------------------------------
export const BUILDINGS = {
  towncenter: {
    name: 'Centro urbano', cost: { wood: 275, stone: 100 }, time: 50, hp: 1400, size: 3,
    los: 9, pop: 5, age: 0, dropoff: RESOURCES, trains: ['villager'],
    techs: ['loom', 'wheelbarrow', 'handcart'], attack: 5, range: 6, rof: 2.2, arrows: 1,
    desc: 'Crea aldeanos, almacena recursos y permite avanzar de edad.',
  },
  house: {
    name: 'Casa', cost: { wood: 25 }, time: 12, hp: 320, size: 2, los: 4, pop: 5, age: 0,
    desc: 'Aumenta el límite de población en 5.',
  },
  mill: {
    name: 'Molino', cost: { wood: 100 }, time: 20, hp: 480, size: 2, los: 5, age: 0,
    dropoff: ['food'], desc: 'Almacena comida y permite construir granjas.',
  },
  farm: {
    name: 'Granja', cost: { wood: 60 }, time: 12, hp: 160, size: 2, los: 2, age: 0,
    farm: 320, req: 'mill', desc: 'Fuente inagotable de comida (se agota y se reconstruye).',
  },
  lumbercamp: {
    name: 'Campamento maderero', cost: { wood: 100 }, time: 20, hp: 480, size: 2, los: 5, age: 0,
    dropoff: ['wood'], desc: 'Almacena madera cerca del bosque.',
  },
  miningcamp: {
    name: 'Campamento minero', cost: { wood: 100 }, time: 20, hp: 480, size: 2, los: 5, age: 0,
    dropoff: ['gold', 'stone'], desc: 'Almacena oro y piedra cerca de las minas.',
  },
  barracks: {
    name: 'Cuartel', cost: { wood: 175 }, time: 30, hp: 720, size: 3, los: 6, age: 0,
    trains: ['militia', 'manatarms', 'longswordsman', 'champion', 'spearman', 'pikeman'],
    desc: 'Entrena infantería.',
  },
  archeryrange: {
    name: 'Galería de tiro', cost: { wood: 175 }, time: 30, hp: 720, size: 3, los: 6, age: 1,
    trains: ['archer', 'crossbowman', 'arbalester', 'skirmisher'],
    desc: 'Entrena unidades a distancia.',
  },
  stable: {
    name: 'Establo', cost: { wood: 175 }, time: 30, hp: 720, size: 3, los: 6, age: 1,
    trains: ['scout', 'knight', 'cavalier'], desc: 'Entrena caballería.',
  },
  blacksmith: {
    name: 'Herrería', cost: { wood: 150 }, time: 30, hp: 720, size: 2, los: 5, age: 1,
    techs: ['forging', 'ironcasting', 'scalemail', 'chainmail', 'fletching', 'bodkin', 'paddedarmor'],
    desc: 'Investiga mejoras de ataque y armadura.',
  },
  market: {
    name: 'Mercado', cost: { wood: 175 }, time: 30, hp: 720, size: 3, los: 6, age: 1,
    market: true, desc: 'Compra y vende recursos.',
  },
  tower: {
    name: 'Torre', cost: { wood: 25, stone: 125 }, time: 25, hp: 850, size: 1, los: 8, age: 1,
    attack: 6, range: 7, rof: 2.0, pierce: true, arrows: 2, armor: 3, pArmor: 6,
    desc: 'Defensa que dispara flechas a los enemigos cercanos.',
  },
  wall: {
    name: 'Muralla', cost: { stone: 5 }, time: 4, hp: 900, size: 1, los: 2, age: 1,
    armor: 8, pArmor: 10, wall: true, desc: 'Bloquea el paso del enemigo.',
  },
  castle: {
    name: 'Castillo', cost: { stone: 650 }, time: 60, hp: 3500, size: 4, los: 11, age: 2, pop: 20,
    attack: 11, range: 8, rof: 1.6, pierce: true, arrows: 5, armor: 8, pArmor: 11,
    trains: ['knight', 'cavalier', 'trebuchet'], techs: ['hoardings'],
    desc: 'Fortaleza casi inexpugnable. +20 de población.',
  },
  siegeworkshop: {
    name: 'Taller de asedio', cost: { wood: 200 }, time: 35, hp: 720, size: 3, los: 6, age: 2,
    trains: ['ram', 'mangonel'], desc: 'Construye maquinaria de asedio.',
  },
};

// Orden en el que aparecen los botones de construcción.
export const BUILD_ORDER = [
  'house', 'mill', 'farm', 'lumbercamp', 'miningcamp', 'barracks',
  'archeryrange', 'stable', 'blacksmith', 'market', 'tower', 'wall',
  'towncenter', 'castle', 'siegeworkshop',
];

// --- Tecnologías ------------------------------------------------------------
// effects: [{ target: 'clase'|'tipo'|'building', stat, add }]
// transform: convierte todas las unidades de un tipo en otro.
export const TECHS = {
  loom: {
    name: 'Telar', cost: { gold: 50 }, time: 20, age: 0, building: 'towncenter',
    effects: [{ target: 'villager', stat: 'hp', add: 15 }, { target: 'villager', stat: 'pArmor', add: 1 }],
    desc: '+15 PV y +1 armadura de proyectil para los aldeanos.',
  },
  wheelbarrow: {
    name: 'Carretilla', cost: { food: 175, wood: 50 }, time: 25, age: 1, building: 'towncenter',
    effects: [{ target: 'villager', stat: 'speed', add: 0.12 }, { target: 'villager', stat: 'carry', add: 3 }],
    desc: 'Aldeanos +10% de velocidad y +3 de capacidad de carga.',
  },
  handcart: {
    name: 'Carretilla de mano', cost: { food: 300, wood: 200 }, time: 30, age: 2, building: 'towncenter',
    requires: 'wheelbarrow',
    effects: [{ target: 'villager', stat: 'speed', add: 0.12 }, { target: 'villager', stat: 'carry', add: 5 }],
    desc: 'Aldeanos aún más rápidos y con +5 de capacidad.',
  },
  forging: {
    name: 'Forja', cost: { food: 150 }, time: 25, age: 1, building: 'blacksmith',
    effects: [{ target: 'infantry', stat: 'attack', add: 1 }, { target: 'cavalry', stat: 'attack', add: 1 }],
    desc: '+1 de ataque para infantería y caballería.',
  },
  ironcasting: {
    name: 'Fundición de hierro', cost: { food: 220, gold: 120 }, time: 30, age: 2, building: 'blacksmith',
    requires: 'forging',
    effects: [{ target: 'infantry', stat: 'attack', add: 1 }, { target: 'cavalry', stat: 'attack', add: 1 }],
    desc: '+1 de ataque adicional para infantería y caballería.',
  },
  scalemail: {
    name: 'Armadura de escamas', cost: { food: 100 }, time: 25, age: 1, building: 'blacksmith',
    effects: [{ target: 'infantry', stat: 'armor', add: 1 }, { target: 'cavalry', stat: 'armor', add: 1 }],
    desc: '+1 de armadura para infantería y caballería.',
  },
  chainmail: {
    name: 'Cota de malla', cost: { food: 200, gold: 100 }, time: 30, age: 2, building: 'blacksmith',
    requires: 'scalemail',
    effects: [
      { target: 'infantry', stat: 'armor', add: 1 }, { target: 'cavalry', stat: 'armor', add: 1 },
      { target: 'infantry', stat: 'pArmor', add: 1 }, { target: 'cavalry', stat: 'pArmor', add: 1 },
    ],
    desc: '+1 de armadura y +1 contra proyectiles.',
  },
  fletching: {
    name: 'Emplumado', cost: { food: 100, gold: 50 }, time: 25, age: 1, building: 'blacksmith',
    effects: [{ target: 'archer', stat: 'attack', add: 1 }, { target: 'archer', stat: 'range', add: 0.5 }],
    desc: 'Arqueros y torres: +1 de ataque y +0,5 de alcance.',
  },
  bodkin: {
    name: 'Punta de bodkin', cost: { food: 200, gold: 100 }, time: 30, age: 2, building: 'blacksmith',
    requires: 'fletching',
    effects: [{ target: 'archer', stat: 'attack', add: 1 }, { target: 'archer', stat: 'range', add: 0.5 }],
    desc: 'Arqueros y torres: +1 de ataque y +0,5 de alcance adicionales.',
  },
  paddedarmor: {
    name: 'Armadura acolchada', cost: { food: 100 }, time: 25, age: 1, building: 'blacksmith',
    effects: [{ target: 'archer', stat: 'pArmor', add: 1 }, { target: 'archer', stat: 'armor', add: 1 }],
    desc: '+1 de armadura para unidades a distancia.',
  },
  hoardings: {
    name: 'Almenas', cost: { food: 400, wood: 400 }, time: 35, age: 2, building: 'castle',
    effects: [{ target: 'building', stat: 'hp', add: 0.21, pct: true }],
    desc: '+21% de PV para todos los edificios.',
  },
};

// Mejoras de línea: al investigarlas transforman las unidades existentes.
export const UPGRADES = {
  manatarms: { name: 'Hombres de armas', from: 'militia', to: 'manatarms', cost: { food: 100, gold: 40 }, time: 20, age: 1, building: 'barracks' },
  longswordsman: { name: 'Espadachines', from: 'manatarms', to: 'longswordsman', cost: { food: 200, gold: 65 }, time: 25, age: 2, building: 'barracks' },
  champion: { name: 'Campeones', from: 'longswordsman', to: 'champion', cost: { food: 750, gold: 350 }, time: 35, age: 3, building: 'barracks' },
  pikeman: { name: 'Piqueros', from: 'spearman', to: 'pikeman', cost: { food: 215, gold: 90 }, time: 25, age: 2, building: 'barracks' },
  crossbowman: { name: 'Ballesteros', from: 'archer', to: 'crossbowman', cost: { food: 125, gold: 75 }, time: 25, age: 2, building: 'archeryrange' },
  arbalester: { name: 'Arbaleteros', from: 'crossbowman', to: 'arbalester', cost: { food: 300, gold: 200 }, time: 30, age: 3, building: 'archeryrange' },
  cavalier: { name: 'Caballeros pesados', from: 'knight', to: 'cavalier', cost: { food: 300, gold: 300 }, time: 30, age: 3, building: 'stable' },
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
