// Modelos 3D de los recursos del mapa: árboles, minas, bayas y animales.
// La variante siembra el azar para que cada ejemplar sea un poco distinto y
// siempre el mismo, y `depleted` deja el yacimiento visiblemente menguado.

import { look } from '../data/appearance.js';
import {
  box, cyl, sphere, limb, scaleMesh, tone, srand, rand,
} from './engine.js';

function treeMesh(out, L, variant, depleted) {
  srand(variant * 17 + 5);
  const trunk = L.trunk, leaf = L.foliage;
  const h = 0.55 + rand() * 0.25;
  cyl(out, 0, 0, 0, 0.13, 0.08, h + 0.3, trunk, { seg: 6 });
  // Alguna raíz vista y una rama.
  limb(out, [0.1, 0.04, 0.02], [0.22, 0.12, 0], 0.03, trunk);
  limb(out, [0, 0, h + 0.1], [0.26, -0.2, h + 0.3], 0.03, trunk, { r2: 0.012 });
  // La copa: un racimo apretado de lóbulos con el tono revuelto, que al
  // hornearse dan el follaje picado del original.
  const lobes = depleted ? 3 : 6;
  const spread = depleted ? 0.26 : 0.4;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rand();
    const r = i === 0 ? 0 : spread * (0.6 + rand() * 0.4);
    const cx = Math.cos(a) * r, cy = Math.sin(a) * r;
    const cz = h + 0.3 + rand() * 0.35;
    sphere(out, cx, cy, cz, (depleted ? 0.26 : 0.36) + rand() * 0.12, leaf, {
      rings: 3, seg: 6, flat: 0.85, rough: 0.5,
    });
  }
  sphere(out, 0, 0, h + 0.75, depleted ? 0.22 : 0.32, tone(leaf, 0.08), { rings: 3, seg: 6, rough: 0.5 });
}

function stumpMesh(out, L) {
  srand(9);
  cyl(out, 0, 0, 0, 0.15, 0.13, 0.14, L.trunk, { seg: 7 });
  cyl(out, 0, 0, 0.14, 0.12, 0.11, 0.015, tone(L.trunk, 0.35), { seg: 7 });
  limb(out, [0.12, 0.05, 0.03], [0.24, 0.12, 0], 0.028, L.trunk);
}

function mineMesh(out, L, variant, depleted, gold) {
  srand(variant * 23 + (gold ? 7 : 3));
  const rocks = depleted ? 3 : 5;
  for (let i = 0; i < rocks; i++) {
    const a = (i / rocks) * Math.PI * 2 + rand() * 1.5;
    const r = i === 0 ? 0 : 0.16 + rand() * 0.22;
    const cx = Math.cos(a) * r, cy = Math.sin(a) * r;
    const size = (i === 0 ? 0.30 : 0.16 + rand() * 0.14) * (depleted ? 0.75 : 1);
    box(out, cx, cy, 0, size * 2, size * 1.7, size * (1.1 + rand() * 0.5), L.rock, {
      yaw: rand() * Math.PI, rough: 0.35,
    });
  }
  // Las vetas: esquirlas brillantes incrustadas por la cara de la cámara.
  const seams = depleted ? 3 : 7;
  for (let i = 0; i < seams; i++) {
    const a = rand() * Math.PI * 0.9 - 0.2; // sesgo hacia +x/+y, lo visible
    const cx = Math.cos(a) * (0.15 + rand() * 0.3);
    const cy = Math.sin(a) * (0.15 + rand() * 0.3);
    box(out, cx, cy, 0.05 + rand() * 0.3, 0.09, 0.09, 0.07, L.accent, {
      yaw: rand() * Math.PI, rough: 0.3, noshadow: true, unlit: gold,
    });
  }
}

function berriesMesh(out, L, variant, depleted) {
  srand(variant * 11 + 2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rand();
    const r = i === 0 ? 0 : 0.18 + rand() * 0.12;
    sphere(out, Math.cos(a) * r, Math.sin(a) * r, 0.1, 0.2 + rand() * 0.08, L.bush, {
      rings: 3, seg: 6, flat: 0.7, rough: 0.4,
    });
  }
  const n = depleted ? 4 : 12;
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI; // la media esfera que mira a la cámara
    const r = 0.12 + rand() * 0.3;
    sphere(out, Math.cos(a) * r, Math.sin(a) * r, 0.16 + rand() * 0.14, 0.035, L.berry, {
      rings: 2, seg: 4, noshadow: true,
    });
  }
}

function sheepMesh(out, L, variant) {
  srand(variant * 13 + 4);
  // Mira a la izquierda de la pantalla: el collar de domesticación del
  // renderizador cuenta con la cabeza en ese lado.
  const fx = -0.7071, fy = 0.7071;
  // Cuerpo lanudo.
  sphere(out, 0, 0, 0.30, 0.21, L.body, { rings: 3, seg: 7, flat: 0.85, rough: 0.18 });
  sphere(out, fx * 0.1, fy * 0.1, 0.34, 0.15, tone(L.body, 0.06), { rings: 3, seg: 6, rough: 0.18 });
  // Cabeza oscura con orejas.
  sphere(out, fx * 0.24, fy * 0.24, 0.42, 0.085, L.head, { rings: 3, seg: 6 });
  for (const s of [-1, 1]) {
    limb(out, [fx * 0.26 - fy * s * 0.06, fy * 0.26 + fx * s * 0.06, 0.44],
      [fx * 0.28 - fy * s * 0.1, fy * 0.28 + fx * s * 0.1, 0.42], 0.02, L.head);
  }
  for (const [lx, ly] of [[0.1, 0.08], [0.1, -0.08], [-0.1, 0.08], [-0.1, -0.08]]) {
    limb(out, [lx, ly, 0.18], [lx, ly, 0], 0.028, L.legs);
  }
}

function deerMesh(out, L, variant) {
  srand(variant * 19 + 6);
  const fx = -0.7071, fy = 0.7071;
  // Cuerpo esbelto.
  limb(out, [-fx * 0.18, -fy * 0.18, 0.42], [fx * 0.18, fy * 0.18, 0.44], 0.11, L.body);
  sphere(out, -fx * 0.2, -fy * 0.2, 0.43, 0.115, tone(L.body, -0.08), { rings: 3, seg: 6 });
  sphere(out, fx * 0.2, fy * 0.2, 0.45, 0.105, L.body, { rings: 3, seg: 6 });
  // Cuello y cabeza erguidos.
  limb(out, [fx * 0.24, fy * 0.24, 0.48], [fx * 0.34, fy * 0.34, 0.68], 0.05, L.body, { r2: 0.04 });
  limb(out, [fx * 0.34, fy * 0.34, 0.69], [fx * 0.45, fy * 0.45, 0.66], 0.035, L.head, { r2: 0.02 });
  for (const s of [-1, 1]) {
    limb(out, [fx * 0.33 - fy * s * 0.04, fy * 0.33 + fx * s * 0.04, 0.72],
      [fx * 0.34 - fy * s * 0.08, fy * 0.34 + fx * s * 0.08, 0.78], 0.015, L.head);
    // Cuerna ramificada.
    const bx = fx * 0.31 - fy * s * 0.03, by = fy * 0.31 + fx * s * 0.03;
    limb(out, [bx, by, 0.72], [bx - fx * 0.08 - fy * s * 0.08, by - fy * 0.08 + fx * s * 0.08, 0.86], 0.012, L.antlers);
    limb(out, [bx - fx * 0.04 - fy * s * 0.05, by - fy * 0.04 + fx * s * 0.05, 0.8],
      [bx - fy * s * 0.13, by + fx * s * 0.13, 0.9], 0.01, L.antlers);
  }
  for (const [t, side] of [[0.16, 0.07], [0.16, -0.07], [-0.16, 0.07], [-0.16, -0.07]]) {
    const lx = fx * t - fy * side, ly = fy * t + fx * side;
    limb(out, [lx, ly, 0.36], [lx, ly, 0], 0.024, L.legs);
  }
  // Rabito claro.
  sphere(out, -fx * 0.3, -fy * 0.3, 0.48, 0.04, tone(L.body, 0.3), { rings: 2, seg: 4 });
}

/** Malla de un recurso del mapa, anclada al centro de su rombo. */
export function nodeMesh(kind, variant, depleted) {
  const L = look('node', kind === 'stump' ? 'tree' : kind);
  const out = [];
  if (kind === 'tree') treeMesh(out, L, variant, depleted);
  else if (kind === 'stump') stumpMesh(out, L);
  else if (kind === 'gold') mineMesh(out, L, variant, depleted, true);
  else if (kind === 'stone') mineMesh(out, L, variant, depleted, false);
  else if (kind === 'berries') berriesMesh(out, L, variant, depleted);
  else if (kind === 'sheep') sheepMesh(out, L, variant);
  else if (kind === 'deer') deerMesh(out, L, variant);
  else mineMesh(out, L, variant, depleted, false);
  scaleMesh(out, L.scale || 1);
  return out;
}
