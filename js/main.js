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
import { loadOverrides, adoptOverrides, rebaseBuildingLooks } from './data/overrides.js';
import { loadDesigns, adoptDesigns, syncDesigns } from './data/designs.js';
import { clearSpriteCaches } from './sprites.js';
import { watchViewport } from './viewport.js';

const el = (id) => document.getElementById(id);

/*
 * Lo primero de todo: cuánto mide lo que se ve. De ahí cuelgan la partida y
 * las superposiciones, así que si se mide tarde la primera pintada sale con la
 * franja muerta abajo y se corrige delante del jugador.
 */
watchViewport();

// Primero las caras que el jugador les haya hecho a los edificios en el taller,
// porque fijan los colores de partida de los que vista; encima de eso se
// aplican los valores y los retoques guardados en el catálogo.
loadDesigns();
loadOverrides();

/*
 * Y, si hay taller compartido, se pregunta qué hay en la nube. Va aparte y sin
 * esperarla: el menú sale con lo que había guardado aquí —al instante y aunque
 * no haya cobertura— y los edificios que hayan cambiado se repintan en cuanto
 * llega la respuesta. Se hace sólo aquí, con el menú delante: cambiar los
 * modelos a mitad de partida dejaría edificios que se dibujan de otra forma de
 * un fotograma al siguiente.
 */
syncDesigns().then((r) => rebaseBuildingLooks(r.changed));
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
  // los modelos del taller: se ven los suyos, y los propios vuelven al recargar
  // la página.
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

/*
 * Tocando la versión, el juego dice cómo está midiendo la pantalla: alto de la
 * página, alto del aparato, zonas seguras y qué consultas de medios se aplican.
 * En un móvil no hay consola a la que asomarse, y sin estos números no hay
 * forma de saber por qué algo se ve distinto ahí y bien en todas las pruebas.
 */
el('build').onclick = (e) => {
  const box = e.currentTarget;
  if (box.dataset.open) { box.textContent = box.dataset.was; delete box.dataset.open; return; }
  box.dataset.was = box.textContent;
  box.dataset.open = '1';
  // Las zonas seguras no se pueden leer de una variable: `env()` sólo se
  // resuelve al aplicarse. Se miden poniéndolas de relleno en una caja aparte.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;'
    + 'padding:env(safe-area-inset-top) env(safe-area-inset-right)'
    + ' env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const p = getComputedStyle(probe);
  const sa = [p.paddingTop, p.paddingRight, p.paddingBottom, p.paddingLeft]
    .map((v) => Math.round(parseFloat(v) || 0)).join('/');
  probe.remove();
  /*
   * Y cuánto mide cada forma de decir "toda la pantalla". En iOS no todas
   * valen lo mismo: `inset: 0` y `100%` se quedan en el área visible, mientras
   * que las unidades de ventana grande pueden dar la pantalla entera. Saber
   * cuál da el alto de verdad es lo que decide con qué se maqueta.
   */
  const caja = document.createElement('div');
  caja.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px';
  document.body.appendChild(caja);
  const alto = (v) => {
    caja.style.height = v;
    return Math.round(caja.getBoundingClientRect().height) || '—';
  };
  const unidades = `vh ${alto('100vh')} · dvh ${alto('100dvh')} · svh ${alto('100svh')}`
    + ` · lvh ${alto('100lvh')} · fill ${alto('-webkit-fill-available')}`
    // Y con cuál se está maquetando de verdad: es la que decide si sobra o
    // falta franja abajo.
    + ` · app ${alto('var(--app-h)')}`;
  caja.remove();
  const anchos = [480, 620, 900].filter((n) => matchMedia(`(max-width:${n}px)`).matches).join(',') || 'ninguna';
  box.textContent = `${box.dataset.was} · página ${innerWidth}×${innerHeight}`
    + ` · raíz ${document.documentElement.clientHeight}`
    + ` · visual ${Math.round(window.visualViewport?.height || 0)}`
    + ` · pantalla ${screen.width}×${screen.height} · zonas ${sa}`
    + ` · ${unidades}`
    + ` · medios ≤${anchos} · standalone ${!!navigator.standalone}`;
};

window.__lobbyUi = lobbyUi; // útil para depurar la conexión desde la consola
window.__studio = studio;   // y el taller, para trastear con un diseño a mano

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
