// Catálogo del juego: ver y editar unidades, edificios, recursos y terrenos.

import {
  UNITS, BUILDINGS, RESOURCE_NODES, GATHER_RATE, AGES, RES_NAME, RESOURCES, TILE_W, TILE_H,
} from './config.js';
import {
  unitSprite, buildingSprite, resourceSprite, makeCanvas, drawTerrainTile, TERRAIN_COLORS,
  drawSprite,
} from './sprites.js';
import {
  fieldsFor, getPath, setValue, reset, isChanged, defaultValue, countChanges,
  TERRAIN_LABELS, NODE_LABELS, RATE_LABELS,
} from './data/overrides.js';
import { LOOK } from './data/appearance.js';

const el = (id) => document.getElementById(id);

const CLASS_NAMES = {
  civilian: 'Civil', infantry: 'Infantería', archer: 'A distancia',
  cavalry: 'Caballería', siege: 'Asedio',
};

export class Catalog {
  constructor() {
    this.tab = 'unit';
    this.selected = null;
    this.filter = '';
    this.bind();
  }

  bind() {
    el('btn-catalog').onclick = () => this.open();
    el('btn-catalog-close').onclick = () => this.close();
    el('catalog-search').addEventListener('input', (e) => {
      this.filter = e.target.value.toLowerCase();
      this.renderList();
    });
    for (const btn of document.querySelectorAll('#catalog-tabs button')) {
      btn.onclick = () => {
        this.tab = btn.dataset.tab;
        this.selected = null;
        for (const b of document.querySelectorAll('#catalog-tabs button')) {
          b.classList.toggle('active', b === btn);
        }
        this.renderList();
      };
    }
    // Confirmación en dos pasos sobre el propio botón: restablecer todo borra
    // trabajo, pero un diálogo del navegador queda fuera de lugar en el juego.
    const resetAll = el('btn-catalog-reset-all');
    resetAll.onclick = () => {
      if (!countChanges()) return;
      if (!this.confirmingReset) {
        this.confirmingReset = true;
        resetAll.textContent = '¿Seguro? Pulsa otra vez';
        resetAll.classList.add('confirming');
        clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(() => this.cancelResetConfirm(), 5000);
        return;
      }
      this.cancelResetConfirm();
      reset();
      this.renderList();
      this.updateChangeCount();
    };
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el('catalog').classList.contains('hidden')) this.close();
    });
  }

  cancelResetConfirm() {
    clearTimeout(this.confirmTimer);
    this.confirmingReset = false;
    const btn = el('btn-catalog-reset-all');
    btn.textContent = 'Restablecer todo';
    btn.classList.remove('confirming');
  }

  open() {
    this.cancelResetConfirm();
    el('main-menu').classList.add('hidden');
    el('catalog').classList.remove('hidden');
    this.renderList();
    this.updateChangeCount();
  }

  close() {
    el('catalog').classList.add('hidden');
    el('main-menu').classList.remove('hidden');
  }

  updateChangeCount() {
    if (this.confirmingReset && !countChanges()) this.cancelResetConfirm();
    const n = countChanges();
    const box = el('catalog-changes');
    box.textContent = n
      ? `${n} valor${n > 1 ? 'es' : ''} modificado${n > 1 ? 's' : ''} · se aplican a las partidas nuevas`
      : 'Todo con los valores originales';
    box.classList.toggle('dirty', n > 0);
    el('btn-catalog-reset-all').disabled = n === 0;
  }

  // --- Listado ---------------------------------------------------------------

  entries() {
    if (this.tab === 'unit') {
      return Object.entries(UNITS).map(([key, def]) => ({
        key, def, name: def.name, sub: `${CLASS_NAMES[def.class] || def.class} · ${AGES[def.age].short}`,
      }));
    }
    if (this.tab === 'building') {
      return Object.entries(BUILDINGS).map(([key, def]) => ({
        key, def, name: def.name, sub: `${AGES[def.age].short} · ${def.size}x${def.size}`,
      }));
    }
    if (this.tab === 'node') {
      return Object.entries(RESOURCE_NODES).map(([key, def]) => ({
        key, def, name: NODE_LABELS[key] || key, sub: `${RES_NAME[def.res]} · ${def.amount}`,
      }));
    }
    return Object.entries(TERRAIN_COLORS).map(([key, color]) => ({
      key, def: { color }, name: TERRAIN_LABELS[key] || key,
      sub: key === 'water' || key === 'shallow' ? 'Intransitable' : 'Transitable',
    }));
  }

  renderList() {
    const list = el('catalog-list');
    list.innerHTML = '';
    const items = this.entries().filter((e) => !this.filter || e.name.toLowerCase().includes(this.filter));
    if (!items.length) {
      list.innerHTML = '<li class="cat-empty">No hay nada que coincida.</li>';
      this.selected = null;
      this.renderDetail();
      return;
    }
    if (!this.selected || !items.some((e) => e.key === this.selected)) this.selected = items[0].key;
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'cat-item' + (item.key === this.selected ? ' active' : '');
      const thumb = this.preview(item.key, 44);
      thumb.className = 'cat-thumb';
      const text = document.createElement('div');
      text.className = 'cat-text';
      const n = document.createElement('div');
      n.className = 'cat-name';
      n.textContent = item.name;
      const s = document.createElement('div');
      s.className = 'cat-sub';
      s.textContent = item.sub;
      text.append(n, s);
      li.append(thumb, text);
      if (this.hasChanges(item.key)) {
        const dot = document.createElement('span');
        dot.className = 'cat-dot';
        dot.title = 'Tiene valores modificados';
        li.appendChild(dot);
      }
      li.onclick = () => { this.selected = item.key; this.renderList(); };
      list.appendChild(li);
    }
    this.renderDetail();
  }

  hasChanges(key) {
    if (this.tab === 'terrain') return isChanged('terrain', key);
    if (this.lookChanged(key)) return true;
    if (this.tab === 'node') {
      if (isChanged('node', key, 'amount')) return true;
      const rate = RESOURCE_NODES[key]?.rate;
      return rate ? isChanged('rate', rate) : false;
    }
    const def = this.tab === 'unit' ? UNITS[key] : BUILDINGS[key];
    return def ? fieldsFor(this.tab, def).some((f) => isChanged(this.tab, key, f.key)) : false;
  }

  /** ¿Tiene el objeto algún color o tamaño cambiado? */
  lookChanged(key) {
    const def = LOOK[this.tab]?.[key];
    if (!def) return false;
    const kind = `${this.tab}Look`;
    return fieldsFor(kind, def).some((f) => isChanged(kind, key, f.key));
  }

  // --- Vistas previas --------------------------------------------------------

  /**
   * `real` dibuja a escala fija, de modo que una unidad a la que se le ha
   * subido el tamaño se ve más grande. Las miniaturas de la lista, en cambio,
   * encajan siempre en su hueco: allí interesa reconocer el objeto, no
   * compararlo.
   */
  preview(key, size, real = false) {
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    // Deja sitio para el tamaño máximo que se puede elegir en el catálogo.
    const MAX = 1.6;
    if (this.tab === 'unit') {
      const s = unitSprite(key, 0, 1, 0, false);
      const sc = real ? size / (60 * MAX) : Math.min(size / (s.w - 4), size / (s.h - 4)) * 1.05;
      drawSprite(ctx, s, size / 2, size - 6, sc);
    } else if (this.tab === 'building') {
      const s = buildingSprite(key, 0, 2);
      const sc = Math.min((size - 4) / s.w, (size - 4) / s.h);
      // Encuadrado por la caja del sprite, no por su anclaje.
      drawSprite(ctx, s, size / 2 - (s.w / 2 - s.ox) * sc, size - 2 - (s.h - s.oy) * sc, sc);
    } else if (this.tab === 'node') {
      const s = resourceSprite(key, 0);
      const sc = real ? size / (96 * MAX) : Math.min(size / s.w, size / s.h) * 1.15;
      drawSprite(ctx, s, size / 2, size - 8, sc);
    } else {
      // Terreno: un rombo con la misma textura que usa el mapa.
      ctx.save();
      ctx.translate(size / 2, (size - TILE_H * (size / 64)) / 2);
      ctx.scale(size / 64, size / 64);
      drawTerrainTile(ctx, 0, 0, key, 0.5);
      ctx.restore();
    }
    return c;
  }

  // --- Ficha -----------------------------------------------------------------

  renderDetail() {
    const box = el('catalog-detail');
    box.innerHTML = '';
    const key = this.selected;
    if (!key) { box.innerHTML = '<p class="cat-empty">Elige un elemento de la lista.</p>'; return; }

    const head = document.createElement('div');
    head.className = 'cat-head';
    const big = this.preview(key, 120, true);
    big.className = 'cat-big';
    const info = document.createElement('div');
    const title = document.createElement('h3');
    const sub = document.createElement('p');
    sub.className = 'cat-detail-sub';
    info.append(title, sub);
    head.append(big, info);
    box.appendChild(head);

    if (this.tab === 'terrain') {
      title.textContent = TERRAIN_LABELS[key] || key;
      sub.textContent = 'Color con el que se pinta este terreno en el mapa y en el minimapa.';
      box.appendChild(this.terrainForm(key));
    } else if (this.tab === 'node') {
      const def = RESOURCE_NODES[key];
      title.textContent = NODE_LABELS[key] || key;
      sub.textContent = `Da ${RES_NAME[def.res]}. ${def.blocking ? 'Bloquea el paso.' : 'No bloquea el paso.'}`;
      box.appendChild(this.lookForm(key));
      box.appendChild(this.nodeForm(key, def));
    } else {
      const def = this.tab === 'unit' ? UNITS[key] : BUILDINGS[key];
      title.textContent = def.name;
      sub.textContent = this.tab === 'unit'
        ? `${CLASS_NAMES[def.class] || def.class} · disponible en la ${AGES[def.age].name}`
        : `Disponible en la ${AGES[def.age].name}`;
      box.appendChild(this.extraInfo(def));
      box.appendChild(this.lookForm(key));
      box.appendChild(this.form(this.tab, key, def));
    }

    const actions = document.createElement('div');
    actions.className = 'cat-actions';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'secondary';
    resetBtn.textContent = 'Restablecer este elemento';
    resetBtn.disabled = !this.hasChanges(key);
    resetBtn.onclick = () => {
      if (this.tab === 'node') {
        reset('node', key);
        const rate = RESOURCE_NODES[key]?.rate;
        if (rate) reset('rate', rate);
      } else {
        reset(this.tab, key);
      }
      if (LOOK[this.tab]?.[key]) reset(`${this.tab}Look`, key);
      this.renderList();
      this.updateChangeCount();
    };
    actions.appendChild(resetBtn);
    box.appendChild(actions);
  }

  /** Datos que no se editan pero conviene ver (bonus, qué entrena, etc.). */
  extraInfo(def) {
    const wrap = document.createElement('div');
    wrap.className = 'cat-extra';
    const add = (label, value) => {
      if (!value) return;
      const row = document.createElement('div');
      row.innerHTML = `<b></b> <span></span>`;
      row.querySelector('b').textContent = `${label}:`;
      row.querySelector('span').textContent = value;
      wrap.appendChild(row);
    };
    if (def.bonus) {
      add('Daño extra', Object.entries(def.bonus)
        .map(([k, v]) => `+${v} contra ${CLASS_NAMES[k] || (k === 'building' ? 'edificios' : k)}`).join(', '));
    }
    if (def.trains) add('Entrena', def.trains.map((t) => UNITS[t].name).join(', '));
    if (def.dropoff) add('Almacena', def.dropoff.map((r) => RES_NAME[r]).join(', '));
    if (def.req) add('Necesita', BUILDINGS[def.req].name);
    if (def.pierce) add('Tipo de daño', 'Proyectil');
    return wrap;
  }

  /**
   * Sección "Aspecto": los colores con los que se dibuja el objeto y, cuando
   * tiene sentido, su tamaño. Sólo salen los campos que ese objeto usa de
   * verdad, así no se pregunta por la montura de un lancero.
   */
  lookForm(key) {
    const def = LOOK[this.tab]?.[key];
    if (!def) return document.createDocumentFragment();
    const kind = `${this.tab}Look`;
    const fields = fieldsFor(kind, def);
    if (!fields.length) return document.createDocumentFragment();
    return this.group('Aspecto', fields.map((f) => this.field(kind, key, def, f)));
  }

  /**
   * Vuelve a dibujar sólo las miniaturas del elemento activo. Se usa mientras
   * se arrastra el selector de color: rehacer la lista entera en cada
   * movimiento del ratón se notaría.
   */
  refreshPreview() {
    const big = el('catalog-detail').querySelector('.cat-big');
    if (big) {
      const fresh = this.preview(this.selected, 120, true);
      fresh.className = 'cat-big';
      big.replaceWith(fresh);
    }
    const thumb = el('catalog-list').querySelector('.cat-item.active .cat-thumb');
    if (thumb) {
      const fresh = this.preview(this.selected, 44);
      fresh.className = 'cat-thumb';
      thumb.replaceWith(fresh);
    }
  }

  form(kind, key, def) {
    const wrap = document.createElement('div');
    const fields = fieldsFor(kind, def);
    const groups = new Map();
    for (const f of fields) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(f);
    }
    for (const [group, list] of groups) {
      wrap.appendChild(this.group(group, list.map((f) => this.field(kind, key, def, f))));
    }
    return wrap;
  }

  group(title, rows) {
    const sec = document.createElement('section');
    sec.className = 'cat-group';
    const h = document.createElement('h4');
    h.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'cat-grid';
    for (const r of rows) grid.appendChild(r);
    sec.append(h, grid);
    return sec;
  }

  field(kind, key, def, f) {
    const row = document.createElement('label');
    row.className = 'cat-field' + (f.wide ? ' wide' : '');
    const name = document.createElement('span');
    name.className = 'cat-label';
    name.textContent = f.unit ? `${f.label} (${f.unit})` : f.label;
    const input = document.createElement('input');
    input.type = f.type === 'text' ? 'text' : f.type === 'color' ? 'color' : 'number';
    if (input.type === 'number') { input.min = f.min; input.max = f.max; input.step = f.step; }
    input.value = getPath(def, f.key);
    const mark = () => {
      const changed = isChanged(kind, key, f.key);
      row.classList.toggle('changed', changed);
      name.title = changed ? `Original: ${defaultValue(kind, key, f.key)}` : '';
    };
    mark();
    const commit = () => {
      const saved = setValue(kind, key, f.key, input.value);
      if (saved === null) input.value = getPath(def, f.key);
      else input.value = saved;
      mark();
      this.renderList();
      this.updateChangeCount();
    };
    input.onchange = commit;
    if (f.type === 'color') {
      // Con el selector abierto se va viendo el resultado sin esperar a cerrarlo.
      input.oninput = () => {
        clearTimeout(this.liveTimer);
        this.liveTimer = setTimeout(() => {
          if (setValue(kind, key, f.key, input.value) !== null) this.refreshPreview();
        }, 60);
      };
    }
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
    row.append(name, input);
    return row;
  }

  nodeForm(key, def) {
    const wrap = document.createElement('div');
    wrap.appendChild(this.group('Yacimiento', [this.field('node', key, def, {
      key: 'amount', label: 'Cantidad', type: 'number', min: 1, max: 20000, step: 10,
    })]));
    const rate = def.rate;
    if (rate && GATHER_RATE[rate] !== undefined) {
      const row = document.createElement('label');
      row.className = 'cat-field';
      const name = document.createElement('span');
      name.className = 'cat-label';
      name.textContent = `${RATE_LABELS[rate] || rate} (por segundo)`;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = 0.05; input.max = 20; input.step = 0.01;
      input.value = GATHER_RATE[rate];
      const mark = () => {
        const changed = isChanged('rate', rate);
        row.classList.toggle('changed', changed);
        name.title = changed ? `Original: ${defaultValue('rate', rate)}` : '';
      };
      mark();
      input.onchange = () => {
        const saved = setValue('rate', rate, null, input.value);
        input.value = saved === null ? GATHER_RATE[rate] : saved;
        mark();
        this.renderList();
        this.updateChangeCount();
      };
      row.append(name, input);
      wrap.appendChild(this.group('Recolección', [row]));
    }
    return wrap;
  }

  terrainForm(key) {
    const row = document.createElement('label');
    row.className = 'cat-field';
    const name = document.createElement('span');
    name.className = 'cat-label';
    name.textContent = 'Color';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = TERRAIN_COLORS[key];
    const mark = () => {
      const changed = isChanged('terrain', key);
      row.classList.toggle('changed', changed);
      name.title = changed ? `Original: ${defaultValue('terrain', key)}` : '';
    };
    mark();
    input.onchange = () => {
      setValue('terrain', key, null, input.value);
      mark();
      this.renderList();
      this.updateChangeCount();
    };
    row.append(name, input);
    return this.group('Aspecto', [row]);
  }
}
