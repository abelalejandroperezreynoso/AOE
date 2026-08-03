// Modelos 3D de los edificios. Comparten un kit de obra (zócalo de piedra,
// muros con entramado, tejados por hiladas, almenas, banderas) y cada tipo lo
// combina a su manera. La huella va de (0,0) a (s,s) casillas, con el origen en
// la esquina superior del rombo, que es donde ancla el renderizador.
//
// Cada edificio sabe además dibujarse a medio construir: la etapa 0 es el
// encofrado de madera sobre la tierra, la 1 los muros a media altura entre
// andamios y la 2 la obra terminada.

import { BUILDINGS, PLAYER_COLORS } from '../config.js';
import { look, ramp } from '../data/appearance.js';
import {
  tri, quad, box, cyl, sphere, limb, wheel, lathe, tone, srand, rand,
} from './engine.js';

// --- Kit común ---------------------------------------------------------------

/** Caja por esquinas de huella: de (x0,y0) a (x1,y1), de z0 a z0+h. */
function slab(out, x0, y0, x1, y1, z0, h, color, o) {
  box(out, (x0 + x1) / 2, (y0 + y1) / 2, z0, x1 - x0, y1 - y0, h, color, o);
}

/**
 * Cuerpo de muros con zócalo de piedra y esquineras de madera. Devuelve la cota
 * del remate para apoyar encima el tejado.
 */
function walls(out, x0, y0, x1, y1, h, M, o = {}) {
  const plinth = Math.min(0.16, h * 0.25);
  slab(out, x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, 0, plinth, M.stone);
  slab(out, x0, y0, x1, y1, plinth, h - plinth, M.wall);
  if (!o.plain) {
    // Esquineras y carrera superior de madera, el entramado del clásico.
    for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      box(out, cx, cy, plinth, 0.07, 0.07, h - plinth, M.wood, { noshadow: true });
    }
    limb(out, [x0, y1 + 0.035, h - 0.04], [x1, y1 + 0.035, h - 0.04], 0.035, M.wood, { noshadow: true });
    limb(out, [x1 + 0.035, y0, h - 0.04], [x1 + 0.035, y1, h - 0.04], 0.035, M.wood, { noshadow: true });
  }
  return h;
}

/** Puerta en la cara +x (la que mira a la cámara por la derecha). */
function doorX(out, x, cy, w, h, M) {
  quad(out,
    [x + 0.015, cy - w / 2, 0.02], [x + 0.015, cy + w / 2, 0.02],
    [x + 0.015, cy + w / 2, h], [x + 0.015, cy - w / 2, h],
    M.door || '#3b2a17', { bias: 0.05, noshadow: true });
  limb(out, [x + 0.02, cy - w / 2 - 0.03, 0], [x + 0.02, cy - w / 2 - 0.03, h + 0.03], 0.03, M.wood, { noshadow: true });
  limb(out, [x + 0.02, cy + w / 2 + 0.03, 0], [x + 0.02, cy + w / 2 + 0.03, h + 0.03], 0.03, M.wood, { noshadow: true });
  limb(out, [x + 0.02, cy - w / 2 - 0.05, h + 0.03], [x + 0.02, cy + w / 2 + 0.05, h + 0.03], 0.035, M.wood, { noshadow: true });
}

/** Ventana oscura con dintel, en la cara +x o +y. */
function windowAt(out, face, x, y, z, w, h, M) {
  const e = 0.015;
  if (face === 'x') {
    quad(out, [x + e, y - w / 2, z], [x + e, y + w / 2, z], [x + e, y + w / 2, z + h], [x + e, y - w / 2, z + h],
      '#241d14', { bias: 0.05, noshadow: true, unlit: true });
    limb(out, [x + e, y - w / 2 - 0.02, z + h], [x + e, y + w / 2 + 0.02, z + h], 0.02, M.wood, { noshadow: true });
  } else {
    quad(out, [x - w / 2, y + e, z], [x + w / 2, y + e, z], [x + w / 2, y + e, z + h], [x - w / 2, y + e, z + h],
      '#241d14', { bias: 0.05, noshadow: true, unlit: true });
    limb(out, [x - w / 2 - 0.02, y + e, z + h], [x + w / 2 + 0.02, y + e, z + h], 0.02, M.wood, { noshadow: true });
  }
}

/**
 * Tejado a dos aguas por hiladas: cada faldón se corta en franjas con tonos
 * alternos, que es lo que hace que se lea como bálago o teja y no como un
 * plástico liso. La cumbrera corre a lo largo del eje mayor.
 */
function gableRoof(out, x0, y0, x1, y1, zb, rise, roofCol, M, o = {}) {
  const alongX = (o.axis || (x1 - x0 >= y1 - y0 ? 'x' : 'y')) === 'x';
  const ov = o.overhang !== undefined ? o.overhang : 0.14;
  const courses = o.courses || 4;
  const [rL, rB, rD] = ramp(roofCol).map((c) => c);
  const A0 = alongX ? x0 - ov : y0 - ov, A1 = alongX ? x1 + ov : y1 + ov;
  const B0 = alongX ? y0 - ov : x0 - ov, B1 = alongX ? y1 + ov : x1 + ov;
  const Bm = (B0 + B1) / 2;
  const zt = zb + rise;
  const pt = (a, b, z) => (alongX ? [a, b, z] : [b, a, z]);

  for (let s = 0; s < 2; s++) {
    const be = s === 0 ? B0 : B1;                    // borde del alero
    for (let i = 0; i < courses; i++) {
      const t0 = i / courses, t1 = (i + 1) / courses;
      const b0 = be + (Bm - be) * t0, b1 = be + (Bm - be) * t1;
      const zc0 = zb + rise * t0, zc1 = zb + rise * t1;
      const col = tone(s === 0 ? rD : rB, (i % 2 ? 0.06 : -0.02) + (rand() - 0.5) * 0.05);
      quad(out, pt(A0, b0, zc0), pt(A1, b0, zc0), pt(A1, b1, zc1 + 0.015), pt(A0, b1, zc1 + 0.015), col);
    }
  }
  // Hastiales.
  const g0 = alongX ? x0 : y0, g1 = alongX ? x1 : y1;
  tri(out, pt(g0, B0 + ov, zb), pt(g0, B1 - ov, zb), pt(g0, Bm, zt), M.wall);
  tri(out, pt(g1, B0 + ov, zb), pt(g1, B1 - ov, zb), pt(g1, Bm, zt), M.wall);
  // Cumbrera.
  limb(out, pt(A0, Bm, zt + 0.01), pt(A1, Bm, zt + 0.01), 0.035, tone(rD, -0.15), { noshadow: true });
  return zt;
}

/** Tejado a cuatro aguas (piramidal si la planta es cuadrada). */
function hipRoof(out, x0, y0, x1, y1, zb, rise, roofCol, o = {}) {
  const ov = o.overhang !== undefined ? o.overhang : 0.16;
  const [rL, rB, rD] = ramp(roofCol);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, zt = zb + rise;
  const X0 = x0 - ov, X1 = x1 + ov, Y0 = y0 - ov, Y1 = y1 + ov;
  const ridge = Math.abs((x1 - x0) - (y1 - y0)) < 0.01 ? 0 : 0.25;
  const r0 = [cx - ridge * (x1 - x0), cy, zt], r1 = [cx + ridge * (x1 - x0), cy, zt];
  const courses = o.courses || 4;
  // Los dos faldones que se ven, por franjas; los otros dos, lisos.
  for (let i = 0; i < courses; i++) {
    const t0 = i / courses, t1 = (i + 1) / courses;
    const col = (base) => tone(base, (i % 2 ? 0.06 : -0.02) + (rand() - 0.5) * 0.04);
    // Faldón +x
    quad(out,
      [X1 - (X1 - r1[0]) * t0, Y0 + (cy - Y0) * t0, zb + rise * t0],
      [X1 - (X1 - r1[0]) * t0, Y1 - (Y1 - cy) * t0, zb + rise * t0],
      [X1 - (X1 - r1[0]) * t1, Y1 - (Y1 - cy) * t1, zb + rise * t1 + 0.01],
      [X1 - (X1 - r1[0]) * t1, Y0 + (cy - Y0) * t1, zb + rise * t1 + 0.01], col(rB));
    // Faldón +y
    quad(out,
      [X0 + (r0[0] - X0) * t0, Y1 - (Y1 - cy) * t0, zb + rise * t0],
      [X1 - (X1 - r1[0]) * t0, Y1 - (Y1 - cy) * t0, zb + rise * t0],
      [X1 - (X1 - r1[0]) * t1, Y1 - (Y1 - cy) * t1, zb + rise * t1 + 0.01],
      [X0 + (r0[0] - X0) * t1, Y1 - (Y1 - cy) * t1, zb + rise * t1 + 0.01], col(rD));
  }
  quad(out, [X0, Y0, zb], [X1, Y0, zb], r1, r0, rL);           // faldón -y
  tri(out, [X0, Y0, zb], [X0, Y1, zb], r0, rL);                 // faldón -x
  limb(out, [r0[0], r0[1], zt + 0.01], [r1[0] + 0.001, r1[1], zt + 0.01], 0.04, tone(rD, -0.2), { noshadow: true });
  return zt;
}

/** Almenas alrededor del borde superior de un rectángulo. */
function battlements(out, x0, y0, x1, y1, z, M) {
  slab(out, x0 - 0.05, y0 - 0.05, x1 + 0.05, y1 + 0.05, z, 0.1, tone(M.wall, -0.06));
  const step = 0.34;
  const edges = [
    [[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]],
    [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]],
  ];
  for (const [[ax, ay], [bx, by]] of edges) {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(2, Math.floor(len / step));
    for (let i = 0; i <= n; i += 2) {
      const t = i / n;
      box(out, ax + (bx - ax) * t, ay + (by - ay) * t, z + 0.1, 0.14, 0.14, 0.14, M.wall, { noshadow: true });
    }
  }
}

/** Torre redonda con almenas; r y altura en casillas. */
function roundTower(out, cx, cy, r, h, M) {
  cyl(out, cx, cy, 0, r * 1.12, r, h, M.wall, { seg: 10 });
  cyl(out, cx, cy, h, r * 1.14, r * 1.14, 0.08, tone(M.wall, -0.08), { seg: 10 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    box(out, cx + Math.cos(a) * r * 1.02, cy + Math.sin(a) * r * 1.02, h + 0.08, 0.12, 0.12, 0.14, M.wall, { noshadow: true });
  }
  // Saetera a la cara de la cámara.
  quad(out,
    [cx + r * 0.72, cy + r * 0.72, h * 0.55], [cx + r * 0.6, cy + r * 0.84, h * 0.55],
    [cx + r * 0.6, cy + r * 0.84, h * 0.75], [cx + r * 0.72, cy + r * 0.72, h * 0.75],
    '#241d14', { bias: 0.08, noshadow: true, unlit: true });
}

/** Estandarte del jugador: mástil con gallardete. */
function flag(out, x, y, z, h, col) {
  limb(out, [x, y, z], [x, y, z + h], 0.018, '#5b4a2f');
  const t = z + h;
  quad(out, [x, y, t], [x + 0.26, y + 0.05, t - 0.06], [x, y, t - 0.13], [x, y, t - 0.12], col, { noshadow: true });
}

/** Andamio perimetral para la obra a medias. */
function scaffold(out, x0, y0, x1, y1, h, M) {
  for (const [cx, cy] of [[x1 + 0.14, y0 + 0.2], [x1 + 0.14, y1 - 0.2], [x0 + 0.2, y1 + 0.14], [x1 - 0.2, y1 + 0.14]]) {
    limb(out, [cx, cy, 0], [cx, cy, h + 0.35], 0.03, M.wood);
  }
  limb(out, [x1 + 0.14, y0 + 0.2, h + 0.2], [x1 + 0.14, y1 - 0.2, h + 0.2], 0.025, tone(M.wood, 0.15));
  limb(out, [x0 + 0.2, y1 + 0.14, h + 0.2], [x1 - 0.2, y1 + 0.14, h + 0.2], 0.025, tone(M.wood, 0.15));
  // Tablones apoyados.
  limb(out, [x1 - 0.5, y0 + 0.3, 0.02], [x1 + 0.3, y0 + 0.5, 0.02], 0.04, tone(M.wood, -0.1));
}

/** Cimientos: el encofrado de vigas sobre tierra removida. */
function foundation(out, x0, y0, x1, y1, M) {
  slab(out, x0, y0, x1, y1, 0, 0.045, '#7a5f3d');
  const beams = [
    [[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]],
    [[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]],
  ];
  for (const [[ax, ay], [bx, by]] of beams) {
    limb(out, [ax, ay, 0.07], [bx, by, 0.07], 0.05, M.wood);
  }
  for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    limb(out, [cx, cy, 0], [cx, cy, 0.3], 0.035, tone(M.wood, -0.15));
  }
  // Materiales acopiados.
  limb(out, [x0 + 0.4, y0 + 0.35, 0.08], [x0 + 0.95, y0 + 0.35, 0.08], 0.075, tone(M.wood, 0.08));
  limb(out, [x0 + 0.45, y0 + 0.48, 0.08], [x0 + 0.9, y0 + 0.48, 0.08], 0.07, tone(M.wood, -0.05));
  box(out, x1 - 0.4, y1 - 0.4, 0, 0.26, 0.26, 0.22, tone(M.stone || '#9a9a94', 0.05));
}

function logPile(out, cx, cy, len, n, wood) {
  for (let i = 0; i < n; i++) {
    const z = 0.06 + Math.floor(i / 3) * 0.11;
    const off = (i % 3) * 0.12 - 0.12 + (Math.floor(i / 3) % 2) * 0.06;
    limb(out, [cx - len / 2, cy + off, z], [cx + len / 2, cy + off, z], 0.055, tone(wood, (i % 2) * 0.12 - 0.04));
  }
}

function barrel(out, cx, cy, wood) {
  lathe(out, cx, cy, [[0.07, 0], [0.09, 0.09], [0.07, 0.18]], wood, { seg: 7 });
}

// --- Los edificios -----------------------------------------------------------

const BUILDERS = {
  house(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.2, 0.2, s - 0.2, s - 0.2, M);
    const h = 0.8 * (stage === 1 ? 0.55 : 1);
    walls(out, 0.16, 0.16, s - 0.16, s - 0.16, h, M);
    if (stage === 1) return scaffold(out, 0.16, 0.16, s - 0.16, s - 0.16, h, M);
    // Planta alta encalada sobre el muro bajo (wall2), como la casa original.
    slab(out, 0.2, 0.2, s - 0.2, s - 0.2, h, 0.34, M.wall2 || tone(M.wall, 0.3));
    limb(out, [0.2, s - 0.16, h + 0.17], [s - 0.2, s - 0.16, h + 0.17], 0.03, M.wood, { noshadow: true });
    gableRoof(out, 0.2, 0.2, s - 0.2, s - 0.2, h + 0.34, 0.55, M.roof, M, { courses: 5 });
    doorX(out, s - 0.16, s * 0.5, 0.3, 0.42, M);
    windowAt(out, 'y', s * 0.45, s - 0.16, h * 0.45, 0.2, 0.2, M);
    // Chimenea humilde.
    box(out, 0.45, 0.55, h + 0.6, 0.16, 0.16, 0.5, M.chimney || '#5c5c58');
  },

  mill(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.2, 0.2, s - 0.2, s - 0.2, M);
    const h = 1.15 * (stage === 1 ? 0.5 : 1);
    const cx = s * 0.52, cy = s * 0.52;
    cyl(out, cx, cy, 0, 0.62, 0.5, h, M.wall, { seg: 9 });
    if (stage === 1) return scaffold(out, 0.1, 0.1, s - 0.1, s - 0.1, h, M);
    cyl(out, cx, cy, h, 0.58, 0.04, 0.5, ramp(M.roof)[1], { seg: 9 });
    limb(out, [cx, cy, h + 0.42], [cx + 0.36, cy - 0.1, h + 0.28], 0.035, M.wood);
    // Las aspas, en cruz sobre la cara que mira a la cámara.
    const hub = [cx + 0.38, cy - 0.11, h + 0.27];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const vy = Math.cos(a) * 0.55, vz = Math.sin(a) * 0.55;
      limb(out, hub, [hub[0] + 0.06, hub[1] + vy, hub[2] + vz], 0.025, M.wood);
      quad(out, [hub[0] + 0.03, hub[1] + vy * 0.25, hub[2] + vz * 0.25],
        [hub[0] + 0.03, hub[1] + vy, hub[2] + vz],
        [hub[0] + 0.1, hub[1] + vy * 0.95 + vz * 0.18, hub[2] + vz * 0.95 - vy * 0.18],
        [hub[0] + 0.1, hub[1] + vy * 0.3 + vz * 0.18, hub[2] + vz * 0.3 - vy * 0.18],
        M.accent || '#ebe4c8', { noshadow: true });
    }
    doorX(out, cx + 0.55, cy - 0.05, 0.28, 0.4, M);
    // Sacos junto a la puerta.
    sphere(out, s - 0.3, s - 0.55, 0.09, 0.09, '#c2ad6b', { rings: 2, seg: 5, flat: 0.8 });
    sphere(out, s - 0.42, s - 0.42, 0.09, 0.09, '#b09a62', { rings: 2, seg: 5, flat: 0.8 });
  },

  farm(out, s, M) {
    // Parcela llana: surcos alternos de tierra y cultivo, con cerca somera.
    // No arroja sombra: es suelo labrado, no un bulto.
    slab(out, 0.05, 0.05, s - 0.05, s - 0.05, 0, 0.03, ramp(M.soil)[1], { noshadow: true });
    const rows = 7;
    for (let i = 0; i < rows; i++) {
      const y = 0.15 + (i / (rows - 1)) * (s - 0.3);
      limb(out, [0.15, y, 0.045], [s - 0.15, y, 0.045], 0.045,
        tone(ramp(M.crop)[i % 2 ? 0 : 1], (rand() - 0.5) * 0.08), { noshadow: true });
    }
    for (const [px, py] of [[0.08, 0.08], [s - 0.08, 0.08], [0.08, s - 0.08], [s - 0.08, s - 0.08]]) {
      limb(out, [px, py, 0], [px, py, 0.16], 0.025, M.fence || '#5b4426');
    }
  },

  lumbercamp(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.15, 0.15, s - 0.15, s - 0.15, M);
    slab(out, 0.05, 0.05, s - 0.05, s - 0.05, 0, 0.03, M.soil || '#a8926a');
    const h = 0.72 * (stage === 1 ? 0.6 : 1);
    // Cobertizo abierto: postes y techo de una sola agua.
    for (const [px, py] of [[0.25, 0.25], [s - 0.9, 0.25], [0.25, s - 0.35], [s - 0.9, s - 0.35]]) {
      limb(out, [px, py, 0], [px, py, h], 0.045, M.wood);
    }
    if (stage === 1) return scaffold(out, 0.2, 0.2, s - 0.2, s - 0.2, h, M);
    quad(out, [0.1, 0.1, h + 0.12], [s - 0.75, 0.1, h + 0.24], [s - 0.75, s - 0.2, h + 0.24], [0.1, s - 0.2, h + 0.12],
      ramp(M.accent || '#a08a55')[1]);
    logPile(out, s - 0.55, s * 0.45, 0.85, 7, M.wood);
    // Tronco a medio aserrar sobre caballetes.
    limb(out, [0.4, s - 0.25, 0.18], [1.1, s - 0.15, 0.18], 0.06, tone(M.wood, 0.1));
  },

  miningcamp(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.15, 0.15, s - 0.15, s - 0.15, M);
    slab(out, 0.05, 0.05, s - 0.05, s - 0.05, 0, 0.03, M.soil || '#a8926a');
    const h = 0.72 * (stage === 1 ? 0.6 : 1);
    for (const [px, py] of [[0.25, 0.3], [s - 0.85, 0.3], [0.25, s - 0.3], [s - 0.85, s - 0.3]]) {
      limb(out, [px, py, 0], [px, py, h], 0.045, M.wood);
    }
    if (stage === 1) return scaffold(out, 0.2, 0.2, s - 0.2, s - 0.2, h, M);
    gableRoof(out, 0.2, 0.25, s - 0.8, s - 0.25, h, 0.3, M.roof || '#c6ae86', M, { courses: 3, overhang: 0.1 });
    // Montones de mena y la carretilla.
    for (let i = 0; i < 3; i++) {
      sphere(out, s - 0.45 - i * 0.14, s - 0.5 + (i % 2) * 0.22, 0.07, 0.1, tone(M.stone || '#8f9298', (rand() - 0.5) * 0.2), { rings: 2, seg: 5, flat: 0.7 });
    }
    wheel(out, s - 0.35, 0.4, 0.12, 0.12, 0.05, M.wood, { axis: 'y', seg: 8 });
    limb(out, [s - 0.6, 0.32, 0.16], [s - 0.15, 0.32, 0.2], 0.03, M.wood);
    // Pico apoyado.
    limb(out, [0.4, 0.3, 0], [0.52, 0.38, 0.4], 0.02, M.wood);
    limb(out, [0.47, 0.33, 0.4], [0.6, 0.46, 0.36], 0.025, M.metal || '#9aa4ad');
  },

  barracks(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.25, 0.25, s - 0.25, s - 0.25, M);
    const h = 1.05 * (stage === 1 ? 0.55 : 1);
    walls(out, 0.25, 0.25, s - 0.25, s - 0.25, h, M);
    if (stage === 1) return scaffold(out, 0.25, 0.25, s - 0.25, s - 0.25, h, M);
    gableRoof(out, 0.25, 0.3, s - 0.25, s - 0.3, h, 0.75, M.roof, M, { courses: 5 });
    doorX(out, s - 0.25, s * 0.5, 0.45, 0.6, M);
    windowAt(out, 'x', s - 0.25, s * 0.22, h * 0.55, 0.18, 0.22, M);
    windowAt(out, 'y', s * 0.3, s - 0.25, h * 0.55, 0.22, 0.22, M);
    // Paño de armas: lanzas apoyadas junto a la puerta.
    for (let i = 0; i < 3; i++) {
      limb(out, [s - 0.2, s * 0.72 + i * 0.12, 0], [s - 0.32, s * 0.74 + i * 0.12, 0.8], 0.018, M.wood);
    }
    flag(out, s * 0.5, 0.35, h + 0.75, 0.55, C.main);
    // Blasón colgado del hastial.
    quad(out, [s - 0.245, s * 0.42, h - 0.05], [s - 0.245, s * 0.58, h - 0.05],
      [s - 0.245, s * 0.58, h - 0.38], [s - 0.245, s * 0.42, h - 0.38], C.main, { bias: 0.05, noshadow: true });
  },

  archeryrange(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.25, 0.25, s - 0.25, s - 0.25, M);
    const h = 0.95 * (stage === 1 ? 0.55 : 1);
    walls(out, 0.25, 0.25, s - 1.0, s - 0.25, h, M);
    if (stage === 1) return scaffold(out, 0.25, 0.25, s - 0.25, s - 0.25, h, M);
    gableRoof(out, 0.25, 0.3, s - 1.0, s - 0.3, h, 0.6, M.roof, M, { courses: 4 });
    doorX(out, s - 1.0, s * 0.5, 0.4, 0.55, M);
    // Campo de tiro: diana de paja frente a la fachada.
    const tx = s - 0.45, ty = s * 0.42;
    cyl(out, tx, ty, 0, 0.06, 0.05, 0.5, M.wood, { seg: 6 });
    wheel(out, tx + 0.02, ty, 0.55, 0.26, 0.07, '#d8c98e', { axis: 'x', seg: 10 });
    wheel(out, tx + 0.062, ty, 0.55, 0.16, 0.01, '#b8483a', { axis: 'x', seg: 8, noshadow: true });
    wheel(out, tx + 0.068, ty, 0.55, 0.07, 0.01, '#e8e2d0', { axis: 'x', seg: 8, noshadow: true });
    flag(out, 0.4, 0.4, h + 0.6, 0.5, C.main);
  },

  stable(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.25, 0.25, s - 0.25, s - 0.25, M);
    const h = 0.9 * (stage === 1 ? 0.55 : 1);
    walls(out, 0.25, 0.25, s - 0.25, s - 1.0, h, M);
    if (stage === 1) return scaffold(out, 0.25, 0.25, s - 0.25, s - 0.25, h, M);
    gableRoof(out, 0.25, 0.25, s - 0.25, s - 1.0, h, 0.6, M.roof, M, { courses: 4, axis: 'x' });
    doorX(out, s - 0.25, s * 0.32, 0.5, 0.6, M);
    // Corral con cerca de dos travesaños.
    const cy0 = s - 0.9, cy1 = s - 0.15;
    for (const [ax, ay, bx, by] of [
      [0.25, cy0, 0.25, cy1], [0.25, cy1, s - 0.3, cy1], [s - 0.3, cy1, s - 0.3, cy0],
    ]) {
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 0.45));
      for (let i = 0; i <= n; i++) {
        limb(out, [ax + (bx - ax) * (i / n), ay + (by - ay) * (i / n), 0], [ax + (bx - ax) * (i / n), ay + (by - ay) * (i / n), 0.3], 0.025, M.wood);
      }
      for (const z of [0.14, 0.26]) limb(out, [ax, ay, z], [bx, by, z], 0.018, tone(M.wood, 0.1), { noshadow: true });
    }
    // Abrevadero y paja.
    box(out, 0.6, cy0 + 0.35, 0, 0.4, 0.18, 0.14, M.wood);
    sphere(out, s - 0.7, cy0 + 0.4, 0.08, 0.14, '#c9b47c', { rings: 2, seg: 6, flat: 0.6 });
    flag(out, 0.4, 0.35, h + 0.6, 0.5, C.main);
  },

  blacksmith(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.2, 0.2, s - 0.2, s - 0.2, M);
    const h = 0.85 * (stage === 1 ? 0.55 : 1);
    walls(out, 0.16, 0.16, s - 0.16, s - 0.16, h, M, { plain: true });
    if (stage === 1) return scaffold(out, 0.16, 0.16, s - 0.16, s - 0.16, h, M);
    gableRoof(out, 0.16, 0.16, s - 0.16, s - 0.16, h, 0.5, M.roof, M, { courses: 4 });
    // Fragua abierta: hueco grande con el resplandor dentro.
    quad(out, [s - 0.155, s * 0.3, 0.02], [s - 0.155, s * 0.75, 0.02],
      [s - 0.155, s * 0.75, 0.55], [s - 0.155, s * 0.3, 0.55], '#241d14', { bias: 0.05, noshadow: true, unlit: true });
    quad(out, [s - 0.15, s * 0.38, 0.06], [s - 0.15, s * 0.62, 0.06],
      [s - 0.15, s * 0.62, 0.3], [s - 0.15, s * 0.38, 0.3], M.accent || '#ff9a3c', { bias: 0.1, noshadow: true, unlit: true });
    // Chimenea robusta y yunque a la puerta.
    box(out, 0.42, 0.45, h + 0.3, 0.24, 0.24, 0.75, M.chimney || '#5c5c58');
    cyl(out, s - 0.35, s - 0.35, 0, 0.09, 0.08, 0.18, M.wood, { seg: 6 });
    box(out, s - 0.35, s - 0.35, 0.18, 0.2, 0.09, 0.08, '#8d8f96');
  },

  market(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.2, 0.2, s - 0.2, s - 0.2, M);
    // Plaza empedrada.
    slab(out, 0.05, 0.05, s - 0.05, s - 0.05, 0, 0.05, ramp(M.ground)[1]);
    const h = 0.9 * (stage === 1 ? 0.6 : 1);
    // Pabellón central.
    for (const [px, py] of [[s * 0.32, s * 0.32], [s * 0.68, s * 0.32], [s * 0.32, s * 0.68], [s * 0.68, s * 0.68]]) {
      limb(out, [px, py, 0.05], [px, py, h], 0.05, M.wood);
    }
    if (stage === 1) return scaffold(out, 0.2, 0.2, s - 0.2, s - 0.2, h, M);
    hipRoof(out, s * 0.28, s * 0.28, s * 0.72, s * 0.72, h, 0.55, M.stall1 || '#c9553f', { courses: 3, overhang: 0.1 });
    // Puestos con toldo en las cuatro esquinas.
    const stalls = [
      [0.45, 0.45, M.stall1], [s - 0.45, 0.45, M.stall2],
      [0.45, s - 0.45, M.stall3], [s - 0.45, s - 0.45, M.stall4],
    ];
    for (const [px, py, col] of stalls) {
      box(out, px, py, 0.05, 0.5, 0.4, 0.28, M.counter || '#8a6a3c');
      for (const [ox, oy] of [[-0.24, -0.19], [0.24, -0.19], [-0.24, 0.19], [0.24, 0.19]]) {
        limb(out, [px + ox, py + oy, 0.05], [px + ox, py + oy, 0.62], 0.02, M.wood);
      }
      quad(out, [px - 0.3, py - 0.25, 0.6], [px + 0.3, py - 0.25, 0.6],
        [px + 0.3, py + 0.25, 0.68], [px - 0.3, py + 0.25, 0.68], ramp(col || '#c9553f')[1]);
      // Género sobre el mostrador.
      sphere(out, px - 0.1, py, 0.36, 0.06, '#d9b330', { rings: 2, seg: 5 });
      sphere(out, px + 0.08, py + 0.04, 0.36, 0.06, '#c8324a', { rings: 2, seg: 5 });
    }
    barrel(out, s * 0.5, 0.28, M.wood);
    barrel(out, s * 0.62, 0.32, tone(M.wood, 0.1));
  },

  tower(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.12, 0.12, s - 0.12, s - 0.12, M);
    const h = 1.7 * (stage === 1 ? 0.45 : 1);
    roundTower(out, s / 2, s / 2, 0.34, h, M);
    if (stage === 1) return scaffold(out, 0.1, 0.1, s - 0.1, s - 0.1, h * 0.8, M);
    doorX(out, s / 2 + 0.33, s / 2, 0.22, 0.34, M);
    flag(out, s / 2, s / 2, h + 0.2, 0.45, C.main);
  },

  wall(out, s, M, C, stage) {
    const h = (stage === 2 ? 0.85 : stage === 1 ? 0.45 : 0.12);
    slab(out, 0.04, 0.04, s - 0.04, s - 0.04, 0, 0.14, tone(M.wall, -0.12));
    slab(out, 0.08, 0.08, s - 0.08, s - 0.08, 0.14, Math.max(0.02, h - 0.14), M.wall);
    if (stage === 2) {
      for (const [cx, cy] of [[0.22, 0.22], [0.78, 0.22], [0.22, 0.78], [0.78, 0.78], [0.5, 0.5]]) {
        box(out, cx * s, cy * s, h, 0.16, 0.16, 0.14, M.wall, { noshadow: true });
      }
    }
  },

  towncenter(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.2, 0.2, s - 0.2, s - 0.2, M);
    // Basamento escalonado de piedra con escalinata a la cámara.
    slab(out, 0.1, 0.1, s - 0.1, s - 0.1, 0, 0.14, ramp(M.base)[2]);
    slab(out, 0.2, 0.2, s - 0.2, s - 0.2, 0.14, 0.14, ramp(M.base)[1]);
    for (let i = 0; i < 3; i++) {
      slab(out, s - 0.1 - i * 0.12, s * 0.36, s - i * 0.12, s * 0.64, 0, 0.28 - i * 0.09, ramp(M.base)[0]);
    }
    const h = 1.35 * (stage === 1 ? 0.5 : 1);
    if (stage === 1) {
      walls(out, 0.45, 0.45, s - 0.45, s - 0.45, 0.28 + h * 0.6, M);
      return scaffold(out, 0.3, 0.3, s - 0.3, s - 0.3, h, M);
    }
    // Cuerpo principal: piedra abajo, entramado arriba.
    slab(out, 0.5, 0.5, s - 0.5, s - 0.5, 0.28, 0.55, M.stone);
    walls(out, 0.42, 0.42, s - 0.42, s - 0.42, 0.55, M, { plain: false });
    slab(out, 0.42, 0.42, s - 0.42, s - 0.42, 0.83, 0.62, M.wall);
    // Vigas del entramado alto.
    for (let i = 0; i <= 4; i++) {
      const t = 0.42 + (i / 4) * (s - 0.84);
      limb(out, [s - 0.41, t, 0.83], [s - 0.41, t, 1.45], 0.03, M.wood, { noshadow: true });
      limb(out, [t, s - 0.41, 0.83], [t, s - 0.41, 1.45], 0.03, M.wood, { noshadow: true });
    }
    // El gran tejado a cuatro aguas con faldón de bálago.
    hipRoof(out, 0.32, 0.32, s - 0.32, s - 0.32, 1.45, 0.85, M.roof, { courses: 5, overhang: 0.24 });
    // Porche de entrada.
    for (const py of [s * 0.36, s * 0.64]) {
      limb(out, [s - 0.22, py, 0.28], [s - 0.22, py, 1.0], 0.045, M.wood);
    }
    quad(out, [s - 0.5, s * 0.3, 1.05], [s - 0.12, s * 0.3, 0.95], [s - 0.12, s * 0.7, 0.95], [s - 0.5, s * 0.7, 1.05], ramp(M.thatch || M.roof)[1]);
    doorX(out, s - 0.42, s * 0.5, 0.5, 0.66, M);
    flag(out, 0.35, 0.35, 2.3, 0.7, C.main);
    flag(out, s - 0.35, 0.4, 2.0, 0.6, C.main);
  },

  castle(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.3, 0.3, s - 0.3, s - 0.3, M);
    const h = 1.5 * (stage === 1 ? 0.5 : 1);
    const W = tone(M.wall, 0);
    // Lienzo de muralla.
    slab(out, 0.35, 0.35, s - 0.35, s - 0.35, 0, 0.2, tone(M.wall, -0.15));
    slab(out, 0.4, 0.4, s - 0.4, s - 0.4, 0.2, h - 0.2, W);
    if (stage === 1) return scaffold(out, 0.35, 0.35, s - 0.35, s - 0.35, h, M);
    battlements(out, 0.4, 0.4, s - 0.4, s - 0.4, h, M);
    // Torreones en las esquinas.
    for (const [cx, cy] of [[0.42, 0.42], [s - 0.42, 0.42], [0.42, s - 0.42], [s - 0.42, s - 0.42]]) {
      roundTower(out, cx, cy, 0.4, h + 0.85, M);
    }
    // Torre del homenaje.
    slab(out, s * 0.34, s * 0.34, s * 0.66, s * 0.66, h - 0.1, 1.0, tone(W, 0.06));
    battlements(out, s * 0.34, s * 0.34, s * 0.66, s * 0.66, h + 0.9, M);
    // Portón con arco.
    quad(out, [s - 0.395, s * 0.42, 0.02], [s - 0.395, s * 0.58, 0.02],
      [s - 0.395, s * 0.58, 0.75], [s - 0.395, s * 0.42, 0.75], M.door || '#3b2a17', { bias: 0.06, noshadow: true });
    tri(out, [s - 0.395, s * 0.42, 0.75], [s - 0.395, s * 0.58, 0.75], [s - 0.395, s * 0.5, 0.9], M.door || '#3b2a17', { bias: 0.06, noshadow: true });
    slab(out, s - 0.55, s * 0.38, s - 0.35, s * 0.62, h, 0.5, W);
    battlements(out, s - 0.55, s * 0.38, s - 0.35, s * 0.62, h + 0.5, M);
    flag(out, s * 0.5, s * 0.5, h + 1.95, 0.8, C.main);
    for (const [cx, cy] of [[0.42, 0.42], [s - 0.42, 0.42]]) {
      flag(out, cx, cy, h + 1.15, 0.5, C.main);
    }
  },

  siegeworkshop(out, s, M, C, stage) {
    if (stage === 0) return foundation(out, 0.25, 0.25, s - 0.25, s - 0.25, M);
    const h = 1.0 * (stage === 1 ? 0.55 : 1);
    walls(out, 0.25, 0.4, s - 0.25, s - 0.25, h, M);
    if (stage === 1) return scaffold(out, 0.25, 0.25, s - 0.25, s - 0.25, h, M);
    gableRoof(out, 0.25, 0.4, s - 0.25, s - 0.25, h, 0.62, M.roof, M, { courses: 4, axis: 'x' });
    // Portalón abierto de par en par.
    quad(out, [s - 0.245, s * 0.35, 0.02], [s - 0.245, s * 0.75, 0.02],
      [s - 0.245, s * 0.75, 0.7], [s - 0.245, s * 0.35, 0.7], '#241d14', { bias: 0.05, noshadow: true, unlit: true });
    // Un ariete a medio armar en el patio.
    const rx = s * 0.5, ry = 0.22;
    limb(out, [rx - 0.4, ry, 0.25], [rx + 0.4, ry, 0.25], 0.04, M.wood);
    for (const ox of [-0.3, 0.3]) {
      limb(out, [rx + ox, ry - 0.15, 0], [rx + ox, ry, 0.25], 0.03, M.wood);
      limb(out, [rx + ox, ry + 0.15, 0], [rx + ox, ry, 0.25], 0.03, M.wood);
    }
    wheel(out, rx - 0.55, ry, 0.13, 0.13, 0.05, tone(M.wood, -0.25), { axis: 'y', seg: 8 });
    logPile(out, 0.6, s - 0.5, 0.7, 5, M.wood);
    flag(out, 0.45, 0.55, h + 0.62, 0.5, C.main);
  },
};

/**
 * Malla de un edificio en una etapa de obra (0 cimientos, 1 a medias, 2
 * terminado), con los colores del catálogo y el estandarte del jugador.
 */
export function buildingMesh(type, colorIdx, stage) {
  const B = BUILDINGS[type];
  const s = (B && B.size) || 2;
  // Colores de reserva para las piezas del kit que un tipo no define.
  const M = {
    wall: '#d8cba6', wood: '#8a6234', stone: '#9a9a94', roof: '#a8452f',
    door: '#3b2a17', ...look('building', type),
  };
  const C = PLAYER_COLORS[colorIdx] || PLAYER_COLORS[0];
  const out = [];
  srand(type.length * 31 + stage * 7 + 3);
  const build = BUILDERS[type] || BUILDERS.house;
  build(out, s, M, C, stage);
  return out;
}
