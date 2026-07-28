// Pantalla de la sala de espera: lista de conectados, invitaciones y arranque
// de la partida en red.

import { Lobby, Peer } from './net/lobby.js';
import { exportOverrides } from './data/overrides.js';

const el = (id) => document.getElementById(id);

export class LobbyUI {
  /** onStart({ peer, role, seed, mapSize, names }) arranca la partida. */
  constructor(onStart) {
    this.onStart = onStart;
    this.lobby = new Lobby();
    this.peer = null;
    this.pendingInvite = null;
    this.opponent = null;
    this.starting = false;
    this.bind();
  }

  bind() {
    el('btn-multi').onclick = () => this.open();
    el('btn-lobby-enter').onclick = () => this.enter();
    el('btn-lobby-leave').onclick = () => this.close();
    el('btn-invite-accept').onclick = () => this.respond(true);
    el('btn-invite-decline').onclick = () => this.respond(false);
    el('lobby-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.enter();
    });

    this.lobby.addEventListener('players', (e) => this.renderPlayers(e.detail));
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
    } catch (err) {
      this.error(`No se pudo entrar en la sala: ${err.message}`);
    } finally {
      el('btn-lobby-enter').disabled = false;
    }
  }

  async close() {
    await this.lobby.leave();
    el('lobby').classList.add('hidden');
    el('main-menu').classList.remove('hidden');
    el('lobby-join').classList.remove('hidden');
    el('lobby-room').classList.add('hidden');
  }

  renderPlayers(players) {
    const list = el('lobby-players');
    const status = el('lobby-status');
    list.innerHTML = '';
    if (!players.length) {
      status.textContent = 'No hay nadie más conectado ahora mismo.';
      return;
    }
    status.textContent = `${players.length} jugador${players.length > 1 ? 'es' : ''} en la sala`;
    for (const p of players) {
      const li = document.createElement('li');
      li.className = 'lobby-player';
      const name = document.createElement('span');
      name.className = 'lobby-name';
      name.textContent = p.name;   // textContent: el nombre lo elige otro usuario
      const btn = document.createElement('button');
      btn.textContent = this.opponent === p.id ? 'Invitando...' : 'Invitar';
      btn.disabled = !!this.opponent || this.starting;
      btn.onclick = () => this.invite(p);
      li.append(name, btn);
      list.appendChild(li);
    }
  }

  async invite(player) {
    try {
      this.opponent = player.id;
      this.opponentName = player.name;
      this.lobby.fast = true;
      el('lobby-status').textContent = `Invitación enviada a ${player.name}, esperando respuesta...`;
      this.renderPlayers(this.lobby.players);
      await this.lobby.invite(player.id);
    } catch (err) {
      this.opponent = null;
      this.error(`No se pudo invitar: ${err.message}`);
    }
  }

  showInvite(inv) {
    if (this.starting || this.opponent) return;
    this.pendingInvite = inv;
    el('invite-text').textContent = `${inv.fromName} quiere jugar contigo.`;
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
    this.starting = true;
    this.lobby.fast = true;
    this.opponent = inv.from;
    this.opponentName = inv.fromName;
    el('lobby-status').textContent = `Conectando con ${inv.fromName}...`;
    this.peer = new Peer();
    this.waitTimer = setTimeout(() => {
      if (!this.peer?.ready) this.error('No se pudo conectar con el otro jugador. Volved a intentarlo.');
    }, 20000);
  }

  /** El invitado aceptó: como anfitrión, se envía la oferta de conexión. */
  async onAnswer(ans) {
    if (!ans.accepted) {
      this.opponent = null;
      el('lobby-status').textContent = `${ans.toName} no puede jugar ahora.`;
      this.renderPlayers(this.lobby.players);
      return;
    }
    if (this.starting) return;
    this.starting = true;
    this.lobby.fast = true;
    el('lobby-status').textContent = `${ans.toName} ha aceptado, conectando...`;
    this.peer = new Peer();
    this.role = 'host';
    const seed = (Math.random() * 4294967295) >>> 0;
    const mapSize = parseInt(el('lobby-size').value, 10);
    this.gameOpts = { seed, mapSize };
    const offer = await this.peer.createOffer();
    this.peer.addEventListener('open', () => this.launch('host'));
    await this.lobby.signal(ans.to, 'offer', JSON.stringify({
      sdp: offer, seed, mapSize, name: this.lobby.name, overrides: exportOverrides(),
    }));
  }

  /** Llega una oferta o una respuesta de conexión. */
  async onSignal(sig) {
    try {
      if (sig.kind === 'offer') {
        const payload = JSON.parse(sig.data);
        this.gameOpts = { seed: payload.seed, mapSize: payload.mapSize };
        this.hostOverrides = payload.overrides || null;
        this.opponentName = payload.name || this.opponentName;
        if (!this.peer) this.peer = new Peer();
        this.peer.addEventListener('open', () => this.launch('guest'));
        const answer = await this.peer.acceptOffer(payload.sdp);
        await this.lobby.signal(sig.from, 'answer', answer);
      } else if (sig.kind === 'answer' && this.peer) {
        await this.peer.acceptAnswer(sig.data);
      }
    } catch (err) {
      this.error(`Fallo al conectar: ${err.message}`);
    }
  }

  launch(role) {
    if (this.launched) return;
    this.launched = true;
    clearTimeout(this.waitTimer);
    this.lobby.pause();
    el('lobby').classList.add('hidden');
    el('invite-dialog').classList.add('hidden');
    const names = role === 'host'
      ? [this.lobby.name, this.opponentName || 'Rival']
      : [this.opponentName || 'Rival', this.lobby.name];
    this.onStart({
      peer: this.peer,
      role,
      seed: this.gameOpts.seed,
      mapSize: this.gameOpts.mapSize,
      names,
      overrides: this.hostOverrides,
    });
  }
}
