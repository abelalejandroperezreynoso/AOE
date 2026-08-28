// Pantalla de la sala de espera: lista de conectados, invitaciones y arranque
// de la partida en red, de dos a ocho jugadores.
//
// Quien invita hace de anfitrión y arma la partida: va invitando gente, ve
// quién ha aceptado y decide cuándo empezar. Al empezar abre una conexión
// directa con cada invitado, y cuando todas están listas manda la señal de
// arranque para que todos generen el mismo mundo a la vez.
//
// Con tres o más personas es normal que dos se inviten a la vez, o que alguien
// llegue cuando la partida ya se está montando. Por eso ninguna invitación se
// queda sin respuesta: o se acepta, o se convierte en una petición para entrar
// en la partida que ya llevo, o se rechaza al momento para que quien invitó no
// se quede esperando (y bloqueado, porque quien espera figura como ocupado).

import { Lobby, Peer } from './net/lobby.js';
import { exportOverrides } from './data/overrides.js';
import { shareableDesigns } from './data/designs.js';
import { MAX_PLAYERS } from './config.js';

const el = (id) => document.getElementById(id);

const CONNECT_MS = 25000;   // margen para que se abran todas las conexiones
const WAIT_MS = 120000;     // margen del invitado esperando a que empiecen
const ASK_MS = 30000;       // margen esperando a que el anfitrión me deje entrar
const HINT_MS = 8000;       // lo que dura un aviso antes de volver la ayuda

export class LobbyUI {
  /** onStart({ role, links, seed, mapSize, names, localPlayer, absent }). */
  constructor(onStart) {
    this.onStart = onStart;
    this.lobby = new Lobby();
    // 'host' mientras armo partida, 'guest' si me uní, 'asking' mientras espero
    // a que un anfitrión me deje entrar en la suya.
    this.mode = null;
    this.party = [];         // invitados: { id, name, state, inviteId, peer, slot }
    this.host = null;        // como invitado: { id, name }
    this.dialog = null;      // aviso en pantalla: { kind: 'invite'|'join', inv }
    this.queue = [];         // avisos que esperan a que se cierre el de delante
    this.asked = null;       // a quién le he pedido entrar
    this.askedName = '';
    this.askId = null;
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
    this.lobby.addEventListener('invites', (e) => this.syncInvites(e.detail));
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

  status(msg) {
    el('lobby-status').textContent = msg;
    this.statusAt = performance.now();
  }

  /** Texto de ayuda de fondo: no pisa un aviso que se acabe de dar. */
  hint(msg) {
    if (performance.now() - (this.statusAt ?? -HINT_MS) > HINT_MS) this.status(msg);
  }

  /**
   * Cómo me ven los demás en su lista. `open` es lo que permite que alguien que
   * llega tarde pueda pedirme entrar en la partida que estoy montando.
   */
  syncPresence() {
    this.lobby.busy = this.mode === 'host' || this.mode === 'guest';
    this.lobby.open = this.mode === 'host' && !this.starting && !this.launched && !this.full;
    this.lobby.fast = !!this.mode;
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
      this.renderParty();
    } catch (err) {
      this.error(`No se pudo entrar en la sala: ${err.message}`);
    } finally {
      el('btn-lobby-enter').disabled = false;
    }
  }

  async close() {
    // Quien tuviera un aviso mío en pantalla se queda sin respuesta si me voy
    // sin contestar, así que se rechaza al salir.
    if (this.dialog) { this.refuse(this.dialog.inv); this.closeDialog(); }
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
    // A quien le pedí entrar ya no está: al arrancar la partida deja de
    // anunciarse, así que lo más probable es que haya empezado sin mí.
    if (this.mode === 'asking' && !players.some((p) => p.id === this.asked)) {
      this.cancelAsk(`${this.askedName} ya no está en la sala.`);
      return;
    }
    this.renderPlayers(players);
  }

  get full() { return 1 + this.party.length >= MAX_PLAYERS; }

  renderPlayers(players) {
    const list = el('lobby-players');
    list.innerHTML = '';
    if (!players.length) {
      el('lobby-count').textContent = 'nadie más por ahora';
      if (!this.mode) this.hint('Esperando a que se conecte alguien más...');
      return;
    }
    el('lobby-count').textContent = `${players.length} ${players.length > 1 ? 'conectados' : 'conectado'}`;
    if (!this.mode) this.hint('Invita a quien quieras: hasta ocho jugadores por partida.');

    for (const p of players) {
      const li = document.createElement('li');
      li.className = 'lobby-player';
      const name = document.createElement('span');
      name.className = 'lobby-name';
      name.textContent = p.name;   // textContent: el nombre lo elige otro usuario
      li.appendChild(name);

      const tag = (text, muted = false) => {
        const s = document.createElement('span');
        s.className = muted ? 'lobby-tag muted' : 'lobby-tag';
        s.textContent = text;
        li.appendChild(s);
      };
      const button = (text, onclick) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.onclick = onclick;
        li.appendChild(btn);
      };

      const member = this.party.find((m) => m.id === p.id);
      if (member) tag(member.state === 'ready' ? 'En tu partida' : 'Invitado');
      else if (this.asked === p.id) tag('Le has pedido entrar', true);
      // Quien monta una partida y aún admite gente: se le puede pedir entrar
      // en vez de quedarse mirando cómo empieza sin uno.
      else if (p.open && !this.mode) button('Pedir unirse', () => this.requestJoin(p));
      else if (p.busy || p.open) tag('Ocupado', true);
      else if ((!this.mode || this.mode === 'host') && !this.starting && !this.full) {
        button('Invitar', () => this.invite(p));
      }
      list.appendChild(li);
    }
  }

  /** La partida que se está montando: yo y los invitados, con su estado. */
  renderParty() {
    const box = el('lobby-party-box');
    const list = el('lobby-party');
    const startBtn = el('btn-lobby-start');
    list.innerHTML = '';   // sin partida no debe quedar rastro de la anterior
    if (!this.mode) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');

    const rows = this.mode === 'host'
      ? [{ name: this.lobby.name, note: 'anfitrión (tú)' },
        ...this.party.map((m) => ({ name: m.name, note: PARTY_STATE[m.state] || '' }))]
      : this.mode === 'asking'
        ? [{ name: this.askedName, note: 'anfitrión' },
          { name: this.lobby.name, note: 'esperando su respuesta' }]
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
    const waiting = this.party.length - ready;
    startBtn.classList.toggle('hidden', this.mode !== 'host');
    startBtn.disabled = this.starting || ready < 1;
    // Empezar con alguien sin contestar lo deja fuera, así que se avisa en el
    // propio botón antes de pulsarlo.
    startBtn.textContent = !ready ? 'Empezar partida'
      : waiting ? `Empezar sin esperar (${ready + 1})`
        : `Empezar partida (${ready + 1})`;
    el('btn-lobby-cancel').textContent = this.mode === 'host' ? 'Cancelar partida'
      : this.mode === 'asking' ? 'Retirar la petición' : 'Salir de la partida';
    el('btn-lobby-cancel').classList.toggle('hidden', this.starting);
  }

  // --- Anfitrión -------------------------------------------------------------

  /** `reply`: si con esto contesto que sí a su petición de entrar, cuál era. */
  async invite(player, reply = '') {
    if (this.starting || this.full || this.mode === 'guest') return;
    this.mode = 'host';
    this.syncPresence();
    const member = { id: player.id, name: player.name, state: 'invited', inviteId: null };
    this.party.push(member);
    this.status(`Invitación enviada a ${player.name}.`);
    this.renderPlayers(this.lobby.players);
    this.renderParty();
    try {
      const ready = this.party.filter((m) => m.state === 'ready').length;
      const r = await this.lobby.invite(player.id, ready, reply);
      member.inviteId = r.inviteId;
      // Puede haberse ido mientras se enviaba: entonces hay que retirarla, que
      // si no le llega una invitación a una partida que ya no existe.
      if (!this.party.includes(member)) this.lobby.cancel(r.inviteId).catch(() => {});
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
    if (!this.party.length && this.mode === 'host' && !this.starting) this.leaveParty(!!msg);
    else { this.syncPresence(); this.renderParty(); this.renderPlayers(this.lobby.players); }
  }

  /** Vuelve al estado de sala, sin partida en marcha. */
  leaveParty(keepStatus = false) {
    for (const m of this.party) {
      if (m.inviteId) this.lobby.cancel(m.inviteId).catch(() => {});
      try { m.peer?.close(); } catch { /* nada que cerrar */ }
    }
    if (this.askId) this.lobby.cancel(this.askId).catch(() => {});
    this.party = [];
    this.host = null;
    this.mode = null;
    this.starting = false;
    this.asked = null;
    this.askId = null;
    clearTimeout(this.waitTimer);
    clearTimeout(this.startTimer);
    clearTimeout(this.askTimer);
    this.syncPresence();
    this.renderParty();
    // El aviso de por qué se deshizo la partida no se pisa con la ayuda.
    if (!keepStatus) this.statusAt = -HINT_MS;
    this.renderPlayers(this.lobby.players);
  }

  cancelParty(quiet = false) {
    if (!this.mode || this.launched) return;
    const was = this.mode;
    this.leaveParty(true);
    if (quiet) return;
    this.status(was === 'host' ? 'Partida cancelada.'
      : was === 'asking' ? 'Has retirado tu petición.' : 'Has salido de la partida.');
  }

  /** Respuesta a una invitación mía: de un invitado, o del anfitrión al que pedí entrar. */
  onAnswer(ans) {
    if (this.mode === 'asking' && ans.inviteId === this.askId) {
      if (!ans.accepted) this.cancelAsk(`${ans.toName} no te ha dejado entrar en su partida.`);
      return;
    }
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
    this.syncPresence();
    // Los que aún no han contestado se quedan fuera de esta partida; a ellos se
    // les retira la invitación y en su pantalla se cierra el aviso.
    const waiting = this.party.filter((m) => m.state !== 'ready');
    for (const m of waiting) this.dropMember(m, '');
    this.roster = ready;
    ready.forEach((m, i) => { m.slot = i + 1; });

    const seed = (Math.random() * 4294967295) >>> 0;
    const mapSize = parseInt(el('lobby-size').value, 10);
    const names = [this.lobby.name, ...ready.map((m) => m.name)];
    this.gameOpts = { seed, mapSize, names };
    this.status(waiting.length
      ? `Empezando sin ${waiting.map((m) => m.name).join(', ')}: no llegó a aceptar.`
      : 'Conectando con los demás jugadores...');
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
    // Las caras que el anfitrión les haya hecho a los edificios viajan aquí:
    // sus invitados verán en el mapa los mismos edificios que él.
    const designs = shareableDesigns();
    for (const m of connected) m.peer.send(JSON.stringify({ t: 'start', absent, designs }));

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

  // --- Invitaciones que me llegan --------------------------------------------

  /**
   * Ninguna invitación se queda sin respuesta: quien invita se bloquea mientras
   * espera, así que si no puedo aceptarla se rechaza en el acto.
   */
  showInvite(inv) {
    // Es el anfitrión al que le pedí entrar, contestando que sí.
    if (this.mode === 'asking' && inv.from === this.asked) { this.joinAccepted(inv); return; }
    if (this.launched || this.starting) { this.refuse(inv); return; }

    // Contesta que sí a lo que yo le pedí, aunque se lo pidiera con el botón de
    // invitar. Que él lo haya aceptado a mano manda sobre cualquier otra regla:
    // deshago mi partida y me voy a la suya.
    if (inv.reply && this.party.some((m) => m.inviteId === inv.reply)) {
      this.leaveParty(true);
      this.accept(inv);
      return;
    }

    // Nos hemos invitado a la vez. Si cada uno espera al otro no empieza nadie,
    // así que cede el que tenga menos gente confirmada (y si empatan, siempre
    // el mismo): deshace su partida y se mete en la del otro. El que no cede
    // contesta que no, y así el otro tampoco se queda esperando.
    const crossed = this.mode === 'host' && this.party.find((m) => m.id === inv.from);
    if (crossed) {
      if (this.yieldsTo(inv)) { this.leaveParty(true); this.accept(inv); }
      else this.refuse(inv);   // mi invitación le sigue esperando
      return;
    }

    // Con varios avisos a la vez se atienden de uno en uno, en vez de que el
    // último tape al anterior.
    if (this.dialog) { if (this.queue.length < 4) this.queue.push(inv); else this.refuse(inv); return; }
    // Estoy montando una partida y aún cabe gente: quien me invita en realidad
    // quiere jugar conmigo, así que se lo planteo como petición para entrar.
    if (this.mode === 'host' && !this.full) { this.askJoin(inv); return; }
    if (this.mode) { this.refuse(inv); return; }

    this.dialog = { kind: 'invite', inv };
    el('invite-title').textContent = 'Te han invitado';
    el('invite-text').textContent = `${inv.fromName} te invita a su partida.`;
    el('btn-invite-accept').textContent = 'Aceptar y jugar';
    el('btn-invite-decline').textContent = 'Ahora no';
    el('invite-dialog').classList.remove('hidden');
  }

  /**
   * Nos hemos invitado a la vez: ¿quién deshace su partida y se une a la del
   * otro? Manda quien ya tenga gente confirmada, que deshacer la suya dejaría
   * a más gente colgada; a igualdad decide el identificador, que es lo único
   * en lo que los dos ven lo mismo.
   */
  yieldsTo(inv) {
    const mine = this.party.filter((m) => m.state === 'ready').length;
    const theirs = inv.ready || 0;
    return mine === theirs ? this.lobby.id > inv.from : mine < theirs;
  }

  /** Alguien quiere entrar en la partida que estoy montando. */
  askJoin(inv) {
    this.dialog = { kind: 'join', inv };
    el('invite-title').textContent = 'Quieren entrar';
    el('invite-text').textContent = `${inv.fromName} quiere unirse a tu partida.`;
    el('btn-invite-accept').textContent = 'Dejarle entrar';
    el('btn-invite-decline').textContent = 'Ahora no';
    el('invite-dialog').classList.remove('hidden');
  }

  closeDialog() {
    this.dialog = null;
    el('invite-dialog').classList.add('hidden');
  }

  /** Siguiente aviso en la cola, si es que aún tiene sentido enseñarlo. */
  showNext() {
    const inv = this.queue.shift();
    if (inv) this.showInvite(inv);
  }

  /** Botones del aviso: vale tanto para una invitación como para una petición. */
  respond(accept) {
    const d = this.dialog;
    this.closeDialog();
    if (!d) return;
    if (d.kind === 'join') {
      // Dejarle entrar es invitarle: la invitación va marcada como respuesta a
      // su petición, así que se acepta sola al otro lado.
      if (accept && this.mode === 'host' && !this.starting && !this.full) {
        this.invite({ id: d.inv.from, name: d.inv.fromName }, d.inv.inviteId);
      } else {
        this.refuse(d.inv);
      }
    } else if (accept) {
      this.accept(d.inv);
    } else {
      this.refuse(d.inv);
    }
    this.showNext();
  }

  /** Que no se quede esperando: se le contesta que ahora no. */
  refuse(inv) {
    this.lobby.respond(inv.inviteId, false).catch(() => {});
  }

  /** Si la invitación del aviso ya no está, se cierra en vez de dejarlo colgado. */
  syncInvites(list) {
    const vivas = new Set(list.map((i) => i.inviteId));
    this.queue = this.queue.filter((inv) => vivas.has(inv.inviteId));
    const d = this.dialog;
    if (!d || vivas.has(d.inv.inviteId)) return;
    this.closeDialog();
    this.status(d.kind === 'join'
      ? `${d.inv.fromName} ya no espera entrar.`
      : `La invitación de ${d.inv.fromName} ya no está: ha empezado sin ti.`);
    this.showNext();
  }

  /** Entro como invitado en la partida de quien me invitó. */
  async accept(inv) {
    try {
      await this.lobby.respond(inv.inviteId, true);
    } catch (err) {
      this.error(`No se pudo aceptar: ${err.message}`);
      return;
    }
    this.mode = 'guest';
    this.host = { id: inv.from, name: inv.fromName };
    this.syncPresence();
    this.status(`Esperando a que ${inv.fromName} empiece la partida...`);
    this.renderParty();
    this.renderPlayers(this.lobby.players);
    this.waitTimer = setTimeout(() => {
      if (this.launched || this.starting) return;
      this.leaveParty(true);
      this.status('La partida no llegó a empezar.');
    }, WAIT_MS);
  }

  // --- Pedir entrar en una partida que ya se está montando --------------------

  /**
   * El anfitrión ya está ocupado invitando gente, así que no puede invitarme
   * desde la lista: la petición viaja como una invitación suya al revés, y él
   * la ve como "quiere unirse a tu partida".
   */
  async requestJoin(player) {
    if (this.mode) return;
    this.mode = 'asking';
    this.asked = player.id;
    this.askedName = player.name;
    this.syncPresence();
    this.status(`Le has pedido a ${player.name} entrar en su partida.`);
    this.renderParty();
    this.renderPlayers(this.lobby.players);
    try {
      const r = await this.lobby.invite(player.id);
      if (this.asked !== player.id) { this.lobby.cancel(r.inviteId).catch(() => {}); return; }
      this.askId = r.inviteId;
    } catch (err) {
      this.cancelAsk(`No se pudo pedir entrar: ${err.message}`);
      return;
    }
    this.askTimer = setTimeout(() => this.cancelAsk(`${player.name} no ha contestado.`), ASK_MS);
  }

  cancelAsk(msg) {
    if (this.mode !== 'asking') return;
    this.leaveParty(true);
    if (msg) this.status(msg);
  }

  /** Me han dejado entrar: la invitación del anfitrión se acepta sin preguntar. */
  joinAccepted(inv) {
    clearTimeout(this.askTimer);
    if (this.askId) this.lobby.cancel(this.askId).catch(() => {});
    this.askId = null;
    this.asked = null;
    this.mode = null;
    this.accept(inv);
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
      designs: msg.designs || [],
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
