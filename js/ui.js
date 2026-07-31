// Interfaz de usuario: HUD, panel de órdenes y control con ratón, teclado y dedo.

import {
  UNITS, BUILDINGS, TECHS, UPGRADES, AGES, RESOURCES, RES_NAME,
  BUILD_ORDER, PLAYER_COLORS,
} from './config.js';
import { iconFor } from './sprites.js';
import { NODE_LABELS as NODE_NAMES } from './data/overrides.js';
import { fmtTime, clamp, dist } from './utils.js';

const HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'A', 'S', 'D', 'F', 'G', 'H', 'Z', 'X', 'C', 'V', 'B', 'N'];
const MARKET_RATE = { sell: 0.8, buy: 1.4 };
const QUEUE_ICONS = 6; // iconos que se dibujan de la cola; el resto los dice el contador
// Cuánto se levanta la maqueta por encima del dedo al arrastrar un edificio.
const DRAG_LIFT = 56;
/*
 * Cuánto hay que mantener el dedo quieto sobre el mapa para que el toque pase
 * de seleccionar a dar la orden. Es el clic derecho del táctil, así que va
 * corto: lo justo para separarlo de un toque, sin que se haga esperar.
 */
const HOLD_MS = 320;

/**
 * Elementos que se pulsan o se arrastran: mientras el puntero esté encima no se
 * desplaza la cámara, aunque esté pegado al borde. Sólo los controles en sí,
 * no los paneles que los contienen: el fondo de una barra sigue desplazando.
 */
const CONTROL_SELECTOR = 'button, select, input, a, .overlay, .panel';

function isControl(target) {
  return !!(target && target.closest && target.closest(CONTROL_SELECTOR));
}

/** ¿Es un recurso del mapa (árbol, mina, oveja...) y no una unidad o edificio? */
function isNode(e) {
  return !!e && e.kind !== 'unit' && e.kind !== 'building' && e.res !== undefined;
}

/** ¿Es un animal de rebaño que ya está en mi bando? */
function isMyAnimal(e, game) {
  return isNode(e) && e.herd && e.alive && e.owner === game.human.id;
}

// --- Pantalla completa ------------------------------------------------------

const fsEl = () => document.documentElement;

export function fullscreenSupported() {
  const e = fsEl();
  return !!(e.requestFullscreen || e.webkitRequestFullscreen || e.msRequestFullscreen);
}

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}

/** Alterna la pantalla completa. Debe llamarse desde un gesto del usuario. */
export function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      return exit && exit.call(document);
    }
    const e = fsEl();
    const req = e.requestFullscreen || e.webkitRequestFullscreen || e.msRequestFullscreen;
    return req && req.call(e, { navigationUI: 'hide' });
  } catch (err) {
    return Promise.reject(err);
  }
}

/** Mantiene los botones y el `<body>` al día con el estado real. */
export function syncFullscreenUi() {
  const on = isFullscreen();
  document.body.classList.toggle('is-fullscreen', on);
  for (const id of ['btn-fullscreen', 'btn-fullscreen-menu']) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.title = on ? 'Salir de la pantalla completa [F11]' : 'Pantalla completa [F11]';
    b.setAttribute('aria-pressed', String(on));
    const label = b.querySelector('.fs-label');
    if (label) label.textContent = on ? 'Salir de pantalla completa' : 'Pantalla completa';
  }
}

export class UI {
  constructor(game, renderer, audio) {
    this.game = game;
    this.r = renderer;
    this.audio = audio;
    game.ui = this;
    game.audio = audio;
    this.el = {};
    this.selectionKey = '';
    this.pending = null;
    this.notifications = [];
    this.cacheDom();
    this.bindInput();
    this.buildStatic();
  }

  cacheDom() {
    const id = (x) => document.getElementById(x);
    this.el.canvas = id('game');
    this.el.res = {};
    for (const r of RESOURCES) this.el.res[r] = id(`res-${r}`);
    this.el.pop = id('res-pop');
    this.el.age = id('age-label');
    this.el.clock = id('clock');
    this.el.commands = id('commands');
    this.el.selInfo = id('sel-info');
    this.el.selList = id('sel-list');
    this.el.queue = id('queue');
    this.el.notif = id('notifications');
    this.el.production = id('production');
    this.el.tooltip = id('tooltip');
    this.el.dragGhost = id('drag-ghost');
    this.el.bottombar = id('bottombar');
    this.el.pauseMenu = id('pause-menu');
    this.el.endScreen = id('end-screen');
    this.el.idleBtn = id('idle-villager');
    this.el.idleCount = id('idle-count');
    this.el.speed = id('speed-label');
  }

  buildStatic() {
    document.getElementById('btn-menu').onclick = () => this.togglePause();
    document.getElementById('btn-resume').onclick = () => this.togglePause();
    document.getElementById('btn-resign').onclick = () => {
      this.game.commandResign();
      this.el.pauseMenu.classList.add('hidden');
      this.game.paused = false;
    };
    document.getElementById('btn-restart').onclick = () => location.reload();
    document.getElementById('btn-restart2').onclick = () => location.reload();
    // El anfitrión eliminado puede quedarse mirando: su equipo sigue llevando
    // la partida de los demás.
    document.getElementById('btn-end-watch').onclick = () => {
      this.el.endScreen.classList.add('hidden');
    };
    const vol = document.getElementById('volume');
    vol.oninput = () => this.audio.setVolume(parseFloat(vol.value));
    this.setupFullscreen();
    this.watchBars();
    this.el.idleBtn.onclick = () => this.selectIdleVillager();
    /*
     * Pulsar la ficha de abajo suelta la selección. Antes era un botón más en
     * la barra de arriba, lejos de donde se está mirando; aquí se pulsa lo
     * mismo que se quiere soltar. Los botones de dentro —los montones de una
     * selección múltiple— siguen a lo suyo.
     */
    this.el.selInfo.onclick = (e) => {
      if (e.target.closest('button')) return;
      if (this.game.selection.length) this.select([]);
    };
    document.getElementById('btn-speed').onclick = () => this.cycleSpeed();
    document.getElementById('btn-help').onclick = () => {
      document.getElementById('help-panel').classList.toggle('hidden');
    };
    document.getElementById('btn-help-close').onclick = () => {
      document.getElementById('help-panel').classList.add('hidden');
    };
  }

  /** Botón de pantalla completa: se oculta si el navegador no la admite. */
  setupFullscreen() {
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    if (!fullscreenSupported()) { btn.classList.add('hidden'); return; }
    btn.onclick = () => {
      const p = toggleFullscreen();
      if (p && p.catch) p.catch(() => this.notify('El navegador ha bloqueado la pantalla completa', 'bad'));
    };
    const onChange = () => {
      syncFullscreenUi();
      // El lienzo cambia de tamaño al entrar y salir.
      this.r.resize();
      this.r.clampCam();
    };
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange']) {
      document.addEventListener(ev, onChange);
    }
    syncFullscreenUi();
  }

  /**
   * Las barras ya no tienen un alto fijo: la de abajo crece con la cola y
   * encoge cuando no hay nada seleccionado. Se miden y el resultado se le pasa
   * al lienzo, que ocupa lo que quede en medio.
   */
  watchBars() {
    const root = document.documentElement;
    const topbar = document.getElementById('topbar');
    const canvas = this.el.canvas;
    const orientation = () => (window.innerWidth >= window.innerHeight ? 'h' : 'v');
    let lastBars = '';
    let lastOrientation = orientation();
    let areaBeforeTurn = 0, settle = 0;

    /*
     * El lienzo se dibuja en píxeles CSS sobre un búfer de ancho×dpr. Si el
     * búfer se queda con la medida anterior, el navegador estira el mapa de
     * bits para rellenar la caja y el tablero sale deformado. Así que la
     * referencia es siempre la caja del lienzo, no el alto de las barras: al
     * girar sólo cambia el ancho y las barras podrían medir lo mismo.
     */
    const syncCanvas = () => {
      if (canvas.clientWidth === this.r.w && canvas.clientHeight === this.r.h) return;
      this.r.resize();
      this.r.clampCam();
    };

    const apply = () => {
      // Al girar, lo primero es guardar el lienzo de antes: es la referencia
      // para que se siga viendo la misma cantidad de mundo.
      if (orientation() !== lastOrientation) {
        lastOrientation = orientation();
        if (!areaBeforeTurn) areaBeforeTurn = this.r.w * this.r.h;
        clearTimeout(settle);
        // El giro dispara varios avisos seguidos; se espera a que pare.
        settle = setTimeout(() => {
          const before = areaBeforeTurn;
          areaBeforeTurn = 0;
          syncCanvas();
          this.keepViewOnTurn(before);
        }, 180);
      }
      const top = topbar.offsetHeight, bottom = this.el.bottombar.offsetHeight;
      const key = `${top}/${bottom}`;
      if (key !== lastBars) {
        lastBars = key;
        root.style.setProperty('--top-total', `${top}px`);
        root.style.setProperty('--bottom-total', `${bottom}px`);
      }
      syncCanvas();
    };

    if (window.ResizeObserver) {
      // El lienzo también se observa: es quien manda sobre el búfer.
      const ro = new ResizeObserver(apply);
      for (const el of [topbar, this.el.bottombar, canvas]) ro.observe(el);
    }
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    /*
     * Red de seguridad: durante la animación de giro, Safari en iOS informa
     * de medidas que todavía no son las definitivas, y si el último aviso
     * llega con las viejas nadie vuelve a corregirlo. Esta comprobación son
     * dos lecturas y sólo actúa si de verdad no cuadran.
     */
    setInterval(syncCanvas, 250);
    apply();
  }

  /**
   * Al girar el teléfono, el HUD se lleva una parte distinta de la pantalla:
   * en apaisado pesa bastante más, así que con el mismo zoom se vería mucho
   * menos mundo y parece que la escala haya cambiado. Se ajusta el zoom para
   * que el área de mundo a la vista sea la misma antes y después.
   *
   * El área visible vale (ancho × alto) / zoom², así que para mantenerla el
   * zoom tiene que ir con la raíz del área del lienzo. Girar y volver deja el
   * zoom exactamente como estaba.
   */
  keepViewOnTurn(areaBefore) {
    const areaAfter = this.r.w * this.r.h;
    if (!areaBefore || !areaAfter) return;
    this.r.cam.zoom *= Math.sqrt(areaAfter / areaBefore);
    this.r.clampCam();
  }

  cycleSpeed() {
    if (this.game.net) return; // en multijugador el ritmo lo marca la partida
    const speeds = [1, 1.5, 2, 3];
    const i = speeds.indexOf(this.game.speed);
    this.game.speed = speeds[(i + 1) % speeds.length];
    this.el.speed.textContent = `${this.game.speed}x`;
  }

  /**
   * En multijugador el menú se abre sin detener la partida: no se puede parar
   * el mundo mientras el otro jugador sigue jugando.
   */
  togglePause() {
    const menu = this.el.pauseMenu;
    if (this.game.net) {
      menu.classList.toggle('hidden');
      return;
    }
    this.game.paused = !this.game.paused;
    menu.classList.toggle('hidden', !this.game.paused);
  }

  // --- Entrada --------------------------------------------------------------

  bindInput() {
    const c = this.el.canvas;
    this.keys = new Set();
    this.drag = null;
    this.panning = null;

    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('mousedown', (e) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      this.audio.ensure();
      if (e.button === 0) {
        if (this.game.placing) { this.tryPlace(x, y, e.shiftKey); return; }
        if (this.pending === 'attackmove') { this.issueAttackMove(x, y); return; }
        this.drag = { x0: x, y0: y, x1: x, y1: y, shift: e.shiftKey, moved: false, t: performance.now() };
      } else if (e.button === 2) {
        if (this.game.placing) { this.cancelPlacing(); return; }
        this.rightClick(x, y, e.shiftKey);
      } else if (e.button === 1) {
        this.panning = { x, y };
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      this.touchMode = false; // hay ratón de verdad: vuelve el desplazamiento por el borde
      this.mouse = {
        x, y,
        wx: e.clientX, wy: e.clientY, // coordenadas de ventana, para el borde de pantalla
        inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height,
        // Sobre un control no se desplaza la cámara, para poder pulsarlo tranquilamente.
        onControl: isControl(e.target),
        out: false,
      };
      if (this.drag) {
        this.drag.x1 = x; this.drag.y1 = y;
        if (Math.hypot(x - this.drag.x0, y - this.drag.y0) > 5) this.drag.moved = true;
        this.r.dragBox = this.drag.moved ? this.drag : null;
      }
      if (this.panning) {
        this.r.cam.x -= (x - this.panning.x) / this.r.cam.zoom;
        this.r.cam.y -= (y - this.panning.y) / this.r.cam.zoom;
        this.panning = { x, y };
        this.r.clampCam();
      }
      if (this.game.placing && this.mouse.inside) {
        const [u, v] = this.r.screenToWorld(x, y);
        const size = BUILDINGS[this.game.placing.type].size;
        this.game.placing.tx = Math.floor(u - size / 2 + 0.5);
        this.game.placing.ty = Math.floor(v - size / 2 + 0.5);
      }
      if (!this.drag && !this.panning && this.mouse.inside) {
        this.r.hover = this.r.entityAtScreen(x, y);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) { this.panning = null; return; }
      if (e.button !== 0 || !this.drag) return;
      const d = this.drag;
      this.drag = null; this.r.dragBox = null;
      const rect = c.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width), y = clamp(e.clientY - rect.top, 0, rect.height);
      if (d.moved) this.boxSelect(d.x0, d.y0, x, y, d.shift);
      else this.clickSelect(d.x0, d.y0, d.shift, performance.now() - d.t);
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const before = this.r.screenToWorld(mx, my);
      this.r.cam.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.r.clampCam();
      const after = this.r.screenToWorld(mx, my);
      const [ax, ay] = this.r.worldToCanvas(before[0], before[1]);
      const [bx, by] = this.r.worldToCanvas(after[0], after[1]);
      this.r.cam.x += ax - bx; this.r.cam.y += ay - by;
      this.r.clampCam();
    }, { passive: false });

    this.bindTouch(c);

    // Teclado
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key;
      this.keys.add(k.toLowerCase());
      if (k === 'Escape') {
        if (this.game.placing) this.cancelPlacing();
        else if (!document.getElementById('help-panel').classList.contains('hidden')) {
          document.getElementById('help-panel').classList.add('hidden');
        } else this.togglePause();
        return;
      }
      if (/^[0-9]$/.test(k)) {
        if (e.ctrlKey || e.metaKey) { this.game.groups[k] = this.game.selection.slice(); this.notify(`Grupo ${k} guardado`); }
        else if (this.game.groups[k]) this.select(this.game.groups[k].filter((u) => !u.dead));
        e.preventDefault();
        return;
      }
      if (k === 'Delete' || k === 'Backspace') { this.deleteSelected(); return; }
      if (k === ' ') { this.centerOnSelection(); e.preventDefault(); return; }
      if (k === '.') { this.selectIdleVillager(); return; }
      if (k.toLowerCase() === 'p') { this.togglePause(); return; }
      if (k === 'F1') { e.preventDefault(); document.getElementById('help-panel').classList.toggle('hidden'); return; }
      // Atajos del panel de órdenes.
      const btn = this.buttons && this.buttons.find((b) => b.hotkey === k.toUpperCase());
      if (btn && !btn.disabled) { e.preventDefault(); btn.action(); this.audio.play('click'); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); if (this.mouse) this.mouse.out = true; });
    // Si el puntero abandona la ventana, se detiene el desplazamiento de borde.
    document.addEventListener('mouseleave', () => { if (this.mouse) this.mouse.out = true; });
    document.addEventListener('mouseenter', () => { if (this.mouse) this.mouse.out = false; });
    /*
     * Cierre del gesto de la barra pase lo que pase: si el botón desaparece a
     * media faena —la botonera se rehace al cambiar la selección— o el
     * navegador no concede la captura del puntero, el «pointerup» no llega al
     * botón y el edificio se quedaría pegado al dedo.
     */
    window.addEventListener('pointerup', (e) => {
      if (this.barGesture && this.barGesture.id === e.pointerId) this.barGestureEnd(e);
    });
    window.addEventListener('pointercancel', () => this.barGestureCancel());

    // Al girar el móvil o cambiar el tamaño, la ficha quedaría descolocada.
    window.addEventListener('resize', () => this.hideTooltip());
    window.addEventListener('orientationchange', () => this.hideTooltip());
  }

  /**
   * Control táctil: un toque selecciona lo propio o da la orden sobre lo
   * seleccionado, mantener el dedo un momento da la orden sin cambiar la
   * selección, arrastrar mueve la cámara y pellizcar acerca o aleja.
   *
   * Construir no entra aquí: con el dedo, la única forma es arrastrar el
   * edificio desde la barra de órdenes (ver barGesture*). El lienzo no coloca
   * nada, así que un toque nunca planta un edificio por sorpresa.
   */
  bindTouch(c) {
    const pos = (t) => {
      const r = c.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const spread = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    let start = null, moved = false, pinch = 0, lastPan = null;
    // Pulsación mantenida: el "clic derecho" del dedo (ver `touchHold`).
    let holdTimer = null, held = false;
    const cancelHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

    c.addEventListener('touchstart', (e) => {
      this.audio.ensure();
      this.touchMode = true;
      this.hideTooltip();
      cancelHold();
      if (e.touches.length === 1) {
        start = pos(e.touches[0]);
        lastPan = start;
        moved = false;
        held = false;
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (moved || !start) return;
          held = this.touchHold(start.x, start.y);
        }, HOLD_MS);
      } else if (e.touches.length === 2) {
        pinch = spread(e.touches);
        moved = true;
      }
      e.preventDefault();
    }, { passive: false });

    c.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinch) {
        cancelHold();
        const d = spread(e.touches);
        this.r.cam.zoom *= d / pinch;
        pinch = d;
        this.r.clampCam();
      } else if (e.touches.length === 1 && lastPan) {
        const p = pos(e.touches[0]);
        if (Math.hypot(p.x - start.x, p.y - start.y) > 12) { moved = true; cancelHold(); }
        // Tras dar la orden manteniendo pulsado, el mismo dedo ya no arrastra
        // la cámara: se levanta y se vuelve a apoyar, y así no se va la vista
        // sola justo después de mandar a alguien.
        if (moved && !held) {
          this.r.cam.x -= (p.x - lastPan.x) / this.r.cam.zoom;
          this.r.cam.y -= (p.y - lastPan.y) / this.r.cam.zoom;
          this.r.clampCam();
        }
        lastPan = p;
      }
      e.preventDefault();
    }, { passive: false });

    c.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) pinch = 0;
      cancelHold();
      // La orden ya se dio al mantener el dedo: levantarlo no hace nada más.
      if (held) { held = false; start = null; lastPan = null; e.preventDefault(); return; }
      if (!start || moved) { start = null; lastPan = null; return; }
      const { x, y } = start;
      start = null; lastPan = null;
      // Una colocación en marcha aquí sólo puede venir de un teclado o de un
      // ratón en un aparato híbrido: el dedo no la continúa, la deshace.
      if (this.game.placing) {
        this.cancelPlacing();
        this.notify('Arrastra el edificio desde la barra hasta el mapa');
        return;
      }
      if (this.pending === 'attackmove') { this.issueAttackMove(x, y); return; }
      const g = this.game;
      const target = this.r.entityAtScreen(x, y);
      const mine = g.selection.length && g.selection[0].owner === g.human.id;
      // Tocar algo propio lo selecciona, salvo que lo que haya seleccionado
      // pueda trabajar en ello: mandar aldeanos a terminar unos cimientos es
      // una orden, no un cambio de selección.
      if (mine && this.canWorkOn(target, false)) this.rightClick(x, y, false);
      else if (target && target.kind && target.owner === g.human.id) {
        // Se queda con el edificio, que es lo que se ha pedido; pero si había
        // un aldeano cargado, se recuerda que la descarga está a un dedo
        // mantenido de distancia.
        if (this.canDeposit(target)) this.holdHint();
        this.clickSelect(x, y, false, 0, true);
      } else if (mine) this.rightClick(x, y, false);
      else this.clickSelect(x, y, false, 0, true);
      e.preventDefault();
    }, { passive: false });

    c.addEventListener('touchcancel', () => {
      cancelHold();
      start = null; lastPan = null; pinch = 0; held = false;
    });
  }

  /**
   * Pulsación mantenida sobre el mapa: es el clic derecho del táctil. Da la
   * orden a lo que se tenga seleccionado sin tocar la selección, así que un
   * toque corto puede quedarse con lo suyo —seleccionar el edificio— y el
   * dedo mantenido con lo otro —mandar al aldeano a descargar en él—.
   *
   * Devuelve si el gesto se ha consumido: sin nada propio seleccionado no hay
   * orden que dar, así que se deja pasar y el toque acaba seleccionando.
   */
  touchHold(x, y) {
    const g = this.game;
    if (g.placing || this.pending) return false;
    if (!g.selection.some((e) => e.owner === g.human.id)) return false;
    this.rightClick(x, y, false);
    // Un golpecito para avisar de que la orden salió sin levantar el dedo.
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* da igual */ } }
    return true;
  }

  /** Aviso, una sola vez por partida, de para qué sirve mantener pulsado. */
  holdHint() {
    if (this.holdHinted) return;
    this.holdHinted = true;
    this.notify('Mantén pulsado el edificio para ir a descargar');
  }

  /**
   * ¿Los aldeanos seleccionados tienen trabajo que hacer en ese objetivo?
   * Con el dedo no hay clic derecho, así que un toque tiene que decidir entre
   * seleccionar y dar la orden. Sobre unos cimientos propios o una granja
   * propia lo que se quiere es mandar a los aldeanos; el edificio terminado se
   * sigue seleccionando como siempre.
   *
   * No entra el reparar: seleccionar un edificio dañado —para ver cómo va o
   * para sacar unidades de él— es demasiado corriente como para robarle el
   * toque. Para trabajar sobre unos cimientos que ya no quieres, basta con
   * deseleccionar tocando el suelo y volver a tocarlos.
   *
   * Las ovejas propias también cuentan, y aquí sí manda con el ratón: con
   * aldeanos seleccionados, pulsar una oveja es mandarlos a por su comida, no
   * cambiar la selección. Para pastorearla se pulsa sin aldeanos seleccionados.
   *
   * `deposit` desactiva el caso de ir a descargar. Con el dedo se apaga: el
   * toque corto sobre el centro urbano o un campamento los selecciona y para
   * mandar al aldeano a soltar la carga se mantiene pulsado (ver `touchHold`).
   */
  canWorkOn(target, deposit = true) {
    const g = this.game;
    const hasVillager = g.selection
      .some((e) => e.kind === 'unit' && e.type === 'villager' && e.owner === g.human.id);
    if (!hasVillager) return false;
    if (isMyAnimal(target, g)) return true;
    if (deposit && this.canDeposit(target)) return true;
    if (!target || target.kind !== 'building' || target.owner !== g.human.id) return false;
    return !target.built || target.type === 'farm';
  }

  /**
   * ¿Alguno de los aldeanos seleccionados tiene algo que soltar en ese edificio?
   * Con el ratón, señalar el centro urbano (o el molino, el campamento...) con
   * un aldeano cargado es mandarlo a descargar, no cambiar la selección: para
   * eso están ahí, y el clic derecho sigue disponible para todo lo demás. El
   * edificio se sigue seleccionando en cuanto el aldeano va de vacío.
   */
  canDeposit(target) {
    const g = this.game;
    return g.selection.some((e) => e.owner === g.human.id && g.acceptsCarry(target, e));
  }

  // --- Selección ------------------------------------------------------------

  select(list) {
    for (const e of this.game.selection) e.selected = false;
    // `alive === false` es un recurso ya agotado: una oveja que se comieron.
    this.game.selection = list.filter((e) => e && !e.dead && e.alive !== false);
    for (const e of this.game.selection) e.selected = true;
    if (this.game.selection.length) this.audio.play('select');
    this.refreshSelection();
  }

  clickSelect(x, y, shift, elapsed, touch = false) {
    const g = this.game;
    const e = this.r.entityAtScreen(x, y);
    if (!e) { if (!shift) this.select([]); return; }
    // Oveja propia con aldeanos seleccionados: se les manda a por ella en vez
    // de soltarlos para seleccionarla.
    if (isMyAnimal(e, g) && this.canWorkOn(e)) { this.rightClick(x, y, shift); return; }
    // Almacén propio con aldeanos cargados: se les manda a descargar. Con el
    // dedo no: ahí el toque corto selecciona y para descargar se mantiene
    // pulsado, que si no no habría forma de abrir el centro urbano con un
    // aldeano cargado a cuestas.
    if (!touch && this.canDeposit(e)) { this.rightClick(x, y, shift); return; }
    // Un recurso del mapa sólo enseña su ficha... salvo que sea un animal de mi
    // rebaño, que se selecciona como cualquier otra cosa mía para poder moverlo.
    if (isNode(e) && !isMyAnimal(e, g)) {
      this.select([]);
      this.showResourceInfo(e);
      return;
    }
    if (shift && g.selection.length && g.selection[0].kind === e.kind) {
      const i = g.selection.indexOf(e);
      if (i >= 0) { e.selected = false; g.selection.splice(i, 1); }
      else { e.selected = true; g.selection.push(e); }
      this.refreshSelection();
      return;
    }
    // Doble clic: selecciona todas las unidades del mismo tipo en pantalla.
    if (this.lastClick && performance.now() - this.lastClick.t < 350
      && this.lastClick.e === e && e.kind === 'unit') {
      const same = this.r.unitsInBox(0, 0, this.r.w, this.r.h, e.owner).filter((u) => u.type === e.type);
      this.select(same);
      this.lastClick = null;
      return;
    }
    this.lastClick = { e, t: performance.now() };
    this.select([e]);
  }

  boxSelect(x0, y0, x1, y1, shift) {
    const g = this.game;
    let list = this.r.unitsInBox(x0, y0, x1, y1, g.human.id);
    // Con muchas unidades, prioriza las militares.
    const mil = list.filter((u) => u.isMilitary);
    if (mil.length) list = mil;
    // El rebaño sólo entra si no había ninguna unidad: al encuadrar el ejército
    // no se quiere arrastrar a las ovejas que pasaban por ahí.
    const animals = list.length ? [] : this.r.animalsInBox(x0, y0, x1, y1, g.human.id);
    if (animals.length) list = animals;
    if (shift) {
      // Al añadir se respeta la familia de lo que ya había seleccionado:
      // unidades con unidades y rebaño con rebaño.
      const prev = g.selection.filter((e) => (animals.length ? isNode(e) : e.kind === 'unit'));
      const set = new Set(prev);
      for (const u of list) set.add(u);
      list = [...set];
    }
    if (!list.length && !shift) { this.select([]); return; }
    this.select(list);
  }

  selectIdleVillager() {
    const idle = this.game.idleVillagers();
    if (!idle.length) { this.notify('No hay aldeanos en reposo'); return; }
    this.idleIdx = ((this.idleIdx || 0) + 1) % idle.length;
    const v = idle[this.idleIdx];
    this.select([v]);
    this.r.centerOn(v.x, v.y);
  }

  centerOnSelection() {
    const s = this.game.selection[0];
    if (!s) return;
    this.r.centerOn(isNode(s) ? s.fx : (s.x ?? s.cx), isNode(s) ? s.fy : (s.y ?? s.cy));
  }

  deleteSelected() {
    const g = this.game;
    g.commandDelete(g.selection.slice());
    this.select([]);
  }

  // --- Órdenes --------------------------------------------------------------

  rightClick(x, y, shift) {
    const g = this.game;
    const sel = g.selection.filter((e) => e.owner === g.human.id);
    if (!sel.length) return;
    const [u, v] = this.r.screenToWorld(x, y);

    // Punto de reunión de un edificio.
    if (sel[0].kind === 'building') {
      const target = this.r.entityAtScreen(x, y);
      g.commandRally(sel, u, v, target);
      this.r.markOrder(u, v, '#ffe9a8');
      this.audio.play('order');
      return;
    }

    // Rebaño: se lleva al punto señalado, como un pastor.
    const animals = sel.filter((e) => isMyAnimal(e, g));
    if (animals.length) {
      g.commandHerd(animals, u, v);
      this.r.markOrder(u, v, '#ffe9a8');
      this.audio.play('order');
      if (animals.length === sel.length) return;
    }

    const target = this.r.entityAtScreen(x, y);
    const units = sel.filter((e) => e.kind === 'unit');
    if (target && target !== null && (target.kind === 'unit' || target.kind === 'building')) {
      if (target.owner !== g.human.id) {
        g.commandTarget(units, target);
        this.r.markOrder(target.x ?? target.cx, target.y ?? target.cy, '#ff8b76');
      } else {
        g.commandTarget(units, target);
        this.r.markOrder(target.x ?? target.cx, target.y ?? target.cy, '#8fe08f');
      }
    } else if (target && target.res) {
      g.commandTarget(units, target);
      this.r.markOrder(target.fx, target.fy, '#ffdc6a');
    } else {
      g.commandMove(units, u, v);
      this.r.markOrder(u, v, '#8fe08f');
    }
    this.audio.play('order');
  }

  issueAttackMove(x, y) {
    const g = this.game;
    const [u, v] = this.r.screenToWorld(x, y);
    const units = g.selection.filter((e) => e.kind === 'unit' && e.owner === g.human.id);
    g.commandMove(units, u, v, true);
    this.r.markOrder(u, v, '#ff8b76');
    this.pending = null;
    document.body.classList.remove('cursor-attack');
    this.audio.play('order');
  }

  startPlacing(type) {
    this.game.placing = { type };
    document.body.classList.add('cursor-build');
  }

  cancelPlacing() {
    this.game.placing = null;
    document.body.classList.remove('cursor-build');
  }

  /*
   * Gesto del dedo sobre la barra de órdenes. La barra no decide nada por su
   * cuenta —el navegador tiene el desplazamiento desactivado ahí—, así que cada
   * arrastre elige un solo camino y no se mezclan nunca:
   *
   *  · De lado: se recorre la tira de botones y nada más. El mapa no se entera.
   *  · Hacia arriba desde un edificio: se lo saca de la barra y se lo lleva al
   *    mapa, como quien coge una ficha. Se suelta donde vaya a construirse.
   *  · Sin moverse: es un toque normal y se ejecuta la orden del botón.
   *
   * El edificio viaja en el dedo desde el primer momento: primero como el icono
   * del botón (la maqueta del mapa aún no puede dibujarse sobre la barra) y, al
   * entrar en el lienzo, ese icono se apaga y toma el relevo la maqueta de
   * verdad, con su huella y su aviso de si el sitio vale. Ambos se dibujan en el
   * mismo punto —DRAG_LIFT por encima del dedo, para que no lo tape la mano—,
   * de modo que el relevo pasa desapercibido.
   *
   * Con ratón no cambia nada: se pulsa el botón y luego el mapa, con Mayús para
   * encadenar varios.
   */
  barGestureStart(el, b, run, e) {
    // La captura mantiene los eventos en el botón aunque el dedo se vaya al
    // lienzo; si el navegador no la da, la red de seguridad de bindInput cierra
    // el gesto igualmente.
    try { el.setPointerCapture(e.pointerId); } catch { /* no pasa nada */ }
    this.barGesture = {
      el, b, run, id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, mode: null,
    };
  }

  barGestureMove(e) {
    const d = this.barGesture;
    if (!d || d.id !== e.pointerId) return;
    if (!d.mode) {
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (Math.hypot(dx, dy) < 12) return;
      this.hideTooltip();
      if (Math.abs(dx) > Math.abs(dy)) d.mode = 'scroll';
      else if (d.b.place && !d.b.disabled) this.dragPlaceArm(d);
      else d.mode = 'idle'; // hacia arriba desde un botón que no es un edificio
    }
    if (d.mode === 'scroll') {
      this.el.commands.scrollLeft -= e.clientX - d.lastX;
      d.lastX = e.clientX;
    } else if (d.mode === 'place') {
      this.dragPlaceGhost(e);
    }
  }

  /** Saca el edificio de la barra: el botón se vacía y el icono pasa al dedo. */
  dragPlaceArm(d) {
    d.mode = 'place';
    d.el.classList.add('dragging');
    const ghost = this.el.dragGhost;
    ghost.innerHTML = d.b.icon ? `<img src="${d.b.icon}" alt="">` : '';
    ghost.classList.remove('hidden', 'over-map');
    this.startPlacing(d.b.place);
    this.audio.play('click');
  }

  /**
   * Lleva el edificio al punto que toca el dedo. Sobre el lienzo manda la
   * maqueta del juego; fuera —la barra, los bordes— sigue el icono a secas y no
   * hay dónde construir.
   */
  dragPlaceGhost(e) {
    const pl = this.game.placing;
    if (!pl) return null;
    const r = this.el.canvas.getBoundingClientRect();
    const gx = e.clientX, gy = e.clientY - DRAG_LIFT;
    const ghost = this.el.dragGhost;
    ghost.style.left = `${gx}px`;
    ghost.style.top = `${gy}px`;
    const x = clamp(gx - r.left, 0, r.width);
    const y = gy - r.top;
    const onMap = y >= 0 && y <= r.height && gx >= r.left && gx <= r.right;
    ghost.classList.toggle('over-map', onMap);
    if (!onMap) { pl.tx = undefined; return null; }
    const [u, v] = this.r.screenToWorld(x, y);
    const size = BUILDINGS[pl.type].size;
    pl.tx = Math.floor(u - size / 2 + 0.5);
    pl.ty = Math.floor(v - size / 2 + 0.5);
    return { x, y };
  }

  barGestureEnd(e) {
    const d = this.barGesture;
    if (!d || d.id !== e.pointerId) return;
    this.barGestureClear();
    if (d.mode === 'place') {
      const at = this.dragPlaceGhost(e);
      // Soltar fuera del lienzo —sobre la propia barra, casi siempre— es desistir.
      if (at) this.tryPlace(at.x, at.y, false);
      this.cancelPlacing();
      return;
    }
    if (d.mode) return; // se recorrió la tira o se tiró de un botón sin edificio
    // Sin movimiento es un toque normal.
    if (d.b.place && !d.b.disabled) { this.notify('Arrastra el edificio desde la barra hasta el mapa'); return; }
    d.el._tapAt = performance.now();
    d.run();
  }

  barGestureCancel() {
    const d = this.barGesture;
    if (!d) return;
    this.barGestureClear();
    if (d.mode === 'place') this.cancelPlacing();
  }

  /** Deshace las señales del arrastre: el botón vuelve y el icono se guarda. */
  barGestureClear() {
    const d = this.barGesture;
    if (!d) return;
    this.barGesture = null;
    try { d.el.releasePointerCapture(d.id); } catch { /* ya estaba suelto */ }
    d.el.classList.remove('dragging');
    this.el.dragGhost.classList.add('hidden');
    this.el.dragGhost.innerHTML = '';
  }

  tryPlace(x, y, keepGoing) {
    const g = this.game;
    const pl = g.placing;
    if (pl.tx === undefined) return;
    const builders = g.selection.filter((e) => e.kind === 'unit' && e.type === 'villager');
    const err = g.placeBuilding(pl.type, pl.tx, pl.ty, g.human, builders);
    if (err) { this.notify(err, 'bad'); this.audio.play('error'); return; }
    this.audio.play('order');
    if (!keepGoing) this.cancelPlacing();
    this.refreshSelection();
  }

  // --- Paneles --------------------------------------------------------------

  /**
   * Huella de lo que decide *qué* botones existen: la selección, la edad y las
   * tecnologías (una mejora terminada cambia las unidades que se ofrecen).
   * Mientras no cambie, los botones se dejan en su sitio y sólo se repinta si
   * algo se puede pagar o no.
   */
  selectionSignature() {
    const p = this.game.human;
    return `${this.game.selection.map((e) => `${e.kind}${e.id}:${e.type}`).join(',')}|${p.age}|${p.techs.size}`;
  }

  refreshSelection() {
    this.selectionKey = this.selectionSignature();
    this.renderSelectionPanel();
    this.renderCommands();
  }

  renderSelectionPanel() {
    const g = this.game, sel = g.selection;
    const info = this.el.selInfo, list = this.el.selList;
    info.innerHTML = ''; list.innerHTML = '';
    /*
     * Sin nada seleccionado la barra entera se retira: lo único que enseñaba
     * era un recordatorio de cómo se juega, y a cambio se comía una franja de
     * mapa en todo momento. watchBars() se entera sola y el lienzo crece.
     */
    this.el.bottombar.classList.toggle('hidden', !sel.length);
    if (!sel.length) return;
    if (sel.length === 1 && isNode(sel[0])) {
      this.renderAnimalPanel(sel[0]);
      return;
    }
    if (sel.length > 1 && isNode(sel[0])) {
      this.renderHerdPanel(sel);
      return;
    }
    if (sel.length === 1) {
      const e = sel[0];
      const isUnit = e.kind === 'unit';
      const def = isUnit ? UNITS[e.type] : BUILDINGS[e.type];
      const p = g.players[e.owner];
      const img = document.createElement('img');
      img.className = 'portrait';
      img.src = iconFor(isUnit ? 'unit' : 'building', e.type, p.colorIdx);
      info.appendChild(img);
      const box = document.createElement('div');
      box.className = 'sel-text';
      const atk = isUnit ? p.stat(e.type, 'attack') : p.buildingStat(e.type, 'attack');
      const arm = isUnit ? p.stat(e.type, 'armor') : (def.armor ?? 0);
      const parm = isUnit ? p.stat(e.type, 'pArmor') : (def.pArmor ?? 4);
      const rng = isUnit ? p.stat(e.type, 'range') : (def.range || 0);
      let stats = `<div class="stat-row">
        <span title="Puntos de vida">❤ ${Math.ceil(e.hp)}/${Math.round(e.maxHp)}</span>`;
      if (atk) stats += `<span title="Ataque">⚔ ${Math.round(atk)}</span>`;
      stats += `<span title="Armadura / armadura contra proyectiles">🛡 ${arm}/${parm}</span>`;
      if (rng > 1.5) stats += `<span title="Alcance">🏹 ${rng.toFixed(1)}</span>`;
      stats += '</div>';
      if (isUnit && e.carry > 0.5) {
        stats += `<div class="carry">Lleva ${Math.floor(e.carry)} de ${RES_NAME[e.carryRes]}</div>`;
      }
      if (!isUnit && e.farmAmount !== undefined) {
        stats += `<div class="carry">Comida restante: ${Math.max(0, Math.ceil(e.farmAmount))}</div>`;
      }
      if (!isUnit && !e.built) {
        stats += `<div class="carry">En construcción: ${Math.round(e.progress * 100)}%</div>`;
      }
      box.innerHTML = `<div class="sel-name">${def.name}</div>
        <div class="sel-owner" style="color:${PLAYER_COLORS[p.colorIdx].light}">${p.name}</div>
        ${stats}<div class="sel-desc">${def.desc || ''}</div>`;
      info.appendChild(box);
    } else {
      info.innerHTML = `<div class="sel-name">${sel.length} unidades seleccionadas</div>`;
      const counts = {};
      for (const e of sel) counts[e.type] = (counts[e.type] || 0) + 1;
      for (const type in counts) {
        const b = document.createElement('button');
        b.className = 'sel-chip';
        b.innerHTML = `<img src="${iconFor(sel[0].kind === 'unit' ? 'unit' : 'building', type, g.players[sel[0].owner].colorIdx)}"><span>${counts[type]}</span>`;
        b.title = (UNITS[type] || BUILDINGS[type]).name;
        b.onclick = () => this.select(sel.filter((e) => e.type === type));
        list.appendChild(b);
      }
    }
  }

  /** Ficha de un animal del rebaño: quién lo tiene y cuánta comida le queda. */
  renderAnimalPanel(n) {
    const g = this.game;
    const info = this.el.selInfo;
    const img = document.createElement('img');
    img.className = 'portrait';
    img.src = iconFor('node', n.kind, 0);
    info.appendChild(img);
    const box = document.createElement('div');
    box.className = 'sel-text';
    const owner = n.owner === null || n.owner === undefined ? null : g.players[n.owner];
    const ownerLine = owner
      ? `<div class="sel-owner" style="color:${PLAYER_COLORS[owner.colorIdx].light}">${owner.name}</div>`
      : '<div class="sel-owner" style="color:#9c8a68">Sin dueño</div>';
    box.innerHTML = `<div class="sel-name">${NODE_NAMES[n.kind] || n.kind}</div>
      ${ownerLine}
      <div class="stat-row"><span>${RES_NAME[n.res]}: ${Math.ceil(n.amount)}</span></div>
      <div class="sel-desc">${owner && owner.isHuman
    ? 'Clic derecho para llevarla a otro sitio. Se cambia de bando si otro jugador se le acerca más.'
    : 'Acerca tus unidades para que se una a tu bando.'}</div>`;
    info.appendChild(box);
  }

  /** Varios animales a la vez: sólo hace falta cuántos son y de qué clase. */
  renderHerdPanel(sel) {
    const info = this.el.selInfo, list = this.el.selList;
    info.innerHTML = `<div class="sel-name">${sel.length} animales seleccionados</div>`;
    const counts = {};
    for (const n of sel) counts[n.kind] = (counts[n.kind] || 0) + 1;
    for (const kind in counts) {
      const b = document.createElement('button');
      b.className = 'sel-chip';
      b.innerHTML = `<img src="${iconFor('node', kind, 0)}"><span>${counts[kind]}</span>`;
      b.title = NODE_NAMES[kind] || kind;
      b.onclick = () => this.select(sel.filter((n) => n.kind === kind));
      list.appendChild(b);
    }
  }

  /** Construye la lista de botones según lo que esté seleccionado. */
  commandList() {
    const g = this.game, p = g.human, sel = g.selection;
    const btns = [];
    if (!sel.length || sel[0].owner !== p.id) return btns;

    // Rebaño: sólo se le puede mandar y parar.
    const animals = sel.filter((e) => isMyAnimal(e, g));
    if (animals.length === sel.length) {
      btns.push({
        icon: null, glyph: '✋', label: 'Detener',
        tooltip: 'El rebaño se queda donde está.',
        action: () => g.commandStop(animals),
      });
      return btns;
    }

    const units = sel.filter((e) => e.kind === 'unit');
    const buildings = sel.filter((e) => e.kind === 'building');

    if (units.length) {
      const hasVillager = units.some((u) => u.type === 'villager');
      const hasMilitary = units.some((u) => u.isMilitary);
      if (hasVillager) {
        for (const type of BUILD_ORDER) {
          const B = BUILDINGS[type];
          if (B.age > p.age) continue;
          if (B.req && !p.hasBuilding(B.req)) continue;
          btns.push({
            icon: iconFor('building', type, p.colorIdx),
            label: B.name,
            cost: B.cost,
            tooltip: `${B.name}\n${B.desc}`,
            disabled: !p.canAfford(B.cost),
            place: type, // con el dedo se arrastra desde aquí hasta el mapa
            action: () => this.startPlacing(type),
          });
        }
      }
      if (hasMilitary) {
        btns.push({
          icon: null, glyph: '⚔', label: 'Atacar aquí',
          tooltip: 'Ataque en movimiento: las unidades avanzan atacando a todo lo que encuentren.',
          action: () => { this.pending = 'attackmove'; document.body.classList.add('cursor-attack'); },
        });
      }
      btns.push({
        icon: null, glyph: '✋', label: 'Detener',
        tooltip: 'Cancela la orden actual.',
        action: () => g.commandStop(units),
      });
      btns.push({
        icon: null, glyph: '☠', label: 'Eliminar',
        tooltip: 'Destruye las unidades seleccionadas.',
        danger: true,
        action: () => this.deleteSelected(),
      });
      return btns;
    }

    if (buildings.length) {
      const b = buildings[0];
      const B = BUILDINGS[b.type];
      if (!b.built) {
        btns.push({
          icon: null, glyph: '☠', label: 'Cancelar obra', danger: true,
          tooltip: 'Derriba los cimientos.',
          action: () => g.commandDelete([b]),
        });
        return btns;
      }
      for (const type of B.trains || []) {
        if (!p.unitAvailable(type)) continue;
        const U = UNITS[type];
        btns.push({
          icon: iconFor('unit', type, p.colorIdx),
          label: U.name,
          cost: U.cost,
          tooltip: `${U.name}\n${U.desc}\nPV ${U.hp} · Ataque ${U.attack}`,
          disabled: !p.canAfford(U.cost),
          action: () => {
            for (const bb of buildings) {
              if (!BUILDINGS[bb.type].trains?.includes(type)) continue;
              const err = g.queueUnit(bb, type, p);
              if (err) { this.notify(err, 'bad'); this.audio.play('error'); }
              break;
            }
            this.updateAffordability();
          },
        });
      }
      // Mejoras de línea disponibles en este edificio.
      for (const key in UPGRADES) {
        const up = UPGRADES[key];
        if (up.building !== b.type || p.techs.has(key) || up.age > p.age) continue;
        if (!p.unitAvailable(up.from) && !p.techs.has(key)) {
          // Sólo se ofrece si ya tenemos el escalón previo disponible.
          const prevOk = UNITS[up.from].age <= p.age;
          if (!prevOk) continue;
        }
        btns.push({
          icon: iconFor('unit', up.to, p.colorIdx),
          label: up.name, cost: up.cost, upgrade: true,
          tooltip: `${up.name}\nConvierte tus ${UNITS[up.from].name} en ${UNITS[up.to].name}.`,
          disabled: !p.canAfford(up.cost),
          action: () => {
            const err = g.queueUpgrade(b, key, p);
            if (err) { this.notify(err, 'bad'); this.audio.play('error'); }
            this.updateAffordability();
          },
        });
      }
      for (const key of B.techs || []) {
        const t = TECHS[key];
        if (p.techs.has(key) || t.age > p.age) continue;
        if (t.requires && !p.techs.has(t.requires)) continue;
        btns.push({
          icon: iconFor('tech', t.name, 0),
          label: t.name, cost: t.cost,
          tooltip: `${t.name}\n${t.desc}`,
          disabled: !p.canAfford(t.cost),
          action: () => {
            const err = g.queueTech(b, key, p);
            if (err) { this.notify(err, 'bad'); this.audio.play('error'); }
            this.updateAffordability();
          },
        });
      }
      if (b.type === 'towncenter' && p.age < 3) {
        const next = AGES[p.age + 1];
        btns.push({
          icon: iconFor('tech', next.short, 0),
          label: `Avanzar a la ${next.short}`, cost: next.cost, big: true,
          tooltip: `${next.name}\nDesbloquea nuevas unidades, edificios y mejoras.\nRequiere ${next.reqBuildings} edificio(s) de la edad actual.`,
          disabled: !p.canAfford(next.cost),
          action: () => {
            const err = g.queueAge(b, p);
            if (err) { this.notify(err, 'bad'); this.audio.play('error'); }
            else this.notify(`Avanzando a la ${next.name}...`, 'good');
            this.updateAffordability();
          },
        });
      }
      if (B.market) {
        for (const r of ['food', 'wood', 'stone']) {
          btns.push({
            icon: iconFor('res', r, 0), label: `Vender ${RES_NAME[r]}`,
            tooltip: `Vende 100 de ${RES_NAME[r]} a cambio de ${Math.round(100 * MARKET_RATE.sell)} de oro.`,
            disabled: p.res[r] < 100,
            action: () => { g.commandMarket(r, 'sell'); this.audio.play('tech'); },
          });
        }
        for (const r of ['food', 'wood', 'stone']) {
          btns.push({
            icon: iconFor('res', r, 0), label: `Comprar ${RES_NAME[r]}`,
            tooltip: `Compra 100 de ${RES_NAME[r]} por ${Math.round(100 * MARKET_RATE.buy)} de oro.`,
            disabled: p.res.gold < 100 * MARKET_RATE.buy,
            action: () => { g.commandMarket(r, 'buy'); this.audio.play('tech'); },
          });
        }
      }
      btns.push({
        icon: null, glyph: '☠', label: 'Demoler', danger: true,
        tooltip: 'Destruye este edificio.',
        action: () => this.deleteSelected(),
      });
    }
    return btns;
  }

  /**
   * Rehace la botonera entera. Sólo debe llamarse cuando cambia *qué* botones
   * hay, nunca al pulsar uno: destruir el nodo que se acaba de tocar rompe los
   * toques seguidos en el móvil. Para el «se puede pagar o no» está
   * updateAffordability(), que sólo cambia una clase.
   */
  renderCommands() {
    const cont = this.el.commands;
    // Cualquier ficha abierta apunta a un botón que va a dejar de existir.
    this.hideTooltip();
    cont.innerHTML = '';
    const btns = this.commandList();
    this.buttons = btns;
    btns.forEach((b, i) => {
      b.hotkey = HOTKEYS[i] || '';
      const el = document.createElement('button');
      el.className = 'cmd' + (b.disabled ? ' disabled' : '') + (b.danger ? ' danger' : '') + (b.big ? ' big' : '');
      const inner = b.icon
        ? `<img src="${b.icon}" alt="">`
        : `<span class="glyph">${b.glyph || ''}</span>`;
      const costHtml = b.cost ? `<span class="cost">${RESOURCES.filter((r) => b.cost[r])
        .map((r) => `<i class="dot ${r}"></i>${b.cost[r]}`).join(' ')}</span>` : '';
      el.innerHTML = `${inner}<span class="key">${b.hotkey}</span>${costHtml}`;
      el.title = `${b.label}${b.hotkey ? ` [${b.hotkey}]` : ''}\n${b.tooltip || ''}${b.cost ? `\nCoste: ${RESOURCES.filter((r) => b.cost[r]).map((r) => `${b.cost[r]} ${RES_NAME[r]}`).join(', ')}` : ''}`;
      const run = () => {
        if (b.disabled) { this.audio.play('error'); this.notify('Recursos insuficientes', 'bad'); return; }
        b.action();
        this.audio.play('click');
      };
      // Con ratón la ficha sigue al puntero; con el dedo solo se ve mientras
      // se mantiene pulsado, para que no se quede tapando la barra inferior.
      el.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') this.showTooltip(b, el);
      });
      el.addEventListener('pointerleave', () => this.hideTooltip());
      /*
       * Todo el gesto táctil del botón lo lleva barGesture*: la orden se
       * ejecuta al levantar el dedo, sin esperar al «click» que sintetiza el
       * navegador —en iOS ese click llega tarde o no llega cuando se repiten
       * los toques, y encolar varias unidades seguidas fallaba—, y el arrastre
       * decide entre recorrer la tira y sacar el edificio al mapa.
       */
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        this.showTooltip(b, el, true);
        this.barGestureStart(el, b, run, e);
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') return;
        this.barGestureMove(e);
      });
      el.addEventListener('pointercancel', () => { this.hideTooltip(); this.barGestureCancel(); });
      el.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse') return;
        this.hideTooltip();
        this.barGestureEnd(e);
      });
      el.onclick = () => {
        // Descarta el click sintetizado que sigue a un toque ya atendido.
        if (el._tapAt && performance.now() - el._tapAt < 700) return;
        run();
      };
      cont.appendChild(el);
    });
  }

  /**
   * Muestra la ficha de una orden encima de su botón. Nunca se sale de la
   * pantalla: si no cabe arriba baja, y el ancho se limita por CSS al viewport.
   * `touch` la dibuja compacta, porque con el dedo tapa la barra inferior.
   */
  showTooltip(b, el, touch = false) {
    const t = this.el.tooltip;
    const cost = b.cost
      ? `<div class="tt-cost">${RESOURCES.filter((r) => b.cost[r])
        .map((r) => `<i class="dot ${r}"></i>${b.cost[r]}`).join(' ')}</div>` : '';
    // En táctil el texto va en línea corrida, así que los saltos se sustituyen
    // por un separador; con ratón se conservan como renglones.
    const lines = (b.tooltip || '').split('\n').slice(1);
    t.innerHTML = `<div class="tt-title">${b.label}${b.hotkey ? ` <em>[${b.hotkey}]</em>` : ''}</div>
      <div class="tt-body">${lines.join(touch ? ' · ' : '<br>')}</div>${cost}`;
    t.classList.toggle('touch', touch);
    t.classList.toggle('with-body', lines.length > 0);
    t.classList.remove('hidden');

    const m = 8;
    const r = el.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    // Con el dedo la ficha se apoya sobre la barra inferior completa, no sobre
    // el botón: así no tapa el panel de selección.
    const anchor = touch ? this.el.bottombar.getBoundingClientRect() : r;
    const cx = touch ? window.innerWidth / 2 : r.left + r.width / 2;
    t.style.left = `${clamp(cx - tw / 2, m, Math.max(m, window.innerWidth - tw - m))}px`;
    // Preferencia: encima. Si no cabe, debajo; y siempre dentro de la pantalla.
    let top = anchor.top - th - 10;
    if (top < m) top = anchor.bottom + 10;
    t.style.top = `${clamp(top, m, Math.max(m, window.innerHeight - th - m))}px`;

    // Red de seguridad: en táctil algunos navegadores se comen el «pointerup»
    // (al deslizar fuera del botón, al abrir un diálogo...) y la ficha se
    // quedaría pegada tapando la interfaz.
    clearTimeout(this.tooltipTimer);
    if (touch) this.tooltipTimer = setTimeout(() => this.hideTooltip(), 4000);
  }

  hideTooltip() {
    clearTimeout(this.tooltipTimer);
    this.el.tooltip.classList.add('hidden');
  }

  showResourceInfo(node) {
    const extra = node.herd
      ? 'Acerca tus unidades para que se una a tu bando y poder moverla.'
      : 'Envía aldeanos con el clic derecho para recolectarlo.';
    this.el.selInfo.innerHTML = `<div class="sel-text">
      <div class="sel-name">${NODE_NAMES[node.kind] || node.kind}</div>
      <div class="stat-row"><span>${RES_NAME[node.res]}: ${Math.ceil(node.amount)}</span></div>
      <div class="sel-desc">${extra}</div></div>`;
    this.el.selList.innerHTML = '';
    this.el.commands.innerHTML = '';
    this.buttons = [];
  }

  /** Icono y nombre de un elemento en cola, sea unidad, edad, mejora o tecnología. */
  queueIcon(item) {
    const idx = this.game.human.colorIdx;
    switch (item.kind) {
      case 'unit': return iconFor('unit', item.key, idx);
      case 'age': return iconFor('tech', AGES[item.key].short, 0);
      case 'upgrade': return iconFor('unit', UPGRADES[item.key].to, idx);
      default: return iconFor('tech', TECHS[item.key].name, 0);
    }
  }

  queueLabel(item) {
    switch (item.kind) {
      case 'unit': return UNITS[item.key].name;
      case 'age': return AGES[item.key].name;
      case 'upgrade': return UPGRADES[item.key].name;
      default: return TECHS[item.key].name;
    }
  }

  /**
   * Cola del edificio seleccionado, con un contador de cuántas cosas van a
   * salir. Igual que la tira: el DOM sólo se rehace cuando cambia la cola, no
   * en cada fotograma, que era pura basura para el navegador del móvil.
   */
  renderQueue() {
    const g = this.game;
    const sel = g.selection[0];
    const q = this.el.queue;
    const items = (sel && sel.kind === 'building' && sel.queue) ? sel.queue : [];
    const key = items.map((it) => `${it.kind}:${it.key}:${it.blocked ? 1 : 0}`).join(',');

    if (key !== this._queueKey) {
      this._queueKey = key;
      q.innerHTML = '';
      // Más iconos no caben en una tira estrecha; para el resto está el contador.
      items.slice(0, QUEUE_ICONS).forEach((item, i) => {
        const el = document.createElement('button');
        el.className = 'qitem' + (item.blocked ? ' blocked' : '');
        el.innerHTML = `<img src="${this.queueIcon(item)}"><span class="qbar"></span>`;
        el.title = item.blocked
          ? 'Bloqueado: límite de población alcanzado. Clic para cancelar.'
          : `${this.queueLabel(item)} · Clic para cancelar`;
        el.onclick = () => { g.cancelQueueItem(sel, i); this.renderQueue(); };
        el._bar = el.querySelector('.qbar');
        q.appendChild(el);
      });
      if (items.length > 1) {
        const c = document.createElement('span');
        c.className = 'qcount';
        c.textContent = `×${items.length}`;
        c.title = `${items.length} en cola`;
        q.appendChild(c);
      }
    }

    // Sólo avanza el primero de la cola.
    if (items.length && q.firstElementChild) {
      q.firstElementChild._bar.style.height = `${clamp((items[0].progress / items[0].time) * 100, 0, 100)}%`;
    }
  }

  /**
   * Tira de producción: una ficha por cada edificio propio que esté fabricando
   * algo, con lo que sale ahora y cuántas cosas más esperan detrás. Así se ve de
   * un vistazo qué se está produciendo sin ir seleccionando edificio por
   * edificio. El DOM sólo se rehace cuando cambia la lista; entre medias basta
   * con mover las barras de progreso.
   */
  renderProduction() {
    const g = this.game;
    const cont = this.el.production;
    const busy = [];
    for (const b of g.buildings) {
      if (b.owner === g.human.id && b.built && !b.dead && b.queue.length) busy.push(b);
    }
    // Orden estable por id: las fichas no deben bailar de sitio al repintar.
    busy.sort((a, b) => a.id - b.id);

    const key = busy.map((b) => {
      const it = b.queue[0];
      return `${b.id}:${it.kind}:${it.key}:${b.queue.length}:${it.blocked ? 1 : 0}`;
    }).join(',');

    if (key !== this._prodKey) {
      this._prodKey = key;
      cont.innerHTML = '';
      for (const b of busy) {
        const item = b.queue[0];
        const total = b.queue.length;
        const el = document.createElement('button');
        el.className = 'prod' + (item.blocked ? ' blocked' : '');
        el.innerHTML = `<img src="${this.queueIcon(item)}" alt=""><span class="pbar"></span>${
          total > 1 ? `<span class="pmore">×${total}</span>` : ''}`;
        el.title = `${this.queueLabel(item)} · ${BUILDINGS[b.type].name}${
          total > 1 ? ` (${total} en cola)` : ''}${
          item.blocked ? ' · bloqueado: falta población' : ''}\nClic para ir al edificio`;
        el.onclick = () => {
          this.select([b]);
          this.r.centerOn(b.cx, b.cy);
        };
        el._bar = el.querySelector('.pbar');
        cont.appendChild(el);
      }
      cont.classList.toggle('hidden', !busy.length);
      document.body.classList.toggle('producing', busy.length > 0);
    }

    const nodes = cont.children;
    for (let i = 0; i < busy.length && i < nodes.length; i++) {
      const item = busy[i].queue[0];
      nodes[i]._bar.style.width = `${clamp((item.progress / item.time) * 100, 0, 100)}%`;
    }
  }

  // --- Avisos ---------------------------------------------------------------

  notify(msg, kind = 'info') {
    // Evita que el mismo aviso se repita en cadena.
    const now = performance.now();
    this._lastNotif ||= {};
    if (this._lastNotif[msg] && now - this._lastNotif[msg] < 6000) return;
    this._lastNotif[msg] = now;
    const el = document.createElement('div');
    el.className = `notif ${kind}`;
    el.textContent = msg;
    this.el.notif.appendChild(el);
    setTimeout(() => { el.classList.add('fade'); }, 3200);
    setTimeout(() => { el.remove(); }, 4000);
    while (this.el.notif.childElementCount > 6) this.el.notif.firstChild.remove();
  }

  showEnd(won, reason = null) {
    const g = this.game;
    const s = g.human.stats;
    this.el.endScreen.classList.remove('hidden');
    const cortada = reason === 'disconnect';
    const title = document.getElementById('end-title');
    title.textContent = cortada ? 'Partida interrumpida' : (won ? '¡Victoria!' : 'Derrota');
    title.className = cortada ? '' : (won ? 'win' : 'lose');
    const intro = cortada
      ? 'Se ha perdido la conexión con el anfitrión, así que la partida no puede continuar.'
      : (won ? 'Has conquistado a todos tus rivales.' : 'Tu civilización ha caído.');
    // Si es el anfitrión quien cae, los demás siguen jugando en su equipo: se
    // avisa de que salir ahora les cortaría la partida.
    const sigue = g.keepsSimulating;
    document.getElementById('btn-end-watch').classList.toggle('hidden', !sigue);
    document.getElementById('end-body').innerHTML = `
      <p>${intro}</p>
      ${sigue ? '<p class="end-warn">Los demás siguen jugando desde tu equipo: si sales ahora, '
        + 'la partida se les cortará. Puedes quedarte mirando hasta que termine.</p>' : ''}
      <table class="stats">
        <tr><td>Duración</td><td>${fmtTime(g.time)}</td></tr>
        <tr><td>Edad alcanzada</td><td>${AGES[g.human.age].name}</td></tr>
        <tr><td>Recursos recolectados</td><td>${Math.round(s.gathered)}</td></tr>
        <tr><td>Unidades entrenadas</td><td>${s.unitsTrained}</td></tr>
        <tr><td>Bajas causadas</td><td>${s.kills}</td></tr>
        <tr><td>Unidades perdidas</td><td>${s.unitsLost}</td></tr>
        <tr><td>Edificios construidos</td><td>${s.buildingsBuilt}</td></tr>
      </table>`;
    this.audio.play(cortada ? 'defeat' : (won ? 'victory' : 'defeat'));
  }

  // --- Actualización por fotograma -----------------------------------------

  update(dt) {
    const g = this.game, p = g.human;
    for (const r of RESOURCES) {
      const v = Math.floor(p.res[r]);
      const el = this.el.res[r];
      if (el._v !== v) { el.textContent = v; el._v = v; }
    }
    const pop = `${p.pop}/${p.popCap}`;
    if (this.el.pop._v !== pop) {
      this.el.pop.textContent = pop;
      this.el.pop.classList.toggle('warn', p.pop >= p.popCap);
      this.el.pop._v = pop;
    }
    const ageTxt = AGES[p.age].name;
    if (this.el.age._v !== ageTxt) { this.el.age.textContent = ageTxt; this.el.age._v = ageTxt; }
    const clock = fmtTime(g.time);
    if (this.el.clock._v !== clock) { this.el.clock.textContent = clock; this.el.clock._v = clock; }

    const idle = g.idleVillagers().length;
    if (this.el.idleBtn._v !== idle) {
      this.el.idleCount.textContent = idle;
      this.el.idleBtn.classList.toggle('has-idle', idle > 0);
      this.el.idleBtn.title = idle
        ? `${idle} aldeano${idle === 1 ? '' : 's'} en reposo · pulsa para ir al siguiente [.]`
        : 'Aldeanos en reposo [.]';
      this.el.idleBtn._v = idle;
    }

    // Refrescar el panel si la selección cambió o si cambia lo que se puede pagar.
    const key = this.selectionSignature();
    if (key !== this.selectionKey) { this.selectionKey = key; this.refreshSelection(); }
    else this.updateAffordability();

    this.renderQueue();
    this.renderProduction();
    this.edgeScroll(dt);
  }

  updateAffordability() {
    if (!this.buttons) return;
    const p = this.game.human;
    const nodes = this.el.commands.children;
    for (let i = 0; i < this.buttons.length && i < nodes.length; i++) {
      const b = this.buttons[i];
      if (!b.cost) continue;
      const can = p.canAfford(b.cost);
      if (b.disabled === !can) continue;
      b.disabled = !can;
      nodes[i].classList.toggle('disabled', !can);
    }
  }

  /**
   * Desplazamiento por el borde de la pantalla, como en un juego a pantalla
   * completa: lo que dispara el movimiento es el borde de la ventana, no el del
   * lienzo, así que llevar el ratón al tope de la pantalla siempre funciona
   * aunque encima haya una barra del HUD. Sólo se detiene si el puntero está
   * justo sobre un control que se pueda pulsar o arrastrar.
   */
  edgeScroll(dt) {
    const r = this.r;
    let dx = 0, dy = 0;
    const k = this.keys;
    if (k.has('arrowleft') || k.has('a')) dx -= 1;
    if (k.has('arrowright') || k.has('d')) dx += 1;
    if (k.has('arrowup') || k.has('w')) dy -= 1;
    if (k.has('arrowdown') || k.has('s')) dy += 1;

    const mo = this.mouse;
    if (mo && !mo.out && !mo.onControl && !this.drag && !this.panning && !this.touchMode) {
      const m = 26;
      const W = window.innerWidth, H = window.innerHeight;
      if (mo.wx >= 0 && mo.wx <= W && mo.wy >= 0 && mo.wy <= H) {
        if (mo.wx < m) dx -= 1;
        else if (mo.wx > W - m) dx += 1;
        if (mo.wy < m) dy -= 1;
        else if (mo.wy > H - m) dy += 1;
      }
    }
    if (dx || dy) {
      const sp = 900 * dt / r.cam.zoom;
      r.cam.x += dx * sp; r.cam.y += dy * sp * 0.6;
      r.clampCam();
    }
  }
}
