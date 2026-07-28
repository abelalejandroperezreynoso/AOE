// Arte procedural: todos los sprites se dibujan con la API de Canvas y se
// cachean en lienzos fuera de pantalla. No hay imágenes externas.

import { TILE_W, TILE_H, PLAYER_COLORS, UNITS, BUILDINGS } from './config.js';
import { shade, mix } from './utils.js';

const HW = TILE_W / 2; // 32
const HH = TILE_H / 2; // 16

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// --- Geometría isométrica ---------------------------------------------------

function iso(x, y, u, v) { return [x + (u - v) * HW, y + (u + v) * HH]; }

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

/** Prisma isométrico: (x,y) es la esquina superior de la huella. */
function isoPrism(ctx, x, y, w, d, h, top, left, right) {
  const p00 = iso(x, y, 0, 0), p10 = iso(x, y, w, 0), p11 = iso(x, y, w, d), p01 = iso(x, y, 0, d);
  const up = (p) => [p[0], p[1] - h];
  poly(ctx, [p01, p11, up(p11), up(p01)], left);           // cara sur-oeste
  poly(ctx, [p11, p10, up(p10), up(p11)], right);          // cara sur-este
  poly(ctx, [up(p00), up(p10), up(p11), up(p01)], top);    // techo plano
  return { p00, p10, p11, p01, up };
}

/** Tejado a dos aguas con la cumbrera a lo largo del eje u. */
function isoRoof(ctx, x, y, w, d, base, rh, c1, c2, c3) {
  const P = (u, v, hh = base) => { const p = iso(x, y, u, v); return [p[0], p[1] - hh]; };
  const r0 = P(0, d / 2, base + rh), r1 = P(w, d / 2, base + rh);
  const ov = 0.12; // alero
  poly(ctx, [P(-ov, -ov), P(w + ov, -ov), r1, r0], c1);                       // faldón trasero
  poly(ctx, [P(-ov, -ov), P(-ov, d + ov), r0], c3);                            // hastial izq.
  poly(ctx, [P(w + ov, -ov), P(w + ov, d + ov), r1], c3);                      // hastial der.
  poly(ctx, [r0, r1, P(w + ov, d + ov), P(-ov, d + ov)], c2);                  // faldón delantero
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
}

function shadowEllipse(ctx, cx, cy, rx, ry, a = 0.26) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}

// --- Terreno ----------------------------------------------------------------

export const TERRAIN_COLORS = {
  grass: '#5b8b3a', grass2: '#4f7d33', grass3: '#679a42',
  dirt: '#93743f', sand: '#c2ad6b', water: '#2f5f9e', shallow: '#3f7cb8', road: '#8a7247',
};

/** Dibuja un rombo de terreno en el lienzo estático del mapa. */
export function drawTerrainTile(ctx, sx, sy, terrain, rnd) {
  let base = TERRAIN_COLORS[terrain] || TERRAIN_COLORS.grass;
  base = shade(base, (rnd - 0.5) * 0.16);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + HW, sy + HH);
  ctx.lineTo(sx, sy + TILE_H);
  ctx.lineTo(sx - HW, sy + HH);
  ctx.closePath();
  ctx.fillStyle = base;
  ctx.fill();

  if (terrain === 'water' || terrain === 'shallow') {
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + rnd * 0.06})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 14, sy + HH + (rnd - 0.5) * 6);
    ctx.quadraticCurveTo(sx, sy + HH + 4 + (rnd - 0.5) * 6, sx + 14, sy + HH + (rnd - 0.5) * 6);
    ctx.stroke();
  } else if (terrain !== 'road') {
    // Mata de hierba / motas de tierra.
    const n = 2 + Math.floor(rnd * 3);
    for (let i = 0; i < n; i++) {
      const a = (rnd * 97 + i * 53) % 1, b = (rnd * 41 + i * 29) % 1;
      const px = sx + (a - 0.5) * 40, py = sy + HH + (b - 0.5) * 16;
      ctx.fillStyle = terrain === 'sand' || terrain === 'dirt'
        ? `rgba(0,0,0,.10)` : `rgba(${30 + a * 40 | 0},${90 + b * 60 | 0},30,.30)`;
      ctx.fillRect(px, py, 2, terrain === 'sand' || terrain === 'dirt' ? 1 : 2);
    }
  }
}

// --- Sprites de recursos ----------------------------------------------------

const resCache = new Map();

export function resourceSprite(kind, variant = 0, depleted = false) {
  const key = `${kind}|${variant}|${depleted ? 1 : 0}`;
  let s = resCache.get(key);
  if (s) return s;
  const c = makeCanvas(80, 96);
  const ctx = c.getContext('2d');
  const ox = 40, oy = 74; // punto de anclaje (centro del rombo del tile)
  const r = (n) => ((Math.sin(variant * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;

  switch (kind) {
    case 'tree': {
      shadowEllipse(ctx, ox + 3, oy + 3, 15, 7);
      const th = 16 + r(1) * 8;
      ctx.fillStyle = '#5a4028';
      ctx.fillRect(ox - 3, oy - th, 6, th);
      ctx.fillStyle = '#41301e';
      ctx.fillRect(ox + 1, oy - th, 2, th);
      const leaf = ['#2f6b2c', '#357a30', '#28602a'][variant % 3];
      const blobs = [[0, -th - 12, 17], [-11, -th - 4, 12], [11, -th - 5, 12], [-4, -th - 22, 12], [6, -th - 20, 11]];
      for (const [bx, by, br] of blobs) {
        ctx.beginPath();
        ctx.ellipse(ox + bx, oy + by, br, br * 0.86, 0, 0, Math.PI * 2);
        ctx.fillStyle = shade(leaf, (r(bx + 2) - 0.45) * 0.3);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(ox - 6, oy - th - 18, 7, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fill();
      break;
    }
    case 'stump': {
      shadowEllipse(ctx, ox + 2, oy + 2, 9, 4);
      ctx.fillStyle = '#5a4028';
      ctx.fillRect(ox - 4, oy - 7, 8, 7);
      ctx.beginPath(); ctx.ellipse(ox, oy - 7, 4, 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#8a6a45'; ctx.fill();
      break;
    }
    case 'gold': case 'stone': {
      const isGold = kind === 'gold';
      shadowEllipse(ctx, ox + 2, oy + 2, 17, 8);
      const rock = isGold ? '#8d7a4e' : '#8c8f95';
      const hi = isGold ? '#ffd24a' : '#d6dae0';
      const parts = depleted ? [[0, 0, 10, 7]] : [[-8, 0, 12, 9], [8, -2, 11, 8], [0, -8, 13, 10]];
      for (const [px, py, pw, ph] of parts) {
        poly(ctx, [
          [ox + px - pw, oy + py - 2], [ox + px - pw * 0.4, oy + py - ph],
          [ox + px + pw * 0.5, oy + py - ph * 0.9], [ox + px + pw, oy + py - 1],
          [ox + px + pw * 0.3, oy + py + 3], [ox + px - pw * 0.5, oy + py + 2],
        ], shade(rock, -0.06 + r(px) * 0.2), 'rgba(0,0,0,.18)');
        ctx.fillStyle = hi;
        for (let i = 0; i < (isGold ? 4 : 2); i++) {
          const a = r(px + i * 3), b = r(px + i * 7);
          ctx.globalAlpha = isGold ? 0.95 : 0.5;
          ctx.beginPath();
          ctx.ellipse(ox + px + (a - 0.5) * pw, oy + py - ph * 0.5 + (b - 0.5) * 5, 2, 1.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      break;
    }
    case 'berries': {
      shadowEllipse(ctx, ox + 2, oy + 2, 14, 6);
      for (let i = 0; i < 3; i++) {
        const bx = ox + (i - 1) * 9, by = oy - 4 - (i === 1 ? 4 : 0);
        ctx.beginPath(); ctx.ellipse(bx, by, 9, 8, 0, 0, Math.PI * 2);
        ctx.fillStyle = shade('#2e6b35', (r(i) - 0.5) * 0.25); ctx.fill();
        if (!depleted) {
          for (let k = 0; k < 5; k++) {
            ctx.beginPath();
            ctx.arc(bx + (r(i * 5 + k) - 0.5) * 12, by + (r(i * 3 + k) - 0.5) * 10, 1.8, 0, Math.PI * 2);
            ctx.fillStyle = '#c8324a'; ctx.fill();
          }
        }
      }
      break;
    }
    case 'sheep': case 'deer': {
      const deer = kind === 'deer';
      shadowEllipse(ctx, ox + 2, oy + 2, 12, 5);
      const body = deer ? '#a9723f' : '#efe9dc';
      ctx.fillStyle = '#6b6257';
      ctx.fillRect(ox - 7, oy - 8, 2.5, 8); ctx.fillRect(ox + 5, oy - 8, 2.5, 8);
      ctx.beginPath(); ctx.ellipse(ox, oy - 12, 11, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = body; ctx.fill();
      ctx.beginPath(); ctx.ellipse(ox - 11, oy - 17, 5, 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = deer ? '#8f5f34' : '#3b3a38'; ctx.fill();
      if (deer) {
        ctx.strokeStyle = '#5e4326'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(ox - 12, oy - 21); ctx.lineTo(ox - 15, oy - 27); ctx.moveTo(ox - 13, oy - 24); ctx.lineTo(ox - 17, oy - 24);
        ctx.moveTo(ox - 9, oy - 21); ctx.lineTo(ox - 7, oy - 27); ctx.moveTo(ox - 8, oy - 24); ctx.lineTo(ox - 4, oy - 25);
        ctx.stroke();
      }
      break;
    }
  }
  s = { canvas: c, ox, oy };
  resCache.set(key, s);
  return s;
}

// --- Sprites de unidades ----------------------------------------------------

const unitCache = new Map();
const UW = 48, UH = 60, UOX = 24, UOY = 48;

function limb(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

/**
 * Dibuja una figura humanoide. f=0..3 ciclo de marcha, 4/5 ataque.
 * dir=1 mira a la derecha, dir=-1 a la izquierda. back=true de espaldas.
 */
function humanoid(ctx, o) {
  const { tunic, trim, skin, helm, f, back } = o;
  const walk = f < 4 ? Math.sin((f / 4) * Math.PI * 2) : 0;
  const cx = 0, ground = 0;
  const bob = f < 4 ? Math.abs(walk) * -1.2 : 0;
  const hipY = ground - 13 + bob;
  const shoulderY = ground - 24 + bob;

  // Piernas
  limb(ctx, cx - 1, hipY, cx - 2 + walk * 4, ground, 4, '#3e3a33');
  limb(ctx, cx + 1, hipY, cx + 2 - walk * 4, ground, 4, '#4a453c');
  // Torso
  ctx.fillStyle = tunic;
  ctx.beginPath();
  ctx.moveTo(cx - 5, hipY + 1); ctx.lineTo(cx - 5.5, shoulderY);
  ctx.lineTo(cx + 5.5, shoulderY); ctx.lineTo(cx + 5, hipY + 1);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = trim;
  ctx.fillRect(cx - 5, hipY - 2, 10, 2.5);
  // Cabeza
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(cx + 0.5, shoulderY - 5, 4.4, 0, Math.PI * 2); ctx.fill();
  if (!back) {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(cx + 2, shoulderY - 6.5, 1.2, 1.2);
  }
  if (helm) {
    ctx.fillStyle = helm;
    ctx.beginPath();
    ctx.arc(cx + 0.5, shoulderY - 5.5, 4.9, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(cx - 4.4, shoulderY - 6, 9.4, 1.8);
  }
  return { hipY, shoulderY, cx, ground, walk };
}

function drawUnit(ctx, type, colorIdx, f, back) {
  const col = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
  const tunic = col.main, trim = col.dark, skin = '#d9a878';
  const atk = f >= 4;
  const swing = f === 5 ? 1 : f === 4 ? -0.5 : 0;
  shadowEllipse(ctx, 1, 2, 9, 4.5);

  const mounted = UNITS[type] && UNITS[type].class === 'cavalry';
  if (UNITS[type] && UNITS[type].class === 'siege') { drawSiege(ctx, type, col, f); return; }

  if (mounted) {
    ctx.save();
    ctx.translate(0, -9);
    // Caballo
    const horse = type === 'scout' ? '#8a6a4a' : '#4a3f38';
    const gallop = Math.sin((f / 4) * Math.PI * 2);
    limb(ctx, -6, 0, -8 + gallop * 3, 9, 3, shade(horse, -0.25));
    limb(ctx, 7, 0, 9 - gallop * 3, 9, 3, shade(horse, -0.25));
    limb(ctx, -4, 0, -3 - gallop * 3, 9, 3, horse);
    limb(ctx, 6, 0, 7 + gallop * 3, 9, 3, horse);
    ctx.fillStyle = horse;
    ctx.beginPath(); ctx.ellipse(1, -2, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(horse, 0.1);
    ctx.beginPath(); ctx.ellipse(11, -8, 4.5, 4, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(horse, -0.3);
    ctx.fillRect(13, -12, 1.8, 3); ctx.fillRect(10, -12, 1.8, 3);
    limb(ctx, -10, -4, -14, 2, 3, shade(horse, -0.2)); // cola
    if (type !== 'scout') { ctx.fillStyle = col.main; ctx.fillRect(-6, -6, 12, 7); }
    ctx.restore();
  }

  ctx.save();
  if (mounted) ctx.translate(0, -20);
  const h = humanoid(ctx, { tunic, trim, skin, helm: type === 'villager' ? null : shade('#b9bcc4', -0.1), f, back });

  const armY = h.shoulderY + 2;
  switch (type) {
    case 'villager': {
      limb(ctx, 3, armY, 8, armY + 6 - (atk ? swing * 8 : 0), 3.2, skin);
      limb(ctx, -3, armY, -7, armY + 7, 3.2, skin);
      // Hacha / herramienta
      ctx.save();
      ctx.translate(8, armY + 6);
      ctx.rotate(atk ? -0.9 + swing * 1.4 : 0.5);
      ctx.fillStyle = '#6b4d2c'; ctx.fillRect(-1, -10, 2, 13);
      ctx.fillStyle = '#b9bcc4'; ctx.fillRect(-3.5, -12, 7, 4);
      ctx.restore();
      break;
    }
    case 'militia': case 'manatarms': case 'longswordsman': case 'champion': {
      limb(ctx, -4, armY, -8, armY + 6, 3.4, skin);
      // Escudo
      ctx.fillStyle = col.main; ctx.strokeStyle = shade(col.dark, -0.2); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(-8, armY + 4, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const sx = 5, sy = armY + 3;
      limb(ctx, 3, armY, sx, sy, 3.4, skin);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(atk ? -1.9 + swing * 2.3 : -0.35);
      const swLen = type === 'militia' ? 11 : type === 'champion' ? 17 : 14;
      ctx.fillStyle = '#3a2c1c'; ctx.fillRect(-1.2, -2, 2.4, 5);
      ctx.fillStyle = '#c9ccd4'; ctx.fillRect(-1.4, -swLen, 2.8, swLen);
      ctx.fillStyle = '#8c6b3a'; ctx.fillRect(-4, -3, 8, 2);
      ctx.restore();
      break;
    }
    case 'spearman': case 'pikeman': {
      limb(ctx, -4, armY, -8, armY + 6, 3.4, skin);
      limb(ctx, 3, armY, 6, armY + 2, 3.4, skin);
      ctx.save();
      ctx.translate(6, armY + 2);
      ctx.rotate(atk ? -1.2 + swing * 0.5 : -0.55);
      const len = type === 'pikeman' ? 30 : 25;
      ctx.fillStyle = '#7a5c33'; ctx.fillRect(-1.1, -len * 0.75, 2.2, len);
      ctx.fillStyle = '#d2d6de';
      ctx.beginPath();
      ctx.moveTo(0, -len * 0.75 - 7); ctx.lineTo(3, -len * 0.75); ctx.lineTo(-3, -len * 0.75);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      break;
    }
    case 'archer': case 'crossbowman': case 'arbalester': case 'skirmisher': {
      const draw = atk ? (f === 5 ? 1 : 0.55) : 0;
      limb(ctx, -3, armY, 7, armY - 1, 3.2, skin);
      limb(ctx, 3, armY, 2 - draw * 5, armY + 1, 3.2, skin);
      ctx.save();
      ctx.translate(8, armY - 1);
      if (type === 'skirmisher') {
        ctx.rotate(atk ? -1.4 + draw * 0.8 : -0.4);
        ctx.fillStyle = '#7a5c33'; ctx.fillRect(-0.9, -14, 1.8, 18);
        ctx.fillStyle = '#d2d6de';
        ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(2.4, -14); ctx.lineTo(-2.4, -14); ctx.closePath(); ctx.fill();
      } else if (type === 'archer') {
        ctx.strokeStyle = '#7a4f28'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 9, -1.25, 1.25); ctx.stroke();
        ctx.strokeStyle = '#e8e4d8'; ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(2.9, -8.6); ctx.lineTo(-draw * 6, 0); ctx.lineTo(2.9, 8.6); ctx.stroke();
      } else {
        ctx.fillStyle = '#5e4526'; ctx.fillRect(-6, -1.6, 14, 3.2);
        ctx.fillStyle = '#8d8f96'; ctx.fillRect(2, -7, 2.4, 14);
      }
      ctx.restore();
      // Carcaj
      ctx.fillStyle = '#6b4d2c'; ctx.fillRect(-6, h.shoulderY, 3.5, 9);
      break;
    }
    default:
      limb(ctx, -4, armY, -8, armY + 6, 3.2, skin);
      limb(ctx, 4, armY, 8, armY + 6, 3.2, skin);
  }
  ctx.restore();
}

function drawSiege(ctx, type, col, f) {
  const recoil = f >= 4 ? (f === 5 ? -3 : 2) : 0;
  if (type === 'ram') {
    ctx.fillStyle = '#5e4426';
    poly(ctx, [[-16, -6], [16, -6], [13, -16], [-13, -16]], '#6b4f2c');
    poly(ctx, [[-13, -16], [13, -16], [10, -22], [-10, -22]], '#7d5c33');
    ctx.fillStyle = '#3f2f1c';
    ctx.fillRect(-18 + recoil, -12, 30, 5);
    ctx.fillStyle = '#8d8f96';
    ctx.fillRect(10 + recoil, -13.5, 7, 8);
    for (const wx of [-11, 0, 11]) {
      ctx.beginPath(); ctx.arc(wx, -3, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#4a3720'; ctx.fill();
      ctx.strokeStyle = '#2c2013'; ctx.lineWidth = 1.4; ctx.stroke();
    }
  } else {
    // Manganel / trabuquete
    ctx.fillStyle = '#5e4426';
    poly(ctx, [[-16, -4], [16, -4], [14, -10], [-14, -10]], '#6b4f2c');
    for (const wx of [-10, 10]) {
      ctx.beginPath(); ctx.arc(wx, -3, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#4a3720'; ctx.fill();
      ctx.strokeStyle = '#2c2013'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    const tall = type === 'trebuchet';
    ctx.strokeStyle = '#7d5c33'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, -10); ctx.lineTo(0, tall ? -34 : -22);
    ctx.moveTo(6, -10); ctx.lineTo(0, tall ? -34 : -22); ctx.stroke();
    ctx.save();
    ctx.translate(0, tall ? -32 : -20);
    ctx.rotate(f >= 4 ? (f === 5 ? -1.9 : -0.2) : -0.9);
    ctx.strokeStyle = '#6b4f2c'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(12, 0); ctx.stroke();
    ctx.fillStyle = '#4a3720';
    ctx.beginPath(); ctx.arc(13, 0, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = col.main;
    ctx.fillRect(-3, -14, 6, 4);
  }
}

export function unitSprite(type, colorIdx, dir, f, back = false) {
  const key = `${type}|${colorIdx}|${dir}|${f}|${back ? 1 : 0}`;
  let s = unitCache.get(key);
  if (s) return s;
  const c = makeCanvas(UW, UH);
  const ctx = c.getContext('2d');
  ctx.translate(UOX, UOY);
  if (dir < 0) ctx.scale(-1, 1);
  drawUnit(ctx, type, colorIdx, f, back);
  s = { canvas: c, ox: UOX, oy: UOY };
  unitCache.set(key, s);
  return s;
}

// --- Sprites de edificios ---------------------------------------------------

const buildCache = new Map();

function bannerPole(ctx, x, y, h, col) {
  ctx.strokeStyle = '#5b4a2f'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
  ctx.fillStyle = col.main;
  ctx.beginPath();
  ctx.moveTo(x, y - h); ctx.lineTo(x + 9, y - h + 3); ctx.lineTo(x, y - h + 7);
  ctx.closePath(); ctx.fill();
}

/** Sillares: hiladas horizontales con juntas verticales alternas. */
function stoneTexture(ctx, x, y, w, d, h) {
  const p1 = iso(x, y, 0, d), p2 = iso(x, y, w, d), p3 = iso(x, y, w, 0);
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  const rows = Math.floor(h / 8);
  for (let i = 1; i <= rows; i++) {
    const yy = -i * 8;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1] + yy); ctx.lineTo(p2[0], p2[1] + yy); ctx.lineTo(p3[0], p3[1] + yy);
    ctx.stroke();
    // Juntas verticales, desplazadas en filas alternas.
    for (let k = 0; k <= 2; k++) {
      const t = (k + (i % 2) * 0.5) / 2.5;
      const a = [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
      const b = [p2[0] + (p3[0] - p2[0]) * t, p2[1] + (p3[1] - p2[1]) * t];
      for (const pt of [a, b]) {
        ctx.beginPath();
        ctx.moveTo(pt[0], pt[1] + yy); ctx.lineTo(pt[0], pt[1] + yy + 8);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Almenas sobre el borde superior de una huella cuadrada. */
function battlements(ctx, x, y, w, d, h, top, left, right) {
  const n = Math.max(2, Math.round(w * 2));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.15) * (w / n);
    const p = iso(x, y, u, d);
    isoPrism(ctx, p[0], p[1] - h, w / n * 0.6, 0.28, 7, top, left, right);
  }
  for (let i = 0; i < n; i++) {
    const v = (i + 0.15) * (d / n);
    const p = iso(x, y, w, v);
    isoPrism(ctx, p[0], p[1] - h, 0.28, d / n * 0.6, 7, top, left, right);
  }
}

function drawBuilding(ctx, type, colorIdx, x, y) {
  const col = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
  const B = BUILDINGS[type];
  const s = B.size;
  const wood = '#8a6234', woodD = '#66492a', woodL = '#a37b45';
  const plaster = '#d8cba6', plasterD = '#b6a887', plasterL = '#eee2c1';
  const stone = '#9a9a94', stoneD = '#70706c', stoneL = '#bcbcb4';
  const roofA = '#a8452f', roofB = '#8a3423', roofC = '#c2543a';

  switch (type) {
    case 'house': {
      isoPrism(ctx, x, y, s * 0.82, s * 0.82, 16, plasterL, plasterD, plaster);
      isoRoof(ctx, x, y, s * 0.82, s * 0.82, 16, 15, roofB, roofA, roofC);
      const d = iso(x, y, s * 0.55, s * 0.82);
      ctx.fillStyle = '#4d3620'; ctx.fillRect(d[0] - 4, d[1] - 15, 8, 12);
      bannerPole(ctx, x - s * 0.82 * HW + 4, y + s * 0.82 * HH - 2, 20, col);
      break;
    }
    case 'towncenter': {
      // Plataforma de piedra, sala central y pórtico con pilares de madera.
      isoPrism(ctx, x, y, s, s, 7, '#cdb887', '#8e7a4f', '#ab9668');
      // Cuerpo del edificio, algo más pequeño que la huella.
      const inner = iso(x, y, 0.55, 0.55);
      isoPrism(ctx, inner[0], inner[1] - 7, s - 1.1, s - 1.1, 22, plasterL, plasterD, plaster);
      // Pilares en las cuatro esquinas del pórtico.
      for (const [u, v] of [[0.1, 0.1], [s - 0.7, 0.1], [0.1, s - 0.7], [s - 0.7, s - 0.7]]) {
        const p = iso(x, y, u, v);
        isoPrism(ctx, p[0], p[1] - 7, 0.6, 0.6, 30, woodL, woodD, wood);
      }
      // Tejado bajo y ancho, muy distinto al de una casa.
      ctx.save();
      ctx.translate(0, -37);
      isoRoof(ctx, x, y, s, s, 0, 15, '#7d3a2a', '#96442f', '#a85a3d');
      ctx.restore();
      // Portalón.
      const door = iso(x, y, s / 2, s - 0.55);
      ctx.fillStyle = '#3b2a17';
      ctx.beginPath();
      ctx.moveTo(door[0] - 7, door[1] - 7); ctx.lineTo(door[0] - 7, door[1] - 20);
      ctx.quadraticCurveTo(door[0], door[1] - 28, door[0] + 7, door[1] - 20);
      ctx.lineTo(door[0] + 7, door[1] - 7); ctx.closePath(); ctx.fill();
      bannerPole(ctx, x - s * HW + 10, y + s * HH - 8, 26, col);
      bannerPole(ctx, x + s * HW - 10, y + s * HH - 8, 26, col);
      break;
    }
    case 'mill': {
      isoPrism(ctx, x + 2, y, s * 0.7, s * 0.7, 20, plasterL, plasterD, plaster);
      isoRoof(ctx, x + 2, y, s * 0.7, s * 0.7, 20, 12, roofB, roofA, roofC);
      // Aspas, sujetas al hastial delantero.
      const c0 = iso(x + 2, y, s * 0.35, s * 0.72);
      ctx.save();
      ctx.translate(c0[0], c0[1] - 30);
      ctx.strokeStyle = '#6b4f2c'; ctx.lineWidth = 2.4;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15); ctx.stroke();
        ctx.fillStyle = 'rgba(235,228,200,.75)';
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 10, Math.sin(a) * 10, 5, 2.4, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      break;
    }
    case 'lumbercamp': case 'miningcamp': {
      isoPrism(ctx, x + 3, y + 2, s * 0.55, s * 0.55, 12, woodL, woodD, wood);
      isoRoof(ctx, x + 3, y + 2, s * 0.55, s * 0.55, 12, 8, '#6d5a3c', '#5a4a31', '#7d6947');
      if (type === 'lumbercamp') {
        for (let i = 0; i < 3; i++) {
          const p = iso(x, y, 1.2 + i * 0.2, 1.5);
          ctx.fillStyle = i % 2 ? '#7d5c33' : '#8f6a3c';
          ctx.fillRect(p[0] - 12, p[1] - 6 - i * 4, 24, 5);
          ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.strokeRect(p[0] - 12, p[1] - 6 - i * 4, 24, 5);
        }
      } else {
        const p = iso(x, y, 1.3, 1.4);
        for (const [dx, dy, r] of [[-8, 0, 6], [4, -3, 7], [10, 2, 5]]) {
          ctx.beginPath(); ctx.ellipse(p[0] + dx, p[1] + dy, r, r * 0.75, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#8c8f95'; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.stroke();
        }
      }
      bannerPole(ctx, x - s * 0.4 * HW, y + s * 0.5 * HH, 16, col);
      break;
    }
    case 'farm': {
      const p00 = iso(x, y, 0, 0), p10 = iso(x, y, s, 0), p11 = iso(x, y, s, s), p01 = iso(x, y, 0, s);
      poly(ctx, [p00, p10, p11, p01], '#8a6a3c', '#6d5330');
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p00[0], p00[1]); ctx.lineTo(p10[0], p10[1]); ctx.lineTo(p11[0], p11[1]); ctx.lineTo(p01[0], p01[1]);
      ctx.closePath(); ctx.clip();
      for (let i = 0; i <= 8; i++) {
        const a = iso(x, y, (i / 8) * s, 0), b = iso(x, y, (i / 8) * s, s);
        ctx.strokeStyle = i % 2 ? '#a8c24a' : '#7a9a34';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = '#5b4426'; ctx.lineWidth = 1.5;
      poly(ctx, [p00, p10, p11, p01], null, '#5b4426');
      break;
    }
    case 'barracks': case 'archeryrange': case 'stable': case 'siegeworkshop': {
      // Cada edificio militar lleva su propio color de tejado para reconocerlo de un vistazo.
      const roofs = {
        barracks: ['#5f2c21', '#7a3a2c', '#8f4a37'],
        archeryrange: ['#39522c', '#4a6b3a', '#5c8047'],
        stable: ['#5a4a31', '#6d5a3c', '#7d6947'],
        siegeworkshop: ['#3d424b', '#4f5560', '#616875'],
      }[type];
      isoPrism(ctx, x + 2, y + 1, s - 0.5, s - 0.5, 22, plasterL, plasterD, plaster);
      isoRoof(ctx, x + 2, y + 1, s - 0.5, s - 0.5, 22, 14, roofs[0], roofs[1], roofs[2]);
      const front = iso(x + 2, y + 1, (s - 0.5) / 2, s - 0.5);
      ctx.fillStyle = '#4d3620';
      ctx.fillRect(front[0] - 6, front[1] - 20, 12, 17);
      // Emblema según el edificio
      ctx.save();
      ctx.translate(front[0], front[1] - 30);
      ctx.strokeStyle = '#d8d8d0'; ctx.lineWidth = 2;
      if (type === 'barracks') {
        ctx.beginPath(); ctx.moveTo(-5, 5); ctx.lineTo(5, -6); ctx.moveTo(5, 5); ctx.lineTo(-5, -6); ctx.stroke();
      } else if (type === 'archeryrange') {
        ctx.beginPath(); ctx.arc(-1, 0, 6, -1.2, 1.2); ctx.moveTo(-3, -6); ctx.lineTo(-3, 6); ctx.stroke();
      } else if (type === 'stable') {
        ctx.beginPath(); ctx.arc(0, 0, 5, 0.4, 5.4); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(-6, 5); ctx.lineTo(6, -5); ctx.moveTo(2, -6); ctx.lineTo(7, -1); ctx.stroke();
      }
      ctx.restore();
      bannerPole(ctx, x - (s - 0.5) * HW + 6, y + (s - 0.5) * HH, 22, col);
      break;
    }
    case 'blacksmith': {
      isoPrism(ctx, x + 2, y + 1, s * 0.8, s * 0.8, 18, stoneL, stoneD, stone);
      isoRoof(ctx, x + 2, y + 1, s * 0.8, s * 0.8, 18, 10, '#54483a', '#43392e', '#635546');
      const ch = iso(x + 2, y + 1, s * 0.15, s * 0.15);
      isoPrism(ctx, ch[0], ch[1] - 20, 0.35, 0.35, 18, '#6d6d68', '#4c4c48', '#5c5c58');
      ctx.fillStyle = 'rgba(210,210,210,.35)';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(ch[0] + i * 2 - 2, ch[1] - 44 - i * 8, 4 + i * 2, 0, Math.PI * 2); ctx.fill();
      }
      const f2 = iso(x + 2, y + 1, s * 0.4, s * 0.8);
      ctx.fillStyle = '#ff9a3c';
      ctx.fillRect(f2[0] - 4, f2[1] - 12, 8, 8);
      bannerPole(ctx, x - s * 0.5 * HW, y + s * 0.5 * HH, 18, col);
      break;
    }
    case 'market': {
      // Plaza empedrada con puestos de distintos colores.
      isoPrism(ctx, x, y, s, s, 3, '#b3a37e', '#7d7052', '#948763');
      const stalls = [[0.5, 0.4, '#c9553f'], [1.9, 0.6, '#3f7fa8'], [0.7, 1.9, '#c9a13f'], [2.0, 2.0, '#6b8f4a']];
      for (const [u, v, tone] of stalls) {
        const p = iso(x, y, u, v);
        const py = p[1] - 3;
        // Mostrador
        ctx.fillStyle = '#8a6a3c';
        poly(ctx, [[p[0] - 13, py - 2], [p[0], py + 5], [p[0] + 13, py - 2], [p[0], py - 9]], '#8a6a3c', '#5b4426');
        // Postes y toldo
        ctx.fillStyle = '#6b4f2c';
        ctx.fillRect(p[0] - 12, py - 16, 2, 14); ctx.fillRect(p[0] + 10, py - 16, 2, 14);
        poly(ctx, [[p[0] - 15, py - 16], [p[0], py - 22], [p[0] + 15, py - 16], [p[0], py - 11]], tone, 'rgba(0,0,0,.25)');
        // Género sobre el mostrador
        ctx.fillStyle = shade(tone, 0.25);
        ctx.beginPath(); ctx.arc(p[0] - 3, py - 5, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(p[0] + 3, py - 6, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      bannerPole(ctx, x - s * HW + 8, y + s * HH - 6, 22, col);
      break;
    }
    case 'tower': {
      const H = 52;
      // Zócalo ligeramente más ancho que el fuste.
      isoPrism(ctx, x, y, 1, 1, 8, stoneL, stoneD, stone);
      const shaft = iso(x, y, 0.1, 0.1);
      isoPrism(ctx, shaft[0], shaft[1] - 8, 0.8, 0.8, H, stoneL, stoneD, stone);
      stoneTexture(ctx, shaft[0], shaft[1] - 8, 0.8, 0.8, H);
      // Saledizo y almenas.
      const topY = 8 + H;
      isoPrism(ctx, x, y - topY, 1, 1, 6, shade(stoneL, 0.05), stoneD, stone);
      battlements(ctx, x, y - topY - 6, 1, 1, 0, shade(stoneL, 0.08), stoneD, stone);
      // Aspillera y puerta.
      const face = iso(x, y, 0.5, 1);
      ctx.fillStyle = '#2b2118';
      ctx.fillRect(face[0] - 2, face[1] - topY + 6, 4, 9);
      ctx.fillStyle = '#3b2a17';
      ctx.fillRect(face[0] - 4, face[1] - 12, 8, 10);
      ctx.fillStyle = col.main;
      ctx.fillRect(face[0] - 3.5, face[1] - topY - 4, 7, 7);
      break;
    }
    case 'castle': {
      isoPrism(ctx, x + 0.1 * HW, y + 0.2 * HH, s - 0.2, s - 0.2, 36, stoneL, stoneD, stone);
      stoneTexture(ctx, x + 0.1 * HW, y + 0.2 * HH, s - 0.2, s - 0.2, 36);
      ctx.save(); ctx.translate(0, -36);
      isoPrism(ctx, x + 0.1 * HW, y + 0.2 * HH, s - 0.2, s - 0.2, 7, shade(stoneL, 0.06), stoneD, stone);
      ctx.restore();
      // Torreones en las cuatro esquinas
      const corners = [[0, 0], [s - 1.1, 0], [0, s - 1.1], [s - 1.1, s - 1.1]];
      for (const [u, v] of corners) {
        const p = iso(x, y, u, v);
        isoPrism(ctx, p[0], p[1], 1.1, 1.1, 56, stoneL, stoneD, stone);
        ctx.save(); ctx.translate(0, -56);
        isoPrism(ctx, p[0] - 0.08 * HW, p[1], 1.25, 1.25, 7, shade(stoneL, 0.08), stoneD, stone);
        ctx.restore();
      }
      const gate = iso(x, y, s / 2, s - 0.2);
      ctx.fillStyle = '#3b2a17';
      ctx.beginPath();
      ctx.moveTo(gate[0] - 7, gate[1] - 4); ctx.lineTo(gate[0] - 7, gate[1] - 18);
      ctx.quadraticCurveTo(gate[0], gate[1] - 26, gate[0] + 7, gate[1] - 18);
      ctx.lineTo(gate[0] + 7, gate[1] - 4); ctx.closePath(); ctx.fill();
      bannerPole(ctx, iso(x, y, 0, s - 1.1)[0] - 2, iso(x, y, 0, s - 1.1)[1] - 56, 26, col);
      bannerPole(ctx, iso(x, y, s - 1.1, 0)[0] + 2, iso(x, y, s - 1.1, 0)[1] - 56, 26, col);
      break;
    }
    case 'wall': {
      isoPrism(ctx, x, y, 1, 1, 26, stoneL, stoneD, stone);
      stoneTexture(ctx, x, y, 1, 1, 26);
      isoPrism(ctx, x, y - 26, 1, 1, 4, shade(stoneL, 0.06), stoneD, stone);
      battlements(ctx, x, y - 30, 1, 1, 0, shade(stoneL, 0.1), stoneD, stone);
      break;
    }
    default:
      isoPrism(ctx, x, y, s, s, 20, plasterL, plasterD, plaster);
  }
}

/** stage: 0 cimientos, 1 a medio construir, 2 terminado. */
export function buildingSprite(type, colorIdx, stage = 2) {
  const key = `${type}|${colorIdx}|${stage}`;
  let s = buildCache.get(key);
  if (s) return s;
  const B = BUILDINGS[type];
  const size = B.size;
  const pad = 14;
  const topH = type === 'castle' ? 96 : type === 'tower' ? 62 : type === 'towncenter' ? 74 : 52;
  const w = size * TILE_W + pad * 2;
  const h = pad + topH + size * TILE_H + pad;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const ox = size * HW + pad, oy = pad + topH;

  if (stage === 0) {
    // Cimientos: estacas y una plataforma de tierra.
    const p00 = iso(ox, oy, 0, 0), p10 = iso(ox, oy, size, 0), p11 = iso(ox, oy, size, size), p01 = iso(ox, oy, 0, size);
    poly(ctx, [p00, p10, p11, p01], 'rgba(120,96,60,.55)', 'rgba(80,60,34,.9)');
    ctx.setLineDash([4, 3]);
    poly(ctx, [p00, p10, p11, p01], null, 'rgba(255,240,200,.5)');
    ctx.setLineDash([]);
    for (const [u, v] of [[0, 0], [size, 0], [size, size], [0, size]]) {
      const p = iso(ox, oy, u, v);
      ctx.fillStyle = '#7a5c33';
      ctx.fillRect(p[0] - 1.5, p[1] - 10, 3, 10);
    }
  } else if (stage === 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, oy - topH * 0.45, w, h);
    ctx.clip();
    ctx.globalAlpha = 0.92;
    drawBuilding(ctx, type, colorIdx, ox, oy);
    ctx.restore();
    // Andamios
    ctx.strokeStyle = '#8a6a3c'; ctx.lineWidth = 2;
    for (const [u, v] of [[0.1, 0.1], [size - 0.1, 0.1], [0.1, size - 0.1], [size - 0.1, size - 0.1]]) {
      const p = iso(ox, oy, u, v);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - topH * 0.5); ctx.stroke();
    }
  } else {
    drawBuilding(ctx, type, colorIdx, ox, oy);
  }
  s = { canvas: c, ox, oy };
  buildCache.set(key, s);
  return s;
}

// --- Iconos para la interfaz ------------------------------------------------

const iconCache = new Map();

/** Emblemas vectoriales para las tecnologías y los avances de edad. */
function techGlyph(ctx, sym) {
  ctx.save();
  ctx.translate(28, 28);
  ctx.strokeStyle = '#2e2413';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const metal = '#e8e4da', metalD = '#9a978f', woodC = '#8a6234';
  switch (sym) {
    case 'sword':
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(0, -17); ctx.lineTo(4, -11); ctx.lineTo(4, 6); ctx.lineTo(-4, 6); ctx.lineTo(-4, -11);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = woodC;
      ctx.fillRect(-10, 6, 20, 4);
      ctx.fillRect(-2.5, 10, 5, 8);
      ctx.strokeRect(-10, 6, 20, 4);
      break;
    case 'armor':
      ctx.fillStyle = '#b9bcc4';
      ctx.beginPath();
      ctx.moveTo(0, -17); ctx.lineTo(15, -11); ctx.lineTo(13, 6);
      ctx.quadraticCurveTo(6, 15, 0, 18);
      ctx.quadraticCurveTo(-6, 15, -13, 6); ctx.lineTo(-15, -11);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#6b7078'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -14); ctx.lineTo(0, 15); ctx.moveTo(-12, -3); ctx.lineTo(12, -3);
      ctx.stroke();
      break;
    case 'arrow':
      ctx.strokeStyle = '#7a4f28'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-13, 13); ctx.lineTo(9, -9); ctx.stroke();
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(16, -16); ctx.lineTo(6, -12); ctx.lineTo(12, -6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e8e4d8'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-13, 13); ctx.lineTo(-6, 15); ctx.moveTo(-13, 13); ctx.lineTo(-15, 6);
      ctx.stroke();
      break;
    case 'cart':
      ctx.fillStyle = woodC;
      ctx.fillRect(-14, -10, 22, 11);
      ctx.strokeRect(-14, -10, 22, 11);
      ctx.beginPath(); ctx.arc(-6, 7, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#5a4028'; ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#2e2413';
      ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(16, -9); ctx.stroke();
      break;
    case 'loom':
      ctx.fillStyle = '#d8cba6';
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 13, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#a8905c'; ctx.lineWidth = 1.5;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, 11 - Math.abs(i) * 3, 13, 0.3 + i * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'tower':
      ctx.fillStyle = '#b0b0a8';
      ctx.fillRect(-11, -8, 22, 24);
      ctx.strokeRect(-11, -8, 22, 24);
      for (let i = -1; i <= 1; i++) ctx.fillRect(i * 9 - 3.5, -16, 7, 8);
      ctx.strokeRect(-11, -16, 22, 8);
      ctx.fillStyle = '#3b2a17';
      ctx.fillRect(-4, 6, 8, 10);
      break;
    default: { // números romanos de la edad
      ctx.fillStyle = '#3a2c14';
      ctx.font = 'bold 26px Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(sym, 0, 2);
    }
  }
  ctx.restore();
}

const TECH_SYMBOLS = {
  Forja: 'sword', 'Fundición de hierro': 'sword', 'Armadura de escamas': 'armor',
  'Cota de malla': 'armor', 'Armadura acolchada': 'armor', Emplumado: 'arrow',
  'Punta de bodkin': 'arrow', Telar: 'loom', Carretilla: 'cart', 'Carretilla de mano': 'cart',
  Almenas: 'tower', Oscura: 'I', Feudal: 'II', Castillos: 'III', Imperial: 'IV',
};

/** Caja envolvente de los píxeles no transparentes (para encuadrar iconos). */
const boundsCache = new Map();
function tightBounds(canvas, key) {
  if (boundsCache.has(key)) return boundsCache.get(key);
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 12) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  } catch { /* lienzo "manchado": se usa el tamaño completo */ }
  const b = x1 <= x0 || y1 <= y0
    ? { x: 0, y: 0, w, h }
    : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  boundsCache.set(key, b);
  return b;
}

export function iconFor(kind, type, colorIdx = 0) {
  const key = `${kind}|${type}|${colorIdx}`;
  let url = iconCache.get(key);
  if (url) return url;
  const c = makeCanvas(56, 56);
  const ctx = c.getContext('2d');
  if (kind === 'unit') {
    // Retrato de medio cuerpo: así se distinguen el yelmo y el arma de cada unidad.
    const s = unitSprite(type, colorIdx, 1, 0, false);
    const b = tightBounds(s.canvas, `u${key}`);
    const cls = UNITS[type].class;
    const crop = cls === 'siege' ? 1 : 0.66;
    const ch = Math.max(8, b.h * crop);
    const sc = Math.min(54 / b.w, 52 / ch);
    ctx.drawImage(s.canvas, b.x, b.y, b.w, ch,
      28 - (b.w * sc) / 2, 30 - (ch * sc) / 2, b.w * sc, ch * sc);
  } else if (kind === 'building') {
    const s = buildingSprite(type, colorIdx, 2);
    const b = tightBounds(s.canvas, `b${key}`);
    const sc = Math.min(52 / b.w, 50 / b.h);
    ctx.drawImage(s.canvas, b.x, b.y, b.w, b.h,
      28 - (b.w * sc) / 2, 54 - b.h * sc, b.w * sc, b.h * sc);
  } else if (kind === 'tech') {
    const grad = ctx.createLinearGradient(0, 0, 0, 56);
    grad.addColorStop(0, '#e2d3a6'); grad.addColorStop(1, '#bda87a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(6, 4); ctx.lineTo(50, 4); ctx.lineTo(50, 40);
    ctx.quadraticCurveTo(28, 56, 6, 40);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7a5f36'; ctx.lineWidth = 2; ctx.stroke();
    techGlyph(ctx, TECH_SYMBOLS[type] || (type || '?').slice(0, 1).toUpperCase());
  } else if (kind === 'res') {
    const cols = { food: ['#ff8b76', '#b8332a'], wood: ['#b98a4d', '#6b4a24'], gold: ['#ffe58a', '#c9971a'], stone: ['#dcdcd6', '#85857e'] }[type] || ['#aaa', '#666'];
    const grad = ctx.createRadialGradient(22, 20, 2, 28, 28, 20);
    grad.addColorStop(0, cols[0]); grad.addColorStop(1, cols[1]);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(28, 28, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
  }
  url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

/**
 * Vacía todos los cachés de dibujo. Hay que llamarla cuando se cambian datos
 * del juego desde el catálogo: los sprites se guardan por tipo y color, así
 * que si cambia el tamaño de un edificio o el color de un terreno hay que
 * volver a dibujarlos.
 */
export function clearSpriteCaches() {
  resCache.clear();
  unitCache.clear();
  buildCache.clear();
  iconCache.clear();
  boundsCache.clear();
}

export { HW, HH };
