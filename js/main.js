// Arranque: menú principal, creación de la partida y bucle de juego.

import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { AI } from './ai.js';
import { Audio } from './audio.js';

const el = (id) => document.getElementById(id);

const audio = new Audio();
let game = null, renderer = null, ui = null, raf = 0;

function startGame(opts) {
  el('main-menu').classList.add('hidden');
  el('loading').classList.remove('hidden');

  // Un fotograma de respiro para que se vea la pantalla de carga.
  requestAnimationFrame(() => setTimeout(() => {
    try {
      game = new Game(opts);
      game.ai = new AI(game);
      el('app').classList.remove('hidden');
      renderer = new Renderer(el('game'), game);
      ui = new UI(game, renderer, audio);
      window.game = game; // útil para depurar desde la consola

      const start = game.map.starts[0];
      renderer.centerOn(start.x + 1, start.y + 1);
      renderer.resize();
      ui.refreshSelection();
      ui.notify('Reúne recursos, avanza de edad y derrota a tus rivales.', 'good');

      el('loading').classList.add('hidden');
      loop(performance.now());
    } catch (err) {
      console.error(err);
      el('loading-text').textContent = `Error al iniciar: ${err.message}`;
    }
  }, 30));
}

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
