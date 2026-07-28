// Sesión de partida entre dos jugadores.
//
// El anfitrión es quien simula: manda instantáneas del estado diez veces por
// segundo y aplica las órdenes que recibe. El invitado no simula nada, sólo
// pinta lo que le llega (interpolando entre instantáneas para que se vea
// fluido a 60 fps) y manda sus órdenes.

import { encodeSnapshot, decodeSnapshot, encodeOver, decodeOver } from './protocol.js';
import { UNITS, BUILDINGS, TECHS } from '../config.js';
import { Unit, Building } from '../entities.js';

const SNAPSHOT_MS = 100;

export class NetSession {
  constructor(peer, role, game) {
    this.peer = peer;
    this.role = role;           // 'host' o 'guest'
    this.game = game;
    this.acc = 0;
    this.lost = false;
    this.onLost = null;
    game.net = this;

    peer.addEventListener('message', (e) => this.receive(e.detail));
    peer.addEventListener('lost', () => {
      if (this.lost) return;
      this.lost = true;
      if (this.onLost) this.onLost();
    });
  }

  get isHost() { return this.role === 'host'; }

  sendCommand(cmd) {
    if (this.isHost) return; // el anfitrión aplica sus órdenes directamente
    this.peer.send(JSON.stringify(cmd));
  }

  /** Llamado desde el bucle principal, después de simular. */
  tick(dt) {
    if (!this.isHost || !this.peer.ready) return;
    this.acc += dt * 1000;
    if (this.acc < SNAPSHOT_MS) return;
    this.acc = 0;
    const g = this.game;
    const buf = encodeSnapshot(g, this.remotePlayer, g.netRemoved, g.netDepleted);
    g.netRemoved = [];
    g.netDepleted = [];
    this.peer.send(buf);
  }

  get remotePlayer() {
    const g = this.game;
    return this.isHost ? g.players[1] : g.players[0];
  }

  /** El anfitrión comunica el final; `won` es desde la óptica del invitado. */
  announceOver(won) {
    if (this.isHost) this.peer.send(encodeOver(won));
  }

  receive(data) {
    if (typeof data === 'string') {
      if (this.isHost) this.applyCommand(JSON.parse(data));
      return;
    }
    const buf = data instanceof ArrayBuffer ? data : null;
    if (!buf) return;
    const kind = new DataView(buf).getUint8(0);
    if (kind === 1) this.applySnapshot(decodeSnapshot(buf));
    else if (kind === 2) {
      const over = decodeOver(buf);
      if (over && !this.game.over) this.game.endGame(over.won);
    }
  }

  // --- Anfitrión: aplicar lo que pide el invitado --------------------------

  applyCommand(cmd) {
    const g = this.game;
    const player = g.players[1];
    if (!cmd || !player || player.defeated || g.over) return;
    const mine = (ids) => (ids || [])
      .map((id) => g.byId.get(id))
      .filter((e) => e && !e.dead && e.owner === player.id);

    switch (cmd.c) {
      case 'move': g.commandMove(mine(cmd.ids), cmd.x, cmd.y, !!cmd.a); break;
      case 'target': {
        const units = mine(cmd.ids);
        const target = cmd.k === 'n' ? g.map.nodes[cmd.t] : g.byId.get(cmd.t);
        if (units.length && target && !target.dead && target.alive !== false) g.commandTarget(units, target);
        break;
      }
      case 'stop': for (const u of mine(cmd.ids)) u.stopTask(); break;
      case 'delete':
        for (const e of mine(cmd.ids)) {
          if (e.kind === 'unit') g.killUnit(e, null); else g.killBuilding(e, null);
        }
        break;
      case 'build': {
        if (!BUILDINGS[cmd.t]) break;
        g.placeBuilding(cmd.t, cmd.x, cmd.y, player, mine(cmd.ids));
        break;
      }
      case 'train': {
        const b = g.byId.get(cmd.b);
        if (b && b.owner === player.id && UNITS[cmd.t]) g.queueUnit(b, cmd.t, player);
        break;
      }
      case 'tech': {
        const b = g.byId.get(cmd.b);
        if (b && b.owner === player.id) g.queueTech(b, cmd.k2, player);
        break;
      }
      case 'upgrade': {
        const b = g.byId.get(cmd.b);
        if (b && b.owner === player.id) g.queueUpgrade(b, cmd.k2, player);
        break;
      }
      case 'age': {
        const b = g.byId.get(cmd.b);
        if (b && b.owner === player.id) g.queueAge(b, player);
        break;
      }
      case 'cancelq': {
        const b = g.byId.get(cmd.b);
        if (b && b.owner === player.id) g.cancelQueueItem(b, cmd.i);
        break;
      }
      case 'rally': {
        for (const b of mine(cmd.ids)) {
          if (b.kind !== 'building') continue;
          const target = cmd.t ? g.byId.get(cmd.t) : null;
          b.rally = target && !target.dead
            ? { x: target.x ?? target.cx, y: target.y ?? target.cy, target }
            : { x: cmd.x, y: cmd.y };
        }
        break;
      }
      case 'market': {
        const price = Math.round(100 * (cmd.d === 'sell' ? 0.8 : 1.4));
        if (cmd.d === 'sell' && player.res[cmd.r] >= 100) { player.res[cmd.r] -= 100; player.res.gold += price; }
        else if (cmd.d === 'buy' && player.res.gold >= price) { player.res.gold -= price; player.res[cmd.r] += 100; }
        break;
      }
      case 'resign':
        player.defeated = true;
        g.checkVictory();
        break;
      default: break;
    }
  }

  // --- Invitado: aplicar el estado recibido --------------------------------

  applySnapshot(snap) {
    if (!snap) return;
    const g = this.game;
    g.time = snap.time;

    for (const ps of snap.players) {
      const p = g.players[ps.id];
      if (!p) continue;
      p.res = ps.res;
      p.age = ps.age;
      p.defeated = ps.defeated;
    }
    // Las mejoras ya vienen reflejadas en el tipo de cada unidad; aquí sólo se
    // rehacen los modificadores para que el panel muestre bien las cifras.
    if (g.human) rebuildMods(g.human, snap.techs);

    const seen = new Set();
    for (const us of snap.units) {
      seen.add(us.id);
      let u = g.byId.get(us.id);
      if (!u || u.kind !== 'unit') {
        u = new Unit(us.type, us.owner, us.x, us.y);
        u.id = us.id;
        u.radius = UNITS[us.type].radius;
        g.units.add(u);
        g.players[us.owner].units.add(u);
        g.byId.set(u.id, u);
        u.lerpFrom = { x: us.x, y: us.y };
      } else {
        u.lerpFrom = { x: u.x, y: u.y };
      }
      if (u.type !== us.type) { u.type = us.type; u.radius = UNITS[us.type].radius; }
      u.lerpTo = { x: us.x, y: us.y };
      u.lerpT = 0;
      u.hp = us.hp; u.maxHp = us.maxHp;
      u.dir = us.dir; u.back = us.back; u.moving = us.moving; u.working = us.working;
      u.attackAnim = us.attackAnim;
      u.carry = us.carry; u.carryRes = us.carryRes;
      if (u.moving) u.anim += 0.9;
    }

    for (const bs of snap.buildings) {
      seen.add(bs.id);
      let b = g.byId.get(bs.id);
      if (!b || b.kind !== 'building') {
        b = new Building(bs.type, bs.owner, bs.tx, bs.ty, g.players[bs.owner]);
        b.id = bs.id;
        g.buildings.add(b);
        g.players[bs.owner].buildings.add(b);
        g.byId.set(b.id, b);
        for (let y = bs.ty; y < bs.ty + b.size; y++) {
          for (let x = bs.tx; x < bs.tx + b.size; x++) {
            if (g.map.inBounds(x, y)) g.map.occupied[g.map.idx(x, y)] = b.id;
          }
        }
      }
      b.hp = bs.hp; b.maxHp = bs.maxHp;
      b.built = bs.built; b.progress = bs.progress;
      if (bs.farmAmount) b.farmAmount = bs.farmAmount;
      b.rally = bs.rally;
      b.queue = bs.queue.map((q) => ({ ...q, progress: q.progress, time: 1 }));
    }

    for (const id of snap.removed) {
      const e = g.byId.get(id);
      if (!e) continue;
      if (e.kind === 'unit') g.killUnit(e, null);
      else g.killBuilding(e, null);
    }
    // Red de seguridad por si se perdió alguna instantánea.
    for (const u of [...g.units]) if (!seen.has(u.id)) g.killUnit(u, null);
    for (const b of [...g.buildings]) if (!seen.has(b.id)) g.killBuilding(b, null);

    for (const idx of snap.depleted) {
      const node = g.map.nodes[idx];
      if (node && node.alive) g.map.removeNode(node);
    }

    // x/y apuntan al origen del vuelo para que la flecha salga bien orientada.
    g.projectiles = snap.projectiles.map((p) => ({ ...p, x: p.px, y: p.py }));
    g.netHasState = true;
  }
}

/** Rehace player.mods a partir de la lista de tecnologías investigadas. */
function rebuildMods(player, techKeys) {
  player.techs = new Set(techKeys);
  player.mods = {};
  for (const key of techKeys) {
    const t = TECHS[key];
    if (!t) continue; // las mejoras de línea no tienen modificadores
    for (const e of t.effects || []) {
      const bucket = (player.mods[e.target] ||= {});
      const stat = e.pct ? `${e.stat}Pct` : e.stat;
      bucket[stat] = (bucket[stat] || 0) + e.add;
    }
  }
}
