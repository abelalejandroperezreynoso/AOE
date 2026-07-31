// Búsqueda de caminos A* sobre la rejilla del mapa.

import { MinHeap } from './utils.js';

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

function octile(dx, dy) {
  dx = Math.abs(dx); dy = Math.abs(dy);
  return dx > dy ? dx + 0.4142 * dy : dy + 0.4142 * dx;
}

/**
 * Camino desde (sx,sy) hasta cualquiera de los destinos.
 * Devuelve un array de tiles (sin incluir el origen) o null.
 * Si no se alcanza el destino, devuelve el mejor camino parcial.
 */
export function findPath(map, sx, sy, goals, maxNodes = 7000) {
  if (!goals.length) return null;
  const S = map.size;
  const goalSet = new Set(goals.map((g) => g.y * S + g.x));
  const h = (x, y) => {
    let best = Infinity;
    for (const g of goals) {
      const d = octile(g.x - x, g.y - y);
      if (d < best) best = d;
    }
    return best;
  };

  const start = sy * S + sx;
  if (goalSet.has(start)) return [];

  const gScore = new Map();
  const cameFrom = new Map();
  const closed = new Set();
  const open = new MinHeap();
  gScore.set(start, 0);
  open.push(start, h(sx, sy));

  let bestNode = start, bestH = h(sx, sy), expanded = 0, found = -1;

  while (open.size && expanded < maxNodes) {
    const cur = open.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    expanded++;
    const cx = cur % S, cy = (cur / S) | 0;

    if (goalSet.has(cur)) { found = cur; break; }
    const hc = h(cx, cy);
    if (hc < bestH) { bestH = hc; bestNode = cur; }

    const gc = gScore.get(cur);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const ni = ny * S + nx;
      if (closed.has(ni)) continue;
      const walkable = map.isPassable(nx, ny) || goalSet.has(ni);
      if (!walkable) continue;
      // No cortar esquinas entre dos obstáculos.
      if (dx && dy && !(map.isPassable(cx + dx, cy) && map.isPassable(cx, cy + dy))) continue;
      const ng = gc + cost;
      const old = gScore.get(ni);
      if (old === undefined || ng < old - 1e-6) {
        gScore.set(ni, ng);
        cameFrom.set(ni, cur);
        open.push(ni, ng + h(nx, ny) * 1.08);
      }
    }
  }

  const end = found >= 0 ? found : bestNode;
  if (end === start) return found >= 0 ? [] : null;
  const path = [];
  let cur = end;
  while (cur !== start && cur !== undefined) {
    path.push({ x: cur % S, y: (cur / S) | 0 });
    cur = cameFrom.get(cur);
  }
  if (cur === undefined) return null;
  path.reverse();
  return smooth(map, sx, sy, path);
}

/** Elimina puntos intermedios cuando hay línea de visión directa. */
function smooth(map, sx, sy, path) {
  if (path.length < 3) return path;
  const out = [];
  let cx = sx, cy = sy, i = 0;
  while (i < path.length) {
    let j = Math.min(path.length - 1, i + 12);
    while (j > i && !lineClear(map, cx, cy, path[j].x, path[j].y)) j--;
    out.push(path[j]);
    cx = path[j].x; cy = path[j].y;
    i = j + 1;
  }
  return out;
}

function lineClear(map, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0, guard = 0;
  while (guard++ < 400) {
    if (!map.isPassable(x, y)) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; if (!map.isPassable(x, y)) return false; }
    if (e2 < dx) { err += dx; y += sy; if (!map.isPassable(x, y)) return false; }
  }
  return false;
}

/** Tiles libres alrededor de un rectángulo (para acercarse a un objetivo). */
export function ringTiles(map, tx, ty, w, h, radius = 1) {
  const out = [];
  const x0 = tx - radius, x1 = tx + w - 1 + radius;
  const y0 = ty - radius, y1 = ty + h - 1 + radius;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const inner = x >= tx && x <= tx + w - 1 && y >= ty && y <= ty + h - 1;
      if (inner) continue;
      const border = x === x0 || x === x1 || y === y0 || y === y1;
      if (!border) continue;
      if (map.isPassable(x, y)) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Tiles transitables de dentro de un rectángulo. Sirve para llegar al interior
 * de un edificio por el que se puede andar: a la granja se entra, no se rodea.
 */
export function areaTiles(map, tx, ty, w, h) {
  const out = [];
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) if (map.isPassable(x, y)) out.push({ x, y });
  }
  return out;
}

/** Busca el tile libre más cercano a (x,y) en espiral. */
export function nearestFree(map, x, y, maxR = 12) {
  if (map.isPassable(x, y)) return { x, y };
  for (let r = 1; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (map.isPassable(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}
