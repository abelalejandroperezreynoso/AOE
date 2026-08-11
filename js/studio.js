// Taller de edificios: modelar en 3D dentro del propio juego.
//
// Un edificio se arma con piezas —cajas, tejados, torres, vigas— colocadas
// sobre su huella, y lo que se ve mientras se modela está proyectado e
// iluminado con la misma cámara y la misma luz que usa el horneado, así que la
// vista de trabajo y el sprite final son la misma cosa. Debajo se hornea de
// verdad, a tamaño de juego, en las tres etapas de obra.
//
// El visor pinta los triángulos por orden de lejanía con la API de Canvas (el
// pintor de toda la vida) en vez de rasterizar a mano: aquí interesa responder
// al arrastre del ratón, no clavar el resultado, que para eso está la vista
// previa horneada de al lado.

import { PLAYER_COLORS, AGES, UNITS, RESOURCES, RES_NAME } from './config.js';
import { project, depth, faceLight, rotZ, bake, HW, HH, VZ } from './gfx3d/engine.js';
import {
  PARTS, PART_KEYS, FIELDS, FLAGS, MATERIALS, MATERIAL_KEYS, PLAYER_MAT,
  DEFAULT_PALETTE, designParts, designMesh,
} from './gfx3d/parts.js';
import {
  allDesigns, getDesign, saveDesign, deleteDesign, duplicateDesign, canAddDesign,
  designFromTemplate, TEMPLATES, ROLES, STAT_FIELDS, ROLE_FIELDS, MAX_PARTS, MAX_DESIGNS,
} from './data/designs.js';
import { clearSpriteCaches, drawSprite } from './sprites.js';
import { captureBuilding, forgetBuilding, reset } from './data/overrides.js';

const el = (id) => document.getElementById(id);

const STAGE_NAMES = ['Cimientos', 'En obra', 'Terminado'];
const SNAPS = [
  [0.05, 'fino (0,05)'], [0.1, 'medio (0,1)'], [0.25, 'cuarto (0,25)'], [0.5, 'media casilla'],
];

export class Studio {
  constructor() {
    this.design = null;      // copia de trabajo del diseño abierto
    this.selected = -1;      // índice de la pieza elegida
    this.tab = 'part';
    this.colorIdx = 0;
    this.viewYaw = 0;        // 0-3: giro de la vista, sólo para trabajar
    this.zoom = 4;
    this.ox = 0; this.oy = 0;
    this.snap = 0.05;
    this.undo = [];
    this.picks = [];         // triángulos ya proyectados, para saber qué se pulsa
    this.drag = null;
    this.bind();
  }

  // --- Enganches --------------------------------------------------------------

  bind() {
    el('btn-studio').onclick = () => this.open();
    el('btn-studio-close').onclick = () => this.close();
    el('btn-studio-new').onclick = () => this.askTemplate();
    el('btn-studio-dup').onclick = () => {
      const d = duplicateDesign(this.design?.id);
      if (!d) return this.status(`No caben más de ${MAX_DESIGNS} edificios.`);
      captureBuilding(d.id);
      clearSpriteCaches();
      this.load(d.id);
      this.renderList();
      return this.status(`Copiado como «${d.name}».`);
    };
    el('btn-studio-del').onclick = () => this.confirmDelete();

    for (const btn of document.querySelectorAll('#studio-tabs button')) {
      btn.onclick = () => {
        this.tab = btn.dataset.tab;
        for (const b of document.querySelectorAll('#studio-tabs button')) {
          b.classList.toggle('active', b === btn);
        }
        this.renderPanel();
      };
    }

    const c = el('studio-view');
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', () => { this.drag = null; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => { if (this.isOpen()) this.redraw(); });
  }

  isOpen() { return !el('studio').classList.contains('hidden'); }

  open() {
    el('main-menu').classList.add('hidden');
    el('studio').classList.remove('hidden');
    this.renderTools();
    this.renderList();
    const first = allDesigns()[0];
    if (first) { this.load(first.id); return; }
    // Sin nada guardado se enseñan las plantillas: es la primera visita.
    this.tab = 'new';
    for (const b of document.querySelectorAll('#studio-tabs button')) b.classList.remove('active');
    this.clearView();
    this.renderPanel();
  }

  close() {
    this.persist(true);
    el('studio').classList.add('hidden');
    el('main-menu').classList.remove('hidden');
  }

  status(msg) {
    el('studio-status').textContent = msg || '';
    clearTimeout(this.statusTimer);
    if (msg) this.statusTimer = setTimeout(() => { el('studio-status').textContent = ''; }, 4000);
  }

  // --- Diseños ---------------------------------------------------------------

  /** Abre un diseño guardado en una copia de trabajo. */
  load(id) {
    const d = getDesign(id);
    if (!d) return;
    this.design = structuredClone(d);
    this.selected = this.design.parts.length ? 0 : -1;
    this.undo = [];
    this.fit();
    this.renderList();
    this.renderPanel();
    this.redraw();
    this.schedulePreview();
  }

  askTemplate() {
    if (!canAddDesign()) { this.status(`No caben más de ${MAX_DESIGNS} edificios.`); return; }
    this.tab = 'new';
    for (const b of document.querySelectorAll('#studio-tabs button')) b.classList.remove('active');
    this.renderPanel();
  }

  newDesign(templateKey) {
    if (!canAddDesign()) { this.status(`No caben más de ${MAX_DESIGNS} edificios.`); return; }
    const draft = designFromTemplate(templateKey);
    const saved = saveDesign(draft);
    if (!saved) { this.status('No se ha podido crear el edificio.'); return; }
    captureBuilding(saved.id);
    clearSpriteCaches();
    this.tab = 'part';
    for (const b of document.querySelectorAll('#studio-tabs button')) {
      b.classList.toggle('active', b.dataset.tab === 'part');
    }
    this.load(saved.id);
    this.status(`«${saved.name}» ya se puede construir en la partida.`);
  }

  confirmDelete() {
    const btn = el('btn-studio-del');
    if (!this.design) return;
    if (!this.confirming) {
      this.confirming = true;
      btn.textContent = '¿Seguro?';
      btn.classList.add('confirming');
      clearTimeout(this.delTimer);
      this.delTimer = setTimeout(() => this.cancelDelete(), 5000);
      return;
    }
    this.cancelDelete();
    const id = this.design.id;
    deleteDesign(id);
    forgetBuilding(id);
    clearSpriteCaches();
    this.design = null;
    const next = allDesigns()[0];
    this.renderList();
    if (next) this.load(next.id);
    else { this.clearView(); this.renderPanel(); }
    this.status('Edificio borrado.');
  }

  cancelDelete() {
    clearTimeout(this.delTimer);
    this.confirming = false;
    const btn = el('btn-studio-del');
    btn.textContent = 'Borrar';
    btn.classList.remove('confirming');
  }

  /**
   * Guarda la copia de trabajo. Los edificios del taller son suyos: al guardar
   * se dejan mandar sus valores y sus colores, así que se retiran los cambios
   * que el catálogo tuviera puestos encima de este edificio (los del resto del
   * juego no se tocan).
   */
  persist(now = false) {
    clearTimeout(this.saveTimer);
    if (!this.design) return;
    const doIt = () => {
      const saved = saveDesign(this.design);
      if (!saved) { this.status('No se ha podido guardar.'); return; }
      captureBuilding(saved.id);
      reset('building', saved.id);
      reset('buildingLook', saved.id);
      clearSpriteCaches();
      this.renderList();
    };
    if (now) doIt();
    else this.saveTimer = setTimeout(doIt, 350);
  }

  pushUndo() {
    if (!this.design) return;
    this.undo.push(JSON.stringify({ parts: this.design.parts, sel: this.selected }));
    if (this.undo.length > 40) this.undo.shift();
  }

  undoLast() {
    const snap = this.undo.pop();
    if (!snap || !this.design) return;
    const state = JSON.parse(snap);
    this.design.parts = state.parts;
    this.selected = Math.min(state.sel, this.design.parts.length - 1);
    this.afterChange();
    this.status('Deshecho.');
  }

  /**
   * Todo lo que hay que rehacer tras tocar el diseño. El punto de deshacer se
   * apunta antes de cambiar nada (`pushUndo`), no aquí: si no, se guardaría el
   * estado nuevo y deshacer no desharía nada.
   */
  afterChange() {
    this.redraw();
    this.renderPanel();
    this.persist();
    this.schedulePreview();
  }

  // --- Lista de edificios -----------------------------------------------------

  renderList() {
    const list = el('studio-list');
    list.innerHTML = '';
    const designs = allDesigns();
    if (!designs.length) {
      list.innerHTML = '<li class="cat-empty">Todavía no has hecho ninguno.</li>';
    }
    for (const d of designs) {
      const li = document.createElement('li');
      li.className = 'cat-item' + (this.design && d.id === this.design.id ? ' active' : '');
      const thumb = this.thumb(d, 44);
      thumb.className = 'cat-thumb';
      const text = document.createElement('div');
      text.className = 'cat-text';
      const n = document.createElement('div');
      n.className = 'cat-name';
      n.textContent = d.name;
      const s = document.createElement('div');
      s.className = 'cat-sub';
      s.textContent = `${ROLES[d.role].short} · ${d.size}×${d.size} · ${AGES[d.age].short}`;
      text.append(n, s);
      li.append(thumb, text);
      li.onclick = () => { this.persist(true); this.load(d.id); };
      list.appendChild(li);
    }
    el('btn-studio-dup').disabled = !this.design;
    el('btn-studio-del').disabled = !this.design;
    el('btn-studio-new').disabled = !canAddDesign();
  }

  /** Miniatura horneada de un diseño, encajada en su hueco. */
  thumb(design, size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    try {
      const s = bake(designMesh(design, this.colorIdx, 2));
      const sc = Math.min((size - 4) / s.w, (size - 4) / s.h);
      ctx.imageSmoothingEnabled = false;
      drawSprite(ctx, s, size / 2 - (s.w / 2 - s.ox) * sc, size - 2 - (s.h - s.oy) * sc, sc);
    } catch { /* un diseño vacío no tiene nada que enseñar */ }
    return c;
  }

  // --- Barra de herramientas --------------------------------------------------

  renderTools() {
    const bar = el('studio-tools');
    if (bar.dataset.ready) return;
    bar.dataset.ready = '1';

    const palette = document.createElement('div');
    palette.className = 'studio-palette';
    for (const k of PART_KEYS) {
      const spec = PARTS[k];
      const b = document.createElement('button');
      b.className = 'studio-piece';
      b.title = `${spec.label} — ${spec.hint}`;
      b.innerHTML = '<span class="studio-glyph"></span><span class="studio-piece-name"></span>';
      b.querySelector('.studio-glyph').textContent = spec.glyph;
      b.querySelector('.studio-piece-name').textContent = spec.label;
      b.onclick = () => this.addPart(k);
      palette.appendChild(b);
    }

    const view = document.createElement('div');
    view.className = 'studio-view-tools';

    const mkBtn = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onclick = fn;
      return b;
    };
    view.appendChild(mkBtn('↻ Girar vista', 'Mira el modelo desde otro lado. No cambia el edificio.', () => {
      this.viewYaw = (this.viewYaw + 1) % 4;
      this.redraw();
    }));
    view.appendChild(mkBtn('⤢ Encajar', 'Vuelve a centrar y ajustar el zoom.', () => { this.fit(); this.redraw(); }));
    view.appendChild(mkBtn('↶ Deshacer', 'Deshace el último cambio [Ctrl+Z]', () => this.undoLast()));

    const snap = document.createElement('label');
    snap.className = 'studio-inline';
    snap.innerHTML = '<span>Rejilla</span>';
    const snapSel = document.createElement('select');
    for (const [v, label] of SNAPS) snapSel.add(new Option(label, v));
    snapSel.value = String(this.snap);
    snapSel.onchange = () => { this.snap = Number(snapSel.value); };
    snap.appendChild(snapSel);
    view.appendChild(snap);

    const color = document.createElement('label');
    color.className = 'studio-inline';
    color.innerHTML = '<span>Jugador</span>';
    const colorSel = document.createElement('select');
    for (const [i, p] of PLAYER_COLORS.entries()) colorSel.add(new Option(p.name, i));
    colorSel.value = String(this.colorIdx);
    colorSel.onchange = () => {
      this.colorIdx = Number(colorSel.value);
      this.redraw();
      this.renderList();
      this.schedulePreview();
    };
    color.appendChild(colorSel);
    view.appendChild(color);

    bar.append(palette, view);
  }

  // --- Piezas -----------------------------------------------------------------

  addPart(kind) {
    if (!this.design) return;
    if (this.design.parts.length >= MAX_PARTS) {
      this.status(`Un edificio no puede pasar de ${MAX_PARTS} piezas.`);
      return;
    }
    this.pushUndo();
    const spec = PARTS[kind];
    const p = { ...structuredClone(spec.def), k: kind };
    // La pieza nace en el centro de la huella; si hay otra elegida, encima de
    // ella, que es lo que se quiere el 90% de las veces (muro → tejado).
    const s = this.design.size;
    const sel = this.design.parts[this.selected];
    if (p.x !== undefined) p.x = sel ? sel.x : s / 2;
    if (p.y !== undefined) p.y = sel ? sel.y : s / 2;
    if (p.z !== undefined && sel) p.z = Math.min(FIELDS.z.max, this.topOf(sel));
    this.design.parts.push(p);
    this.selected = this.design.parts.length - 1;
    this.afterChange();
    this.status(`${spec.label} añadida.`);
  }

  /** Cota a la que remata una pieza: donde apoyar la siguiente. */
  topOf(part) {
    if (part.h !== undefined) return (part.z || 0) + part.h + (part.rise || 0);
    if (part.rise !== undefined) return (part.z || 0) + part.rise;
    if (part.r !== undefined) return (part.z || 0) + part.r * 2 * (part.flat || 1);
    return part.z || 0;
  }

  deletePart() {
    if (!this.design || this.selected < 0) return;
    this.pushUndo();
    this.design.parts.splice(this.selected, 1);
    this.selected = Math.min(this.selected, this.design.parts.length - 1);
    this.afterChange();
  }

  duplicatePart() {
    if (!this.design || this.selected < 0) return;
    if (this.design.parts.length >= MAX_PARTS) return;
    this.pushUndo();
    const copy = structuredClone(this.design.parts[this.selected]);
    if (copy.x !== undefined) copy.x = Math.min(FIELDS.x.max, copy.x + 0.25);
    this.design.parts.splice(this.selected + 1, 0, copy);
    this.selected += 1;
    this.afterChange();
  }

  // --- Visor ------------------------------------------------------------------

  clearView() {
    const c = el('studio-view');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    el('studio-shots').innerHTML = '';
    el('studio-info').textContent = '';
  }

  /** Punto del mundo (ya girado por la vista) a píxeles del lienzo. */
  toScreen(p) {
    const [sx, sy] = project(p);
    return [this.ox + sx * this.zoom, this.oy + sy * this.zoom];
  }

  /** Gira un punto del suelo con la vista de trabajo. */
  spin(x, y) {
    if (!this.viewYaw) return [x, y];
    const a = (this.viewYaw * Math.PI) / 2;
    const c = Math.cos(a), s = Math.sin(a), m = (this.design?.size || 2) / 2;
    return [m + (x - m) * c - (y - m) * s, m + (x - m) * s + (y - m) * c];
  }

  /** Ajusta zoom y encuadre para que quepa todo el edificio. */
  fit() {
    const c = el('studio-view');
    const box = c.getBoundingClientRect();
    const W = Math.max(120, box.width), H = Math.max(120, box.height);
    const s = this.design?.size || 2;
    const pts = [];
    for (const [x, y] of [[0, 0], [s, 0], [s, s], [0, s]]) {
      const [rx, ry] = this.spin(x, y);
      pts.push(project([rx, ry, 0]));
    }
    if (this.design) {
      for (const g of designParts(this.design, this.colorIdx, 2, true)) {
        for (const t of g.tris) {
          for (const p of t.p) {
            const [rx, ry] = this.spin(p[0], p[1]);
            pts.push(project([rx, ry, p[2]]));
          }
        }
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of pts) {
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    const pad = 24;
    this.zoom = Math.max(1.5, Math.min(12, Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1))));
    this.ox = W / 2 - ((x0 + x1) / 2) * this.zoom;
    this.oy = H / 2 - ((y0 + y1) / 2) * this.zoom;
  }

  redraw() {
    const c = el('studio-view');
    const box = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(120, Math.round(box.width)), H = Math.max(120, Math.round(box.height));
    if (c.width !== W * dpr || c.height !== H * dpr) {
      c.width = W * dpr; c.height = H * dpr;
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#3f5a30';
    ctx.fillRect(0, 0, W, H);
    if (!this.design) return;

    this.drawGround(ctx);

    // Triángulos de todas las piezas, proyectados y ordenados de lejos a cerca:
    // el algoritmo del pintor. Con unos miles de caras va sobrado y responde al
    // arrastre sin pensárselo.
    const groups = designParts(this.design, this.colorIdx, 2, true);
    const list = [];
    for (const g of groups) {
      const gi = this.design.parts.indexOf(g.part);
      if (this.viewYaw) rotZ(g.tris, (this.viewYaw * Math.PI) / 2, this.design.size / 2, this.design.size / 2);
      for (const t of g.tris) {
        list.push({
          gi,
          pts: t.p.map((p) => this.toScreen(p)),
          dep: (depth(t.p[0]) + depth(t.p[1]) + depth(t.p[2])) / 3 - (t.bias || 0),
          c: t.c,
          light: faceLight(t),
        });
      }
    }
    list.sort((a, b) => b.dep - a.dep);
    this.picks = list;

    for (const it of list) {
      const l = it.light;
      ctx.fillStyle = `rgb(${Math.min(255, it.c[0] * l) | 0},${Math.min(255, it.c[1] * l) | 0},${Math.min(255, it.c[2] * l) | 0})`;
      ctx.beginPath();
      ctx.moveTo(it.pts[0][0], it.pts[0][1]);
      ctx.lineTo(it.pts[1][0], it.pts[1][1]);
      ctx.lineTo(it.pts[2][0], it.pts[2][1]);
      ctx.closePath();
      ctx.fill();
      // Un pelo de trazo del mismo color tapa la costura entre triángulos que
      // deja el suavizado del navegador.
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    this.drawSelection(ctx);
    this.drawLegend(ctx, W, H);
  }

  /** La huella del edificio: las casillas que ocupará en el mapa. */
  drawGround(ctx) {
    const s = this.design.size;
    const corner = (x, y) => {
      const [rx, ry] = this.spin(x, y);
      return this.toScreen([rx, ry, 0]);
    };
    for (let i = 0; i < s; i++) {
      for (let j = 0; j < s; j++) {
        const p = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        for (let k = 1; k < 4; k++) ctx.lineTo(p[k][0], p[k][1]);
        ctx.closePath();
        ctx.fillStyle = (i + j) % 2 ? '#4e7038' : '#496a34';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // Borde de la huella y esquina de anclaje (el origen del modelo).
    ctx.beginPath();
    const b = [corner(0, 0), corner(s, 0), corner(s, s), corner(0, s)];
    ctx.moveTo(b[0][0], b[0][1]);
    for (let k = 1; k < 4; k++) ctx.lineTo(b[k][0], b[k][1]);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(240,214,133,.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(240,214,133,.9)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    const mx = corner(s + 0.35, s / 2), my = corner(s / 2, s + 0.35), o = corner(-0.2, -0.2);
    ctx.textAlign = 'center';
    ctx.fillText('+X', mx[0], mx[1]);
    ctx.fillText('+Y', my[0], my[1]);
    ctx.fillText('0,0', o[0], o[1]);
  }

  /** Realce de la pieza elegida: su bulto en oro y su punto de anclaje. */
  drawSelection(ctx) {
    if (this.selected < 0 || !this.picks.length) return;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#f0d685';
    for (const it of this.picks) {
      if (it.gi !== this.selected) continue;
      ctx.beginPath();
      ctx.moveTo(it.pts[0][0], it.pts[0][1]);
      ctx.lineTo(it.pts[1][0], it.pts[1][1]);
      ctx.lineTo(it.pts[2][0], it.pts[2][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    const part = this.design.parts[this.selected];
    if (!part || part.x === undefined) return;
    const [rx, ry] = this.spin(part.x, part.y);
    const foot = this.toScreen([rx, ry, 0]);
    const anchor = this.toScreen([rx, ry, part.z || 0]);
    ctx.strokeStyle = 'rgba(240,214,133,.8)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(foot[0], foot[1]);
    ctx.lineTo(anchor[0], anchor[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f0d685';
    ctx.beginPath();
    ctx.arc(anchor[0], anchor[1], 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawLegend(ctx, W, H) {
    const part = this.design.parts[this.selected];
    ctx.fillStyle = 'rgba(20,16,11,.65)';
    ctx.fillRect(0, H - 22, W, 22);
    ctx.fillStyle = '#d5c6a2';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    const pos = part && part.x !== undefined
      ? ` · en (${part.x.toFixed(2)}, ${part.y.toFixed(2)}, ${(part.z || 0).toFixed(2)})`
      : '';
    ctx.fillText(
      `Arrastra para mover · Mayús + arrastrar sube y baja · rueda para el zoom${pos}`,
      10, H - 7,
    );
  }

  // --- Ratón ------------------------------------------------------------------

  pointerAt(e) {
    const box = el('studio-view').getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  }

  /** Qué pieza hay bajo el puntero: la cara más cercana que lo contiene. */
  pick(px, py) {
    for (let i = this.picks.length - 1; i >= 0; i--) {
      const it = this.picks[i];
      if (pointInTri(px, py, it.pts)) return it.gi;
    }
    return -1;
  }

  onDown(e) {
    if (!this.design) return;
    el('studio-view').setPointerCapture(e.pointerId);
    const [px, py] = this.pointerAt(e);
    const hit = e.button === 2 ? -1 : this.pick(px, py);
    if (hit >= 0 && this.design.parts[hit]) {
      if (hit !== this.selected) { this.selected = hit; this.renderPanel(); }
      const part = this.design.parts[hit];
      this.drag = {
        mode: e.shiftKey ? 'z' : 'xy',
        px, py, moved: false,
        start: { x: part.x, y: part.y, z: part.z },
      };
      this.pushUndo();
    } else {
      this.drag = { mode: 'pan', px, py, moved: false, ox: this.ox, oy: this.oy, hit };
    }
    this.redraw();
  }

  onMove(e) {
    if (!this.drag || !this.design) return;
    const [px, py] = this.pointerAt(e);
    const dsx = px - this.drag.px, dsy = py - this.drag.py;
    if (Math.abs(dsx) > 2 || Math.abs(dsy) > 2) this.drag.moved = true;

    if (this.drag.mode === 'pan') {
      this.ox = this.drag.ox + dsx;
      this.oy = this.drag.oy + dsy;
      this.redraw();
      return;
    }

    const part = this.design.parts[this.selected];
    if (!part) return;
    if (this.drag.mode === 'z') {
      if (part.z === undefined) return;
      const dz = -dsy / (VZ * this.zoom);
      part.z = clampField('z', snapTo(this.drag.start.z + dz, this.snap));
    } else {
      if (part.x === undefined) return;
      // Del desplazamiento en pantalla al desplazamiento en el suelo, y de ahí
      // deshaciendo el giro de la vista para llegar a los ejes del edificio.
      const rx = (dsx / (HW * this.zoom) + dsy / (HH * this.zoom)) / 2;
      const ry = (dsy / (HH * this.zoom) - dsx / (HW * this.zoom)) / 2;
      const a = -(this.viewYaw * Math.PI) / 2;
      const dx = rx * Math.cos(a) - ry * Math.sin(a);
      const dy = rx * Math.sin(a) + ry * Math.cos(a);
      part.x = clampField('x', snapTo(this.drag.start.x + dx, this.snap));
      part.y = clampField('y', snapTo(this.drag.start.y + dy, this.snap));
    }
    this.redraw();
  }

  onUp(e) {
    if (!this.drag) return;
    const wasPan = this.drag.mode === 'pan';
    const moved = this.drag.moved;
    this.drag = null;
    if (wasPan) {
      // Un clic limpio en el suelo suelta la selección; arrastrar sólo movía la vista.
      if (!moved && e.button !== 2 && this.selected >= 0) {
        this.selected = -1;
        this.renderPanel();
        this.redraw();
      }
      return;
    }
    if (moved) { this.renderPanel(); this.persist(); this.schedulePreview(); } else this.undo.pop();
  }

  onWheel(e) {
    if (!this.design) return;
    e.preventDefault();
    const [px, py] = this.pointerAt(e);
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = Math.max(1.5, Math.min(16, this.zoom * k));
    // Se amplía sobre el puntero, que es donde está mirando quien modela.
    this.ox = px - ((px - this.ox) * next) / this.zoom;
    this.oy = py - ((py - this.oy) * next) / this.zoom;
    this.zoom = next;
    this.redraw();
  }

  onKey(e) {
    if (!this.isOpen()) return;
    if (e.key === 'Escape') { this.close(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undoLast(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicatePart(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deletePart(); return; }
    const part = this.design?.parts[this.selected];
    if (!part) return;
    const step = e.shiftKey ? this.snap * 4 : this.snap;
    const nudge = (key, delta) => {
      if (part[key] === undefined) return;
      this.pushUndo();
      part[key] = clampField(key, snapTo(part[key] + delta, this.snap));
      e.preventDefault();
      this.afterChange();
    };
    // Las flechas mueven por el suelo tal y como se ve; ↑↓ con Alt suben la pieza.
    if (e.key === 'ArrowUp') nudge(e.altKey ? 'z' : 'y', e.altKey ? step : -step);
    else if (e.key === 'ArrowDown') nudge(e.altKey ? 'z' : 'y', e.altKey ? -step : step);
    else if (e.key === 'ArrowLeft') nudge('x', -step);
    else if (e.key === 'ArrowRight') nudge('x', step);
  }

  // --- Vista previa horneada --------------------------------------------------

  schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderPreview(), 220);
  }

  /**
   * Las tres etapas de obra tal y como saldrán en la partida: mismo horneado,
   * mismo tamaño. Es la prueba de fuego de un diseño, porque a tamaño de juego
   * se ven las siluetas y no la micro-geometría.
   */
  renderPreview() {
    const wrap = el('studio-shots');
    wrap.innerHTML = '';
    if (!this.design) return;
    let tris = 0, px = 0;
    for (let stage = 0; stage < 3; stage++) {
      const cell = document.createElement('div');
      cell.className = 'studio-shot';
      const c = document.createElement('canvas');
      const label = document.createElement('span');
      label.textContent = STAGE_NAMES[stage];
      try {
        const mesh = designMesh(this.design, this.colorIdx, stage, true);
        const s = bake(mesh);
        if (stage === 2) { tris = mesh.length; px = `${s.canvas.width}×${s.canvas.height}`; }
        c.width = Math.max(24, Math.ceil(s.w) + 8);
        c.height = Math.max(24, Math.ceil(s.h) + 8);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#4a6b3a';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.imageSmoothingEnabled = false;
        drawSprite(ctx, s, s.ox + 4, s.oy + 4, 1);
      } catch {
        c.width = 24; c.height = 24;
      }
      cell.append(c, label);
      wrap.appendChild(cell);
    }
    el('studio-info').textContent =
      `${this.design.parts.length} pieza${this.design.parts.length === 1 ? '' : 's'} · `
      + `${tris} triángulos · sprite de ${px || '—'} px`;
  }

  // --- Panel de propiedades ---------------------------------------------------

  renderPanel() {
    const box = el('studio-panel');
    box.innerHTML = '';
    if (this.tab === 'new') { box.appendChild(this.templatePanel()); return; }
    if (!this.design) {
      box.innerHTML = '<p class="cat-empty">Crea un edificio para empezar.</p>';
      return;
    }
    if (this.tab === 'part') box.appendChild(this.partPanel());
    else if (this.tab === 'build') box.appendChild(this.buildPanel());
    else box.appendChild(this.colorPanel());
  }

  templatePanel() {
    const wrap = document.createElement('div');
    const h = document.createElement('h4');
    h.className = 'studio-h';
    h.textContent = 'Empezar por...';
    wrap.appendChild(h);
    for (const t of TEMPLATES) {
      const b = document.createElement('button');
      b.className = 'studio-template';
      b.innerHTML = '<b></b><small></small>';
      b.querySelector('b').textContent = t.label;
      b.querySelector('small').textContent = t.hint;
      b.onclick = () => this.newDesign(t.key);
      wrap.appendChild(b);
    }
    return wrap;
  }

  /** Lista de piezas y los valores de la elegida. */
  partPanel() {
    const wrap = document.createElement('div');
    const list = document.createElement('ul');
    list.className = 'studio-parts';
    this.design.parts.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'studio-part' + (i === this.selected ? ' active' : '');
      const swatch = document.createElement('i');
      swatch.className = 'studio-swatch';
      swatch.style.background = p.m === PLAYER_MAT
        ? PLAYER_COLORS[this.colorIdx].main
        : (this.design.palette[p.m] || DEFAULT_PALETTE[p.m] || '#888');
      const name = document.createElement('span');
      name.textContent = `${PARTS[p.k].glyph} ${PARTS[p.k].label}`;
      li.append(swatch, name);
      li.onclick = () => { this.selected = i; this.renderPanel(); this.redraw(); };
      list.appendChild(li);
    });
    if (!this.design.parts.length) {
      list.innerHTML = '<li class="cat-empty">Añade piezas desde la barra de arriba.</li>';
    }
    wrap.appendChild(list);

    const part = this.design.parts[this.selected];
    if (!part) {
      const p = document.createElement('p');
      p.className = 'cat-empty';
      p.textContent = 'Elige una pieza en el modelo o en la lista.';
      wrap.appendChild(p);
      return wrap;
    }

    const spec = PARTS[part.k];
    const hint = document.createElement('p');
    hint.className = 'studio-hint-text';
    hint.textContent = spec.hint;
    wrap.appendChild(hint);

    const rows = [];
    for (const key of spec.fields) rows.push(this.partField(part, key));
    rows.push(this.materialField(part));
    for (const f of FLAGS) rows.push(this.flagField(part, f));
    wrap.appendChild(group(spec.label, rows));

    const actions = document.createElement('div');
    actions.className = 'studio-actions';
    const dup = document.createElement('button');
    dup.textContent = 'Duplicar pieza';
    dup.onclick = () => this.duplicatePart();
    const del = document.createElement('button');
    del.className = 'studio-del';
    del.textContent = 'Borrar pieza';
    del.onclick = () => this.deletePart();
    actions.append(dup, del);
    wrap.appendChild(actions);
    return wrap;
  }

  partField(part, key) {
    const f = FIELDS[key];
    const row = document.createElement('label');
    row.className = 'cat-field';
    const name = document.createElement('span');
    name.className = 'cat-label';
    name.textContent = f.unit ? `${f.label} (${f.unit})` : f.label;
    let input;
    if (f.type === 'choice') {
      input = document.createElement('select');
      for (const [v, label] of f.options) input.add(new Option(label, v));
      input.value = part[key];
      input.onchange = () => { this.pushUndo(); part[key] = input.value; this.afterChange(); };
    } else {
      input = document.createElement('input');
      input.type = 'number';
      input.min = f.min; input.max = f.max; input.step = f.step;
      input.value = round(part[key]);
      const commit = () => {
        const v = Number(input.value);
        this.pushUndo();
        part[key] = Number.isFinite(v) ? clampField(key, v) : part[key];
        input.value = round(part[key]);
        this.afterChange();
      };
      input.onchange = commit;
      input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
    }
    row.append(name, input);
    return row;
  }

  materialField(part) {
    const row = document.createElement('label');
    row.className = 'cat-field';
    const name = document.createElement('span');
    name.className = 'cat-label';
    name.textContent = 'Material';
    const sel = document.createElement('select');
    for (const m of MATERIALS) sel.add(new Option(m.label, m.key));
    sel.add(new Option('Color del jugador', PLAYER_MAT));
    sel.value = MATERIAL_KEYS.includes(part.m) ? part.m : 'wall';
    sel.onchange = () => { this.pushUndo(); part.m = sel.value; this.afterChange(); };
    row.append(name, sel);
    return row;
  }

  flagField(part, f) {
    const row = document.createElement('label');
    row.className = 'cat-field';
    const name = document.createElement('span');
    name.className = 'cat-label';
    name.textContent = f.label;
    name.title = f.hint;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!part[f.key];
    input.onchange = () => {
      this.pushUndo();
      if (input.checked) part[f.key] = true; else delete part[f.key];
      this.afterChange();
    };
    row.append(name, input);
    return row;
  }

  /** La ficha del edificio: cómo se comporta en la partida. */
  buildPanel() {
    const d = this.design;
    const wrap = document.createElement('div');

    const nameRow = textRow('Nombre', d.name, 28, (v) => { d.name = v; this.afterChange(); });
    const descRow = textRow('Descripción', d.desc, 120, (v) => { d.desc = v; this.afterChange(); });

    const sizeRow = selectRow('Huella', String(d.size), [1, 2, 3, 4].map((n) => [String(n), `${n}×${n} casillas`]), (v) => {
      d.size = Number(v);
      this.fit();
      this.afterChange();
    });
    const ageRow = selectRow('Edad', String(d.age), AGES.map((a, i) => [String(i), a.name]), (v) => {
      d.age = Number(v);
      this.afterChange();
    });
    wrap.appendChild(group('Ficha', [nameRow, descRow, sizeRow, ageRow]));

    const roleRow = selectRow('Función', d.role,
      Object.entries(ROLES).map(([k, r]) => [k, r.label]), (v) => {
        d.role = v;
        // Los valores propios del papel nuevo se rellenan solos al validar.
        Object.assign(d, pickRoleDefaults(v, d));
        this.afterChange();
      });
    const roleRows = [roleRow];
    const roleHint = document.createElement('p');
    roleHint.className = 'studio-hint-text';
    roleHint.textContent = ROLES[d.role].hint;

    if (d.role === 'store') {
      for (const r of RESOURCES) {
        roleRows.push(checkRow(RES_NAME[r], d.dropoff.includes(r), (on) => {
          const set = new Set(d.dropoff);
          if (on) set.add(r); else set.delete(r);
          d.dropoff = [...set];
          if (!d.dropoff.length) d.dropoff = [r];
          this.afterChange();
        }));
      }
    }
    if (d.role === 'train') {
      for (const [type, def] of Object.entries(UNITS)) {
        roleRows.push(checkRow(def.name, d.trains.includes(type), (on) => {
          const set = new Set(d.trains);
          if (on) set.add(type); else set.delete(type);
          d.trains = [...set];
          if (!d.trains.length) d.trains = [type];
          this.afterChange();
        }));
      }
    }
    for (const f of ROLE_FIELDS[d.role] || []) roleRows.push(this.statField(d, f));
    const roleGroup = group('Qué hace', roleRows);
    roleGroup.insertBefore(roleHint, roleGroup.querySelector('.cat-grid'));
    wrap.appendChild(roleGroup);

    const costRows = RESOURCES.map((r) => this.statField(d.cost, {
      key: r, label: RES_NAME[r], min: 0, max: 5000, step: 5,
    }));
    wrap.appendChild(group('Coste', costRows));
    wrap.appendChild(group('Valores', STAT_FIELDS.map((f) => this.statField(d, f))));
    return wrap;
  }

  statField(obj, f) {
    const row = document.createElement('label');
    row.className = 'cat-field';
    const name = document.createElement('span');
    name.className = 'cat-label';
    name.textContent = f.unit ? `${f.label} (${f.unit})` : f.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = f.min; input.max = f.max; input.step = f.step;
    input.value = round(obj[f.key] ?? f.min);
    const commit = () => {
      const v = Number(input.value);
      obj[f.key] = Number.isFinite(v) ? Math.min(f.max, Math.max(f.min, v)) : (obj[f.key] ?? f.min);
      input.value = round(obj[f.key]);
      this.afterChange();
    };
    input.onchange = commit;
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
    row.append(name, input);
    return row;
  }

  /** Los colores del edificio: sólo los materiales que usa de verdad. */
  colorPanel() {
    const wrap = document.createElement('div');
    const used = new Set(this.design.parts.map((p) => p.m).filter((m) => m !== PLAYER_MAT));
    used.add('wood');
    const rows = [];
    for (const m of MATERIALS) {
      if (!used.has(m.key)) continue;
      rows.push(this.colorField(m));
    }
    const note = document.createElement('p');
    note.className = 'studio-hint-text';
    note.textContent = used.size
      ? 'Sólo salen los materiales que usa alguna pieza. El color del jugador no se elige aquí: lo pone quien construya el edificio.'
      : 'Añade piezas para poder darles color.';
    wrap.appendChild(note);
    if (rows.length) wrap.appendChild(group('Colores', rows));

    const others = document.createElement('details');
    others.className = 'studio-more';
    const sum = document.createElement('summary');
    sum.textContent = 'Los demás materiales';
    others.appendChild(sum);
    const rest = MATERIALS.filter((m) => !used.has(m.key)).map((m) => this.colorField(m));
    if (rest.length) others.appendChild(group('', rest));
    wrap.appendChild(others);
    return wrap;
  }

  colorField(m) {
    const row = document.createElement('label');
    row.className = 'cat-field';
    const name = document.createElement('span');
    name.className = 'cat-label';
    name.textContent = m.label;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = this.design.palette[m.key] || m.def;
    const apply = () => {
      this.design.palette[m.key] = input.value.toLowerCase();
      this.redraw();
    };
    input.oninput = () => {
      // Mientras se arrastra el selector se ve el resultado, pero sin guardar en
      // cada movimiento del ratón.
      clearTimeout(this.colorTimer);
      apply();
      this.colorTimer = setTimeout(() => { this.persist(); this.schedulePreview(); }, 120);
    };
    input.onchange = () => { apply(); this.persist(); this.schedulePreview(); };
    row.append(name, input);
    return row;
  }
}

// --- Ayudas -----------------------------------------------------------------

function pointInTri(px, py, [a, b, c]) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d;
  const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d;
  return u >= 0 && v >= 0 && u + v <= 1;
}

const snapTo = (v, step) => (step ? Math.round(v / step) * step : v);

function clampField(key, v) {
  const f = FIELDS[key];
  if (!f) return v;
  return Math.min(f.max, Math.max(f.min, Math.round(v * 1000) / 1000));
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

function group(title, rows) {
  const sec = document.createElement('section');
  sec.className = 'cat-group';
  if (title) {
    const h = document.createElement('h4');
    h.textContent = title;
    sec.appendChild(h);
  }
  const grid = document.createElement('div');
  grid.className = 'cat-grid';
  for (const r of rows) grid.appendChild(r);
  sec.appendChild(grid);
  return sec;
}

function textRow(label, value, max, onChange) {
  const row = document.createElement('label');
  row.className = 'cat-field wide';
  const name = document.createElement('span');
  name.className = 'cat-label';
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = max;
  input.value = value;
  input.onchange = () => onChange(input.value);
  input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
  row.append(name, input);
  return row;
}

function selectRow(label, value, options, onChange) {
  const row = document.createElement('label');
  row.className = 'cat-field';
  const name = document.createElement('span');
  name.className = 'cat-label';
  name.textContent = label;
  const sel = document.createElement('select');
  for (const [v, text] of options) sel.add(new Option(text, v));
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  row.append(name, sel);
  return row;
}

function checkRow(label, checked, onChange) {
  const row = document.createElement('label');
  row.className = 'cat-field';
  const name = document.createElement('span');
  name.className = 'cat-label';
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.onchange = () => onChange(input.checked);
  row.append(name, input);
  return row;
}

/** Valores de partida al cambiar de función, sin pisar los que ya tuviera. */
function pickRoleDefaults(role, d) {
  if (role === 'house') return { pop: d.pop ?? 5 };
  if (role === 'store') return { dropoff: d.dropoff?.length ? d.dropoff : ['food'] };
  if (role === 'train') return { trains: d.trains?.length ? d.trains : ['militia'] };
  if (role === 'defense') {
    return {
      attack: d.attack ?? 6, range: d.range ?? 7, rof: d.rof ?? 2, arrows: d.arrows ?? 1,
    };
  }
  return {};
}
