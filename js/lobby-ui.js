// Pantalla de la sala de espera: lista de conectados, invitaciones y arranque
// de la partida en red, de dos a ocho jugadores.
//
// Quien invita hace de anfitrión y arma la partida: va invitando gente, ve
// quién ha aceptado y decide cuándo empezar. Al empezar abre una conexión
// directa con cada invitado, y cuando todas están listas manda la señal de
// arranque para que todos generen el mismo mundo a la vez.

import { Lobby, Peer } from './net/lobby.js';
import { exportOverrides } from './data/overrides.js';
import { MAX_PLAYERS } from './config.js';

const el = (id) => document.getElementById(id);

const CONNECT_MS = 25000;   // margen para que se abran todas las conexiones
const WAIT_MS = 120000;     // margen del invitado esperando a que empiecen

export class LobbyUI {
  /** onStart({ role, links, seed, mapSize, names, localPlayer, absent }). */
  constructor(onStart) {
    this.onStart = onStart;
    this.lobby = new Lobby();
    this.mode = null;        // 'host' mientras armo partida, 'guest' si me uní
    this.party = [];         // invitados: { id, name, state, inviteId, peer, slot }
    this.host = null;        // como invitado: { id, name }
    this.pendingInvite = null;
    this.starting = false;
    this.launched = false;
    this.bind();
  }

  bind() {
    el('btn-multi').onclick = () => this.open();
    el('btn-lobby-enter').onclick = () => this.enter();
    el('btn-lobby-leave').onclick = () => this.close();
    el('btn-lobby-start').onclick = () => this.startParty();
    el('btn-lobby-cancel').onclick = () => this.cancelParty();
    el('btn-invite-accept').onclick = () => this.respond(true);
    el('btn-invite-decline').onclick = () => this.respond(false);
    el('lobby-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.enter();
    });

    this.lobby.addEventListener('players', (e) => this.onPlayers(e.detail));
    this.lobby.addEventListener('invite', (e) => this.showInvite(e.detail));
    this.lobby.addEventListener('answer', (e) => this.onAnswer(e.detail));
    this.lobby.addEventListener('signal', (e) => this.onSignal(e.detail));
    this.lobby.addEventListener('error', (e) => {
      this.error(`No se puede contactar con la sala: ${e.detail.message}. `
        + 'Si abriste el juego como archivo local, prueba con el servidor de desarrollo.');
    });
  }

  open() {
    el('main-menu').classList.add('hidden');
    el('lobby').classList.remove('hidden');
    const saved = localStorage.getItem('aor-name') || '';
    el('lobby-name').value = saved;
    el('lobby-name').focus();
  }

  error(msg) {
    const box = el('lobby-error');
    box.textContent = msg;
    box.classList.toggle('hidden', !msg);
  }

  status(msg) { el('lobby-status').textContent = msg; }

  async enter() {
    const name = el('lobby-name').value.trim();
    if (!name) { el('lobby-name').focus(); this.error('Escribe un nombre para que te reconozcan.'); return; }
    localStorage.setItem('aor-name', name);
    this.error('');
    el('btn-lobby-enter').disabled = true;
    try {
      const me = await this.lobby.join(name);
      el('lobby-me').textContent = me.name;
      el('lobby-join').classList.add('hidden');
      el('lobby-room').classList.remove('hidden');
      this.renderPlayers([]);
      this.renderParty();
    } catch (err) {
      this.error(`No se pudo entrar en la sala: ${err.message}`);
    } finally {
      el('btn-lobby-enter').disabled = false;
    }
  }

  async close() {
    this.cancelParty(true);
    await this.lobby.leave();
    el('lobby').classList.add('hidden');
    el('main-menu').classList.remove('hidden');
    el('lobby-join').classList.remove('hidden');
    el('lobby-room').classList.add('hidden');
  }

  // --- Lista de la sala ------------------------------------------------------

  onPlayers(players) {
    // Si alguien de la partida se va de la sala antes de empezar, se le quita.
    if (this.mode === 'host' && !this.starting && this.party.length) {
      const here = new Set(players.map((p) => p.id));
      const gone = this.party.filter((m) => !here.has(m.id));
      for (const m of gone) this.dropMember(m, `${m.name} ha salido de la sala.`);
    }
    if (this.mode === 'guest' && !this.starting && this.host) {
      if (!players.some((p) => p.id === this.host.id)) {
        const name = this.host.name;
        this.leaveParty();
        this.status(`${name} ha salido de la sala.`);
      }
    }
    this.renderPlayers(players);
  }

  get full() { return 1 + this.party.length >= MAX_PLAYERS; }

  renderPlayers(players) {
    const list = el('lobby-players');
    list.innerHTML = '';
    if (!players.length) {
      el('lobby-count').textContent = 'nadie más por ahora';
      if (!this.mode) this.status('Esperando a que se conecte alguien más...');
      return;
    }
    el('lobby-count').textContent = `${players.length} ${players.length > 1 ? 'conectados' : 'conectado'}`;
    if (!this.mode) this.status('Invita a quien quieras: hasta ocho jugadores por partida.');

    for (const p of players) {
      const li = document.createElement('li');
      li.className = 'lobby-player';
      const name = document.createElement('span');
      name.className = 'lobby-name';
      name.textContent = p.name;   // textContent: el nombre lo elige otro usuario
      li.appendChild(name);

      const member = this.party.find((m) => m.id === p.id);
      if (member) {
        const tag = document.createElement('span');
        tag.className = 'lobby-tag';
        tag.textContent = member.state === 'ready' ? 'En tu partida' : 'Invitado';
        li.appendChild(tag);
      } else if (p.busy) {
        const tag = document.createElement('span');
        tag.className = 'lobby-tag muted';
        tag.textContent = 'Ocupado';
        li.appendChild(tag);
      } else if (this.mode !== 'guest') {
        const btn = document.createElement('button');
        btn.textContent = 'Invitar';
        btn.disabled = this.starting || this.full;
        btn.onclick = () => this.invite(p);
        li.appendChild(btn);
      }
      list.appendChild(li);
    }
  }

  /** La partida que se está montando: yo y los invitados, con su estado. */
  renderParty() {
    const box = el('lobby-party-box');
    const list = el('lobby-party');
    const startBtn = el('btn-lobby-start');
    if (!this.mode) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    list.innerHTML = '';

    const rows = this.mode === 'host'
      ? [{ name: this.lobby.name, note: 'anfitrión (tú)' },
        ...this.party.map((m) => ({ name: m.name, note: PARTY_STATE[m.state] || '' }))]
      : [{ name: this.host?.name || '', note: 'anfitrión' },
        { name: this.lobby.name, note: 'tú' }];

    rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = 'party-slot';
      const dot = document.createElement('span');
      dot.className = `party-color c${i}`;
      const name = document.createElement('span');
      name.className = 'lobby-name';
      name.textContent = row.name;
      const note = document.createElement('span');
      note.className = 'lobby-tag muted';
      note.textContent = row.note;
      li.append(dot, name, note);
      list.appendChild(li);
    });

    const total = this.mode === 'host' ? 1 + this.party.length : rows.length;
    el('lobby-party-count').textContent = `${total}/${MAX_PLAYERS}`;
    const ready = this.party.filter((m) => m.state === 'ready').length;
    startBtn.classList.toggle('hidden', this.mode !== 'host');
    startBtn.disabled = this.starting || ready < 1;
    startBtn.textContent = ready > 0 ? `Empezar partida (${ready + 1})` : 'Empezar partida';
    el('btn-lobby-cancel').textContent = this.mode === 'host' ? 'Cancelar partida' : 'Salir de la partida';
    el('btn-lobby-cancel').classList.toggle('hidden', this.starting);
  }

  // --- Anfitrión -------------------------------------------------------------

  async invite(player) {
    if (this.starting || this.full) return;
    this.mode = 'host';
    this.lobby.busy = true;
    this.lobby.fast = true;
    const member = { id: player.id, name: player.name, state: 'invited', inviteId: null };
    this.party.push(member);
    this.status(`Invitación enviada a ${player.name}.`);
    this.renderPlayers(this.lobby.players);
    this.renderParty();
    try {
      const r = await this.lobby.invite(player.id);
      member.inviteId = r.inviteId;
    } catch (err) {
      this.dropMember(member, `No se pudo invitar a ${player.name}: ${err.message}`);
    }
  }

  dropMember(member, msg) {
    const i = this.party.indexOf(member);
    if (i >= 0) this.party.splice(i, 1);
    if (member.inviteId) this.lobby.cancel(member.inviteId).catch(() => {});
    try { member.peer?.close(); } catch { /* aún no había conexión */ }
    if (msg) this.status(msg);
    if (!this.party.length && this.mode === 'host' && !this.starting) this.leaveParty();
    else { this.renderParty(); this.renderPlayers(this.lobby.players); }
  }

  /** Vuelve al estado de sala, sin partida en marcha. */
  leaveParty() {
    for (const m of this.party) {
      if (m.inviteId) this.lobby.cancel(m.inviteId).catch(() => {});
      try { m.peer?.close(); } catch { /* nada que cerrar */ }
    }
    this.party = [];
    this.host = null;
    this.mode = null;
    this.starting = false;
    this.lobby.busy = false;
    this.lobby.fast = false;
    clearTimeout(this.waitTimer);
    clearTimeout(this.startTimer);
    this.renderParty();
    this.renderPlayers(this.lobby.players);
  }

  cancelParty(quiet = false) {
    if (!this.mode || this.launched) return;
    const wasHost = this.mode === 'host';
    this.leaveParty();
    if (!quiet) this.status(wasHost ? 'Partida cancelada.' : 'Has salido de la partida.');
  }

  /** Respuesta de un invitado a mi invitación. */
  onAnswer(ans) {
    const member = this.party.find((m) => m.id === ans.to);
    if (!member) return;
    if (!ans.accepted) {
      this.dropMember(member, `${ans.toName} no puede jugar ahora.`);
      return;
    }
    member.state = 'ready';
    this.status(`${ans.toName} se ha unido a la partida.`);
    this.renderParty();
    this.renderPlayers(this.lobby.players);
  }

  /**
   * Arranca la partida: se abre una conexión con cada invitado listo y, cuando
   * están todas (o se agota el margen), se avisa a todos de que empiecen.
   */
  async startParty() {
    if (this.starting || this.mode !== 'host') return;
    const ready = this.party.filter((m) => m.state === 'ready');
    if (!ready.length) return;

    this.starting = true;
    // Los que aún no han contestado se quedan fuera de esta partida.
    for (const m of [...this.party]) if (m.state !== 'ready') this.dropMember(m, '');
    this.roster = ready;
    ready.forEach((m, i) => { m.slot = i + 1; });

    const seed = (Math.random() * 4294967295) >>> 0;
    const mapSize = parseInt(el('lobby-size').value, 10);
    const names = [this.lobby.name, ...ready.map((m) => m.name)];
    this.gameOpts = { seed, mapSize, names };
    this.status('Conectando con los demás jugadores...');
    this.renderParty();
    this.renderPlayers(this.lobby.players);

    const overrides = exportOverrides();
    // Las ofertas se preparan a la vez: cada una tarda lo suyo en reunir sus
    // candidatos de red y hacerlo en fila sería una espera larguísima.
    await Promise.all(ready.map(async (m) => {
      try {
        m.peer = new Peer();
        m.peer.addEventListener('open', () => this.onMemberOpen(m));
        const sdp = await m.peer.createOffer();
        await this.lobby.signal(m.id, 'offer', JSON.stringify({
          sdp, seed, mapSize, names, slot: m.slot, playerCount: names.length, overrides,
        }));
      } catch (err) {
        this.error(`No se pudo conectar con ${m.name}: ${err.message}`);
      }
    }));

    // Si alguno se queda por el camino se empieza sin él, no se deja tirados
    // a los que sí llegaron.
    this.startTimer = setTimeout(() => this.launchHost(), CONNECT_MS);
  }

  onMemberOpen(member) {
    member.state = 'online';
    const pending = this.roster.filter((m) => !m.peer?.ready).length;
    this.status(pending ? `Conectando... faltan ${pending}` : 'Todo listo, empezando...');
    this.renderParty();
    if (!pending) this.launchHost();
  }

  launchHost() {
    if (this.launched) return;
    this.launched = true;
    clearTimeout(this.startTimer);

    const connected = this.roster.filter((m) => m.peer?.ready);
    const absent = this.roster.filter((m) => !m.peer?.ready).map((m) => m.slot);
    for (const m of this.roster) if (!m.peer?.ready) { try { m.peer?.close(); } catch { /* ya estaba */ } }
    if (!connected.length) {
      this.launched = false;
      this.leaveParty();
      this.error('No se pudo conectar con ningún jugador. Volved a intentarlo.');
      return;
    }
    // La señal de arranque lleva a quién no se pudo esperar, para que todos
    // monten exactamente el mismo mundo.
    for (const m of connected) m.peer.send(JSON.stringify({ t: 'start', absent }));

    this.finish({
      role: 'host',
      links: connected.map((m) => ({ playerId: m.slot, peer: m.peer })),
      seed: this.gameOpts.seed,
      mapSize: this.gameOpts.mapSize,
      names: this.gameOpts.names,
      playerCount: this.gameOpts.names.length,
      localPlayer: 0,
      absent,
    });
  }

  // --- Invitado --------------------------------------------------------------

  showInvite(inv) {
    if (this.launched || this.mode) return;   // ya estoy en una partida
    this.pendingInvite = inv;
    el('invite-text').textContent = `${inv.fromName} te invita a su partida.`;
    el('invite-dialog').classList.remove('hidden');
  }

  async respond(accept) {
    const inv = this.pendingInvite;
    el('invite-dialog').classList.add('hidden');
    this.pendingInvite = null;
    if (!inv) return;
    try {
      await this.lobby.respond(inv.inviteId, accept);
    } catch (err) {
      this.error(`No se pudo responder: ${err.message}`);
      return;
    }
    if (!accept) return;

    // Quien acepta hace de invitado: espera la oferta del anfitrión.
    this.mode = 'guest';
    this.host = { id: inv.from, name: inv.fromName };
    this.lobby.busy = true;
    this.lobby.fast = true;
    this.status(`Esperando a que ${inv.fromName} empiece la partida...`);
    this.renderParty();
    this.renderPlayers(this.lobby.players);
    this.waitTimer = setTimeout(() => {
      if (this.launched || this.starting) return;
      this.leaveParty();
      this.status('La partida no llegó a empezar.');
    }, WAIT_MS);
  }

  /** Llega una oferta (invitado) o una respuesta de conexión (anfitrión). */
  async onSignal(sig) {
    try {
      if (sig.kind === 'offer') {
        if (this.launched || this.mode !== 'guest' || sig.from !== this.host?.id) return;
        const payload = JSON.parse(sig.data);
        this.starting = true;
        clearTimeout(this.waitTimer);
        this.gameOpts = {
          seed: payload.seed,
          mapSize: payload.mapSize,
          names: payload.names || [],
          playerCount: payload.playerCount || (payload.names || []).length,
          slot: payload.slot ?? 1,
        };
        this.hostOverrides = payload.overrides || null;
        this.status('Conectando con el anfitrión...');
        this.renderParty();
        this.peer = new Peer();
        // El anfitrión avisa por el propio canal cuando todos están listos.
        this.peer.addEventListener('raw', (e) => this.onRaw(e.detail));
        const answer = await this.peer.acceptOffer(payload.sdp);
        await this.lobby.signal(sig.from, 'answer', answer);
        this.waitTimer = setTimeout(() => {
          if (!this.launched) this.error('No se pudo conectar con el anfitrión. Volved a intentarlo.');
        }, CONNECT_MS + 10000);
      } else if (sig.kind === 'answer' && this.mode === 'host') {
        const member = this.party.find((m) => m.id === sig.from);
        if (member?.peer) await member.peer.acceptAnswer(sig.data);
      }
    } catch (err) {
      this.error(`Fallo al conectar: ${err.message}`);
    }
  }

  onRaw(data) {
    if (typeof data !== 'string' || this.launched) return;
    let msg = null;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || msg.t !== 'start') return;
    this.launched = true;
    clearTimeout(this.waitTimer);
    this.finish({
      role: 'guest',
      links: [{ playerId: 0, peer: this.peer }],
      seed: this.gameOpts.seed,
      mapSize: this.gameOpts.mapSize,
      names: this.gameOpts.names,
      playerCount: this.gameOpts.playerCount,
      localPlayer: this.gameOpts.slot,
      absent: msg.absent || [],
      overrides: this.hostOverrides,
    });
  }

  // --- Arranque --------------------------------------------------------------

  finish(opts) {
    this.lobby.pause();
    el('lobby').classList.add('hidden');
    el('invite-dialog').classList.add('hidden');
    this.onStart(opts);
  }
}

const PARTY_STATE = {
  invited: 'esperando respuesta',
  ready: 'listo',
  online: 'conectado',
};
