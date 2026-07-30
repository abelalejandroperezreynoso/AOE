// Codificación de los mensajes que viajan entre los dos jugadores.
//
// El anfitrión simula la partida y envía "instantáneas" del estado; el
// invitado envía órdenes. Las instantáneas van en binario porque se mandan
// diez veces por segundo y con 200 unidades el JSON sería demasiado pesado.
// Las órdenes son texto JSON: son pocas y así se leen bien al depurar.

import { UNITS, BUILDINGS, TECHS, UPGRADES } from '../config.js';

// Índices estables: ambos lados ejecutan el mismo código, así que el orden de
// las claves coincide y se pueden mandar como un solo byte.
export const UNIT_TYPES = Object.keys(UNITS);
export const BUILDING_TYPES = Object.keys(BUILDINGS);
export const TECH_KEYS = Object.keys(TECHS);
export const UPGRADE_KEYS = Object.keys(UPGRADES);
const RES_LIST = ['food', 'wood', 'gold', 'stone'];

const unitIdx = new Map(UNIT_TYPES.map((t, i) => [t, i]));
const buildIdx = new Map(BUILDING_TYPES.map((t, i) => [t, i]));
const resIdx = new Map(RES_LIST.map((t, i) => [t, i]));

export const MSG = { SNAPSHOT: 1, OVER: 2 };
const POS = 64; // las posiciones viajan en centésimas de casilla (punto fijo)

class Writer {
  constructor(size = 1 << 16) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
    this.o = 0;
  }
  need(n) {
    if (this.o + n <= this.buf.byteLength) return;
    const bigger = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(bigger).set(new Uint8Array(this.buf));
    this.buf = bigger;
    this.view = new DataView(bigger);
  }
  u8(v) { this.need(1); this.view.setUint8(this.o, v & 0xff); this.o += 1; }
  u16(v) { this.need(2); this.view.setUint16(this.o, v & 0xffff); this.o += 2; }
  i16(v) { this.need(2); this.view.setInt16(this.o, Math.max(-32768, Math.min(32767, v | 0))); this.o += 2; }
  u32(v) { this.need(4); this.view.setUint32(this.o, v >>> 0); this.o += 4; }
  f32(v) { this.need(4); this.view.setFloat32(this.o, v); this.o += 4; }
  done() { return this.buf.slice(0, this.o); }
}

class Reader {
  constructor(buf) { this.view = new DataView(buf); this.o = 0; }
  u8() { const v = this.view.getUint8(this.o); this.o += 1; return v; }
  u16() { const v = this.view.getUint16(this.o); this.o += 2; return v; }
  i16() { const v = this.view.getInt16(this.o); this.o += 2; return v; }
  u32() { const v = this.view.getUint32(this.o); this.o += 4; return v; }
  f32() { const v = this.view.getFloat32(this.o); this.o += 4; return v; }
  get atEnd() { return this.o >= this.view.byteLength; }
}

/**
 * Instantánea del estado. `viewer` es el jugador que la recibirá: sólo de sus
 * edificios se manda el detalle de la cola de producción, que es lo único que
 * necesita para su propia interfaz.
 */
export function encodeSnapshot(game, viewer, removed, depleted) {
  const w = new Writer();
  w.u8(MSG.SNAPSHOT);
  w.f32(game.time);

  w.u8(game.players.length);
  for (const p of game.players) {
    w.u8(p.id);
    w.u8(p.age);
    for (const r of RES_LIST) w.f32(p.res[r]);
    w.u16(Math.min(65535, p.popCap));
    w.u16(Math.min(65535, p.pop));
    w.u8(p.defeated ? 1 : 0);
  }

  w.u16(game.units.size);
  for (const u of game.units) {
    w.u32(u.id);
    w.u8(unitIdx.get(u.type) ?? 0);
    w.u8(u.owner);
    w.i16(Math.round(u.x * POS));
    w.i16(Math.round(u.y * POS));
    w.u16(Math.max(0, Math.round(u.hp)));
    w.u16(Math.round(u.maxHp));
    w.u8((u.dir < 0 ? 1 : 0) | (u.back ? 2 : 0) | (u.moving ? 4 : 0) | (u.working ? 8 : 0));
    w.u8(Math.max(0, Math.min(255, Math.round(u.attackAnim * 255))));
    w.u8(u.carryRes ? (resIdx.get(u.carryRes) + 1) : 0);
    w.u8(Math.max(0, Math.min(255, Math.round(u.carry))));
  }

  w.u16(game.buildings.size);
  for (const b of game.buildings) {
    w.u32(b.id);
    w.u8(buildIdx.get(b.type) ?? 0);
    w.u8(b.owner);
    w.u8(b.tx);
    w.u8(b.ty);
    w.u16(Math.max(0, Math.round(b.hp)));
    w.u16(Math.round(b.maxHp));
    w.u8(b.built ? 1 : 0);
    w.u8(Math.max(0, Math.min(255, Math.round(b.progress * 255))));
    w.u16(Math.max(0, Math.round(b.farmAmount ?? 0)));
    // Cola de producción: sólo la de quien va a recibir la instantánea.
    const q = (viewer && b.owner === viewer.id && b.queue) ? b.queue.slice(0, 8) : [];
    w.u8(q.length);
    for (const item of q) {
      const kind = item.kind === 'unit' ? 0 : item.kind === 'tech' ? 1 : item.kind === 'upgrade' ? 2 : 3;
      w.u8(kind);
      const key = kind === 0 ? (unitIdx.get(item.key) ?? 0)
        : kind === 1 ? TECH_KEYS.indexOf(item.key)
          : kind === 2 ? UPGRADE_KEYS.indexOf(item.key)
            : item.key; // edad: el número de edad
      w.u8(Math.max(0, key));
      w.u8(Math.max(0, Math.min(255, Math.round((item.progress / item.time) * 255))));
      w.u8(item.blocked ? 1 : 0);
    }
    w.u8(b.rally ? 1 : 0);
    if (b.rally) { w.i16(Math.round(b.rally.x * POS)); w.i16(Math.round(b.rally.y * POS)); }
  }

  w.u16(game.projectiles.length);
  for (const p of game.projectiles) {
    w.i16(Math.round((p.px ?? p.x) * POS));
    w.i16(Math.round((p.py ?? p.y) * POS));
    w.u8(Math.max(0, Math.min(255, Math.round((p.pz ?? 0) * 32))));
    w.u8(p.kindOf === 'boulder' ? 1 : 0);
    w.i16(Math.round((p.tx ?? 0) * POS));
    w.i16(Math.round((p.ty ?? 0) * POS));
  }

  w.u16(removed.length);
  for (const id of removed) w.u32(id);

  w.u16(depleted.length);
  for (const idx of depleted) w.u16(idx);

  // Rebaños: se mueven y cambian de bando, así que van en cada instantánea.
  // Son unas pocas docenas en todo el mapa, no llegan a cien bytes.
  const herds = (game.herds || []).filter((n) => n.alive);
  w.u16(herds.length);
  for (const n of herds) {
    w.u16(n.id);
    w.i16(Math.round(n.fx * POS));
    w.i16(Math.round(n.fy * POS));
    w.u8(n.owner === null || n.owner === undefined ? 0 : n.owner + 1);
    w.u16(Math.max(0, Math.round(n.amount)));
  }

  // Tecnologías del receptor, para que su panel muestre lo ya investigado.
  const techs = viewer ? [...viewer.techs] : [];
  w.u8(Math.min(255, techs.length));
  for (const key of techs.slice(0, 255)) {
    const isUp = UPGRADE_KEYS.includes(key);
    w.u8(isUp ? 1 : 0);
    w.u8(isUp ? UPGRADE_KEYS.indexOf(key) : Math.max(0, TECH_KEYS.indexOf(key)));
  }
  return w.done();
}

export function decodeSnapshot(buf) {
  const r = new Reader(buf);
  const type = r.u8();
  if (type !== MSG.SNAPSHOT) return null;
  const snap = {
    time: r.f32(), players: [], units: [], buildings: [], projectiles: [],
    removed: [], depleted: [], herds: [], techs: [],
  };

  const pc = r.u8();
  for (let i = 0; i < pc; i++) {
    const p = { id: r.u8(), age: r.u8(), res: {} };
    for (const res of RES_LIST) p.res[res] = r.f32();
    p.popCap = r.u16();
    p.pop = r.u16();
    p.defeated = !!r.u8();
    snap.players.push(p);
  }

  const uc = r.u16();
  for (let i = 0; i < uc; i++) {
    const id = r.u32(), type2 = UNIT_TYPES[r.u8()], owner = r.u8();
    const x = r.i16() / POS, y = r.i16() / POS;
    const hp = r.u16(), maxHp = r.u16(), flags = r.u8();
    const anim = r.u8() / 255, carryRes = r.u8(), carry = r.u8();
    snap.units.push({
      id, type: type2, owner, x, y, hp, maxHp,
      dir: (flags & 1) ? -1 : 1, back: !!(flags & 2), moving: !!(flags & 4), working: !!(flags & 8),
      attackAnim: anim, carryRes: carryRes ? RES_LIST[carryRes - 1] : null, carry,
    });
  }

  const bc = r.u16();
  for (let i = 0; i < bc; i++) {
    const b = {
      id: r.u32(), type: BUILDING_TYPES[r.u8()], owner: r.u8(), tx: r.u8(), ty: r.u8(),
      hp: r.u16(), maxHp: r.u16(), built: !!r.u8(), progress: r.u8() / 255, farmAmount: r.u16(),
      queue: [], rally: null,
    };
    const ql = r.u8();
    for (let k = 0; k < ql; k++) {
      const kind = r.u8(), key = r.u8(), prog = r.u8() / 255, blocked = !!r.u8();
      b.queue.push({
        kind: ['unit', 'tech', 'upgrade', 'age'][kind],
        key: kind === 0 ? UNIT_TYPES[key] : kind === 1 ? TECH_KEYS[key] : kind === 2 ? UPGRADE_KEYS[key] : key,
        progress: prog, time: 1, blocked,
      });
    }
    if (r.u8()) b.rally = { x: r.i16() / POS, y: r.i16() / POS };
    snap.buildings.push(b);
  }

  const prc = r.u16();
  for (let i = 0; i < prc; i++) {
    snap.projectiles.push({
      px: r.i16() / POS, py: r.i16() / POS, pz: r.u8() / 32,
      kindOf: r.u8() ? 'boulder' : 'arrow',
      tx: r.i16() / POS, ty: r.i16() / POS,
    });
  }

  const rc = r.u16();
  for (let i = 0; i < rc; i++) snap.removed.push(r.u32());
  const dc = r.u16();
  for (let i = 0; i < dc; i++) snap.depleted.push(r.u16());
  const hc = r.u16();
  for (let i = 0; i < hc; i++) {
    const id = r.u16();
    const fx = r.i16() / POS, fy = r.i16() / POS;
    const owner = r.u8();
    snap.herds.push({ id, fx, fy, owner: owner ? owner - 1 : null, amount: r.u16() });
  }
  const tc = r.u8();
  for (let i = 0; i < tc; i++) {
    const isUp = r.u8(), key = r.u8();
    snap.techs.push(isUp ? UPGRADE_KEYS[key] : TECH_KEYS[key]);
  }
  return snap;
}

export function encodeOver(won) {
  const w = new Writer(8);
  w.u8(MSG.OVER);
  w.u8(won ? 1 : 0);
  return w.done();
}

export function decodeOver(buf) {
  const r = new Reader(buf);
  return r.u8() === MSG.OVER ? { won: !!r.u8() } : null;
}
