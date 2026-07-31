// Lógica de la sala de espera, independiente de dónde se ejecute.
//
// Sólo sirve para que los jugadores se encuentren y se pasen los datos de
// conexión: en cuanto la partida arranca, todo el tráfico va directo entre los
// navegadores por WebRTC y este servicio deja de intervenir. El anfitrión puede
// tener varias invitaciones abiertas a la vez, una por cada jugador al que
// quiera meter en su partida (hasta ocho en total).
//
// El almacén se recibe por parámetro (Netlify Blobs en producción, un Map en
// desarrollo). Cada clave tiene un único escritor, así que no hacen falta
// transacciones:
//   p/{id}            el propio jugador (presencia)
//   i/{inviteId}      invitación, la escribe quien invita
//   a/{inviteId}      respuesta, la escribe el invitado
//   s/{destino}/{id}  mensaje de conexión, lo escribe el emisor y lo borra el receptor

export const PLAYER_TTL = 12000;   // sin señales de vida, el jugador desaparece
// El anfitrión puede tardar en reunir a los ocho jugadores, así que una
// invitación aguanta un buen rato antes de darse por caducada.
export const INVITE_TTL = 180000;
export const SIGNAL_TTL = 60000;
const MAX_NAME = 20;
const MAX_SIGNAL = 16000;          // una oferta o respuesta SDP ronda 1 KB

const rnd = (n = 12) => {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
};

/** Nombre visible por otros usuarios: se limpia antes de guardarlo. */
export function cleanName(name) {
  const s = String(name ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  return (s || 'Jugador').slice(0, MAX_NAME);
}

const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });

export async function handle(store, body, now = Date.now()) {
  const action = String(body?.action || '');

  if (action === 'hello') {
    const id = rnd(10);
    const token = rnd(16);
    const name = cleanName(body.name);
    await store.set(`p/${id}`, { id, name, token, lastSeen: now, busy: false });
    return ok({ id, token, name });
  }

  const id = String(body?.id || '');
  const token = String(body?.token || '');
  if (!id || !token) return fail(400, 'faltan credenciales');
  let me = await store.get(`p/${id}`);
  // Si caducó por inactividad se recrea, para no echar a nadie que siga ahí.
  if (!me) me = { id, name: cleanName(body.name), token, lastSeen: now, busy: false };
  if (me.token !== token) return fail(403, 'credenciales no válidas');

  switch (action) {
    case 'poll': {
      me.lastSeen = now;
      if (body.name) me.name = cleanName(body.name);
      if (typeof body.busy === 'boolean') me.busy = body.busy;
      await store.set(`p/${id}`, me);

      const players = [];
      for (const key of await store.list('p/')) {
        const p = await store.get(key);
        if (!p || p.id === id) continue;
        if (now - p.lastSeen > PLAYER_TTL) { await store.del(key); continue; }
        players.push({ id: p.id, name: p.name, busy: !!p.busy });
      }

      const invites = [];   // las que me han enviado y siguen sin responder
      const answers = [];   // respuestas a las que yo envié
      for (const key of await store.list('i/')) {
        const inv = await store.get(key);
        if (!inv) continue;
        if (now - inv.at > INVITE_TTL) { await store.del(key); await store.del(`a/${inv.inviteId}`); continue; }
        const ans = await store.get(`a/${inv.inviteId}`);
        if (inv.to === id && !ans) invites.push({ inviteId: inv.inviteId, from: inv.from, fromName: inv.fromName });
        if (inv.from === id && ans) {
          answers.push({ inviteId: inv.inviteId, to: inv.to, toName: inv.toName, accepted: !!ans.accepted });
          if (!ans.accepted) { await store.del(key); await store.del(`a/${inv.inviteId}`); }
        }
      }

      const signals = [];
      for (const key of await store.list(`s/${id}/`)) {
        const msg = await store.get(key);
        await store.del(key);
        if (!msg || now - msg.at > SIGNAL_TTL) continue;
        signals.push({ from: msg.from, kind: msg.kind, data: msg.data });
      }

      return ok({ players, invites, answers, signals, now });
    }

    case 'invite': {
      const to = String(body.to || '');
      if (!to || to === id) return fail(400, 'destinatario no válido');
      const target = await store.get(`p/${to}`);
      if (!target || now - target.lastSeen > PLAYER_TTL) return fail(404, 'ese jugador ya no está conectado');
      if (target.busy) return fail(409, 'ese jugador ya está en otra partida');
      const inviteId = `${id}~${to}~${rnd(6)}`;
      await store.set(`i/${inviteId}`, {
        inviteId, from: id, fromName: me.name, to, toName: target.name, at: now,
      });
      return ok({ inviteId });
    }

    case 'cancel': {
      const inviteId = String(body.inviteId || '');
      const inv = await store.get(`i/${inviteId}`);
      if (inv && inv.from !== id) return fail(403, 'no es tu invitación');
      await store.del(`i/${inviteId}`);
      await store.del(`a/${inviteId}`);
      return ok({});
    }

    case 'respond': {
      const inviteId = String(body.inviteId || '');
      const inv = await store.get(`i/${inviteId}`);
      if (!inv) return fail(404, 'la invitación ya no existe');
      if (inv.to !== id) return fail(403, 'esa invitación no es para ti');
      await store.set(`a/${inviteId}`, { inviteId, accepted: !!body.accept, at: now });
      return ok({ from: inv.from, fromName: inv.fromName });
    }

    case 'signal': {
      const to = String(body.to || '');
      const data = String(body.data ?? '');
      if (!to) return fail(400, 'destinatario no válido');
      if (data.length > MAX_SIGNAL) return fail(413, 'mensaje demasiado grande');
      await store.set(`s/${to}/${now}-${rnd(6)}`, {
        from: id, kind: String(body.kind || ''), data, at: now,
      });
      return ok({});
    }

    case 'bye':
      await store.del(`p/${id}`);
      return ok({});

    default:
      return fail(400, 'acción desconocida');
  }
}
