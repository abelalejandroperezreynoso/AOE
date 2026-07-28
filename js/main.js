// Arranque: menú principal, creación de la partida y bucle de juego.

import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI, toggleFullscreen, fullscreenSupported, syncFullscreenUi } from './ui.js';
import { AI } from './ai.js';
import { Audio } from './audio.js';
import { LobbyUI } from './lobby-ui.js';
import { NetSession } from './net/session.js';

const el = (id) => document.getElementById(id);

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
        const session = new NetSession(net.peer, net.role, game);
        // Si se cae la conexión no hay ni ganador ni perdedor: se avisa y se
        // cierra la partida, que sin el otro jugador no puede seguir.
        session.onLost = () => {
          if (game.over) return;
          ui.notify('Se ha perdido la conexión con el otro jugador.', 'bad');
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
        ui.notify(`Partida contra ${game.players[net.role === 'host' ? 1 : 0].name}. ¡Suerte!`, 'good');
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

// Multijugador: la sala entrega la conexión ya hecha y aquí sólo se arranca.
const lobbyUi = new LobbyUI(({ peer, role, seed, mapSize, names }) => {
  audio.ensure();
  startGame({
    opponents: 1,
    difficulty: 'normal',
    mapSize,
    seed,
    localPlayer: role === 'host' ? 0 : 1,
    playerNames: names,
  }, { peer, role });
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

window.addEventListener('resize', () => {
  if (renderer) { renderer.resize(); renderer.clampCam(); }
});

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
