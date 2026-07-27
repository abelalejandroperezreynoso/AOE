// Interfaz de usuario: HUD, panel de órdenes, minimapa y control con ratón/teclado.

import {
  UNITS, BUILDINGS, TECHS, UPGRADES, AGES, RESOURCES, RES_NAME,
  BUILD_ORDER, PLAYER_COLORS,
} from './config.js';
import { iconFor } from './sprites.js';
import { fmtTime, clamp, dist } from './utils.js';

const HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'A', 'S', 'D', 'F', 'G', 'H', 'Z', 'X', 'C', 'V', 'B', 'N'];
const MARKET_RATE = { sell: 0.8, buy: 1.4 };

/** Elementos con los que se interactúa y sobre los que no debe moverse la cámara. */
const CONTROL_SELECTOR = 'button, select, input, a, #minimap-panel, #commands, #queue, #sel-list, .overlay, .panel';

function isControl(target) {
  return !!(target && target.closest && target.closest(CONTROL_SELECTOR));
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
    this.el.minimap = id('minimap');
    this.mctx = this.el.minimap.getContext('2d');
    this.el.commands = id('commands');
    this.el.selInfo = id('sel-info');
    this.el.selList = id('sel-list');
    this.el.queue = id('queue');
    this.el.notif = id('notifications');
    this.el.tooltip = id('tooltip');
    this.el.pauseMenu = id('pause-menu');
    this.el.endScreen = id('end-screen');
    this.el.idleBtn = id('idle-villager');
    this.el.speed = id('speed-label');
  }

  buildStatic() {
    this.el.minimap.width = 480;
    this.el.minimap.height = 240;
    document.getElementById('btn-menu').onclick = () => this.togglePause();
    document.getElementById('btn-resume').onclick = () => this.togglePause();
    document.getElementById('btn-resign').onclick = () => {
      this.game.human.defeated = true;
      this.game.endGame(false);
      this.el.pauseMenu.classList.add('hidden');
      this.game.paused = false;
    };
    document.getElementById('btn-restart').onclick = () => location.reload();
    document.getElementById('btn-restart2').onclick = () => location.reload();
    const vol = document.getElementById('volume');
    vol.oninput = () => this.audio.setVolume(parseFloat(vol.value));
    this.el.idleBtn.onclick = () => this.selectIdleVillager();
    document.getElementById('btn-speed').onclick = () => this.cycleSpeed();
    document.getElementById('btn-help').onclick = () => {
      document.getElementById('help-panel').classList.toggle('hidden');
    };
    document.getElementById('btn-help-close').onclick = () => {
      document.getElementById('help-panel').classList.add('hidden');
    };
  }

  cycleSpeed() {
    const speeds = [1, 1.5, 2, 3];
    const i = speeds.indexOf(this.game.speed);
    this.game.speed = speeds[(i + 1) % speeds.length];
    this.el.speed.textContent = `${this.game.speed}x`;
  }

  togglePause() {
    this.game.paused = !this.game.paused;
    this.el.pauseMenu.classList.toggle('hidden', !this.game.paused);
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

    // Minimapa
    const mm = this.el.minimap;
    const mmGoto = (e, order) => {
      const rect = mm.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width * mm.width;
      const py = (e.clientY - rect.top) / rect.height * mm.height;
      const [u, v] = this.r.minimapToWorld(px, py, mm.width, mm.height);
      if (order) {
        this.game.commandMove(this.game.selection.filter((s) => s.kind === 'unit' && s.owner === 0), u, v);
        this.r.markOrder(u, v);
      } else this.r.centerOn(u, v);
    };
    mm.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 2) mmGoto(e, true);
      else { this.mmDrag = true; mmGoto(e, false); }
    });
    mm.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', () => { this.mmDrag = false; });
    window.addEventListener('mousemove', (e) => { if (this.mmDrag) mmGoto(e, false); });

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
  }

  /**
   * Control táctil: un toque selecciona lo propio o da la orden sobre lo
   * seleccionado, arrastrar mueve la cámara y pellizcar acerca o aleja.
   */
  bindTouch(c) {
    const pos = (t) => {
      const r = c.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const spread = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    let start = null, moved = false, pinch = 0, lastPan = null;

    c.addEventListener('touchstart', (e) => {
      this.audio.ensure();
      this.touchMode = true;
      if (e.touches.length === 1) {
        start = pos(e.touches[0]);
        lastPan = start;
        moved = false;
        if (this.game.placing) {
          this.game.placing.tx = undefined;
          const [u, v] = this.r.screenToWorld(start.x, start.y);
          const size = BUILDINGS[this.game.placing.type].size;
          this.game.placing.tx = Math.floor(u - size / 2 + 0.5);
          this.game.placing.ty = Math.floor(v - size / 2 + 0.5);
        }
      } else if (e.touches.length === 2) {
        pinch = spread(e.touches);
        moved = true;
      }
      e.preventDefault();
    }, { passive: false });

    c.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinch) {
        const d = spread(e.touches);
        this.r.cam.zoom *= d / pinch;
        pinch = d;
        this.r.clampCam();
      } else if (e.touches.length === 1 && lastPan) {
        const p = pos(e.touches[0]);
        if (Math.hypot(p.x - start.x, p.y - start.y) > 12) moved = true;
        if (moved && !this.game.placing) {
          this.r.cam.x -= (p.x - lastPan.x) / this.r.cam.zoom;
          this.r.cam.y -= (p.y - lastPan.y) / this.r.cam.zoom;
          this.r.clampCam();
        }
        if (this.game.placing) {
          const [u, v] = this.r.screenToWorld(p.x, p.y);
          const size = BUILDINGS[this.game.placing.type].size;
          this.game.placing.tx = Math.floor(u - size / 2 + 0.5);
          this.game.placing.ty = Math.floor(v - size / 2 + 0.5);
        }
        lastPan = p;
      }
      e.preventDefault();
    }, { passive: false });

    c.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) pinch = 0;
      if (!start || moved) { start = null; lastPan = null; return; }
      const { x, y } = start;
      start = null; lastPan = null;
      if (this.game.placing) { this.tryPlace(x, y, false); return; }
      if (this.pending === 'attackmove') { this.issueAttackMove(x, y); return; }
      const g = this.game;
      const target = this.r.entityAtScreen(x, y);
      const mine = g.selection.length && g.selection[0].owner === g.human.id;
      // Tocar algo propio lo selecciona; en cualquier otro caso es una orden.
      if (target && target.kind && target.owner === g.human.id) this.clickSelect(x, y, false, 0);
      else if (mine) this.rightClick(x, y, false);
      else this.clickSelect(x, y, false, 0);
      e.preventDefault();
    }, { passive: false });

    c.addEventListener('touchcancel', () => { start = null; lastPan = null; pinch = 0; });
  }

  // --- Selección ------------------------------------------------------------

  select(list) {
    for (const e of this.game.selection) e.selected = false;
    this.game.selection = list.filter((e) => e && !e.dead);
    for (const e of this.game.selection) e.selected = true;
    if (this.game.selection.length) this.audio.play('select');
    this.refreshSelection();
  }

  clickSelect(x, y, shift, elapsed) {
    const g = this.game;
    const e = this.r.entityAtScreen(x, y);
    if (!e) { if (!shift) this.select([]); return; }
    if (e.kind === undefined) { // nodo de recursos
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
    if (shift) {
      const set = new Set(g.selection.filter((e) => e.kind === 'unit'));
      for (const u of list) set.add(u);
      list = [...set];
    }
    if (!list.length && !shift) { this.select([]); return; }
    this.select(list);
  }

  selectIdleVillager() {
    const idle = this.game.idleVillagers();
    if (!idle.length) { this.notify('No hay aldeanos ociosos'); return; }
    this.idleIdx = ((this.idleIdx || 0) + 1) % idle.length;
    const v = idle[this.idleIdx];
    this.select([v]);
    this.r.centerOn(v.x, v.y);
  }

  centerOnSelection() {
    const s = this.game.selection[0];
    if (!s) return;
    this.r.centerOn(s.x ?? s.cx, s.y ?? s.cy);
  }

  deleteSelected() {
    const g = this.game;
    for (const e of g.selection.slice()) {
      if (e.owner !== g.human.id) continue;
      if (e.kind === 'unit') g.killUnit(e, null);
      else g.killBuilding(e, null);
    }
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
      for (const b of sel) {
        if (b.kind !== 'building') continue;
        b.rally = target && target.kind ? { x: target.x ?? target.cx, y: target.y ?? target.cy, target } : { x: u, y: v };
      }
      this.r.markOrder(u, v, '#ffe9a8');
      this.audio.play('order');
      return;
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
      this.r.markOrder(target.x + 0.5, target.y + 0.5, '#ffdc6a');
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

  refreshSelection() {
    const g = this.game;
    const sel = g.selection;
    const key = sel.map((e) => `${e.id}:${e.type}`).join(',') + `|${g.human.age}`;
    this.selectionKey = key;
    this.renderSelectionPanel();
    this.renderCommands();
  }

  renderSelectionPanel() {
    const g = this.game, sel = g.selection;
    const info = this.el.selInfo, list = this.el.selList;
    info.innerHTML = ''; list.innerHTML = '';
    if (!sel.length) {
      info.innerHTML = '<div class="hint">Selecciona unidades o edificios con el clic izquierdo. Clic derecho para dar órdenes.</div>';
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

  /** Construye la lista de botones según lo que esté seleccionado. */
  commandList() {
    const g = this.game, p = g.human, sel = g.selection;
    const btns = [];
    if (!sel.length || sel[0].owner !== p.id) return btns;

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
        action: () => { for (const u of units) u.stopTask(); },
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
          action: () => { g.killBuilding(b, null); },
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
            this.renderCommands();
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
            this.renderCommands();
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
            this.renderCommands();
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
            this.renderCommands();
          },
        });
      }
      if (B.market) {
        for (const r of ['food', 'wood', 'stone']) {
          btns.push({
            icon: iconFor('res', r, 0), label: `Vender ${RES_NAME[r]}`,
            tooltip: `Vende 100 de ${RES_NAME[r]} a cambio de ${Math.round(100 * MARKET_RATE.sell)} de oro.`,
            disabled: p.res[r] < 100,
            action: () => {
              if (p.res[r] < 100) return;
              p.res[r] -= 100; p.res.gold += Math.round(100 * MARKET_RATE.sell);
              this.audio.play('tech');
            },
          });
        }
        for (const r of ['food', 'wood', 'stone']) {
          btns.push({
            icon: iconFor('res', r, 0), label: `Comprar ${RES_NAME[r]}`,
            tooltip: `Compra 100 de ${RES_NAME[r]} por ${Math.round(100 * MARKET_RATE.buy)} de oro.`,
            disabled: p.res.gold < 100 * MARKET_RATE.buy,
            action: () => {
              const price = Math.round(100 * MARKET_RATE.buy);
              if (p.res.gold < price) return;
              p.res.gold -= price; p.res[r] += 100;
              this.audio.play('tech');
            },
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

  renderCommands() {
    const cont = this.el.commands;
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
      el.onmouseenter = () => this.showTooltip(b, el);
      el.onmouseleave = () => this.hideTooltip();
      el.onclick = () => {
        if (b.disabled) { this.audio.play('error'); this.notify('Recursos insuficientes', 'bad'); return; }
        b.action();
        this.audio.play('click');
      };
      cont.appendChild(el);
    });
  }

  showTooltip(b, el) {
    const t = this.el.tooltip;
    const cost = b.cost
      ? `<div class="tt-cost">${RESOURCES.filter((r) => b.cost[r])
        .map((r) => `<i class="dot ${r}"></i>${b.cost[r]}`).join(' ')}</div>` : '';
    t.innerHTML = `<div class="tt-title">${b.label}${b.hotkey ? ` <em>[${b.hotkey}]</em>` : ''}</div>
      <div class="tt-body">${(b.tooltip || '').split('\n').slice(1).join('<br>')}</div>${cost}`;
    t.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    t.style.left = `${clamp(r.left + r.width / 2 - 110, 8, window.innerWidth - 236)}px`;
    t.style.top = `${r.top - t.offsetHeight - 10}px`;
  }

  hideTooltip() { this.el.tooltip.classList.add('hidden'); }

  showResourceInfo(node) {
    const names = {
      tree: 'Árbol', gold: 'Mina de oro', stone: 'Cantera',
      berries: 'Arbustos de bayas', sheep: 'Oveja', deer: 'Ciervo',
    };
    this.el.selInfo.innerHTML = `<div class="sel-text">
      <div class="sel-name">${names[node.kind] || node.kind}</div>
      <div class="stat-row"><span>${RES_NAME[node.res]}: ${Math.ceil(node.amount)}</span></div>
      <div class="sel-desc">Envía aldeanos con el clic derecho para recolectarlo.</div></div>`;
    this.el.selList.innerHTML = '';
    this.el.commands.innerHTML = '';
    this.buttons = [];
  }

  renderQueue() {
    const g = this.game;
    const sel = g.selection[0];
    const q = this.el.queue;
    if (!sel || sel.kind !== 'building' || !sel.queue || !sel.queue.length) {
      if (q.childElementCount) q.innerHTML = '';
      return;
    }
    q.innerHTML = '';
    sel.queue.forEach((item, i) => {
      const el = document.createElement('button');
      el.className = 'qitem' + (item.blocked ? ' blocked' : '');
      const icon = item.kind === 'unit' ? iconFor('unit', item.key, g.human.colorIdx)
        : item.kind === 'age' ? iconFor('tech', AGES[item.key].short, 0)
          : item.kind === 'upgrade' ? iconFor('unit', UPGRADES[item.key].to, g.human.colorIdx)
            : iconFor('tech', TECHS[item.key].name, 0);
      const pct = Math.round((item.progress / item.time) * 100);
      el.innerHTML = `<img src="${icon}"><span class="qbar" style="height:${i === 0 ? pct : 0}%"></span>`;
      el.title = item.blocked ? 'Bloqueado: límite de población alcanzado. Clic para cancelar.' : 'Clic para cancelar';
      el.onclick = () => { g.cancelQueueItem(sel, i); this.renderQueue(); this.renderCommands(); };
      q.appendChild(el);
    });
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

  showEnd(won) {
    const g = this.game;
    const s = g.human.stats;
    this.el.endScreen.classList.remove('hidden');
    document.getElementById('end-title').textContent = won ? '¡Victoria!' : 'Derrota';
    document.getElementById('end-title').className = won ? 'win' : 'lose';
    document.getElementById('end-body').innerHTML = `
      <p>${won ? 'Has conquistado a todos tus rivales.' : 'Tu civilización ha caído.'}</p>
      <table class="stats">
        <tr><td>Duración</td><td>${fmtTime(g.time)}</td></tr>
        <tr><td>Edad alcanzada</td><td>${AGES[g.human.age].name}</td></tr>
        <tr><td>Recursos recolectados</td><td>${Math.round(s.gathered)}</td></tr>
        <tr><td>Unidades entrenadas</td><td>${s.unitsTrained}</td></tr>
        <tr><td>Bajas causadas</td><td>${s.kills}</td></tr>
        <tr><td>Unidades perdidas</td><td>${s.unitsLost}</td></tr>
        <tr><td>Edificios construidos</td><td>${s.buildingsBuilt}</td></tr>
      </table>`;
    this.audio.play(won ? 'victory' : 'defeat');
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
      this.el.idleBtn.textContent = `Ociosos: ${idle}`;
      this.el.idleBtn.classList.toggle('active', idle > 0);
      this.el.idleBtn._v = idle;
    }

    // Refrescar el panel si la selección cambió o si cambia lo que se puede pagar.
    const key = g.selection.map((e) => `${e.id}:${e.type}`).join(',') + `|${p.age}`;
    if (key !== this.selectionKey) { this.selectionKey = key; this.refreshSelection(); }
    else this.updateAffordability();

    this.renderQueue();
    this.r.drawMinimap(this.mctx, this.el.minimap.width, this.el.minimap.height);
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
   * Desplazamiento por el borde de la pantalla. La zona activa no acaba en el
   * lienzo: se prolonga por encima de la barra superior y por debajo de la
   * inferior, de modo que pasarse de largo no interrumpe el movimiento. Sobre
   * un control (botones, minimapa, panel de órdenes) no se desplaza nada.
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
      const m = 22;
      const inX = mo.x >= -4 && mo.x <= r.w + 4;
      const inY = mo.y >= -this.barTop() && mo.y <= r.h + this.barBottom();
      if (inX && inY) {
        if (mo.x < m) dx -= 1;
        else if (mo.x > r.w - m) dx += 1;
        if (mo.y < m) dy -= 1;            // incluye toda la barra superior
        else if (mo.y > r.h - m) dy += 1; // incluye toda la barra inferior
      }
    }
    if (dx || dy) {
      const sp = 900 * dt / r.cam.zoom;
      r.cam.x += dx * sp; r.cam.y += dy * sp * 0.6;
      r.clampCam();
    }
  }

  /** Alto de la barra superior, para saber hasta dónde llega la zona de borde. */
  barTop() {
    const el = document.getElementById('topbar');
    return el ? el.getBoundingClientRect().height : 44;
  }

  barBottom() {
    const el = document.getElementById('bottombar');
    return el ? el.getBoundingClientRect().height : 178;
  }
}
