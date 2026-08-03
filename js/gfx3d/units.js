// Modelos 3D de las unidades. Cada tipo se construye por piezas (tronco,
// cabeza, yelmo, arma, montura...) mirando hacia +x, se posa según el
// fotograma y se gira a una de las ocho orientaciones. El motor lo hornea
// después a sprite 2D, así que aquí sólo hay geometría.

import { PLAYER_COLORS } from '../config.js';
import { look } from '../data/appearance.js';
import {
  quad, box, cyl, sphere, limb, wheel, rotZ, scaleMesh, tone, srand,
} from './engine.js';

// Tamaño global del muñeco: la cabeza y el arma se leen bien y una tropa no
// tapa media pantalla, como en el clásico.
const K = 0.9;

/**
 * Rasgos de cada tipo. helm: 'cap' | 'conical' | 'kettle' | 'great';
 * armor: 'cloth' | 'leather' | 'mail' | 'plate'; weapon: cómo pelea.
 */
const SPEC = {
  villager: { hair: true, armor: 'cloth', weapon: 'tool' },
  militia: { helm: 'cap', armor: 'leather', weapon: 'sword', shield: 0.1 },
  manatarms: { helm: 'conical', armor: 'mail', weapon: 'sword', shield: 0.11 },
  longswordsman: { helm: 'kettle', armor: 'mail', weapon: 'sword', shield: 0.11 },
  champion: { helm: 'great', armor: 'plate', weapon: 'sword', shield: 0.12, plume: true },
  spearman: { helm: 'cap', armor: 'leather', weapon: 'spear', shield: 0.09 },
  pikeman: { helm: 'kettle', armor: 'mail', weapon: 'pike', shield: 0.09 },
  archer: { hood: true, armor: 'cloth', weapon: 'bow', quiver: true },
  crossbowman: { helm: 'kettle', armor: 'leather', weapon: 'crossbow', quiver: true },
  arbalester: { helm: 'kettle', armor: 'plate', weapon: 'crossbow', quiver: true },
  skirmisher: { hair: true, armor: 'cloth', weapon: 'javelin', shield: 0.08 },
  scout: { helm: 'cap', armor: 'leather', weapon: 'sword', mounted: true },
  knight: { helm: 'great', armor: 'plate', weapon: 'sword', mounted: true, barding: true, shield: 0.11 },
  cavalier: { helm: 'great', armor: 'plate', weapon: 'sword', mounted: true, barding: true, shield: 0.12, plume: true },
};

/** Colores resueltos de un tipo: los del catálogo más los del jugador. */
function paletteOf(type, colorIdx) {
  const L = look('unit', type);
  const pc = PLAYER_COLORS[colorIdx] || PLAYER_COLORS[0];
  return {
    skin: L.skin || '#d9a878',
    legs: L.legs || '#3e3a33',
    helmet: L.helmet || '#a7a9b0',
    metal: L.metal || '#c9ccd4',
    wood: L.wood || '#8c6b3a',
    cloth: L.cloth || '#b9a279',
    leather: L.leather || '#7a5432',
    hair: L.hair || '#5a3a1e',
    plume: L.plume || '#e0dcd2',
    horse: L.horse || '#8a6a4a',
    wheelC: L.wheel || '#4a3720',
    main: pc.main, dark: pc.dark, light: pc.light,
    scale: L.scale || 1,
  };
}

// --- Postura -----------------------------------------------------------------

/**
 * Fase de la zancada por fotograma: 0 y 2 son los apoyos (valen de reposo),
 * 1 y 3 los pasos cruzados. Los fotogramas 4 y 5 son el golpe: preparación y
 * descarga, con los pies plantados en guardia.
 */
function stance(f) {
  if (f >= 4) return { swing: 0, stagger: 0.13, atk: f === 4 ? 'windup' : 'strike' };
  return { swing: Math.sin((f % 4) * Math.PI / 2), stagger: 0, atk: null };
}

// --- Piezas del soldado ------------------------------------------------------

function legPair(out, P, st, hipZ) {
  for (const side of [-1, 1]) {
    const hip = [0, side * 0.07, hipZ];
    let fx = st.atk ? side * st.stagger : st.swing * side * 0.16;
    const lift = st.atk ? 0 : Math.max(0, st.swing * side) * 0.06;
    const foot = [fx, side * 0.075, lift];
    const knee = [(hip[0] + foot[0]) / 2 + 0.035, side * 0.072, hipZ / 2 + lift / 2];
    limb(out, hip, knee, 0.047, P.legs);
    limb(out, knee, foot, 0.042, P.legs);
    // Bota.
    limb(out, [foot[0] - 0.02, foot[1], lift + 0.02], [foot[0] + 0.09, foot[1], lift + 0.015], 0.032, P.leather);
  }
}

function ridingLegs(out, P) {
  for (const side of [-1, 1]) {
    const hip = [0, side * 0.13, 0.74];
    const knee = [0.13, side * 0.20, 0.58];
    const foot = [0.10, side * 0.19, 0.40];
    limb(out, hip, knee, 0.045, P.legs);
    limb(out, knee, foot, 0.04, P.legs);
    limb(out, [foot[0] - 0.02, foot[1], foot[2]], [foot[0] + 0.08, foot[1], foot[2]], 0.03, P.leather);
  }
}

function torso(out, P, S, base) {
  const armorCol = { cloth: P.cloth, leather: P.leather, mail: tone(P.metal, -0.28), plate: P.metal }[S.armor || 'cloth'];
  // Falda o sobreveste con el color del jugador: es lo que dice de quién es.
  box(out, 0, 0, base, 0.17, 0.21, 0.14, P.main);
  box(out, 0, 0, base + 0.13, 0.165, 0.26, 0.24, armorCol);
  // Cinturón.
  box(out, 0, 0, base + 0.115, 0.175, 0.23, 0.035, P.leather);
  // Hombreras del armado; hombros de tela del resto.
  for (const side of [-1, 1]) {
    sphere(out, 0, side * 0.14, base + 0.35, 0.055, S.armor === 'plate' || S.armor === 'mail' ? armorCol : P.cloth, { rings: 3, seg: 6 });
  }
}

function headAndHelm(out, P, S, neck) {
  const hz = neck + 0.115;
  sphere(out, 0.01, 0, hz, 0.105, P.skin, { rings: 4, seg: 7 });
  if (S.hair) {
    sphere(out, -0.015, 0, hz + 0.035, 0.105, P.hair, { rings: 3, seg: 7, flat: 0.75 });
  }
  if (S.hood) {
    sphere(out, -0.02, 0, hz + 0.03, 0.115, P.cloth, { rings: 3, seg: 7 });
    box(out, -0.06, 0, hz - 0.1, 0.1, 0.16, 0.12, P.cloth);
  }
  const M = P.helmet;
  if (S.helm === 'cap') {
    sphere(out, 0, 0, hz + 0.045, 0.1, S.armor === 'leather' ? P.leather : M, { rings: 3, seg: 7, flat: 0.7 });
  } else if (S.helm === 'conical') {
    cyl(out, 0, 0, hz + 0.02, 0.105, 0.01, 0.17, M, { seg: 7 });
    box(out, 0.1, 0, hz - 0.03, 0.02, 0.03, 0.1, M); // nasal
  } else if (S.helm === 'kettle') {
    cyl(out, 0, 0, hz + 0.03, 0.15, 0.14, 0.025, M, { seg: 8 });
    sphere(out, 0, 0, hz + 0.05, 0.095, M, { rings: 3, seg: 7, flat: 0.75 });
  } else if (S.helm === 'great') {
    box(out, 0, 0, hz - 0.06, 0.185, 0.185, 0.24, M);
    // Visera oscura.
    quad(out,
      [0.096, -0.07, hz + 0.02], [0.096, 0.07, hz + 0.02],
      [0.096, 0.07, hz + 0.06], [0.096, -0.07, hz + 0.06],
      '#1c1c20', { unlit: true, bias: 0.03, noshadow: true });
  }
  if (S.plume) {
    limb(out, [-0.02, 0, hz + 0.16], [-0.14, 0, hz + 0.30], 0.03, P.light, { r2: 0.012 });
  }
}

function shieldOn(out, P, r, hand) {
  wheel(out, hand[0] + 0.02, hand[1] + 0.045, hand[2], r, 0.04, P.main, { seg: 9 });
  wheel(out, hand[0] + 0.02, hand[1] + 0.075, hand[2], r * 0.32, 0.015, P.metal, { seg: 6 });
}

function arm(out, P, S, shoulder, hand, col) {
  const elbow = [
    (shoulder[0] + hand[0]) / 2 - 0.02,
    (shoulder[1] + hand[1]) / 2 + Math.sign(shoulder[1]) * 0.03,
    (shoulder[2] + hand[2]) / 2,
  ];
  limb(out, shoulder, elbow, 0.038, col);
  limb(out, elbow, hand, 0.034, col);
  sphere(out, hand[0], hand[1], hand[2], 0.038, P.skin, { rings: 2, seg: 5 });
}

// --- Armas -------------------------------------------------------------------

function sword(out, P, hand, dir, len = 0.42) {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / n, dir[1] / n, dir[2] / n];
  const at = (t) => [hand[0] + d[0] * t, hand[1] + d[1] * t, hand[2] + d[2] * t];
  limb(out, at(-0.08), at(0.02), 0.016, P.wood);           // empuñadura
  limb(out, at(0.02), at(len), 0.02, P.metal, { r2: 0.004 }); // hoja
  // Cruz de la guarda: perpendicular horizontal.
  const px = [-d[1], d[0], 0];
  const pn = Math.hypot(px[0], px[1]) || 1;
  limb(out, [hand[0] + px[0] / pn * 0.055, hand[1] + px[1] / pn * 0.055, hand[2] + d[2] * 0.02],
    [hand[0] - px[0] / pn * 0.055, hand[1] - px[1] / pn * 0.055, hand[2] + d[2] * 0.02], 0.014, P.metal);
}

function polearm(out, P, hand, dir, len, tipLen = 0.1) {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / n, dir[1] / n, dir[2] / n];
  const at = (t) => [hand[0] + d[0] * t, hand[1] + d[1] * t, hand[2] + d[2] * t];
  limb(out, at(-len * 0.4), at(len * 0.6), 0.015, P.wood);
  limb(out, at(len * 0.6), at(len * 0.6 + tipLen), 0.02, P.metal, { r2: 0.002 });
}

function bowWeapon(out, P, hand, drawn) {
  // La pala del arco: un arco vertical curvado hacia delante.
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const t = -1 + i / 2;
    pts.push([hand[0] + (1 - t * t) * 0.07, hand[1], hand[2] + t * 0.33]);
  }
  for (let i = 0; i < 4; i++) limb(out, pts[i], pts[i + 1], 0.014, P.wood);
  const top = pts[4], bot = pts[0];
  const anchor = drawn
    ? [hand[0] - 0.24, hand[1] + 0.02, hand[2]]
    : [hand[0] - 0.02, hand[1], hand[2]];
  limb(out, top, anchor, 0.006, '#2c2620');
  limb(out, anchor, bot, 0.006, '#2c2620');
  if (drawn) limb(out, anchor, [hand[0] + 0.12, hand[1], hand[2]], 0.008, P.wood, { r2: 0.002 });
}

function crossbowWeapon(out, P, hand, dir) {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / n, dir[1] / n, dir[2] / n];
  const at = (t) => [hand[0] + d[0] * t, hand[1] + d[1] * t, hand[2] + d[2] * t];
  limb(out, at(-0.12), at(0.26), 0.02, P.wood);
  const tip = at(0.22);
  const px = [-d[1], d[0], 0];
  const pn = Math.hypot(px[0], px[1]) || 1;
  for (const s of [-1, 1]) {
    limb(out, tip, [tip[0] + px[0] / pn * s * 0.16 - d[0] * 0.07, tip[1] + px[1] / pn * s * 0.16 - d[1] * 0.07, tip[2]], 0.012, P.metal);
  }
}

function axeTool(out, P, hand, dir) {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / n, dir[1] / n, dir[2] / n];
  const at = (t) => [hand[0] + d[0] * t, hand[1] + d[1] * t, hand[2] + d[2] * t];
  limb(out, at(-0.1), at(0.28), 0.016, P.wood);
  const h = at(0.24);
  box(out, h[0], h[1], h[2] - 0.03, 0.1, 0.03, 0.09, P.metal, { yaw: Math.atan2(d[1], d[0]) });
}

function quiverOn(out, P) {
  limb(out, [-0.13, 0.05, 0.55], [-0.19, 0.1, 0.88], 0.04, P.leather);
  limb(out, [-0.185, 0.098, 0.88], [-0.21, 0.115, 0.96], 0.018, P.wood);
}

// --- El soldado completo -----------------------------------------------------

function humanoid(out, P, S, f, riding) {
  const st = stance(f);
  const bob = st.atk ? 0 : Math.abs(st.swing) * 0.02;
  const base = riding ? 0.60 : 0.42 + bob;

  if (riding) ridingLegs(out, P);
  else legPair(out, P, st, base + 0.02);

  torso(out, P, S, base + (riding ? 0.14 : 0));
  const chest = base + (riding ? 0.14 : 0);
  headAndHelm(out, P, S, chest + 0.40);

  const armCol = S.armor === 'mail' || S.armor === 'plate' ? tone(P.metal, -0.2) : P.cloth;
  const shL = [0, 0.155, chest + 0.33];
  const shR = [0, -0.155, chest + 0.33];
  const W = S.weapon;

  // Brazo del escudo (izquierdo) o segundo brazo.
  if (S.shield && W !== 'bow' && W !== 'crossbow') {
    const hand = [0.11, 0.19, chest + 0.13];
    arm(out, P, S, shL, hand, armCol);
    shieldOn(out, P, S.shield, hand);
  }

  if (W === 'sword' || W === 'tool') {
    const draw = W === 'sword' ? sword : axeTool;
    if (st.atk === 'windup') {
      const hand = [-0.06, -0.2, chest + 0.52];
      arm(out, P, S, shR, hand, armCol);
      draw(out, P, hand, [-0.5, -0.1, 0.55]);
    } else if (st.atk === 'strike') {
      const hand = [0.30, -0.12, chest + 0.25];
      arm(out, P, S, shR, hand, armCol);
      draw(out, P, hand, [1, -0.1, -0.15]);
    } else {
      const hand = [0.08, -0.19, chest + 0.10];
      arm(out, P, S, shR, hand, armCol);
      draw(out, P, hand, [0.25, 0, 1]);
    }
  } else if (W === 'spear' || W === 'pike' || W === 'javelin') {
    const len = W === 'pike' ? 1.5 : W === 'spear' ? 1.0 : 0.7;
    if (st.atk === 'windup') {
      const hand = [-0.04, -0.2, chest + (W === 'javelin' ? 0.5 : 0.18)];
      arm(out, P, S, shR, hand, armCol);
      polearm(out, P, hand, W === 'javelin' ? [1, -0.05, 0.25] : [1, -0.05, 0.05], len);
    } else if (st.atk === 'strike') {
      const hand = [0.26, -0.16, chest + (W === 'javelin' ? 0.42 : 0.2)];
      arm(out, P, S, shR, hand, armCol);
      polearm(out, P, hand, [1, -0.05, W === 'javelin' ? 0.1 : 0], len);
    } else {
      const hand = [0.05, -0.19, chest + 0.12];
      arm(out, P, S, shR, hand, armCol);
      polearm(out, P, hand, [0.1, 0, 1], len);
    }
  } else if (W === 'bow') {
    const drawn = st.atk === 'windup';
    const bowHand = [0.26, -0.02, chest + 0.28];
    arm(out, P, S, shL, bowHand, armCol);
    bowWeapon(out, P, bowHand, drawn);
    const pull = drawn ? [0.04, -0.05, chest + 0.28] : [0.12, -0.16, chest + 0.16];
    arm(out, P, S, shR, pull, armCol);
    if (S.quiver) quiverOn(out, P);
  } else if (W === 'crossbow') {
    const aim = st.atk !== null;
    const hand = aim ? [0.22, -0.02, chest + 0.30] : [0.10, -0.1, chest + 0.12];
    arm(out, P, S, shR, hand, armCol);
    arm(out, P, S, shL, [hand[0] + 0.08, hand[1] + 0.06, hand[2] - 0.02], armCol);
    crossbowWeapon(out, P, hand, aim ? [1, 0, 0.05] : [0.8, 0.15, 0.45]);
    if (S.quiver) quiverOn(out, P);
  }
}

// --- Montura -----------------------------------------------------------------

function horse(out, P, S, f) {
  const st = stance(f);
  const col = P.horse;
  const dark = tone(col, -0.3);

  // Tronco redondeado.
  limb(out, [-0.26, 0, 0.56], [0.26, 0, 0.56], 0.145, col);
  sphere(out, 0.27, 0, 0.56, 0.15, col, { rings: 3, seg: 7 });
  sphere(out, -0.27, 0, 0.57, 0.155, col, { rings: 3, seg: 7 });
  // Cuello y cabeza.
  limb(out, [0.27, 0, 0.64], [0.47, 0, 0.90], 0.085, col, { r2: 0.06 });
  limb(out, [0.46, 0, 0.92], [0.64, 0, 0.83], 0.05, col, { r2: 0.035 });
  for (const s of [-1, 1]) {
    limb(out, [0.44, s * 0.035, 0.96], [0.46, s * 0.05, 1.02], 0.015, dark);
  }
  // Crin y cola.
  limb(out, [0.24, 0, 0.72], [0.44, 0, 0.97], 0.03, dark);
  limb(out, [-0.31, 0, 0.60], [-0.43, 0, 0.36], 0.032, dark, { r2: 0.015 });

  // Patas: diagonales acompasadas al galope corto.
  const legs = [
    [0.21, -0.09, 1], [0.21, 0.09, -1],
    [-0.21, -0.09, -1], [-0.21, 0.09, 1],
  ];
  for (const [lx, ly, ph] of legs) {
    const fx = lx + (st.atk ? 0 : st.swing * ph * 0.12);
    const lift = st.atk ? 0 : Math.max(0, st.swing * ph) * 0.08;
    const knee = [(lx + fx) / 2 - 0.02, ly, 0.28 + lift / 2];
    limb(out, [lx, ly, 0.48], knee, 0.038, col);
    limb(out, knee, [fx, ly, lift], 0.028, col);
    limb(out, [fx, ly, lift], [fx + 0.02, ly, lift + 0.045], 0.03, '#2e2a26');
  }

  if (S.barding) {
    // Gualdrapa del color del jugador, hasta media pata como en el clásico.
    box(out, -0.01, 0, 0.33, 0.66, 0.34, 0.30, P.main);
    box(out, -0.01, 0, 0.31, 0.5, 0.35, 0.05, P.dark);
    // Testera metálica.
    limb(out, [0.47, 0, 0.93], [0.63, 0, 0.845], 0.055, P.metal, { r2: 0.038 });
  }
  // Manta de silla.
  box(out, -0.02, 0, 0.70, 0.30, 0.33, 0.045, S.barding ? P.dark : P.main);
}

// --- Máquinas de asedio ------------------------------------------------------

function ramMesh(out, P, f) {
  const st = stance(f);
  const push = st.atk ? (st.atk === 'strike' ? 0.14 : -0.06) : 0;
  // Caseta a dos aguas con tablones.
  const w = 1.05, d = 0.6;
  box(out, 0, 0, 0.18, w, d, 0.22, P.wood);
  for (const s of [-1, 1]) {
    quad(out,
      [-w / 2 - 0.06, s * (d / 2 + 0.05), 0.40], [w / 2 + 0.06, s * (d / 2 + 0.05), 0.40],
      [w / 2 + 0.06, 0, 0.62], [-w / 2 - 0.06, 0, 0.62],
      tone(P.wood, s * 0.12));
  }
  // Listones del techo.
  for (let i = 0; i < 3; i++) {
    const t = 0.4 + i * 0.07;
    for (const s of [-1, 1]) {
      const y = s * (d / 2 + 0.04) * (1 - (t - 0.4) / 0.24);
      limb(out, [-w / 2 - 0.07, y, t], [w / 2 + 0.07, y, t], 0.015, tone(P.wood, -0.25), { noshadow: true });
    }
  }
  // El tronco, con su cabeza de metal.
  limb(out, [-w / 2 + 0.1 + push, 0, 0.30], [w / 2 + 0.22 + push, 0, 0.30], 0.055, tone(P.wood, -0.15));
  limb(out, [w / 2 + 0.2 + push, 0, 0.30], [w / 2 + 0.3 + push, 0, 0.30], 0.06, P.metal);
  for (const wx of [-0.36, 0, 0.36]) {
    for (const s of [-1, 1]) wheel(out, wx, s * (d / 2 - 0.02), 0.13, 0.13, 0.06, P.wheelC, { axis: 'y', seg: 8 });
  }
}

function mangonelMesh(out, P, f) {
  const st = stance(f);
  box(out, 0, 0, 0.12, 0.9, 0.5, 0.12, P.wood);
  for (const s of [-1, 1]) {
    wheel(out, 0.32, s * 0.28, 0.14, 0.14, 0.06, P.wheelC, { axis: 'y', seg: 8 });
    wheel(out, -0.32, s * 0.28, 0.14, 0.14, 0.06, P.wheelC, { axis: 'y', seg: 8 });
    // Bastidor en A.
    limb(out, [0.18, s * 0.2, 0.2], [0, s * 0.12, 0.62], 0.035, tone(P.wood, 0.1));
    limb(out, [-0.18, s * 0.2, 0.2], [0, s * 0.12, 0.62], 0.035, tone(P.wood, 0.1));
  }
  limb(out, [0, -0.13, 0.62], [0, 0.13, 0.62], 0.035, P.wood); // eje
  // Brazo: en reposo armado hacia atrás; al disparar, vertical.
  const ang = st.atk === 'strike' ? 1.25 : st.atk === 'windup' ? -0.65 : -0.5;
  const tip = [Math.cos(ang) * -0.55, 0, 0.62 + Math.sin(ang) * 0.55];
  limb(out, [Math.cos(ang) * 0.18, 0, 0.62 - Math.sin(ang) * 0.18], tip, 0.04, P.wood);
  // Cazoleta con su piedra.
  sphere(out, tip[0], tip[1], tip[2] + 0.03, 0.055, '#6b6259', { rings: 2, seg: 5 });
  box(out, 0.3, 0, 0.18, 0.16, 0.3, 0.1, P.main);
}

function trebuchetMesh(out, P, f) {
  const st = stance(f);
  box(out, 0, 0, 0.1, 1.0, 0.55, 0.1, P.wood);
  const topZ = 1.05;
  for (const s of [-1, 1]) {
    limb(out, [0.3, s * 0.26, 0.15], [0, s * 0.05, topZ], 0.04, tone(P.wood, 0.08));
    limb(out, [-0.3, s * 0.26, 0.15], [0, s * 0.05, topZ], 0.04, tone(P.wood, 0.08));
  }
  limb(out, [0, -0.07, topZ], [0, 0.07, topZ], 0.04, P.wood);
  // Brazo largo con contrapeso; armado apunta atrás y abajo, disparado sube.
  const ang = st.atk === 'strike' ? 1.35 : st.atk === 'windup' ? -0.5 : -0.35;
  const arm = 0.85, ctr = 0.3;
  const tip = [-Math.cos(ang) * arm, 0, topZ + Math.sin(ang) * arm];
  const back = [Math.cos(ang) * ctr, 0, topZ - Math.sin(ang) * ctr];
  limb(out, back, tip, 0.045, P.wood, { r2: 0.02 });
  box(out, back[0], back[1], back[2] - 0.16, 0.2, 0.24, 0.2, tone(P.wood, -0.25));
  // La honda cuelga del extremo.
  if (st.atk !== 'strike') {
    limb(out, tip, [tip[0] - 0.1, 0, Math.max(0.08, tip[2] - 0.3)], 0.012, '#4c4438');
    sphere(out, tip[0] - 0.1, 0, Math.max(0.1, tip[2] - 0.32), 0.05, '#6b6259', { rings: 2, seg: 5 });
  }
  box(out, 0.42, 0, 0.15, 0.12, 0.26, 0.1, P.main);
}

// --- Entrada -----------------------------------------------------------------

const CLASS_OF = { ram: ramMesh, mangonel: mangonelMesh, trebuchet: trebuchetMesh };

/**
 * Malla completa de una unidad: tipo, color de jugador, orientación (0-7,
 * 0 = +u del mundo, en sentido horario de pantalla) y fotograma (0-3 andar,
 * 4-5 ataque). Lista para hornear.
 */
export function unitMesh(type, colorIdx, face, frame) {
  const P = paletteOf(type, colorIdx);
  const S = SPEC[type] || SPEC.villager;
  const out = [];
  srand((face + 1) * 13 + frame);

  const siege = CLASS_OF[type];
  if (siege) {
    siege(out, P, frame);
  } else if (S.mounted) {
    horse(out, P, S, frame);
    humanoid(out, P, S, frame, true);
  } else {
    humanoid(out, P, S, frame, false);
  }

  rotZ(out, face * Math.PI / 4);
  scaleMesh(out, K * P.scale);
  return out;
}
