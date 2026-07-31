// Sesión de partida en red, de dos a ocho jugadores.
//
// El anfitrión es quien simula: mantiene una conexión con cada invitado, les
// manda instantáneas del estado varias veces por segundo y aplica las órdenes
// que recibe de cada uno. Los invitados no simulan nada, sólo pintan lo que les
// llega (interpolando entre instantáneas para que se vea fluido a 60 fps) y
// mandan sus órdenes al anfitrión.

import { encodeSnapshot, decodeSnapshot, encodeOver, decodeOver } from './protocol.js';
import { UNITS, BUILDINGS, TECHS } from '../config.js';
import { Unit, Building } from '../entities.js';

const SNAPSHOT_MS = 100;
const SNAPSHOT_MAX_MS = 200;
// Los invitados dan señales de vida cada poco. Normalmente basta con lo que
// avisa WebRTC (cerrar la pestaña se nota en unos segundos), pero si la red se
// corta de golpe puede tardar muchísimo, y esto lo cubre. El margen es amplio a
// propósito: un móvil con el juego en segundo plano deja de dibujar, y no por
// eso hay que echarlo de la partida.
const PING_MS = 2000;
const SILENCE_MS = 90000;

/**
 * Con mucha gente el anfitrión tiene que codificar y enviar una instantánea
 * distinta por invitado, así que se espacian un poco para no ahogar su subida.
 */
export function snapshotInterval(guests) {
  return Math.min(SNAPSHOT_MAX_MS, SNAPSHOT_MS + Math.max(0, guests - 2) * 20);
}

export class NetSession {
  /**
   * `links` empareja cada conexión con el jugador que hay al otro lado: en el
   * anfitrión hay una por invitado; en el invitado, sólo la del anfitrión.
   */
  constructor(game, role, links) {
    this.game = game;
    this.role = role;           // 'host' o 'guest'
    this.lost = false;
    this.onLost = null;
    game.net = this;

    this.interval = snapshotInterval(links.length);
    this.links = links.map(({ playerId, peer }, i) => {
      const link = {
        playerId, peer, lost: false,
        // Cada invitado recibe la suya en un momento distinto del ciclo, para
        // repartir el trabajo del anfitrión en vez de amontonarlo.
        acc: (i / Math.max(1, links.length)) * this.interval,
        removed: [], depleted: [], silence: 0,
      };
      peer.addEventListener('message', (e) => this.receive(e.detail, link));
      peer.addEventListener('lost', () => this.handleLost(link));
      return link;
    });
    game.netSnapMs = this.interval / 1000;
    this.lastSnapAt = 0;
    // Va por su cuenta y no con el bucle de dibujo, para que siga habiendo
    // señales de vida aunque el navegador deje de pintar en segundo plano.
    if (!this.isHost) this.pingTimer = setInterval(() => this.ping(), PING_MS);
    // Lo que llegó mientras se generaba el mundo se entrega ahora.
    for (const link of this.links) link.peer.release();
  }

  get isHost() { return this.role === 'host'; }

  /** Conexión con el anfitrión (sólo existe en el invitado). */
  get hostLink() { return this.links[0]; }

  linkOf(playerId) { return this.links.find((l) => l.playerId === playerId) || null; }

  sendCommand(cmd) {
    if (this.isHost) return; // el anfitrión aplica sus órdenes directamente
    this.hostLink?.peer.send(JSON.stringify(cmd));
  }

  /** Llamado desde el bucle principal, después de simular. */
  tick(dt) {
    if (!this.isHost) return;
    const step = dt * 1000;
    const g = this.game;

    // Bajas y recursos agotados de este ciclo: cada invitado lleva su propia
    // lista porque no todos reciben la instantánea en el mismo momento.
    if (g.netRemoved.length || g.netDepleted.length) {
      for (const link of this.links) {
        if (link.lost) continue;
        for (const id of g.netRemoved) link.removed.push(id);
        for (const idx of g.netDepleted) link.depleted.push(idx);
      }
      g.netRemoved = [];
      g.netDepleted = [];
    }

    for (const link of this.links) {
      if (link.lost) continue;
      // Quien lleva mucho rato sin decir nada es que ya no está.
      link.silence += step;
      if (link.silence > SILENCE_MS) { this.handleLost(link); continue; }
      if (!link.peer.ready) continue;
      link.acc += step;
      if (link.acc < this.interval) continue;
      link.acc = 0;
      const viewer = g.players[link.playerId];
      link.peer.send(encodeSnapshot(g, viewer, link.removed, link.depleted));
      link.removed = [];
      link.depleted = [];
    }
  }

  /** Señal de vida del invitado al anfitrión. */
  ping() {
    const link = this.hostLink;
    if (!link || link.lost || !link.peer.ready) return;
    link.peer.send(JSON.stringify({ c: 'ping' }));
  }

  /** El anfitrión comunica a un jugador cómo acabó su partida. */
  announceResult(player, won) {
    if (!this.isHost) return;
    const link = this.linkOf(player.id);
    if (link && !link.lost) link.peer.send(encodeOver(won));
  }

  handleLost(link) {
    if (link.lost) return;
    link.lost = true;
    link.removed = [];
    link.depleted = [];

    // El invitado se queda sin partida: sin el anfitrión no hay simulación.
    if (!this.isHost) {
      clearInterval(this.pingTimer);
      if (this.lost) return;
      this.lost = true;
      if (this.onLost) this.onLost();
      return;
    }

    // El anfitrión sigue: quien se cae queda eliminado y los demás continúan.
    const g = this.game;
    const p = g.players[link.playerId];
    if (!p || p.defeated) return;
    p.defeated = true;
    p.resultSent = true;    // ya no hay canal por el que avisarle
    if (g.ui) g.ui.notify(`${p.name} ha perdido la conexión.`, 'info');
    g.checkVictory();
  }

  receive(data, link) {
    link.silence = 0;
    if (typeof data === 'string') {
      if (!this.isHost) return;   // el arranque lo gestiona la sala
      let cmd = null;
      try { cmd = JSON.parse(data); } catch { return; }
      if (cmd && cmd.t !== 'start') this.applyCommand(cmd, this.game.players[link.playerId]);
      return;
    }
    const buf = data instanceof ArrayBuffer ? data : null;
    if (!buf || buf.byteLength < 1) return;
    const kind = new DataView(buf).getUint8(0);
    if (kind === 1) {
      this.measureRate();
      this.applySnapshot(decodeSnapshot(buf));
    } else if (kind === 2) {
      const over = decodeOver(buf);
      if (over && !this.game.over) this.game.endGame(over.won);
    }
  }

  /**
   * Ritmo real al que llegan las instantáneas: con él se interpola el
   * movimiento, así que se suaviza para que un retraso suelto no dé tirones.
   */
  measureRate() {
    const now = performance.now();
    if (this.lastSnapAt) {
      const gap = Math.min(500, Math.max(50, now - this.lastSnapAt)) / 1000;
      this.game.netSnapMs = this.game.netSnapMs * 0.8 + gap * 0.2;
    }
    this.lastSnapAt = now;
  }

  // --- Anfitrión: aplicar lo que pide un invitado --------------------------

  applyCommand(cmd, player) {
    const g = this.game;
    if (!cmd || !player || player.defeated || player === g.human) return;
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
      case 'herd': {
        const animals = (cmd.ids || []).map((id) => g.map.nodes[id]);
        g.commandHerd(animals, cmd.x, cmd.y, player);
        break;
      }
      case 'herdstop': {
        for (const id of cmd.ids || []) {
          const a = g.map.nodes[id];
          if (a && a.herd && a.owner === player.id) a.task = null;
        }
        break;
      }
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
        if (g.ui) g.ui.notify(`${player.name} se ha rendido.`, 'good');
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
        g.map.occupy(b, b.passable);
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
      if (node && node.alive) { g.map.removeNode(node); g.dropFromSelection(node); }
    }

    // Rebaños: el invitado no los simula, sólo copia dónde están y de quién son.
    for (const hs of snap.herds) {
      const n = g.map.nodes[hs.id];
      if (!n || !n.alive) continue;
      n.fx = hs.fx; n.fy = hs.fy;
      n.amount = hs.amount;
      g.map.retileNode(n);
      if (n.owner !== hs.owner) {
        n.owner = hs.owner;
        if (n.selected && n.owner !== g.human.id) g.dropFromSelection(n);
      }
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
