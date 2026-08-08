// Cliente de la sala de espera y establecimiento de las conexiones entre los
// jugadores (hasta ocho por partida).
//
// El sondeo al servidor sólo ocurre mientras se está en la sala: en cuanto la
// partida arranca se detiene, porque a partir de ahí todo va directo de un
// navegador a otro.

const ENDPOINT = '/api/lobby';
const POLL_MS = 2000;
const POLL_FAST_MS = 500;  // mientras se negocia la conexión, para no hacer esperar
const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export class Lobby extends EventTarget {
  constructor(endpoint = ENDPOINT) {
    super();
    this.endpoint = endpoint;
    this.id = null;
    this.token = null;
    this.name = '';
    this.players = [];
    this.polling = false;
    this.seenAnswers = new Set();   // para no reaccionar dos veces a lo mismo
    this.seenInvites = new Set();
    this.pendingOut = null;         // invitación que he enviado
    this.pendingIn = null;          // invitación que he recibido
    this.failures = 0;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async call(action, params = {}) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id: this.id, token: this.token, ...params }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `error ${res.status}`);
    return body;
  }

  async join(name) {
    const r = await this.call('hello', { name });
    this.id = r.id; this.token = r.token; this.name = r.name;
    this.polling = true;
    this.loop();
    return r;
  }

  async leave() {
    this.polling = false;
    clearTimeout(this.timer);
    if (this.id) { try { await this.call('bye'); } catch { /* da igual */ } }
  }

  /** Deja de anunciarse mientras dura la partida, sin perder la identidad. */
  pause() { this.polling = false; clearTimeout(this.timer); }

  async loop() {
    if (!this.polling) return;
    try {
      const r = await this.call('poll', { name: this.name, busy: !!this.busy, open: !!this.open });
      this.failures = 0;
      this.players = r.players;
      this.emit('players', r.players);

      // La lista completa, no sólo las nuevas: sirve para cerrar un aviso en
      // pantalla cuando la invitación que lo abrió ya no está.
      this.emit('invites', r.invites);
      for (const inv of r.invites) {
        if (this.seenInvites.has(inv.inviteId)) continue;
        this.seenInvites.add(inv.inviteId);
        this.pendingIn = inv;
        this.emit('invite', inv);
      }
      for (const ans of r.answers) {
        if (this.seenAnswers.has(ans.inviteId)) continue;
        this.seenAnswers.add(ans.inviteId);
        this.emit('answer', ans);
      }
      for (const sig of r.signals) this.emit('signal', sig);
    } catch (err) {
      this.failures++;
      if (this.failures === 3) this.emit('error', err);
    }
    if (this.polling) this.timer = setTimeout(() => this.loop(), this.fast ? POLL_FAST_MS : POLL_MS);
  }

  /** `ready`: gente ya confirmada en mi partida, para deshacer empates. */
  invite(toId, ready = 0) { return this.call('invite', { to: toId, ready }); }
  cancel(inviteId) { return this.call('cancel', { inviteId }); }
  respond(inviteId, accept) { return this.call('respond', { inviteId, accept }); }
  signal(to, kind, data) { return this.call('signal', { to, kind, data }); }
}

/**
 * Conexión directa entre dos navegadores. Se espera a reunir todos los
 * candidatos antes de enviar la oferta o la respuesta: así basta con dos
 * mensajes a través de la sala y no hay que ir mandándolos de uno en uno.
 *
 * El anfitrión abre una de estas por cada invitado; el invitado sólo abre la
 * suya con el anfitrión.
 */
export class Peer extends EventTarget {
  constructor() {
    super();
    this.pc = new RTCPeerConnection({ iceServers: ICE });
    this.channel = null;
    this.closed = false;
    // Lo que llegue antes de que la partida esté montada se guarda y se
    // entrega al arrancar: si no, se perderían las primeras órdenes o
    // instantáneas mientras se genera el mundo.
    this.hold = true;
    this.held = [];
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'disconnected' || s === 'closed') this.emit('lost', s);
    };
    this.pc.ondatachannel = (e) => this.attach(e.channel);
    this.hasCandidate = false;
    this.pc.onicecandidate = (e) => { if (e.candidate) this.hasCandidate = true; };
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  attach(channel) {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => this.emit('open');
    channel.onclose = () => this.emit('lost', 'canal cerrado');
    channel.onmessage = (e) => {
      // 'raw' llega siempre: la sala lo usa para oír la señal de arranque.
      this.emit('raw', e.data);
      if (!this.hold) { this.emit('message', e.data); return; }
      this.held.push(e.data);
      if (this.held.length > 80) this.held.shift();
    };
  }

  /** La partida ya está montada: se entrega lo retenido y se deja de retener. */
  release() {
    this.hold = false;
    const queued = this.held;
    this.held = [];
    for (const data of queued) this.emit('message', data);
  }

  /**
   * Espera a tener candidatos de conexión. No hace falta agotar la búsqueda:
   * en cuanto hay alguno se manda, para no tener al usuario esperando.
   */
  async gathered() {
    if (this.pc.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const onState = () => { if (this.pc.iceGatheringState === 'complete') finish(); };
      this.pc.addEventListener('icegatheringstatechange', onState);
      // Con un candidato ya se puede intentar; se da un margen corto por si
      // llega alguno mejor, y un tope duro por si la red va muy lenta.
      const soon = setInterval(() => { if (this.hasCandidate) { clearInterval(soon); setTimeout(finish, 400); } }, 100);
      setTimeout(() => { clearInterval(soon); finish(); }, 4000);
    });
  }

  async createOffer() {
    this.attach(this.pc.createDataChannel('game', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.gathered();
    return JSON.stringify(this.pc.localDescription);
  }

  async acceptOffer(offer) {
    await this.pc.setRemoteDescription(JSON.parse(offer));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.gathered();
    return JSON.stringify(this.pc.localDescription);
  }

  async acceptAnswer(answer) {
    await this.pc.setRemoteDescription(JSON.parse(answer));
  }

  send(data) {
    if (this.channel && this.channel.readyState === 'open') {
      try { this.channel.send(data); } catch { /* buffer lleno: se perderá una instantánea */ }
    }
  }

  get ready() { return this.channel && this.channel.readyState === 'open'; }

  close() {
    this.closed = true;
    try { this.channel?.close(); } catch { /* ya estaba */ }
    try { this.pc.close(); } catch { /* ya estaba */ }
  }
}
