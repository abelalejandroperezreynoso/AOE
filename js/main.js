// Arranque: menú principal, creación de la partida y bucle de juego.

import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI, toggleFullscreen, fullscreenSupported, syncFullscreenUi } from './ui.js';
import { AI } from './ai.js';
import { Audio } from './audio.js';
import { LobbyUI } from './lobby-ui.js';
import { NetSession } from './net/session.js';
import { Catalog } from './catalog.js';
import { Studio } from './studio.js';
import { loadOverrides, adoptOverrides } from './data/overrides.js';
import { loadDesigns, adoptDesigns } from './data/designs.js';
import { clearSpriteCaches } from './sprites.js';

const el = (id) => document.getElementById(id);

// Primero los edificios que haya hecho el jugador en el taller: se dan de alta
// como edificios más del juego, y a partir de ahí el catálogo puede tocarlos y
// sus valores guardados se aplican encima igual que a los de serie.
loadDesigns();
loadOverrides();
const catalog = new Catalog();
const studio = new Studio();

const audio = new Audio();
let game = null, renderer = null, ui = null, raf = 0;

/**
 * Crea la partida. `net` sólo llega en multijugador y trae la conexión ya
 * establecida con el otro jugador.
 */
function startGame(opts, net = null) {
  el('main-menu').classList.add('hidden');
  el('loading').classList.remove('hidden');
  el('loading-text').textContent = net ? 'Sincronizando la partida...' : 'Generando el mundo...';

  // Un fotograma de respiro para que se vea la pantalla de carga.
  requestAnimationFrame(() => setTimeout(() => {
    try {
      game = new Game(opts);
      if (net) {
        const session = new NetSession(game, net.role, net.links);
        // Si el invitado pierde al anfitrión no hay ni ganador ni perdedor: la
        // partida no puede seguir sin quien la simula. Al anfitrión no le pasa:
        // cuando se cae alguien, los demás continúan.
        session.onLost = () => {
          if (game.over) return;
          ui.notify('Se ha perdido la conexión con el anfitrión.', 'bad');
          game.endGame(false, 'disconnect');
        };
      } else {
        game.ai = new AI(game);
      }
      el('app').classList.remove('hidden');
      renderer = new Renderer(el('game'), game);
      ui = new UI(game, renderer, audio);
      window.game = game; // útil para depurar desde la consola

      const start = game.map.starts[game.human.id] || game.map.starts[0];
      renderer.centerOn(start.x + 1, start.y + 1);
      renderer.resize();
      ui.refreshSelection();
      if (net) {
        document.getElementById('btn-speed').classList.add('hidden');
        const rivals = game.players.filter((p) => p !== game.human && !p.defeated);
        const quienes = rivals.length === 1
          ? `contra ${rivals[0].name}`
          : `de ${rivals.length + 1} jugadores`;
        ui.notify(`Partida ${quienes}. ¡Suerte!`, 'good');
      } else {
        ui.notify('Reúne recursos, avanza de edad y derrota a tus rivales.', 'good');
      }

      el('loading').classList.add('hidden');
      loop(performance.now());
    } catch (err) {
      console.error(err);
      el('loading-text').textContent = `Error al iniciar: ${err.message}`;
    }
  }, 30));
}

// Multijugador: la sala entrega las conexiones ya hechas y aquí sólo se arranca.
const lobbyUi = new LobbyUI((s) => {
  audio.ensure();
  // En multijugador mandan los valores del anfitrión: si un invitado tiene
  // otros, se adoptan los del anfitrión mientras dure la partida. Lo mismo con
  // los edificios del taller: se juega con los suyos, que son los que él va a
  // simular, y los propios vuelven al recargar la página.
  if (s.role === 'guest') {
    if (s.designs) { adoptDesigns(s.designs); clearSpriteCaches(); }
    if (s.overrides) adoptOverrides(s.overrides);
  }
  startGame({
    playerCount: s.playerCount,
    difficulty: 'normal',
    mapSize: s.mapSize,
    seed: s.seed,
    localPlayer: s.localPlayer,
    playerNames: s.names,
    absent: s.absent,
  }, { role: s.role, links: s.links });
});

let last = 0;
function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000) || 0;
  last = now;
  game.update(dt);
  renderer.tick(dt);
  renderer.render(dt);
  ui.update(dt);
}

// De redimensionar se encarga UI.watchBars(): mide las barras, se lo pasa al
// lienzo y compensa el zoom al girar. Un segundo listener aquí se adelantaba y
// le estropeaba la medida de cuánto mundo se veía antes del giro.

// Evita el zoom por doble toque en móviles sin bloquear los controles.
document.addEventListener('gesturestart', (e) => e.preventDefault());

el('btn-start').onclick = () => {
  audio.ensure();
  const seedRaw = el('opt-seed').value.trim();
  const seed = seedRaw ? (parseInt(seedRaw, 10) || hash(seedRaw)) : (Math.random() * 4294967295) >>> 0;
  startGame({
    opponents: parseInt(el('opt-opponents').value, 10),
    difficulty: el('opt-difficulty').value,
    mapSize: parseInt(el('opt-size').value, 10),
    seed,
  });
};

// Pantalla completa desde el menú, para empezar ya sin los menús del navegador.
const fsMenuBtn = el('btn-fullscreen-menu');
if (!fullscreenSupported()) {
  fsMenuBtn.classList.add('hidden');
} else {
  fsMenuBtn.onclick = () => { const p = toggleFullscreen(); if (p && p.catch) p.catch(() => {}); };
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange']) {
    document.addEventListener(ev, syncFullscreenUi);
  }
  syncFullscreenUi();
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Permite empezar con Enter desde el menú.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !el('main-menu').classList.contains('hidden')) el('btn-start').click();
});

window.__lobbyUi = lobbyUi; // útil para depurar la conexión desde la consola

// Si se cierra la pestaña estando en la sala, se avisa para no dejar un
// jugador fantasma en la lista de los demás.
window.addEventListener('pagehide', () => {
  if (lobbyUi.lobby.id && !lobbyUi.launched) {
    navigator.sendBeacon?.('/api/lobby', new Blob(
      [JSON.stringify({ action: 'bye', id: lobbyUi.lobby.id, token: lobbyUi.lobby.token })],
      { type: 'application/json' },
    ));
  }
});
