// Catálogo del juego: ver y editar unidades, edificios, recursos y terrenos.

import {
  UNITS, BUILDINGS, RESOURCE_NODES, GATHER_RATE, AGES, RES_NAME, RESOURCES, TILE_W, TILE_H,
} from './config.js';
import {
  unitSprite, buildingSprite, resourceSprite, makeCanvas, drawTerrainTile, TERRAIN_COLORS,
  drawSprite, prepareSprites, unitAnim,
} from './sprites.js';
import {
  fieldsFor, getPath, setValue, reset, isChanged, defaultValue, countChanges,
  TERRAIN_LABELS, NODE_LABELS, RATE_LABELS, READ_ONLY_KINDS,
} from './data/overrides.js';

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
    el('btn-catalog-back').onclick = () => this.showList();
    el('catalog-search').addEventListener('input', (e) => {
      this.filter = e.target.value.toLowerCase();
      this.renderList();
    });
    for (const btn of document.querySelectorAll('#catalog-tabs button')) {
      btn.onclick = () => {
        this.tab = btn.dataset.tab;
        this.selected = null;
        this.showList();
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
      if (e.key !== 'Escape' || el('catalog').classList.contains('hidden')) return;
      // Dentro de una ficha del teléfono, Escape vuelve a la lista, como la flecha.
      if (el('catalog-card').dataset.vista === 'ficha' && el('btn-catalog-back').offsetParent) this.showList();
      else this.close();
    });
  }

  cancelResetConfirm() {
    clearTimeout(this.confirmTimer);
    this.confirmingReset = false;
    const btn = el('btn-catalog-reset-all');
    btn.textContent = 'Restablecer todo';
    btn.classList.remove('confirming');
  }

  async open() {
    this.cancelResetConfirm();
    el('main-menu').classList.add('hidden');
    el('catalog').classList.remove('hidden');
    this.showList();
    // Las miniaturas salen de las hojas del primer color y de los recursos.
    try { await prepareSprites([0]); } catch (err) { console.error(err); }
    this.renderList();
    this.updateChangeCount();
  }

  /*
   * En el teléfono la lista y la ficha no caben juntas: se ve una u otra, como
   * en una navegación de iOS. En pantalla ancha la hoja las enseña a la vez y
   * `data-vista` no cambia nada.
   */
  showList() {
    el('catalog-card').dataset.vista = 'lista';
  }

  showDetail() {
    el('catalog-card').dataset.vista = 'ficha';
    el('catalog').scrollTop = 0;
  }

  close() {
    this.stopAnim();
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
      li.onclick = () => { this.selected = item.key; this.renderList(); this.showDetail(); };
      list.appendChild(li);
    }
    this.renderDetail();
  }

  hasChanges(key) {
    if (this.tab === 'terrain') return isChanged('terrain', key);
    if (this.tab === 'node') {
      const def = RESOURCE_NODES[key];
      if (fieldsFor('node', def).some((f) => isChanged('node', key, f.key))) return true;
      const rate = def?.rate;
      return rate ? isChanged('rate', rate) : false;
    }
    const def = this.tab === 'unit' ? UNITS[key] : BUILDINGS[key];
    return def ? fieldsFor(this.tab, def).some((f) => isChanged(this.tab, key, f.key)) : false;
  }

  // --- Vistas previas --------------------------------------------------------

  /**
   * `real` dibuja a escala fija, de modo que se comparan los tamaños de verdad.
   * Las miniaturas de la lista, en cambio, encajan siempre en su hueco: allí
   * interesa reconocer el objeto, no compararlo.
   */
  preview(key, size, real = false) {
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const MAX = 1.2; // un poco de margen alrededor
    if (this.tab === 'unit') {
      const s = unitSprite(key, 0, 1, unitAnim(key).quieto);
      if (!s) return c;
      // A escala común para comparar tamaños, salvo que no quepa (el caballero).
      const fit = Math.min(size / (s.w - 4), size / (s.h - 4)) * 1.05;
      const sc = real ? Math.min(size / (60 * MAX), (size - 8) / s.h) : fit;
      // Por los pies, dejando sitio a lo que asoma por debajo (patas, sombra).
      drawSprite(ctx, s, size / 2, size - 4 - (s.h - s.oy) * sc, sc);
    } else if (this.tab === 'building') {
      const s = buildingSprite(key, 0, 2);
      if (!s) return c;
      const sc = Math.min((size - 4) / s.w, (size - 4) / s.h);
      // Encuadrado por la caja del sprite, no por su anclaje.
      drawSprite(ctx, s, size / 2 - (s.w / 2 - s.ox) * sc, size - 2 - (s.h - s.oy) * sc, sc);
    } else if (this.tab === 'node') {
      const s = resourceSprite(key, 0);
      if (!s) return c;
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
    this.stopAnim();
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
      sub.textContent = 'Color con el que se pinta este terreno en el mapa.';
      box.appendChild(this.terrainForm(key));
    } else if (this.tab === 'node') {
      const def = RESOURCE_NODES[key];
      title.textContent = NODE_LABELS[key] || key;
      sub.textContent = `Da ${RES_NAME[def.res]}. ${def.blocking ? 'Bloquea el paso.' : 'No bloquea el paso.'}`;
      box.appendChild(this.nodeForm(key, def));
    } else {
      const def = this.tab === 'unit' ? UNITS[key] : BUILDINGS[key];
      title.textContent = def.name;
      sub.textContent = this.tab === 'unit'
        ? `${CLASS_NAMES[def.class] || def.class} · disponible en la ${AGES[def.age].name}`
        : `Disponible en la ${AGES[def.age].name}`;
      box.appendChild(this.extraInfo(def));
      if (this.tab === 'unit') box.appendChild(this.animations(key, def));
      box.appendChild(this.form(this.tab, key, def));
    }
    // Las cifras de las unidades sólo se miran: no hay nada que restablecer.
    if (READ_ONLY_KINDS.has(this.tab)) return;

    const actions = document.createElement('div');
    actions.className = 'cat-actions';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'hoja-boton tenue';
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
      this.renderList();
      this.updateChangeCount();
    };
    actions.appendChild(resetBtn);
    box.appendChild(actions);
  }

  // --- Animaciones -----------------------------------------------------------

  /**
   * Todas las animaciones de una unidad, en marcha: se elige cuál (moverse,
   * quieta o golpe) y se ve a la vez en las ocho direcciones, puestas como en
   * una rosa de los vientos, con sus fotogramas sueltos debajo. Se mueven al
   * ritmo de la partida: al andar, siete fotogramas por casilla recorrida.
   */
  animations(key, def) {
    const an = unitAnim(key);
    const modos = [
      { label: def.class === 'siege' || def.class === 'cavalry' ? 'Moverse' : 'Andar',
        frames: an.andar, fps: def.speed * 7 },
      { label: 'Quieta', frames: [an.quieto], fps: 1 },
      { label: key === 'villager' ? 'Trabajar' : 'Atacar', frames: an.golpe, fps: 4 },
    ];
    let modo = modos[0];

    const card = document.createElement('div');
    card.className = 'cat-anim';
    const seg = document.createElement('div');
    seg.className = 'hoja-segmentos cat-anim-modos';
    card.appendChild(seg);

    // Rosa de las ocho orientaciones: 0 mira abajo a la derecha y van en el
    // sentido de las agujas del reloj (ver `unitSprite`).
    const ROSA = [[4, '↖'], [5, '↑'], [6, '↗'], [3, '←'], null, [7, '→'], [2, '↙'], [1, '↓'], [0, '↘']];
    const rosa = document.createElement('div');
    rosa.className = 'cat-anim-rosa';
    const celdas = [];
    for (const r of ROSA) {
      const cell = document.createElement('div');
      cell.className = 'cat-anim-celda';
      if (r) {
        const c = document.createElement('canvas');
        const tag = document.createElement('span');
        tag.textContent = r[1];
        cell.append(c, tag);
        celdas.push({ face: r[0], canvas: c });
      } else {
        cell.classList.add('centro');
      }
      rosa.appendChild(cell);
    }
    const centro = rosa.querySelector('.centro');
    card.appendChild(rosa);

    // Velocidad, para estudiar la animación a cámara lenta. Se recuerda al
    // pasar de una unidad a otra, pero no se guarda: la partida no la usa.
    if (!this.animSpeed) this.animSpeed = 1;
    const vel = document.createElement('label');
    vel.className = 'cat-anim-vel';
    const velTxt = document.createElement('span');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.05'; slider.max = '1'; slider.step = '0.05';
    slider.value = String(this.animSpeed);
    slider.setAttribute('aria-label', 'Velocidad de la animación');
    const velFps = document.createElement('span');
    velFps.className = 'cat-anim-fps';
    const pintaVel = () => {
      velTxt.textContent = `Velocidad ${Math.round(this.animSpeed * 100)} %`;
      const fps = modo.fps * this.animSpeed;
      velFps.textContent = modo.frames.length > 1 ? `${fps < 1 ? fps.toFixed(1) : Math.round(fps * 10) / 10} fotogramas/s` : '';
    };
    slider.oninput = () => { this.animSpeed = Number(slider.value); pintaVel(); };
    vel.append(velTxt, slider, velFps);
    card.appendChild(vel);

    const h = document.createElement('p');
    h.className = 'cat-anim-nota';
    card.appendChild(h);
    const tira = document.createElement('div');
    tira.className = 'cat-anim-tira';
    card.appendChild(tira);

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const sprite = (face, f) => unitSprite(key, 0, face, f);
    /** Medidas que caben todas las poses, desde los pies, en píxeles de mundo. */
    const medidas = () => {
      let lado = 1, arriba = 1, abajo = 1;
      for (const m of modos) {
        for (const f of m.frames) {
          for (const face of [0, 1, 5, 6, 7]) {
            const s = sprite(face, f);
            if (!s) continue;
            lado = Math.max(lado, s.ox, s.w - s.ox);
            arriba = Math.max(arriba, s.oy);
            abajo = Math.max(abajo, s.h - s.oy);
          }
        }
      }
      return { lado, arriba, abajo };
    };
    const M = medidas();
    /** Prepara un lienzo de w×h CSS y la escala entera que le toca. */
    const prepara = (c, w, hh) => {
      c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
      c.style.width = `${w}px`; c.style.height = `${hh}px`;
      const fit = Math.min(w / (2 * M.lado), hh / (M.arriba + M.abajo));
      // Un píxel del sprite (medio de mundo) en un número entero de píxeles de
      // pantalla, para que se vea nítido.
      const k = Math.max(1, Math.floor(fit * dpr / 2));
      const esc = (k * 2) / dpr;
      c._esc = esc;
      c._x = w / 2;
      c._y = M.arriba * esc + (hh - (M.arriba + M.abajo) * esc) / 2;
    };
    const pinta = (c, face, f) => {
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      drawSprite(ctx, sprite(face, f), c._x, c._y, c._esc);
    };
    for (const { canvas } of celdas) prepara(canvas, 96, 104);

    let tiraCanvas = [];
    const eligeModo = (m) => {
      modo = m;
      for (const b of seg.children) b.classList.toggle('active', b._modo === m);
      centro.textContent = m.label;
      const distintos = new Set(m.frames).size;
      h.textContent = m.frames.length > 1 && distintos === 1
        ? `Sin dibujos propios: se queda en la postura del fotograma ${m.frames[0]}`
        : m.frames.length > 1
          ? `Fotogramas, mirando abajo a la derecha (${m.frames.length})`
          : 'Fotograma, mirando abajo a la derecha';
      tira.innerHTML = '';
      tiraCanvas = (distintos === 1 ? [m.frames[0]] : m.frames).map((f) => {
        const box = document.createElement('div');
        box.className = 'cat-anim-foto';
        const c = document.createElement('canvas');
        prepara(c, 56, 64);
        pinta(c, 0, f);
        const n = document.createElement('span');
        n.textContent = f;
        box.append(c, n);
        tira.appendChild(box);
        return box;
      });
      last = -1;
      fase = 0;
      pintaVel();
    };
    for (const m of modos) {
      const b = document.createElement('button');
      b.textContent = m.label;
      b._modo = m;
      b.onclick = () => eligeModo(m);
      seg.appendChild(b);
    }

    let last = -1;
    // La fase avanza con el tiempo por la velocidad elegida: así, al mover el
    // deslizador, la animación sigue desde donde estaba en vez de saltar.
    let fase = 0, antes = performance.now();
    const tick = (now) => {
      this.animRaf = requestAnimationFrame(tick);
      fase += ((now - antes) / 1000) * modo.fps * this.animSpeed;
      antes = now;
      const i = Math.floor(fase) % modo.frames.length;
      if (i === last) return;
      last = i;
      for (const { face, canvas } of celdas) pinta(canvas, face, modo.frames[i]);
      tiraCanvas.forEach((b, j) => b.classList.toggle('actual', tiraCanvas.length === 1 || j === i));
    };
    eligeModo(modo);
    this.animRaf = requestAnimationFrame(tick);

    return this.group('Animaciones', [card]);
  }

  stopAnim() {
    cancelAnimationFrame(this.animRaf);
    this.animRaf = 0;
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
    if (READ_ONLY_KINDS.has(kind)) {
      // Sólo se enseña: rótulo y valor, sin campo que editar.
      const row = document.createElement('div');
      row.className = 'cat-field fijo' + (f.wide ? ' wide' : '');
      const name = document.createElement('span');
      name.className = 'cat-label';
      name.textContent = f.label;
      const value = document.createElement('span');
      value.className = 'cat-valor';
      const v = getPath(def, f.key);
      value.textContent = f.unit && f.type === 'number' ? `${v} ${f.unit}` : v;
      row.append(name, value);
      return row;
    }
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
    // Los animales de rebaño (las ovejas) además se domestican y andan.
    if (def.herd) {
      wrap.appendChild(this.group('Rebaño', [
        this.field('node', key, def, {
          key: 'tame', label: 'Radio para domesticar', type: 'number', min: 1, max: 20, step: 0.5,
        }),
        this.field('node', key, def, {
          key: 'speed', label: 'Velocidad', type: 'number', min: 0.1, max: 5, step: 0.05,
        }),
      ]));
    }
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
