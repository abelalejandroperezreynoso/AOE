// Catálogo del juego: ver y editar unidades, edificios, recursos y terrenos.

import {
  UNITS, BUILDINGS, RESOURCE_NODES, GATHER_RATE, AGES, RES_NAME, RESOURCES, TILE_W, TILE_H,
} from './config.js';
import {
  unitSprite, buildingSprite, resourceSprite, makeCanvas, drawTerrainTile, TERRAIN_COLORS,
  drawSprite, prepareSprites, unitAnim, terrainHasBitmap, terrainSprite,
} from './sprites.js';
import {
  fieldsFor, getPath, setValue, reset, isChanged, defaultValue, countChanges,
  TERRAIN_LABELS, NODE_LABELS, RATE_LABELS, READ_ONLY_KINDS,
} from './data/overrides.js';

import { marcaDeslizador } from './utils.js';

const el = (id) => document.getElementById(id);

/*
 * Caja de lo sólido de un sprite, en píxeles de mundo desde su ancla: los
 * píxeles casi opacos, sin la sombra translúcida. El ancla de un sprite son
 * los pies (o la esquina de la huella), que es lo que necesita el mapa, pero
 * el dibujo no está centrado en ella: la sombra se va a un lado, la zancada
 * adelanta una pierna, el caballo y el ariete son largos. Las vistas del
 * catálogo se centran por esta caja.
 */
const cajas = new WeakMap();
function cajaSolida(s) {
  let k = cajas.get(s);
  if (k) return k;
  const c = s.canvas, W = c.width, H = c.height, f = W / s.w;
  const d = c.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 200) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
  k = { x0: x0 / f - s.ox, x1: (x1 + 1) / f - s.ox, y0: y0 / f - s.oy, y1: (y1 + 1) / f - s.oy };
  cajas.set(s, k);
  return k;
}
const unir = (a, b) => (a ? {
  x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1),
} : b);
/*
 * Lienzo estándar de las unidades a pie: 100×100 píxeles de sprite, con los
 * pies (el ancla) centrados a lo ancho y a 88 del borde de arriba. Cabe de
 * sobra el aldeano (unos 48×86) con su sombra.
 */
const MARCO_A_PIE = { l: 50, t: 88, r: 50, b: 12, estandar: true };

// Las flechas de dirección, en palabras para el nombre del archivo.
const NOMBRE_ARCHIVO = { '↘': 'sureste', '↓': 'sur', '↙': 'suroeste', '←': 'oeste', '↖': 'noroeste', '↑': 'norte', '↗': 'noreste', '→': 'este' };

/**
 * Descarga un lienzo como PNG con fondo gris claro. En el teléfono, donde un
 * enlace de descarga abre la imagen suelta, usa el menú de compartir de iOS
 * (desde él se guarda en Fotos o en Archivos).
 */
function descargarPNG(canvas, archivo) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f2f7';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  c.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], archivo, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ files: [file], title: archivo }); return; } catch (err) {
        if (err && err.name === 'AbortError') return; // lo canceló el jugador
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = archivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

/** Pinta un sprite con el centro de `caja` en (cx, cy). */
function centrado(ctx, s, caja, cx, cy, sc) {
  drawSprite(ctx, s, cx - ((caja.x0 + caja.x1) / 2) * sc, cy - ((caja.y0 + caja.y1) / 2) * sc, sc);
}

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
    if (this.tab !== 'terrain') {
      const s = this.tab === 'unit' ? unitSprite(key, 0, 0, unitAnim(key).quieto)
        : this.tab === 'building' ? buildingSprite(key, 0, 2) : resourceSprite(key, 0);
      if (!s) return c;
      // Centrado por lo que se ve, no por el ancla (ver `cajaSolida`).
      const k = cajaSolida(s);
      const fit = Math.min((size - 8) / (k.x1 - k.x0), (size - 8) / (k.y1 - k.y0));
      // La grande de las unidades y los recursos va a escala común, para
      // comparar tamaños, salvo que no quepa (el caballero).
      const comun = this.tab === 'unit' ? size / (60 * MAX) : this.tab === 'node' ? size / (96 * MAX) : fit;
      const sc = real ? Math.min(comun, fit) : fit;
      centrado(ctx, s, k, size / 2, size / 2, sc);
    } else {
      // Terreno: su variante 0, a píxel visto como el resto de vistas.
      const s = terrainSprite(key, 0);
      if (!s) return c;
      const sc = (size - 4) / s.w;
      ctx.imageSmoothingEnabled = false;
      drawSprite(ctx, s, size / 2 - (s.w / 2 - s.ox) * sc, size / 2 - (s.h / 2 - s.oy) * sc, sc);
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
      sub.textContent = terrainHasBitmap(key) ? 'Losetas dibujadas, ocho variantes.' : 'Pintado por código, ocho variantes.';
      box.appendChild(this.lupaTerreno(key));
      box.appendChild(this.terrainForm(key));
    } else if (this.tab === 'node') {
      const def = RESOURCE_NODES[key];
      title.textContent = NODE_LABELS[key] || key;
      sub.textContent = `Da ${RES_NAME[def.res]}. ${def.blocking ? 'Bloquea el paso.' : 'No bloquea el paso.'}`;
      box.appendChild(this.lupaFija(resourceSprite(key, 0), key));
      box.appendChild(this.nodeForm(key, def));
    } else {
      const def = this.tab === 'unit' ? UNITS[key] : BUILDINGS[key];
      title.textContent = def.name;
      sub.textContent = this.tab === 'unit'
        ? `${CLASS_NAMES[def.class] || def.class} · disponible en la ${AGES[def.age].name}`
        : `Disponible en la ${AGES[def.age].name}`;
      box.appendChild(this.extraInfo(def));
      if (this.tab === 'unit') box.appendChild(this.animations(key, def));
      else box.appendChild(this.lupaFija(buildingSprite(key, 0, 2), key));
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

  // --- Lupa -----------------------------------------------------------------

  /**
   * Recuadro con un sprite a aumento entero (cada píxel del sprite, un
   * cuadrado de píxeles de pantalla) y la cuadrícula de todos sus píxeles, del
   * tamaño de la imagen. Aparte, una tarjeta con sus datos.
   *
   * `pinta(s, marco, datos)` la rehace. `marco` es el rectángulo común a los
   * fotogramas que se van a enseñar, en píxeles del sprite desde su ancla
   * ({ l, t, r, b }): así el lienzo no cambia de tamaño entre fotogramas y la
   * figura no baila. `datos` son filas extra para la tarjeta ([rótulo, valor]).
   */
  crearLupa(nombre = 'sprite') {
    const card = document.createElement('div');
    card.className = 'cat-lupa';
    const c = document.createElement('canvas');
    card.appendChild(c);
    // Descargar lo que se ve: la imagen ampliada con su cuadrícula, sobre el
    // mismo gris claro de la lupa.
    const boton = document.createElement('button');
    boton.className = 'hoja-boton tenue cat-lupa-descarga';
    boton.textContent = 'Descargar PNG';
    let sufijo = '';
    boton.onclick = () => descargarPNG(c, `${nombre}${sufijo}.png`);
    const dpr = Math.min(3, window.devicePixelRatio || 1);

    const filas = new Map();
    const info = document.createElement('div');
    const fila = (rotulo, valor) => {
      let v = filas.get(rotulo);
      if (!v) {
        const row = document.createElement('div');
        row.className = 'cat-field fijo';
        const n = document.createElement('span');
        n.className = 'cat-label';
        n.textContent = rotulo;
        v = document.createElement('span');
        v.className = 'cat-valor';
        row.append(n, v);
        info.appendChild(row);
        filas.set(rotulo, v);
      }
      v.textContent = valor;
    };

    let actual = '';
    const pinta = (s, marco, datos = []) => {
      if (!s) return;
      const res = s.canvas.width / s.w;
      const ax = Math.round(s.ox * res), ay = Math.round(s.oy * res);
      const m = marco || { l: ax, t: ay, r: s.canvas.width - ax, b: s.canvas.height - ay };
      const W = m.l + m.r, H = m.t + m.b;
      // Aumento: el mayor entero que cabe a lo ancho, sin pasar de 360 de alto,
      // y nunca menos de 3, que por debajo la cuadrícula no deja ver nada. Si
      // así no cabe, la tarjeta se desplaza.
      const ancho = Math.min(360, window.innerWidth - 72);
      let k = Math.floor((ancho * dpr) / W);
      k = Math.min(k, Math.floor((360 * dpr) / H));
      k = Math.max(3, k);
      const clave = `${W}|${H}|${k}`;
      if (clave !== actual) {
        actual = clave;
        c.width = W * k; c.height = H * k;
        c.style.width = `${c.width / dpr}px`; c.style.height = `${c.height / dpr}px`;
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(s.canvas, (m.l - ax) * k, (m.t - ay) * k, s.canvas.width * k, s.canvas.height * k);
      // Cuadrícula completa: una línea por cada borde de píxel.
      ctx.fillStyle = 'rgba(0, 0, 0, .16)';
      for (let x = 0; x <= W; x++) ctx.fillRect(Math.min(x * k, c.width - 1), 0, 1, c.height);
      for (let y = 0; y <= H; y++) ctx.fillRect(0, Math.min(y * k, c.height - 1), c.width, 1);

      sufijo = datos.map(([, v]) => `-${String(v).replace(/[^\w]+/g, '') || NOMBRE_ARCHIVO[v] || ''}`).join('');
      fila('Tamaño', `${s.canvas.width} × ${s.canvas.height} píxeles`);
      fila('Lienzo', m.estandar ? `${W} × ${H} estándar` : `${W} × ${H} píxeles`);
      fila('Aumento', `× ${k}`);
      for (const [r, v] of datos) fila(r, v);
    };
    return { card, info, boton, pinta };
  }

  /** La sección de la lupa, con el botón de descarga aparte, bajo la tarjeta. */
  grupoLupa(lupa) {
    const sec = this.group('Lupa', [lupa.card]);
    sec.appendChild(lupa.boton);
    return sec;
  }

  /** Marco común de varios sprites, en píxeles del sprite desde su ancla. */
  static marcoDe(sprites) {
    let m = null;
    for (const s of sprites) {
      if (!s) continue;
      const res = s.canvas.width / s.w;
      const ax = Math.round(s.ox * res), ay = Math.round(s.oy * res);
      const q = { l: ax, t: ay, r: s.canvas.width - ax, b: s.canvas.height - ay };
      m = m ? { l: Math.max(m.l, q.l), t: Math.max(m.t, q.t), r: Math.max(m.r, q.r), b: Math.max(m.b, q.b) } : q;
    }
    return m;
  }

  lupaFija(s, nombre) {
    const lupa = this.crearLupa(nombre);
    lupa.pinta(s);
    const frag = document.createDocumentFragment();
    frag.append(this.grupoLupa(lupa), this.group('Imagen', [lupa.info]));
    return frag;
  }

  /**
   * Lupa de un terreno: una de sus ocho variantes, que se elige en la fila de
   * debajo, con la cuadrícula, los datos y la descarga como las demás.
   */
  lupaTerreno(key) {
    const lupa = this.crearLupa(key);
    const tira = document.createElement('div');
    tira.className = 'cat-anim-tira cat-variantes';
    const cajas = [];
    const elige = (v) => {
      lupa.pinta(terrainSprite(key, v), null, [['Variante', String(v + 1)]]);
      cajas.forEach((b, i) => b.classList.toggle('actual', i === v));
    };
    for (let v = 0; v < 8; v++) {
      const box = document.createElement('div');
      box.className = 'cat-anim-foto';
      const s = terrainSprite(key, v);
      const c = document.createElement('canvas');
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      c.width = 64 * dpr; c.height = 40 * dpr;
      c.style.width = '64px'; c.style.height = '40px';
      if (s) {
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        const sc = (60 * dpr) / s.w;
        ctx.drawImage(s.canvas, (c.width - s.w * sc) / 2, (c.height - s.h * sc) / 2, s.w * sc, s.h * sc);
      }
      const n = document.createElement('span');
      n.textContent = v + 1;
      box.append(c, n);
      box.onclick = () => elige(v);
      tira.appendChild(box);
      cajas.push(box);
    }
    elige(0);
    const frag = document.createDocumentFragment();
    frag.append(this.grupoLupa(lupa), this.group('Imagen', [lupa.info]), this.group('Variantes', [tira]));
    return frag;
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
    // sentido de las agujas del reloj (ver `unitSprite`). Cada una lleva su
    // flecha y la sigla del punto cardinal, con el norte arriba.
    const ROSA = [[4, '↖', 'NO'], [5, '↑', 'N'], [6, '↗', 'NE'], [3, '←', 'O'], null,
      [7, '→', 'E'], [2, '↙', 'SO'], [1, '↓', 'S'], [0, '↘', 'SE']];
    const rosa = document.createElement('div');
    rosa.className = 'cat-anim-rosa';
    const celdas = [];
    for (const r of ROSA) {
      const cell = document.createElement('div');
      cell.className = 'cat-anim-celda';
      if (r) {
        const c = document.createElement('canvas');
        const tag = document.createElement('span');
        tag.textContent = `${r[1]} ${r[2]}`;
        cell.append(c, tag);
        celdas.push({ face: r[0], canvas: c });
      } else {
        cell.classList.add('centro');
      }
      rosa.appendChild(cell);
    }
    const centro = rosa.querySelector('.centro');
    card.appendChild(rosa);

    // La lupa enseña la dirección elegida (se elige tocando su celda) con el
    // fotograma que toque, o el que se haya fijado tocándolo en la tira.
    const lupa = this.crearLupa(key);
    let lupaCara = 0, fijo = null;
    const NOMBRE = { 0: '↘', 1: '↓', 2: '↙', 3: '←', 4: '↖', 5: '↑', 6: '↗', 7: '→' };
    const marcaCara = () => {
      for (const { face, canvas } of celdas) canvas.parentNode.classList.toggle('elegida', face === lupaCara);
    };

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
    marcaDeslizador(slider);
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
    const aPie = def.class !== 'cavalry' && def.class !== 'siege';
    /** Medidas que caben todas las poses, desde los pies, en píxeles de mundo. */
    /*
     * Una caja por dirección, la de todos sus fotogramas juntos: centrar cada
     * fotograma por la suya haría bailar la figura al andar. La escala sí es
     * la misma para todas, la que hace caber la mayor.
     */
    const cajaDe = new Map();
    let anchoMax = 1, altoMax = 1;
    for (let face = 0; face < 8; face++) {
      let k = null;
      for (const m of modos) for (const f of m.frames) { const s = sprite(face, f); if (s) k = unir(k, cajaSolida(s)); }
      if (!k) continue;
      cajaDe.set(face, k);
      anchoMax = Math.max(anchoMax, k.x1 - k.x0);
      altoMax = Math.max(altoMax, k.y1 - k.y0);
    }
    /** Prepara un lienzo de w×h CSS y la escala entera que le toca. */
    const prepara = (c, w, hh) => {
      c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
      c.style.width = `${w}px`; c.style.height = `${hh}px`;
      const fit = Math.min((w - 6) / anchoMax, (hh - 6) / altoMax);
      // Un píxel del sprite (medio de mundo) en un número entero de píxeles de
      // pantalla, para que se vea nítido.
      const k = Math.max(1, Math.floor(fit * dpr / 2));
      c._esc = (k * 2) / dpr;
      c._w = w; c._h = hh;
    };
    const pinta = (c, face, f) => {
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      const s = sprite(face, f), k = cajaDe.get(face);
      if (s && k) centrado(ctx, s, k, c._w / 2, c._h / 2, c._esc);
    };
    for (const { canvas } of celdas) prepara(canvas, 96, 104);
    // Marco de la lupa por dirección: el de todos sus fotogramas juntos.
    const marcoDe = new Map();
    for (let face = 0; face < 8; face++) {
      const todos = [];
      for (const m of modos) for (const f of m.frames) todos.push(sprite(face, f));
      // Las unidades a pie van siempre en el lienzo estándar de 100×100, con
      // los pies en el mismo sitio: así toda plantilla descargada mide igual.
      marcoDe.set(face, aPie ? { ...MARCO_A_PIE } : Catalog.marcoDe(todos));
    }
    const pintaLupa = (f) => {
      lupa.pinta(sprite(lupaCara, f), marcoDe.get(lupaCara), [
        ['Dirección', NOMBRE[lupaCara]],
        ['Fotograma', fijo !== null ? `${f} (fijo)` : String(f)],
      ]);
    };
    for (const cel of celdas) {
      cel.canvas.parentNode.onclick = () => { lupaCara = cel.face; marcaCara(); last = -1; };
    }
    marcaCara();

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
        // Tocar un fotograma lo fija en todas las vistas; tocarlo otra vez lo suelta.
        box.onclick = () => { fijo = fijo === f ? null : f; last = -1; };
        tira.appendChild(box);
        return box;
      });
      last = -1;
      fase = 0;
      fijo = null;
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
      let i = Math.floor(fase) % modo.frames.length;
      if (fijo !== null) i = Math.max(0, modo.frames.indexOf(fijo));
      const clave = `${i}|${lupaCara}|${fijo}`;
      if (clave === last) return;
      last = clave;
      for (const { face, canvas } of celdas) pinta(canvas, face, modo.frames[i]);
      pintaLupa(modo.frames[i]);
      tiraCanvas.forEach((b, j) => {
        b.classList.toggle('actual', tiraCanvas.length === 1 || j === i);
        b.classList.toggle('fijo', fijo !== null && j === i);
      });
    };
    eligeModo(modo);
    this.animRaf = requestAnimationFrame(tick);

    const frag = document.createDocumentFragment();
    frag.append(this.grupoLupa(lupa), this.group('Imagen', [lupa.info]), this.group('Animaciones', [card]));
    return frag;
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
    // Con losetas dibujadas el color no se aplica: no se ofrece.
    if (terrainHasBitmap(key)) {
      const nota = document.createElement('p');
      nota.className = 'hoja-nota';
      nota.textContent = 'Este terreno está dibujado con losetas, así que su color no se puede cambiar.';
      return nota;
    }
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
