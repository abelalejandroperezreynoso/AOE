// Utilidades generales del motor.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};

let _id = 1;
export const uid = () => _id++;

/** PRNG determinista (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) { this.next = mulberry32(seed); }
  float(a = 0, b = 1) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Montículo binario mínimo usado por A*. */
export class MinHeap {
  constructor() { this.items = []; this.keys = []; }
  get size() { return this.items.length; }
  push(item, key) {
    const it = this.items, ks = this.keys;
    it.push(item); ks.push(key);
    let i = it.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= ks[i]) break;
      [it[p], it[i]] = [it[i], it[p]];
      [ks[p], ks[i]] = [ks[i], ks[p]];
      i = p;
    }
  }
  pop() {
    const it = this.items, ks = this.keys;
    const top = it[0];
    const last = it.pop(), lastK = ks.pop();
    if (it.length) {
      it[0] = last; ks[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < ks.length && ks[l] < ks[m]) m = l;
        if (r < ks.length && ks[r] < ks[m]) m = r;
        if (m === i) break;
        [it[m], it[i]] = [it[i], it[m]];
        [ks[m], ks[i]] = [ks[i], ks[m]];
        i = m;
      }
    }
    return top;
  }
}

/** "3:05" a partir de segundos. */
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Ruido de valor suavizado, para generar terreno. */
export function makeNoise(rng, size) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const at = (x, y) => g[(clamp(y, 0, size - 1) | 0) * size + (clamp(x, 0, size - 1) | 0)];
  return function noise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lerp(at(x0, y0), at(x0 + 1, y0), sx);
    const b = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx);
    return lerp(a, b, sy);
  };
}

/** Ruido fractal en varias octavas, resultado en [0,1]. */
export function fbm(noise, x, y, octaves = 4, freq = 1, persistence = 0.5) {
  let amp = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= persistence;
    freq *= 2;
  }
  return sum / norm;
}

/** Mezcla dos colores hex. */
export function mix(c1, c2, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [r1, g1, b1] = p(c1), [r2, g2, b2] = p(c2);
  const h = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(lerp(r1, r2, t))}${h(lerp(g1, g2, t))}${h(lerp(b1, b2, t))}`;
}

export function shade(hex, amount) {
  return mix(hex, amount > 0 ? '#ffffff' : '#000000', Math.abs(amount));
}
