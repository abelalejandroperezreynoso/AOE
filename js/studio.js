// Taller de edificios: rehacerle el modelo a los edificios del propio juego.
//
// Aquí no se inventan edificios: se coge uno de los que ya hay —la casa, el
// molino, el castillo— y se le hace **otra cara**, armada con piezas (cajas,
// tejados, torres, vigas) sobre la huella que ese edificio ocupa en el mapa. Lo
// que cuesta, lo que aguanta y lo que hace no se toca desde aquí: eso vive en
// el catálogo, y así el taller cambia cómo se ve una partida sin poder
// desequilibrarla.
//
// Lo que se ve mientras se modela está proyectado e iluminado con la misma
// cámara y la misma luz que usa el horneado, así que la vista de trabajo y el
// sprite final son la misma cosa. Debajo se hornea de verdad, a tamaño de
// juego, en las tres etapas de obra.
//
// El visor pinta los triángulos por orden de lejanía con la API de Canvas (el
// pintor de toda la vida) en vez de rasterizar a mano: aquí interesa responder
// al arrastre del ratón, no clavar el resultado, que para eso está la vista
// previa horneada de al lado.

import { PLAYER_COLORS, AGES, UNITS, BUILDINGS, BUILD_ORDER, RESOURCES, RES_NAME } from './config.js';
import { project, depth, faceLight, rotZ, bake, HW, HH, VZ } from './gfx3d/engine.js';
import {
  PARTS, PART_KEYS, FIELDS, FLAGS, MATERIALS, MATERIAL_KEYS, PLAYER_MAT,
  DEFAULT_PALETTE, designParts, designMesh, MINE, isMine, minePartKeys,
} from './gfx3d/parts.js';
import { buildingMesh } from './gfx3d/buildings.js';
import {
  getDesign, isCustom, isBuiltin, saveDesign, resetBuilding,
  designFromTemplate, TEMPLATES, STOCK_BUILDINGS, MAX_PARTS,
  cloudEnabled, syncDesigns, pendingCount, allDesigns,
} from './data/designs.js';
import {
  allPieces, getPiece, savePiece, deletePiece, freeKey, syncPieces,
  MAX_PIECES, MAX_PIECE_PARTS,
} from './data/pieces.js';
import { drawSprite } from './sprites.js';
import { rebaseBuildingLooks } from './data/overrides.js';

const el = (id) => document.getElementById(id);

const STAGE_NAMES = ['Cimientos', 'En obra', 'Terminado'];
/** Los edificios del juego, en el mismo orden en que salen en la barra de obra. */
const BUILDING_ORDER = [
  ...BUILD_ORDER.filter((t) => BUILDINGS[t]),
  ...STOCK_BUILDINGS.filter((t) => !BUILD_ORDER.includes(t)),
];
/** Dónde se guarda la imagen de guía, aparte de los modelos. */
const REF_KEY = 'aor-studio-ref';
/** Lado máximo con el que se guarda la guía: es para calcar, no para enmarcar. */
const REF_MAX = 640;
/*
 * Qué campo de cada pieza hace de ancho, de largo y de alto. No todas los
 * llevan con el mismo nombre: la caja tiene ancho y fondo, el cilindro radios,
 * la viga largo y grueso y la cúpula un achatado que la estira a lo alto. Se
 * coge el primero que la pieza traiga; si no trae ninguno, ese lado no se
 * puede estirar desde la barra y su botón se apaga.
 */
const SCALE_FIELDS = {
  w: ['w', 'r', 'r0', 'th'],
  d: ['d', 'len'],
  h: ['h', 'rise', 'flat'],
};

const SNAPS = [
  [0.05, 'fino (0,05)'], [0.1, 'medio (0,1)'], [0.25, 'cuarto (0,25)'], [0.5, 'media casilla'],
];

export class Studio {
  constructor() {
    this.type = null;        // el edificio del juego que se está vistiendo
    this.pieza = null;       // o la pieza propia que se está haciendo, si toca
    this.design = null;      // copia de trabajo de su modelo (null: el del juego)
    this.selected = -1;      // índice de la pieza elegida
    this.redo = [];          // lo deshecho, esperando a que lo rehagan
    this.tab = 'build';
    this.vista = 'elegir';   // 'elegir' los edificios o 'editor' la mesa
    this.colorIdx = 0;
    this.viewYaw = 0;        // 0-3: giro de la vista, sólo para trabajar
    this.zoom = 4;
    this.ox = 0; this.oy = 0;
    this.snap = 0.05;
    this.undo = [];
    this.picks = [];         // triángulos ya proyectados, para saber qué se pulsa
    this.anchors = [];       // el ancla de cada pieza en pantalla, para el dedo
    this.drag = null;
    this.moveMode = 'xy';    // 'xy' por el suelo, 'z' en vertical (con el dedo)
    this.pointers = new Map(); // dedos o punteros que hay ahora mismo encima
    this.pinch = null;
    this.baked = null;       // el horneado exacto de la vista, cuando está quieta
    this.resCap = 3;         // techo de resolución del horneado, según lo rápido que vaya
    this.bind();
  }

  // --- Enganches --------------------------------------------------------------

  bind() {
    el('btn-studio').onclick = () => this.open();
    el('btn-studio-close').onclick = () => this.back();
    el('btn-share-close').onclick = () => el('studio-share').classList.add('hidden');
    el('btn-piece-sheet-close').onclick = () => this.closePieceSheet();
    el('btn-part-sheet-close').onclick = () => this.closePartSheet();
    el('part-sheet').onclick = (e) => { if (e.target === el('part-sheet')) this.closePartSheet(); };
    // Tocar el velo la cierra, como cualquier hoja.
    el('piece-sheet').onclick = (e) => { if (e.target === el('piece-sheet')) this.closePieceSheet(); };
    // Tocar el fondo del diálogo también lo cierra, como en cualquier ventana.
    el('studio-share').onclick = (e) => {
      if (e.target === el('studio-share')) el('studio-share').classList.add('hidden');
    };
    el('btn-share-copy').onclick = () => this.copyShare();
    el('btn-share-file').onclick = () => this.downloadShare();
    el('btn-share-paste').onclick = () => this.pasteShare();
    el('btn-share-apply').onclick = () => this.applyShare();

    /*
     * El encaje automático sigue al lienzo: cualquier cosa que le cambie el
     * tamaño —plegar la hoja, cambiar de pestaña, girar el teléfono, que salga
     * el teclado— lo vuelve a encajar. Perseguir cada caso a mano dejaba
     * siempre alguno fuera, y el modelo acababa metido debajo de la barra.
     * Sólo mientras nadie haya tocado el zoom o el encuadre: entonces manda lo
     * que haya puesto quien modela.
     */
    // Se guarda la referencia: un observador sin dueño puede acabar barrido.
    this.obsMesa = new ResizeObserver(() => {
      if (this.vista === 'editor' && this.encajado) { this.fit(); this.redraw(); }
    });
    this.obsMesa.observe(el('studio-stage'));

    for (const btn of document.querySelectorAll('#studio-tabs button')) {
      btn.onclick = () => this.showTab(btn.dataset.tab);
    }
    // Con el móvil los paneles van en una hoja de abajo; plegarla deja el
    // modelo a pantalla completa, que es lo que se quiere para mirarlo.
    el('btn-studio-sheet').onclick = () => {
      this.foldSheet(el('studio-card').dataset.sheet !== 'off');
    };

    const c = el('studio-view');
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    window.addEventListener('keydown', (e) => this.onKey(e));
    // El lienzo cambia de tamaño sin que cambie la ventana: al plegar la hoja,
    // al girar el teléfono o al abrirse el teclado. Vale más mirar la mesa.
    if (window.ResizeObserver) {
      new ResizeObserver(() => { if (this.isOpen()) this.redraw(); }).observe(el('studio-stage'));
    } else {
      window.addEventListener('resize', () => { if (this.isOpen()) this.redraw(); });
    }
    this.buildPad();
    this.buildTopbar();
  }

  /**
   * Cambia de pestaña (y, en el móvil, de hoja). Volver a tocar la que ya está
   * puesta la pliega: es la forma rápida de dejar la mesa despejada sin ir a
   * buscar el botón de plegar.
   */
  /**
   * Las piezas del modelo, en una hoja a media pantalla: debajo se eligen y
   * encima se sigue viendo el modelo, con la elegida señalada. Antes eran una
   * pestaña de la hoja de abajo, y para ver cuál se había cogido había que
   * cerrarla.
   */
  openPartSheet() {
    if (!this.design) return;
    closeMenus();
    el('part-sheet').classList.remove('hidden');
    this.renderPartSheet();
    // El modelo se encaja en lo que la hoja deja libre, que es para lo que se
    // queda a medias.
    if (this.encajado) { this.fit(); this.redraw(); }
  }

  closePartSheet() {
    el('part-sheet').classList.add('hidden');
    if (this.encajado) { this.fit(); this.redraw(); }
  }

  partSheetOpen() { return !el('part-sheet').classList.contains('hidden'); }

  renderPartSheet() {
    if (!this.partSheetOpen()) return;
    const box = el('part-sheet-body');
    box.innerHTML = '';
    box.appendChild(this.partPanel());
  }

  /** Lo que la hoja de las piezas le tapa al lienzo por abajo. */
  tapadoPorHoja() {
    if (!this.partSheetOpen()) return 0;
    const panel = el('part-sheet').querySelector('.sheet-panel');
    const mesa = el('studio-stage').getBoundingClientRect();
    // Se mide por lo que ocupa en la maqueta y no por dónde está: mientras sube
    // lleva su caja desplazada, y la cuenta saldría a cero justo cuando hace
    // falta. La hoja va pegada al borde de abajo de la ventana.
    const arriba = window.innerHeight - panel.offsetHeight;
    return Math.max(0, mesa.bottom - arriba);
  }

  showTab(tab) {
    // «Pieza» no es una pestaña del panel: abre la hoja de las piezas.
    if (tab === 'part') { this.openPartSheet(); return; }
    // Un edificio con la cara de siempre no tiene piezas ni colores que tocar:
    // lo que hace falta es la pantalla de empezar, que es la de «Edificio».
    if (!this.design) tab = 'build';
    const card = el('studio-card');
    if (tab === this.tab && card.dataset.sheet !== 'off') { this.foldSheet(true); return; }
    this.setTab(tab);
    if (card.dataset.sheet === 'off') this.foldSheet(false);
    this.renderPanel();
  }

  /** Deja puesta una pestaña sin tocar la hoja: para cuando cambia el edificio. */
  setTab(tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll('#studio-tabs button')) {
      b.classList.toggle('active', b.dataset.tab === tab);
    }
  }

  /** Pliega la hoja de los paneles para dejar el modelo a pantalla completa. */
  /*
   * Plegada la hoja no queda más que el modelo: en pantallas pequeñas se van
   * con ella la barra de herramientas y la vista previa. Es lo que se quiere
   * al entrar —ver el edificio— y cualquier pestaña lo trae todo de vuelta.
   */
  foldSheet(folded) {
    el('studio-card').dataset.sheet = folded ? 'off' : 'on';
    el('btn-studio-sheet').textContent = folded ? '⌃' : '⌄';
    el('btn-studio-sheet').title = folded
      ? 'Sacar las herramientas y el panel'
      : 'Dejar sólo el modelo';
    // La mesa acaba de cambiar de alto. Encajado a ojo por el propio taller, se
    // rehace; puesto a mano, no se toca lo que haya elegido quien modela.
    if (this.vista === 'editor' && this.encajado) { this.fit(); this.redraw(); }
  }

  isOpen() { return !el('studio').classList.contains('hidden'); }

  open() {
    el('main-menu').classList.add('hidden');
    el('studio').classList.remove('hidden');
    this.renderTools();
    this.restoreRef();
    // Lo primero es elegir a quién se le cambia la cara: sin edificio no hay
    // nada que modelar, y entrar directo al último dejaba la mesa puesta con
    // uno que a lo mejor no era el que se venía a tocar.
    this.showPick();
    // Al abrir se mira qué hay en la nube: puede haber cambiado desde otro
    // dispositivo, o haberse quedado algo mío por enviar la última vez.
    this.showCloud(pendingCount() ? `sin enviar (${pendingCount()})` : 'comprobando...');
    this.cloudSync(true);
  }

  /** Un paso atrás: de la mesa a los edificios, y de los edificios al menú. */
  back() {
    if (this.vista === 'editor') this.showPick();
    else this.close();
  }

  /** La pantalla de elegir edificio, que es por donde se entra. */
  showPick() {
    this.closePartSheet();
    this.flush();
    this.cancelReset();
    this.setVista('elegir');
    this.renderPick();
  }

  setVista(vista) {
    this.vista = vista;
    // La pestaña de la ficha dice qué hay en la mesa: un edificio o una pieza.
    const ficha = document.querySelector('#studio-tabs button[data-tab="build"]');
    if (ficha) ficha.textContent = this.enPieza() ? 'Pieza' : 'Edificio';
    el('studio-card').dataset.vista = vista;
    el('btn-studio-close').textContent = vista === 'editor' ? 'Elegir otro' : 'Volver al menú';
  }

  close() {
    this.flush();
    // Lo que quedara por mandar sale ahora: aquí ya no hay nada que dibujar y
    // la partida no espera por esto.
    this.cloudSync(true);
    clearTimeout(this.bakeTimer);
    el('studio').classList.add('hidden');
    el('main-menu').classList.remove('hidden');
  }

  status(msg) {
    el('studio-status').textContent = msg || '';
    clearTimeout(this.statusTimer);
    if (msg) this.statusTimer = setTimeout(() => { el('studio-status').textContent = ''; }, 4000);
  }

  // --- Edificios --------------------------------------------------------------

  /**
   * Pone en la mesa un edificio del juego. Si ya tiene un modelo —propio o de
   * los que trae el juego— se abre una copia de trabajo; si todavía lleva el
   * suyo de siempre no hay piezas que tocar y se recibe con las plantillas.
   */
  load(type) {
    if (!BUILDINGS[type]) return;
    // Al venir de la parrilla se llega a mirar, no a colocar vigas: la mesa se
    // abre con todo plegado y el modelo ocupa la tarjeta entera. Cambiando de
    // edificio desde la columna se respeta como lo tuviera puesto.
    const desdeLaParrilla = this.vista !== 'editor';
    this.setVista('editor');
    this.flush();
    if (this.cloudTimer) this.cloudSync(true);
    this.type = type;
    // En la mesa hay una cosa cada vez: poner un edificio suelta la pieza que
    // se estuviera haciendo, y al revés.
    this.pieza = null;
    this.lastType = type;
    const base = getDesign(type);
    this.design = base ? structuredClone(base) : null;
    // Sin pieza elegida: se llega a ver el edificio, y la barra de mover una
    // pieza sólo tiene sentido cuando hay una que mover.
    this.selected = -1;
    this.undo = [];
    this.redo = [];
    this.baked = null;
    this.cancelReset();
    // Sin modelo propio no hay piezas ni colores: la pestaña que sirve es la
    // del edificio, que es donde están las plantillas.
    this.setVista('editor');
    this.setTab(this.design ? this.tab : 'build');
    if (desdeLaParrilla) {
      this.foldSheet(true);
      if (window.matchMedia('(max-width: 620px), (max-height: 520px)').matches) this.foldPreview(true);
    }
    // El encaje va después de plegar: mide el hueco que le queda al lienzo, y
    // plegando después se habría quedado con la medida de antes.
    this.fit();
    this.renderPanel();
    this.redraw();
    this.schedulePreview();
  }

  /**
   * Pone en la mesa una pieza propia en vez de un edificio. Se modela igual
   * —las mismas herramientas, las mismas barras— sobre una huella de dos
   * casillas, que es el patrón contra el que se mide: lo que ocupe ahí es lo
   * que ocupará al colocarla, y desde ahí se estira como cualquier otra.
   */
  loadPiece(key) {
    const def = getPiece(key);
    if (!def) return;
    const desdeLaParrilla = this.vista !== 'editor';
    this.setVista('editor');
    this.flush();
    if (this.cloudTimer) this.cloudSync(true);
    this.type = null;
    this.pieza = key;
    this.design = { target: null, size: 2, palette: { ...DEFAULT_PALETTE }, parts: structuredClone(def.parts) };
    this.selected = -1;
    this.undo = [];
    this.redo = [];
    this.baked = null;
    this.cancelReset();
    if (desdeLaParrilla) {
      this.foldSheet(true);
      if (window.matchMedia('(max-width: 620px), (max-height: 520px)').matches) this.foldPreview(true);
    }
    this.setVista('editor');
    this.fit();
    this.renderPanel();
    this.redraw();
    this.schedulePreview();
  }

  /** Empieza una pieza vacía y la pone en la mesa. */
  newPiece() {
    if (allPieces().length >= MAX_PIECES) {
      this.status(`No caben más de ${MAX_PIECES} piezas propias.`);
      return;
    }
    const key = freeKey('pieza');
    if (!key || !savePiece({ key, label: 'Pieza nueva', parts: [] })) {
      this.status('No se ha podido empezar la pieza.');
      return;
    }
    this.afterPieceSave();
    this.loadPiece(key);
    this.status('Pieza nueva. Añádele piezas del juego y ponle nombre.');
  }

  /** ¿Se está haciendo una pieza en vez de vistiendo un edificio? */
  enPieza() { return !!this.pieza; }

  /** Cuántos edificios llevan puesta una pieza propia. */
  usosDe(key) {
    return allDesigns().filter((d) => d.parts.some((p) => p.k === MINE + key)).length;
  }

  /** Tras tocar una pieza: se repintan los edificios que la lleven, y a la nube. */
  afterPieceSave() {
    const conLaPieza = allDesigns()
      .filter((d) => d.parts.some((p) => isMine(p.k)))
      .map((d) => d.target);
    rebaseBuildingLooks(conLaPieza);
    this.cloudSync();
  }

  /** Le pone al edificio el modelo de una plantilla, ajustado a su huella. */
  newDesign(templateKey) {
    if (!this.type) return;
    const saved = saveDesign(designFromTemplate(templateKey, this.type));
    if (!saved) { this.status('No se ha podido empezar el modelo.'); return; }
    this.afterSave();
    this.load(this.type);
    this.status(`${BUILDINGS[this.type].name}: modelo empezado. Se ve así en la partida desde ya.`);
  }

  /** Le devuelve al edificio la cara que tenía antes de tocarlo. */
  confirmReset(btn) {
    if (!isCustom(this.type)) return;
    if (!this.confirming) {
      this.confirming = true;
      btn.textContent = '¿Seguro?';
      btn.classList.add('confirming');
      clearTimeout(this.delTimer);
      this.delTimer = setTimeout(() => this.cancelReset(), 5000);
      return;
    }
    this.cancelReset();
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    const type = this.type;
    resetBuilding(type);
    // El aspecto vuelve a ser el de antes, así que los retoques de color que el
    // catálogo tuviera sobre el modelo que había ya no significan nada.
    rebaseBuildingLooks([type]);
    this.cloudSync();
    this.load(type);
    this.status(isBuiltin(type)
      ? `${BUILDINGS[type].name} vuelve al modelo que trae el juego.`
      : `${BUILDINGS[type].name} vuelve a su aspecto original.`);
  }

  cancelReset() {
    clearTimeout(this.delTimer);
    this.confirming = false;
    // Hay dos botones: el de la columna y el de la hoja del móvil.
    for (const b of document.querySelectorAll('.studio-reset-btn')) {
      b.textContent = 'Restablecer';
      b.classList.remove('confirming');
    }
  }

  /**
   * Manda a la nube lo que se haya tocado, más espaciado que el guardado en el
   * navegador: escribir en local es gratis, ir a la red no. Al cerrar el taller
   * y al cambiar de edificio se manda ya, sin esperar.
   */
  cloudSync(now = false) {
    if (!cloudEnabled()) return;
    clearTimeout(this.cloudTimer);
    this.cloudTimer = 0;
    const go = () => {
      this.cloudTimer = 0;
      this.showCloud('...');
      syncDesigns().then((r) => {
        if (r.state === 'error') {
          // Lo hecho no se pierde: está guardado aquí y sale en cuanto se pueda.
          // Decir *por qué* no ha podido ser ahorra media tarde: no es lo mismo
          // que falte la tabla en el proyecto que que no haya cobertura.
          const porQue = {
            table: ['falta la tabla', 'El proyecto no tiene la tabla de los modelos: falta aplicar la migración de supabase/migrations/.'],
            auth: ['clave rechazada', 'El proyecto no acepta la clave, o sus políticas no dejan pasar. Se revisa en js/data/cloud-config.js.'],
          }[r.reason];
          const guardado = r.pending
            ? ` Lo tuyo (${r.pending}) está guardado en este navegador y sale en cuanto se pueda.`
            : '';
          this.showCloud(
            porQue ? porQue[0] : (r.pending ? `sin enviar (${r.pending})` : 'sin conexión'),
            (porQue ? porQue[1] : 'No se ha podido hablar con la nube. Se sigue trabajando aquí con normalidad.') + guardado,
          );
          return;
        }
        if (r.changed.length) {
          rebaseBuildingLooks(r.changed);
          // Lo que ha llegado de fuera puede ser el edificio que hay en la mesa.
          // Si el taller ya está cerrado no hay nada que repintar: los sprites
          // los ha tirado `rebaseBuildingLooks` y la partida los rehará.
          if (!this.isOpen()) { /* nada que enseñar */ }
          else if (this.vista === 'elegir') this.renderPick();
          else if (r.changed.includes(this.type)) this.refreshFromCloud();
          else this.schedulePreview();
        }
        this.showCloud('al día', 'Lo que hay aquí es lo que ve todo el mundo.');
      });
    };
    if (now) go();
    else this.cloudTimer = setTimeout(go, 1200);
  }

  /**
   * El edificio que hay en la mesa ha cambiado en la nube. Antes se recargaba
   * entero con `load()`, que suelta la pieza elegida y vacía el deshacer: a
   * mitad de colocar una pieza, eso es perderla sin motivo. Ahora, si lo que
   * llega es lo que ya tenemos —lo normal, que es el eco de lo que acabamos de
   * mandar—, no se toca nada; y si de verdad viene distinto, se repone la copia
   * de trabajo sin soltar la pieza.
   */
  refreshFromCloud() {
    // Con algo sin guardar todavía manda lo de aquí: es más nuevo que lo que
    // la nube pueda devolver, y pisarlo se llevaría lo que se acaba de colocar.
    if (this.saveTimer) return;
    const base = getDesign(this.type);
    if (JSON.stringify(base ?? null) === JSON.stringify(this.design ?? null)) return;
    this.design = base ? structuredClone(base) : null;
    this.selected = Math.min(this.selected, (this.design?.parts.length ?? 0) - 1);
    this.baked = null;
    this.renderPanel();
    this.redraw();
    this.schedulePreview();
  }

  /** El estado de la nube, en la cinta de arriba del taller. */
  showCloud(text, title = '') {
    const box = el('studio-cloud');
    if (!box) return;
    box.classList.toggle('hidden', !cloudEnabled());
    box.textContent = '';
    if (cloudEnabled()) {
      // El «Taller compartido» va aparte porque en el teléfono no cabe y se
      // esconde: lo que importa del aviso es el estado, no el rótulo.
      const pre = document.createElement('span');
      pre.className = 'cloud-pre';
      pre.textContent = 'Taller compartido: ';
      const val = document.createElement('span');
      val.textContent = text;
      box.append(pre, val);
    }
    box.title = title;
  }

  /**
   * Guarda la copia de trabajo, sin prisa: mientras se arrastra una pieza no
   * hace falta escribir en el navegador cada fotograma.
   */
  persist() {
    if (!this.design) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = 0; this.doSave(); }, 350);
  }

  /** Escribe ya lo que estuviera esperando: al cambiar de edificio o al salir. */
  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    this.doSave();
  }

  doSave() {
    if (!this.design) return;
    if (this.enPieza()) {
      const def = getPiece(this.pieza);
      const saved = savePiece({ key: this.pieza, label: def?.label || this.pieza, parts: this.design.parts });
      if (!saved) { this.status('No se ha podido guardar la pieza.'); return; }
      this.afterPieceSave();
      this.refreshActions();
      return;
    }
    if (!this.type) return;
    const saved = saveDesign(this.design, this.type);
    if (!saved) { this.status('No se ha podido guardar.'); return; }
    this.afterSave();
    // Con el primer guardado el edificio pasa a tener modelo propio, y con él
    // se habilitan compartir y restablecer.
    this.refreshActions();
  }

  /**
   * Lo que hay que rehacer tras cambiarle la cara a un edificio: el modelo
   * manda sobre sus colores, así que se retiran los retoques de aspecto que el
   * catálogo tuviera puestos sobre él. Sus cifras no se tocan —siguen siendo
   * las del juego, con lo que el catálogo diga— ni las del resto del juego.
   */
  afterSave() {
    rebaseBuildingLooks([this.type]);
    this.cloudSync();
  }

  pushUndo() {
    if (!this.design) return;
    this.undo.push(this.snapshot());
    if (this.undo.length > 40) this.undo.shift();
    // Un cambio nuevo corta la rama: lo que se había deshecho ya no se rehace.
    this.redo = [];
  }

  /** El modelo y la pieza elegida, en texto, para las dos pilas. */
  snapshot() {
    return JSON.stringify({ parts: this.design.parts, sel: this.selected });
  }

  /** Repone un punto guardado. Vale para deshacer y para rehacer. */
  restore(snap) {
    const state = JSON.parse(snap);
    this.design.parts = state.parts;
    this.selected = Math.min(state.sel, this.design.parts.length - 1);
    this.afterChange();
  }

  undoLast() {
    if (!this.design || !this.undo.length) return;
    this.redo.push(this.snapshot());
    this.restore(this.undo.pop());
    this.status('Deshecho.');
  }

  redoLast() {
    if (!this.design || !this.redo.length) return;
    this.undo.push(this.snapshot());
    this.restore(this.redo.pop());
    this.status('Rehecho.');
  }

  /**
   * Todo lo que hay que rehacer tras tocar el modelo. El punto de deshacer se
   * apunta antes de cambiar nada (`pushUndo`), no aquí: si no, se guardaría el
   * estado nuevo y deshacer no desharía nada.
   */
  afterChange() {
    this.redraw();
    this.renderPanel();
    this.renderPartSheet();
    this.persist();
    this.schedulePreview();
  }

  // --- Lista de edificios -----------------------------------------------------

  /**
   * Pone al día lo que se puede hacer con el edificio que hay en la mesa, sin
   * rehacer el panel entero: compartir pide un modelo propio y restablecer,
   * que se le haya tocado algo. Cambian al guardar por primera vez.
   */
  refreshActions() {
    for (const b of document.querySelectorAll('.studio-reset-btn')) b.disabled = !isCustom(this.type);
    for (const b of document.querySelectorAll('.studio-share-btn')) b.disabled = !this.design;
  }

  /** Con qué cara anda ahora mismo un edificio. */
  lookOf(type) {
    if (isCustom(type)) return 'Rehecho en el taller';
    return isBuiltin(type) ? 'Modelo del juego' : 'Aspecto original';
  }

  /**
   * La parrilla de la pantalla de elegir, que es la única lista de edificios
   * que hay: cada uno con la cara grande, que es lo que se mira para decidir.
   */
  renderPick() {
    const grid = el('studio-pick-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const type of BUILDING_ORDER) {
      const def = BUILDINGS[type];
      const b = document.createElement('button');
      b.className = 'pick-item'
        + (isCustom(type) ? ' rehecho' : '')
        + (type === this.type ? ' active' : '');
      const thumb = this.thumb(type, 92);
      thumb.className = 'pick-thumb';
      const n = document.createElement('div');
      n.className = 'pick-name';
      n.textContent = def.name;
      const sub = document.createElement('div');
      sub.className = 'pick-sub';
      sub.textContent = `${this.lookOf(type)}\n${def.size}×${def.size} · ${AGES[def.age].short}`;
      b.append(thumb, n, sub);
      b.onclick = () => this.load(type);
      grid.appendChild(b);
    }
    this.renderPiecePick();
  }

  /**
   * La segunda mitad de la parrilla: las piezas del taller. Un edificio se
   * viste con piezas, y éstas se hacen aquí igual que se hace un edificio, con
   * las mismas herramientas. Cambiar una cambia todos los edificios que la
   * lleven, así que cada ficha dice a cuántos.
   */
  renderPiecePick() {
    const caja = el('studio-pick-pieces');
    if (!caja) return;
    caja.innerHTML = '';
    for (const def of allPieces()) {
      const b = document.createElement('button');
      b.className = 'pick-item' + (def.key === this.pieza ? ' active' : '');
      const thumb = this.bakeThumb(structuredClone(def.parts), 92);
      thumb.className = 'pick-thumb';
      const n = document.createElement('div');
      n.className = 'pick-name';
      n.textContent = def.label;
      const usos = this.usosDe(def.key);
      const sub = document.createElement('div');
      sub.className = 'pick-sub';
      sub.textContent = `${def.parts.length} ${def.parts.length === 1 ? 'pieza' : 'piezas'}\n`
        + (usos ? `en ${usos} ${usos === 1 ? 'edificio' : 'edificios'}` : 'sin usar');
      b.append(thumb, n, sub);
      b.onclick = () => this.loadPiece(def.key);
      caja.appendChild(b);
    }

    const nueva = document.createElement('button');
    nueva.className = 'pick-item pick-new';
    nueva.innerHTML = '<span class="pick-plus">+</span>';
    const n = document.createElement('div');
    n.className = 'pick-name';
    n.textContent = 'Pieza nueva';
    const sub = document.createElement('div');
    sub.className = 'pick-sub';
    sub.textContent = `${allPieces().length} de ${MAX_PIECES}`;
    nueva.append(n, sub);
    nueva.onclick = () => this.newPiece();
    caja.appendChild(nueva);
  }

  /** Miniatura horneada de un edificio, con la cara que tenga, en su hueco. */
  thumb(type, size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    try {
      const d = type === this.type ? this.design : getDesign(type);
      const s = bake(d ? designMesh(d, this.colorIdx, 2, type === this.type)
        : buildingMesh(type, this.colorIdx, 2));
      const sc = Math.min((size - 4) / s.w, (size - 4) / s.h);
      ctx.imageSmoothingEnabled = false;
      drawSprite(ctx, s, size / 2 - (s.w / 2 - s.ox) * sc, size - 2 - (s.h - s.oy) * sc, sc);
    } catch { /* un modelo vacío no tiene nada que enseñar */ }
    return c;
  }

  // --- Compartir --------------------------------------------------------------

  /**
   * Sacar un modelo de aquí y meterlo en otro sitio. Un modelo es sólo datos,
   * así que cabe en una línea de texto: se copia, se manda por donde sea y al
   * otro lado se pega. Y esa misma línea es lo que se pone en
   * `js/data/builtin-designs.js` para que el edificio se vea así en el juego de
   * todo el mundo, sin que nadie tenga que importar nada.
   */
  openShare(mode) {
    this.shareMode = mode;
    const box = el('studio-share');
    const exporting = mode === 'export';
    if (exporting && !this.design) {
      this.status('Este edificio todavía lleva su modelo de siempre: no hay nada que compartir.');
      return;
    }
    const name = BUILDINGS[this.type]?.name || 'edificio';
    el('share-title').textContent = exporting ? `Compartir ${name}` : `Importar un modelo para ${name}`;
    el('share-hint').textContent = exporting
      ? 'Cópialo y mándalo a quien quieras. Quien lo reciba lo pega en Importar y verá así su edificio.'
      : `Pega aquí el modelo de un edificio. Se le pondrá a ${BUILDINGS[this.type]?.name || 'este edificio'}, ajustado a su huella.`;
    el('share-text').value = exporting ? JSON.stringify(this.design) : '';
    el('share-text').readOnly = exporting;
    el('share-note').textContent = '';
    el('btn-share-copy').classList.toggle('hidden', !exporting);
    el('btn-share-file').classList.toggle('hidden', !exporting);
    el('btn-share-paste').classList.toggle('hidden', exporting);
    el('btn-share-apply').classList.toggle('hidden', exporting);
    box.classList.remove('hidden');
    if (exporting) {
      el('share-text').focus();
      el('share-text').select();
    }
  }

  shareNote(msg) { el('share-note').textContent = msg; }

  async copyShare() {
    const text = el('share-text').value;
    try {
      await navigator.clipboard.writeText(text);
      this.shareNote('Copiado. Ya lo puedes pegar donde quieras.');
    } catch {
      // Sin permiso de portapapeles (o sin https) queda seleccionarlo a mano.
      el('share-text').select();
      this.shareNote('Cópialo a mano: ya está seleccionado.');
    }
  }

  downloadShare() {
    const name = (this.type || 'edificio').replace(/[^\w\-]+/g, '-').toLowerCase();
    const blob = new Blob([el('share-text').value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.shareNote('Descargado.');
  }

  async pasteShare() {
    try {
      el('share-text').value = await navigator.clipboard.readText();
      this.shareNote('Pegado. Comprueba que es el edificio y dale a importar.');
    } catch {
      el('share-text').focus();
      this.shareNote('Pega el texto en el recuadro con el teclado.');
    }
  }

  /**
   * Le pone al edificio que hay en la mesa el modelo pegado, pasando por el
   * validador de siempre. Manda el edificio elegido, no el que trajera el
   * texto: así el mismo modelo sirve para vestir el molino o el cuartel, y se
   * ajusta solo a la huella del que toque.
   */
  applyShare() {
    let raw = null;
    try {
      raw = JSON.parse(el('share-text').value);
    } catch {
      this.shareNote('Eso no es un modelo: el texto no se entiende.');
      return;
    }
    // Vale tanto un modelo suelto como una lista: de una lista se coge el primero.
    const item = Array.isArray(raw) ? raw[0] : raw;
    const saved = saveDesign(item, this.type);
    if (!saved) { this.shareNote('No se ha podido importar: el modelo no es válido.'); return; }
    this.afterSave();
    el('studio-share').classList.add('hidden');
    this.load(this.type);
    this.status(`${BUILDINGS[this.type].name}: modelo importado.`);
  }

  // --- Barra de herramientas --------------------------------------------------

  renderTools() {
    const bar = el('studio-tools');
    if (bar.dataset.ready) return;
    bar.dataset.ready = '1';

    const view = document.createElement('div');
    view.className = 'studio-view-tools';

    const mkBtn = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onclick = fn;
      return b;
    };

    // Las piezas, en un desplegable: son diecisiete y en fila ocupaban tres
    // renglones de mesa que ahora se lleva el modelo.
    view.appendChild(mkBtn('＋ Añadir', 'Añadir una pieza al edificio', () => this.openPieceSheet()));

    /*
     * Mover por el suelo o subir y bajar. Con ratón basta Mayús, pero con el
     * dedo no hay Mayús que valga: sin este interruptor no habría manera de
     * levantar una pieza del suelo en un móvil.
     */
    this.modeBtn = mkBtn('✥ Mover', 'Cambia entre mover por el suelo y subir o bajar la pieza (con ratón, Mayús mientras arrastras)', () => {
      this.moveMode = this.moveMode === 'z' ? 'xy' : 'z';
      this.modeBtn.classList.toggle('on', this.moveMode === 'z');
      this.modeBtn.textContent = this.moveMode === 'z' ? '⇕ Altura' : '✥ Mover';
      this.updatePad();
      this.redraw();
    });
    view.appendChild(this.modeBtn);
    view.appendChild(mkBtn('↶', 'Deshacer el último cambio [Ctrl+Z]', () => this.undoLast()));

    // Y lo que se toca de vez en cuando, en otro desplegable.
    view.appendChild(this.dropdown('⚙ Vista', 'Girar, encajar, rejilla y color del jugador', (pop) => {
      pop.appendChild(this.menuButton('↻ Girar la vista', 'Mira el modelo desde otro lado. No cambia el edificio.', () => {
        this.viewYaw = (this.viewYaw + 1) % 4;
        this.redraw();
      }));
      pop.appendChild(this.menuButton('⤢ Encajar el modelo', 'Vuelve a centrar y ajustar el zoom.', () => {
        this.fit();
        this.redraw();
      }));
      pop.appendChild(selectRow('Rejilla', String(this.snap), SNAPS.map(([v, l]) => [String(v), l]), (v) => {
        this.snap = Number(v);
      }));
      pop.appendChild(selectRow('Color del jugador', String(this.colorIdx),
        PLAYER_COLORS.map((c, i) => [String(i), c.name]), (v) => {
          this.colorIdx = Number(v);
          this.redraw();
          this.schedulePreview();
        }));
      pop.appendChild(checkRow('Ver la vista previa', !this.foldedPreview, (on) => {
        this.foldPreview(!on);
      }));
    }));

    // La imagen de guía: cargar una foto o un dibujo y calcarlo.
    view.appendChild(this.dropdown('▨ Guía', 'Poner una imagen de referencia debajo del modelo para calcarla', (pop) => this.refMenu(pop)));

    bar.appendChild(view);

    // La vista previa horneada se pliega: en un móvil son sesenta píxeles de
    // mesa, y no hace falta tenerla delante mientras se coloca una viga.
    el('btn-studio-preview').onclick = () => this.foldPreview(!this.foldedPreview);
    this.foldPreview(window.matchMedia('(max-width: 620px)').matches);
  }

  /**
   * Un botón con su menú desplegable. Se cierra al elegir algo, al tocar fuera
   * o con Escape, y se ancla al lado que le quepa.
   */
  dropdown(label, title, build) {
    const wrap = document.createElement('div');
    wrap.className = 'studio-menu';
    const btn = document.createElement('button');
    btn.className = 'studio-menu-btn';
    btn.textContent = `${label} ▾`;
    btn.title = title;
    const pop = document.createElement('div');
    pop.className = 'studio-pop hidden';
    // El contenido se monta al abrir: así refleja el estado de ese momento
    // (la rejilla, el color, si la vista previa está plegada...).
    // El cierre global va por `pointerdown`, que llega antes que el `click`: sin
    // pararlo aquí, volver a pulsar el botón cerraría el menú y lo abriría otra
    // vez, y no habría forma de cerrarlo desde donde se abrió.
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.onclick = (e) => {
      e.stopPropagation();
      const open = !pop.classList.contains('hidden');
      closeMenus();
      if (open) return;
      pop.innerHTML = '';
      build(pop);
      pop.classList.remove('hidden');
      btn.classList.add('on');
      // Si no cabe hacia la derecha, se descuelga por el otro lado.
      pop.classList.remove('right');
      const box = pop.getBoundingClientRect();
      if (box.right > window.innerWidth - 8) pop.classList.add('right');
    };
    // Sin esto, el cierre global se dispararía al tocar dentro del propio menú.
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    wrap.append(btn, pop);
    return wrap;
  }

  /** Una fila de menú que hace algo y lo cierra. */
  menuButton(label, title, fn) {
    const b = document.createElement('button');
    b.className = 'studio-menu-item';
    b.textContent = label;
    b.title = title;
    b.onclick = () => { closeMenus(); fn(); };
    return b;
  }

  /**
   * El menú de la imagen de guía. Se monta al abrir, así que refleja si hay
   * imagen puesta y con qué ajustes.
   */
  refMenu(pop) {
    const file = document.createElement('label');
    file.className = 'studio-menu-item studio-file';
    file.textContent = this.ref ? '▨ Cambiar la imagen...' : '▨ Poner una imagen...';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      if (input.files && input.files[0]) this.loadRef(input.files[0]);
      closeMenus();
    };
    file.appendChild(input);
    pop.appendChild(file);

    if (!this.ref) {
      const hint = document.createElement('p');
      hint.className = 'studio-hint-text';
      hint.textContent = 'Se dibuja detrás del modelo para calcarla encima. Las imágenes con transparencia se ven tal cual.';
      hint.style.margin = '0';
      pop.appendChild(hint);
      return;
    }

    pop.appendChild(rangeRow('Opacidad', this.ref.alpha, 0.05, 1, 0.05, (v) => {
      this.ref.alpha = v;
      this.redraw();
      this.saveRef();
    }));
    pop.appendChild(rangeRow('Tamaño', this.ref.scale, 0.05, 6, 0.05, (v) => {
      this.ref.scale = v;
      this.redraw();
      this.saveRef();
    }));
    pop.appendChild(checkRow('Delante del modelo', this.ref.front, (on) => {
      this.ref.front = on;
      this.redraw();
      this.saveRef();
    }));
    /*
     * Con la guía suelta, el arrastre es suyo: mueve la imagen en vez de las
     * piezas, que es la única forma de ajustarla con el dedo sin descolocar el
     * modelo. Bloqueada, deja de estorbar y se vuelve a modelar con normalidad
     * sin miedo a moverla de un roce.
     */
    pop.appendChild(checkRow('Bloquear la imagen', !!this.ref.locked, (on) => {
      this.ref.locked = on;
      this.status(on ? 'Guía bloqueada: ya no se mueve.' : 'Guía suelta: arrastra para colocarla.');
      this.redraw();
      this.saveRef();
    }));
    pop.appendChild(this.menuButton('⤢ Ponerla sobre la huella', 'La deja de pie en el centro de las casillas del edificio.', () => {
      this.fitRef();
      this.redraw();
      this.saveRef();
    }));
    pop.appendChild(this.menuButton('✕ Quitar la imagen', 'La guía se va; el modelo no se toca.', () => {
      this.ref = null;
      this.saveRef();
      this.redraw();
    }));
  }

  /**
   * Carga la imagen y la deja lista para calcar. Se guarda achicada: es una
   * guía, no un cuadro, y así cabe en el navegador y vuelve al día siguiente.
   */
  loadRef(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        this.ref = {
          img, src: shrinkImage(img), px: 0, py: 0, scale: 1, alpha: 0.45,
          // Delante de partida: detrás la tapan las piezas en cuanto hay dos, y
          // una guía que no se ve no guía. Detrás sigue estando a un toque.
          front: true, locked: false,
        };
        this.fitRef();
        this.saveRef();
        this.redraw();
        this.status('Guía puesta. Arrastra para colocarla; en «Guía» se ajusta y se quita.');
      };
      img.onerror = () => this.status('No se ha podido leer esa imagen.');
      img.src = reader.result;
    };
    reader.onerror = () => this.status('No se ha podido leer el fichero.');
    reader.readAsDataURL(file);
  }

  /**
   * Deja la guía **de pie sobre la huella**: al ancho de las casillas que ocupa
   * el edificio y apoyada en el borde de abajo del rombo, que es justo como se
   * dibuja un edificio isométrico. Es un punto de partida que no depende de lo
   * que haya modelado todavía —encajarla sobre el bulto del modelo la dejaba
   * en un sitio distinto cada vez que se añadía una pieza— y su sitio va en el
   * mismo espacio que el modelo, así que se queda pegada a él al acercar,
   * alejar o mover la vista.
   */
  fitRef() {
    if (!this.ref) return;
    const { img } = this.ref;
    const s = this.viewSize();
    let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of [[0, 0], [s, 0], [s, s], [0, s]]) {
      const [rx, ry] = this.spin(x, y);
      const [px, py] = project([rx, ry, 0]);
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py > y1) y1 = py;
    }
    this.ref.scale = Math.max(0.05, (x1 - x0) / img.width);
    this.ref.px = (x0 + x1) / 2 - (img.width * this.ref.scale) / 2;
    this.ref.py = y1 - img.height * this.ref.scale;
  }

  drawRef(ctx) {
    const r = this.ref;
    if (!r || !r.img) return;
    ctx.save();
    ctx.globalAlpha = r.alpha;
    ctx.drawImage(r.img,
      this.ox + r.px * this.zoom, this.oy + r.py * this.zoom,
      r.img.width * r.scale * this.zoom, r.img.height * r.scale * this.zoom);
    ctx.restore();
  }

  /** Guarda la guía en el navegador, con su sitio y sus ajustes. */
  saveRef() {
    clearTimeout(this.refTimer);
    this.refTimer = setTimeout(() => {
      try {
        if (!this.ref) localStorage.removeItem(REF_KEY);
        else {
          const { src, px, py, scale, alpha, front, locked } = this.ref;
          localStorage.setItem(REF_KEY, JSON.stringify({ src, px, py, scale, alpha, front, locked }));
        }
      } catch {
        // Sin sitio en el navegador: la guía sigue puesta hasta recargar.
      }
    }, 400);
  }

  /** Recupera la guía de la última vez, si la hubiera. */
  restoreRef() {
    if (this.ref || this.refTried) return;
    this.refTried = true;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(REF_KEY) || 'null'); } catch { saved = null; }
    if (!saved || typeof saved.src !== 'string' || !saved.src.startsWith('data:image/')) return;
    const img = new Image();
    img.onload = () => {
      this.ref = {
        img,
        src: saved.src,
        px: Number(saved.px) || 0,
        py: Number(saved.py) || 0,
        scale: Math.min(6, Math.max(0.05, Number(saved.scale) || 1)),
        alpha: Math.min(1, Math.max(0.05, Number(saved.alpha) || 0.5)),
        front: saved.front !== false,
        // Al volver del almacenamiento se recupera bloqueada salvo que se
        // dejara suelta: nadie quiere descolocar de un roce lo que ya colocó.
        locked: saved.locked !== false,
      };
      this.redraw();
    };
    img.src = saved.src;
  }

  /** Pliega o despliega la vista previa horneada. */
  foldPreview(folded) {
    this.foldedPreview = folded;
    el('studio-card').dataset.preview = folded ? 'off' : 'on';
    el('btn-studio-preview').textContent = folded ? '▸ Vista previa' : '▾ Vista previa';
    // Como al plegar la hoja: la mesa cambia de alto y el encaje automático se
    // rehace, el puesto a mano se respeta.
    if (this.vista === 'editor' && this.encajado) { this.fit(); this.redraw(); }
    if (!folded) this.renderPreview();
  }

  /** Los botones que añaden pieza. Salen en la barra y en la pestaña Añadir. */
  /**
   * El catálogo de piezas, en una hoja que sube desde abajo. Antes era un menú
   * con el nombre y un glifo, y había que saberse de memoria qué era cada cosa;
   * aquí cada pieza sale dibujada como se va a colocar, con los colores de este
   * modelo, que es lo que se mira para decidir.
   */
  openPieceSheet() {
    closeMenus();
    const grid = el('piece-sheet-grid');
    grid.innerHTML = '';
    const ficha = (k) => {
      const spec = PARTS[k];
      const b = document.createElement('button');
      b.className = 'piece-card';
      b.title = spec.hint;
      const thumb = this.pieceThumb(k, 68);
      const name = document.createElement('b');
      name.textContent = spec.label;
      b.append(thumb, name);
      b.onclick = () => { this.closePieceSheet(); this.addPart(k); };
      return b;
    };
    for (const k of PART_KEYS) grid.appendChild(ficha(k));

    /*
     * Las del taller van detrás y bajo su rótulo: son las mismas de la parrilla
     * de entrada, ya dadas de alta en el catálogo del dibujante. Dentro de una
     * pieza no salen, que las piezas propias no se anidan.
     */
    const mias = this.enPieza() ? [] : minePartKeys();
    if (mias.length) {
      const h = document.createElement('h4');
      h.className = 'piece-grid-h';
      h.textContent = 'Mis piezas';
      grid.appendChild(h);
      for (const k of mias) grid.appendChild(ficha(k));
    }
    el('piece-sheet').classList.remove('hidden');
  }

  closePieceSheet() { el('piece-sheet').classList.add('hidden'); }

  sheetOpen() { return !el('piece-sheet').classList.contains('hidden'); }

  /**
   * La ficha de una pieza propia: cómo se llama, cuántos edificios la llevan
   * puesta —que es lo que hay que saber antes de tocarla— y el botón de
   * quitarla, que avisa de a cuántos se les caería.
   */
  piecePanel() {
    const def = getPiece(this.pieza);
    const wrap = document.createElement('div');
    if (!def) {
      wrap.innerHTML = '<p class="cat-empty">Esta pieza ya no está.</p>';
      return wrap;
    }
    const h = document.createElement('h4');
    h.className = 'studio-h';
    h.textContent = 'Pieza del taller';
    wrap.appendChild(h);

    // El nombre es lo que se lee en el catálogo de piezas.
    const fila = document.createElement('label');
    fila.className = 'cat-field wide';
    const et = document.createElement('span');
    et.className = 'cat-label';
    et.textContent = 'Nombre';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 32;
    input.value = def.label;
    input.onchange = () => {
      const guardada = savePiece({ ...def, label: input.value, parts: this.design.parts }, this.pieza);
      if (!guardada) { input.value = def.label; return; }
      this.afterPieceSave();
      this.renderPanel();
      this.renderPick();
      this.status('Nombre cambiado.');
    };
    fila.append(et, input);
    wrap.appendChild(fila);

    const usos = this.usosDe(this.pieza);
    const nota = document.createElement('div');
    nota.className = 'studio-builtin-note';
    const p = document.createElement('p');
    p.textContent = usos
      ? `La llevan ${usos} ${usos === 1 ? 'edificio' : 'edificios'}. Lo que cambies aquí `
        + 'les cambia a todos, y a todo el que juegue.'
      : 'Todavía no la lleva ningún edificio. Se pone desde Añadir, en «Mis piezas».';
    nota.appendChild(p);
    wrap.appendChild(nota);

    wrap.appendChild(group('Lo que ocupa', [
      infoRow('Piezas', `${this.design.parts.length} de ${MAX_PIECE_PARTS}`),
      infoRow('Edificios que la usan', String(usos)),
    ]));

    const acts = document.createElement('div');
    acts.className = 'studio-actions';
    const del = document.createElement('button');
    del.className = 'studio-del studio-reset-btn';
    del.textContent = 'Quitar la pieza';
    del.title = usos
      ? `Se caería de ${usos} ${usos === 1 ? 'edificio' : 'edificios'}`
      : 'No la lleva ningún edificio';
    del.onclick = (e) => this.confirmDeletePiece(e.currentTarget);
    acts.appendChild(del);
    wrap.appendChild(acts);
    return wrap;
  }

  /**
   * Quitar una pieza se pregunta dos veces, como restablecer un edificio, y la
   * segunda dice a cuántos se les cae: no es lo mismo tirar una que no usa
   * nadie que una que está en media ciudad.
   */
  confirmDeletePiece(btn) {
    const usos = this.usosDe(this.pieza);
    if (!this.confirming) {
      this.confirming = true;
      btn.textContent = usos ? `¿Seguro? Se cae de ${usos}` : '¿Seguro?';
      btn.classList.add('confirming');
      clearTimeout(this.delTimer);
      this.delTimer = setTimeout(() => this.cancelReset(), 5000);
      return;
    }
    this.cancelReset();
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    const key = this.pieza;
    deletePiece(key);
    this.afterPieceSave();
    this.showPick();
    this.status('Pieza quitada.');
  }

  /**
   * La vista previa de una pieza propia. No tiene etapas de obra —una pieza no
   * se construye, se pone—, así que se enseña sola y a los tres tamaños con los
   * que suele acabar en un edificio.
   */
  renderPiecePreview(wrap) {
    const def = getPiece(this.pieza);
    if (!def) return;
    const partes = structuredClone(this.design.parts);
    for (const [size, label] of [[44, 'Pequeña'], [64, 'A su talla'], [92, 'Grande']]) {
      const cell = document.createElement('div');
      cell.className = 'studio-shot';
      const c = this.bakeThumb(partes, size);
      const t = document.createElement('span');
      t.textContent = label;
      cell.append(c, t);
      wrap.appendChild(cell);
    }
    el('studio-info').textContent = `${partes.length} de ${MAX_PIECE_PARTS} piezas`;
  }

  /** Cómo se ve una pieza del modelo, tal y como está puesta ahora mismo. */
  partThumb(part, size) {
    return this.bakeThumb([{ ...part }], size);
  }

  /**
   * Cómo se ve una pieza suelta: la de serie, horneada igual que en la partida
   * y con la paleta del modelo que se está haciendo, para que el dibujo del
   * catálogo sea el mismo que va a aparecer en la mesa.
   */
  pieceThumb(kind, size) {
    // La clave va aparte: `def` sólo trae los valores, no de qué es la pieza.
    return this.bakeThumb([{ ...structuredClone(PARTS[kind].def), k: kind }], size);
  }

  /** Hornea unas piezas sueltas en su hueco, con la paleta de este modelo. */
  bakeThumb(parts, size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    try {
      const d = {
        target: this.type,
        size: this.viewSize(),
        palette: this.design?.palette || { ...DEFAULT_PALETTE },
        parts,
      };
      const s = bake(designMesh(d, this.colorIdx, 2, true));
      const sc = Math.min((size - 4) / s.w, (size - 4) / s.h);
      ctx.imageSmoothingEnabled = false;
      drawSprite(ctx, s, size / 2 - (s.w / 2 - s.ox) * sc, size - 2 - (s.h - s.oy) * sc, sc);
    } catch { /* una pieza que no se deje dibujar no tumba el catálogo */ }
    return c;
  }

  // --- Piezas -----------------------------------------------------------------

  addPart(kind) {
    if (!this.type && !this.enPieza()) return;
    // Dentro de una pieza propia no entra otra: no se anidan.
    if (this.enPieza() && isMine(kind)) return;
    if (this.enPieza() && this.design.parts.length >= MAX_PIECE_PARTS) {
      this.status(`Una pieza no puede pasar de ${MAX_PIECE_PARTS} piezas.`);
      return;
    }
    // La primera pieza empieza el modelo: si el edificio todavía llevaba su
    // cara de siempre, se parte de la huella vacía y encima va lo que se pida.
    if (!this.design) {
      if (!saveDesign(designFromTemplate('empty', this.type))) return;
      this.afterSave();
      this.load(this.type);
    }
    if (this.design.parts.length >= MAX_PARTS) {
      this.status(`Un edificio no puede pasar de ${MAX_PARTS} piezas.`);
      return;
    }
    this.pushUndo();
    const spec = PARTS[kind];
    const p = { ...structuredClone(spec.def), k: kind };
    // La pieza nace en el centro de la huella; si hay otra elegida, encima de
    // ella, que es lo que se quiere el 90% de las veces (muro → tejado).
    const s = this.viewSize();
    const sel = this.design.parts[this.selected];
    if (p.x !== undefined) p.x = sel ? sel.x : s / 2;
    if (p.y !== undefined) p.y = sel ? sel.y : s / 2;
    if (p.z !== undefined && sel) p.z = Math.min(FIELDS.z.max, this.topOf(sel));
    this.design.parts.push(p);
    this.selected = this.design.parts.length - 1;
    // Nada de abrir la hoja de las piezas: lo que se quiere justo después de
    // añadir una es verla en el modelo, y la hoja lo taparía. Queda elegida, y
    // con ella salen sus dos barras.
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

  /** La huella sobre la que se trabaja: la del edificio, siempre. */
  viewSize() { return BUILDINGS[this.type]?.size || 2; }

  /**
   * Lo que hay en la mesa, pieza a pieza: el modelo que se está haciendo o, si
   * el edificio sigue con el suyo de siempre, el que trae escrito el juego (que
   * se enseña entero, en un solo bulto, porque no está hecho de piezas).
   */
  viewGroups() {
    if (this.design) return designParts(this.design, this.colorIdx, 2, true);
    return [{ part: null, tris: buildingMesh(this.type, this.colorIdx, 2) }];
  }

  /** Lo mismo, en una sola malla, para hornear. */
  viewMesh(stage = 2) {
    return this.design
      ? designMesh(this.design, this.colorIdx, stage, true)
      : buildingMesh(this.type, this.colorIdx, stage);
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
    const c = Math.cos(a), s = Math.sin(a), m = this.viewSize() / 2;
    return [m + (x - m) * c - (y - m) * s, m + (x - m) * s + (y - m) * c];
  }

  /**
   * La caja que ocupa el edificio proyectado —con su huella—, sin zoom ni
   * encuadre. La usan el encaje de la vista y el de la imagen de guía.
   */
  modelBounds() {
    const s = this.viewSize();
    const pts = [];
    for (const [x, y] of [[0, 0], [s, 0], [s, s], [0, s]]) {
      const [rx, ry] = this.spin(x, y);
      pts.push(project([rx, ry, 0]));
    }
    // Y lo que haya encima: el modelo que se está haciendo o, si el edificio
    // sigue con su cara de siempre, la del juego, que también hay que ver entera.
    for (const g of this.viewGroups()) {
      for (const t of g.tris) {
        for (const p of t.p) {
          const [rx, ry] = this.spin(p[0], p[1]);
          pts.push(project([rx, ry, p[2]]));
        }
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of pts) {
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    return { x0, y0, x1, y1 };
  }

  /** Ajusta zoom y encuadre para que quepa todo el edificio. */
  fit() {
    const box = el('studio-view').getBoundingClientRect();
    const W = Math.max(120, box.width), H = Math.max(120, box.height);
    const { x0, y0, x1, y1 } = this.modelBounds();
    // Arriba la cinta de datos y abajo la barra de la pieza: el modelo se
    // encaja entre las dos, para que no lo tapen. El hueco de abajo se reserva
    // aunque no haya pieza elegida, o el modelo daría un salto cada vez que la
    // barra aparece y desaparece.
    const pad = 18;
    const alto = this.padH();
    const bottom = Math.max(alto, this.tapadoPorHoja());
    const top = 24 + (this.hayHuecoArriba() ? alto : 0);
    const usable = Math.max(60, H - top - bottom);
    // El suelo es sólo para que un modelo diminuto no quede invisible: por
    // encima de lo que cabe no puede ir, o el castillo se sale del lienzo en un
    // teléfono, que es justo lo contrario de encajarlo.
    this.zoom = Math.max(0.75, Math.min(12,
      Math.min((W - pad * 2) / (x1 - x0 || 1), usable / (y1 - y0 || 1))));
    this.ox = W / 2 - ((x0 + x1) / 2) * this.zoom;
    this.oy = top + usable / 2 - ((y0 + y1) / 2) * this.zoom;
    // Mientras nadie toque el zoom ni el encuadre, el modelo se vuelve a
    // encajar solo cada vez que la mesa cambia de tamaño.
    this.encajado = true;
    // El encuadre ya está hecho para esta medida: si el lienzo se hubiera
    // quedado con la anterior, `redraw()` lo volvería a correr media pantalla
    // creyendo que hay que compensar el cambio de tamaño.
    this.lastW = Math.max(120, Math.round(box.width));
    this.lastH = Math.max(120, Math.round(box.height));
  }

  redraw() {
    const c = el('studio-view');
    const box = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(120, Math.round(box.width)), H = Math.max(120, Math.round(box.height));
    if (c.width !== W * dpr || c.height !== H * dpr) {
      // Al cambiar de tamaño (al plegar la hoja, al girar el teléfono) se
      // corrige el encuadre para que lo que estaba en el centro siga estando en
      // el centro, sin tocar el zoom que hubiera puesto quien modela.
      if (this.lastW) { this.ox += (W - this.lastW) / 2; this.oy += (H - this.lastH) / 2; }
      this.lastW = W; this.lastH = H;
      c.width = W * dpr; c.height = H * dpr;
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#3f5a30';
    ctx.fillRect(0, 0, W, H);
    // En la mesa hay un edificio o una pieza; sin ninguno de los dos, nada que
    // dibujar.
    if (!this.type && !this.enPieza()) return;

    this.drawGround(ctx);
    // Detrás del modelo, que es como se calca; delante si se pide, para
    // comparar la silueta.
    if (this.ref && !this.ref.front) this.drawRef(ctx);

    // Triángulos de todas las piezas, proyectados y ordenados de lejos a cerca:
    // el algoritmo del pintor. Con unos miles de caras va sobrado y responde al
    // arrastre sin pensárselo. Se calculan siempre, se pinten o no, porque son
    // también con lo que se sabe qué pieza hay bajo el dedo.
    const groups = this.viewGroups();
    const list = [];
    for (const g of groups) {
      const gi = this.design ? this.design.parts.indexOf(g.part) : -1;
      if (this.viewYaw) {
        const m = this.viewSize() / 2;
        rotZ(g.tris, (this.viewYaw * Math.PI) / 2, m, m);
      }
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
    // El ancla de cada pieza en pantalla: es a lo que se agarra un dedo cuando
    // no acierta de lleno en una cara.
    this.anchors = [];
    (this.design ? this.design.parts : []).forEach((p, i) => {
      if (p.x === undefined) return;
      const [rx, ry] = this.spin(p.x, p.y);
      const [ax, ay] = this.toScreen([rx, ry, p.z || 0]);
      this.anchors.push({ gi: i, x: ax, y: ay });
    });

    const sprite = this.settledSprite();
    if (sprite) {
      // Quieta la vista, se enseña el sprite horneado: exactamente el mismo
      // dibujo que saldrá en la partida, sombra y contorno incluidos.
      ctx.imageSmoothingEnabled = false;
      drawSprite(ctx, sprite, this.ox, this.oy, this.zoom);
      ctx.imageSmoothingEnabled = true;
    } else {
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
      this.scheduleBake();
    }

    if (this.ref && this.ref.front) this.drawRef(ctx);
    this.drawSelection(ctx);
    this.drawLegend(ctx, W);
    this.updatePad();
  }

  /*
   * Dos dibujos para lo mismo, y cada uno donde sirve.
   *
   * El juego no dibuja triángulos: hornea el modelo con un rasterizador propio
   * que decide píxel a píxel qué cara queda delante (búfer de profundidad). El
   * taller, mientras se arrastra una pieza, no puede pagar eso —hornear un
   * edificio mediano cuesta decenas de milisegundos— y pinta las caras
   * ordenadas de lejos a cerca. Ese orden es una aproximación: cuando dos
   * cuerpos se cruzan o uno se mete dentro de otro no hay orden posible que
   * salga bien, y ahí es donde el taller enseñaba costuras y piezas
   * atravesadas que en la partida no están.
   *
   * De modo que se pinta rápido mientras hay dedo encima y, en cuanto la vista
   * se queda quieta, se hornea el modelo de verdad y se enseña ese sprite. Lo
   * que se ve al soltar es, píxel a píxel, lo que se verá en la partida.
   */

  /** La resolución del horneado: tanta como aumento tenga la vista, con tope. */
  bakeRes() {
    return Math.max(1, Math.min(this.resCap, Math.round(this.zoom * 2) / 2));
  }

  /** Todo lo que cambia el sprite. Mover o encuadrar la vista no está: no lo cambia. */
  bakeKey() {
    return JSON.stringify([
      this.type, this.design ? this.design.palette : null, this.design ? this.design.parts : null,
      this.viewYaw, this.colorIdx, this.bakeRes(),
    ]);
  }

  /** El horneado de la vista, si el que hay sigue valiendo para lo que se ve ahora. */
  settledSprite() {
    return this.baked && this.baked.key === this.bakeKey() ? this.baked.sprite : null;
  }

  /**
   * Hornea en cuanto la vista lleva un momento quieta. Cualquier redibujado
   * mientras tanto vuelve a aplazarlo, así que arrastrar no hornea ni una vez.
   */
  scheduleBake() {
    clearTimeout(this.bakeTimer);
    this.bakeTimer = setTimeout(() => this.bakeView(), 180);
  }

  bakeView() {
    if (!this.type || !this.isOpen()) return;
    const res = this.bakeRes();
    let sprite = null, ms = 0;
    try {
      const mesh = this.viewMesh(2);
      if (this.viewYaw) {
        const m = this.viewSize() / 2;
        rotZ(mesh, (this.viewYaw * Math.PI) / 2, m, m);
      }
      const t0 = performance.now();
      sprite = bake(mesh, { res });
      ms = performance.now() - t0;
    } catch {
      // Un modelo imposible no deja el taller sin visor: se sigue con el pintor.
      return;
    }
    // Si al aparato le cuesta, se le pide menos la próxima vez: más vale un
    // horneado algo basto que una vista que se queda pillada al soltar. Y si
    // va sobrado se le vuelve a subir, que un tirón suelto no tiene por qué
    // dejar el taller borroso para siempre.
    if (ms > 110 && res > 1) this.resCap = Math.max(1, res - 0.5);
    else if (ms < 40) this.resCap = Math.min(3, this.resCap + 0.5);
    this.baked = { key: this.bakeKey(), sprite };
    this.redraw();
  }

  /** La huella del edificio: las casillas que ocupará en el mapa. */
  drawGround(ctx) {
    const s = this.viewSize();
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

  /**
   * La cinta de arriba: dónde está la pieza y cómo se mueve. Va arriba para no
   * pelearse con la cruceta, y en un lienzo estrecho se queda en lo
   * imprescindible en vez de salirse por el borde.
   */
  drawLegend(ctx, W) {
    const part = this.design?.parts[this.selected];
    ctx.fillStyle = 'rgba(20,16,11,.65)';
    ctx.fillRect(0, 0, W, 22);
    ctx.fillStyle = '#d5c6a2';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    // Sin modelo propio no hay nada que colocar: lo que se ve es el edificio
    // tal y como lo dibuja el juego, y lo que toca decir es por dónde se empieza.
    if (!this.design) {
      const name = BUILDINGS[this.type]?.name || 'Este edificio';
      ctx.fillText(W < 420
        ? `${name}: aspecto original`
        : `${name} con su aspecto original · elige una plantilla en «Edificio» para rehacerlo`, 10, 15);
      return;
    }
    const pos = part && part.x !== undefined
      ? `(${part.x.toFixed(2)}, ${part.y.toFixed(2)}, ${(part.z || 0).toFixed(2)})`
      : 'Nada elegido';
    const placing = this.ref && !this.ref.locked;
    const how = placing
      ? 'colocando la guía: arrastra para moverla · bloquéala al terminar'
      : (this.moveMode === 'z'
        ? 'arrastrar sube y baja'
        : 'arrastra para mover · dos dedos o rueda para el zoom');
    ctx.fillText(W < 420 && !placing ? pos : `${pos} · ${how}`, 10, 15);
  }

  // --- Ratón y dedos ----------------------------------------------------------

  pointerAt(e) {
    const box = el('studio-view').getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  }

  /**
   * Qué pieza hay bajo el puntero: la cara más cercana que lo contiene. Si no
   * cae en ninguna se coge la pieza cuyo ancla esté más cerca, dentro de un
   * margen: un dedo tapa mucho más de lo que apunta, y una viga de dos píxeles
   * sería imposible de pillar si hubiera que acertarla justo.
   */
  pick(px, py, slack = 0) {
    for (let i = this.picks.length - 1; i >= 0; i--) {
      const it = this.picks[i];
      if (pointInTri(px, py, it.pts)) return it.gi;
    }
    if (!slack) return -1;
    /*
     * Nada justo debajo: se coge lo más cercano dentro del margen. El margen
     * era sólo del punto de anclaje, así que fallar el dedo por unos píxeles
     * contra el cuerpo de la pieza no la cogía y encima soltaba la que hubiera
     * elegida. Ahora el margen es de toda su silueta.
     */
    const tope = slack * slack;
    let best = -1, bestD = tope, dElegida = Infinity;
    const mide = (gi, d) => {
      if (gi === this.selected) dElegida = Math.min(dElegida, d);
      if (d < bestD) { bestD = d; best = gi; }
    };
    for (const a of this.anchors) mide(a.gi, (a.x - px) ** 2 + (a.y - py) ** 2);
    for (const it of this.picks) mide(it.gi, distToTri(px, py, it.pts));
    // Dentro del margen manda la que ya estaba elegida: fallar el dedo junto a
    // la pieza en la que se está trabajando no puede saltar a la de al lado.
    // Para cambiar de pieza se toca encima, que eso siempre gana.
    return dElegida <= tope ? this.selected : best;
  }

  /** Margen de acierto: con el dedo hace falta bastante más que con el ratón. */
  slackFor(e) { return e.pointerType === 'mouse' ? 6 : 26; }

  onDown(e) {
    if (!this.design) return;
    const [px, py] = this.pointerAt(e);
    this.pointers.set(e.pointerId, [px, py]);
    el('studio-view').setPointerCapture(e.pointerId);
    if (this.pointers.size >= 2) { this.startPinch(); return; }

    // Con la guía en modo de colocar, el arrastre es suyo: mueve la imagen y no
    // toca ni las piezas ni la vista.
    if (this.ref && !this.ref.locked && e.button !== 2) {
      this.drag = { mode: 'ref', px, py, moved: false, start: { px: this.ref.px, py: this.ref.py } };
      return;
    }
    const hit = e.button === 2 ? -1 : this.pick(px, py, this.slackFor(e));
    if (hit >= 0 && this.design.parts[hit]) {
      if (hit !== this.selected) { this.selected = hit; this.renderPanel(); }
      const part = this.design.parts[hit];
      this.drag = {
        mode: e.shiftKey || this.moveMode === 'z' ? 'z' : 'xy',
        px, py, moved: false,
        start: { x: part.x, y: part.y, z: part.z },
      };
      this.pushUndo();
    } else {
      this.drag = { mode: 'pan', px, py, moved: false, ox: this.ox, oy: this.oy };
    }
    this.redraw();
  }

  /**
   * Empieza un pellizco. El arrastre de pieza que hubiera se cancela y la pieza
   * vuelve donde estaba: al apoyar el segundo dedo el primero siempre se mueve
   * un poco, y sería muy fácil descolocar algo sin querer al ir a hacer zoom.
   */
  startPinch() {
    if (this.drag && this.drag.start) {
      const part = this.design.parts[this.selected];
      if (part) Object.assign(part, this.drag.start);
      this.undo.pop();
    }
    this.drag = null;
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      dist: Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])),
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      zoom: this.zoom, ox: this.ox, oy: this.oy,
    };
    this.redraw();
  }

  onMove(e) {
    if (!this.design) return;
    const [px, py] = this.pointerAt(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [px, py]);

    // Dos dedos: pellizcar acerca y aleja, y moverlos arrastra la vista. El
    // punto que estaba entre los dedos se queda entre los dedos.
    if (this.pinch) {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const next = Math.max(0.75, Math.min(16, (this.pinch.zoom * dist) / this.pinch.dist));
      this.encajado = false;
      this.zoom = next;
      this.ox = mid[0] - ((this.pinch.mid[0] - this.pinch.ox) / this.pinch.zoom) * next;
      this.oy = mid[1] - ((this.pinch.mid[1] - this.pinch.oy) / this.pinch.zoom) * next;
      this.redraw();
      return;
    }

    if (!this.drag) return;
    const dsx = px - this.drag.px, dsy = py - this.drag.py;
    if (Math.abs(dsx) > 3 || Math.abs(dsy) > 3) this.drag.moved = true;

    if (this.drag.mode === 'ref') {
      this.ref.px = this.drag.start.px + dsx / this.zoom;
      this.ref.py = this.drag.start.py + dsy / this.zoom;
      this.redraw();
      return;
    }

    if (this.drag.mode === 'pan') {
      this.encajado = false;
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
      const [dx, dy] = this.screenToGround(dsx, dsy);
      part.x = clampField('x', snapTo(this.drag.start.x + dx, this.snap));
      part.y = clampField('y', snapTo(this.drag.start.y + dy, this.snap));
    }
    this.redraw();
    this.updatePad();
  }

  /**
   * Del desplazamiento en pantalla al desplazamiento por el suelo, deshaciendo
   * el giro de la vista: se arrastra hacia donde se mira, no hacia donde
   * apuntan los ejes del edificio.
   */
  screenToGround(dsx, dsy) {
    const rx = (dsx / (HW * this.zoom) + dsy / (HH * this.zoom)) / 2;
    const ry = (dsy / (HH * this.zoom) - dsx / (HW * this.zoom)) / 2;
    return this.unspin(rx, ry);
  }

  /** Un vector de la vista girada a los ejes del edificio. */
  unspin(rx, ry) {
    const a = -(this.viewYaw * Math.PI) / 2;
    return [rx * Math.cos(a) - ry * Math.sin(a), rx * Math.sin(a) + ry * Math.cos(a)];
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      // El pellizco no acaba hasta que se levantan todos los dedos: si no, al
      // soltar uno el otro se pondría a arrastrar piezas de golpe.
      if (!this.pointers.size) this.pinch = null;
      return;
    }
    if (!this.drag) return;
    if (this.drag.mode === 'ref') {
      this.drag = null;
      this.saveRef();
      return;
    }
    const wasPan = this.drag.mode === 'pan';
    const moved = this.drag.moved;
    this.drag = null;
    if (wasPan) {
      // Un toque limpio en el suelo suelta la selección; arrastrar sólo movía
      // la vista.
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
    // Colocando la guía, la rueda la agranda o la achica a ella.
    if (this.ref && !this.ref.locked) {
      const next = Math.max(0.05, Math.min(6, this.ref.scale * k));
      const { img } = this.ref;
      // Se agranda desde el puntero, para no perder de vista lo que se mira.
      this.ref.px = (px - this.ox) / this.zoom - ((px - this.ox) / this.zoom - this.ref.px) * (next / this.ref.scale);
      this.ref.py = (py - this.oy) / this.zoom - ((py - this.oy) / this.zoom - this.ref.py) * (next / this.ref.scale);
      this.ref.scale = next;
      this.redraw();
      this.saveRef();
      return;
    }
    const next = Math.max(0.75, Math.min(16, this.zoom * k));
    this.encajado = false;
    // Se amplía sobre el puntero, que es donde está mirando quien modela.
    this.ox = px - ((px - this.ox) * next) / this.zoom;
    this.oy = py - ((py - this.oy) * next) / this.zoom;
    this.zoom = next;
    this.redraw();
  }

  onKey(e) {
    if (!this.isOpen()) return;
    if (e.key === 'Escape') {
      // Primero, lo que esté por encima: la hoja de piezas y el compartir.
      if (this.sheetOpen()) { this.closePieceSheet(); return; }
      if (this.partSheetOpen()) { this.closePartSheet(); return; }
      if (!el('studio-share').classList.contains('hidden')) {
        el('studio-share').classList.add('hidden');
        return;
      }
      this.back();
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redoLast(); else this.undoLast();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redoLast(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicatePart(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deletePart(); return; }
    if (!this.design?.parts[this.selected]) return;
    // Las flechas empujan hacia donde apuntan en pantalla, y con Alt suben y
    // bajan la pieza. Van por pasos de la rejilla elegida.
    const big = e.shiftKey ? 4 : 1;
    const dir = {
      ArrowRight: [1, 0, 0], ArrowLeft: [-1, 0, 0],
      ArrowDown: [0, 1, 0], ArrowUp: [0, -1, 0],
    }[e.key];
    if (!dir) return;
    e.preventDefault();
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      this.nudge(0, 0, (e.key === 'ArrowUp' ? 1 : -1) * big);
    } else {
      this.nudge(dir[0] * big, dir[1] * big, 0);
    }
  }

  // --- Cruceta ----------------------------------------------------------------

  /**
   * Los botones flotantes que empujan la pieza. Con el dedo son la forma fina
   * de colocar algo —arrastrar sirve para ponerlo más o menos y esto para
   * clavarlo—, y sustituyen a unas flechas de teclado que en un móvil no hay.
   * Las direcciones son las de la pantalla, así que siguen al giro de la vista.
   */
  buildPad() {
    const pad = el('studio-pad');
    const mk = (dibujo, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.innerHTML = icono(dibujo);
      b.title = title;
      b.setAttribute('aria-label', title);
      b.className = cls;
      b.onclick = fn;
      return b;
    };
    const cross = document.createElement('div');
    cross.className = 'studio-cross';
    cross.append(
      mk('<path d="M17 17 7 7"/><path d="M7 13.5V7h6.5"/>', 'Mover hacia arriba a la izquierda', () => this.nudge(-1, 0, 0)),
      mk('<path d="M7 17 17 7"/><path d="M10.5 7H17v6.5"/>', 'Mover hacia arriba a la derecha', () => this.nudge(0, -1, 0)),
      mk('<path d="M17 7 7 17"/><path d="M7 10.5V17h6.5"/>', 'Mover hacia abajo a la izquierda', () => this.nudge(0, 1, 0)),
      mk('<path d="m7 7 10 10"/><path d="M10.5 17H17v-6.5"/>', 'Mover hacia abajo a la derecha', () => this.nudge(1, 0, 0)),
    );
    const lift = document.createElement('div');
    lift.className = 'studio-lift';
    lift.append(
      mk('<path d="m6 14 6-6 6 6"/>', 'Subir la pieza', () => this.nudge(0, 0, 1)),
      mk('<path d="m6 10 6 6 6-6"/>', 'Bajar la pieza', () => this.nudge(0, 0, -1)),
    );
    /*
     * Estirar y encoger, un lado por columna: ancho, largo y alto. Arriba
     * crecen y abajo encogen, con las flechas apuntando por el mismo diagonal
     * por el que se mueve ese lado en la mesa.
     */
    const escala = document.createElement('div');
    escala.className = 'studio-scale';
    const mkEscala = (eje, dibujo, title, dir) => {
      const b = mk(dibujo, title, () => this.scale(eje, dir));
      b.dataset.eje = eje;
      return b;
    };
    escala.append(
      mkEscala('w', '<path d="M4 4 20 20"/><path d="M4 10V4h6"/><path d="M14 20h6v-6"/>', 'Ensanchar', 1),
      mkEscala('d', '<path d="M20 4 4 20"/><path d="M14 4h6v6"/><path d="M4 14v6h6"/>', 'Alargar', 1),
      mkEscala('h', '<path d="M12 3v18"/><path d="m7 8 5-5 5 5"/><path d="m7 16 5 5 5-5"/>', 'Subir el alto', 1),
      mkEscala('w', '<path d="M3 3 9 9"/><path d="M3 9h6V3"/><path d="M21 21 15 15"/><path d="M21 15h-6v6"/>', 'Estrechar', -1),
      mkEscala('d', '<path d="M21 3 15 9"/><path d="M21 9h-6V3"/><path d="M3 21 9 15"/><path d="M3 15h6v6"/>', 'Acortar', -1),
      mkEscala('h', '<path d="M12 3v6"/><path d="m8 5 4 4 4-4"/><path d="M12 21v-6"/><path d="m8 19 4-4 4 4"/>', 'Bajar el alto', -1),
    );

    // Una rejilla, no una fila: cada grupo se lleva tantas columnas como
    // botones tiene de ancho, y así la barra cabe siempre, del teléfono
    // pequeño al grande, sin números de ancho escritos a mano.
    const rejilla = document.createElement('div');
    rejilla.className = 'studio-pad-grid';
    rejilla.append(cross, lift, escala);
    pad.append(rejilla);
  }

  /**
   * La barra de arriba: lo que se le hace a la pieza, no dónde se pone.
   * Deshacer y rehacer, añadir y duplicar, y su color y borrarla. Misma
   * hechura que la de abajo —grupos redondeados de dos filas— y el mismo
   * tamaño de botón, porque comparte su rejilla de siete columnas.
   */
  buildTopbar() {
    const bar = el('studio-topbar');
    const mk = (dibujo, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.innerHTML = icono(dibujo);
      b.title = title;
      b.setAttribute('aria-label', title);
      b.className = cls;
      if (fn) b.onclick = fn;
      return b;
    };
    const grupo = (cls, ...hijos) => {
      const g = document.createElement('div');
      g.className = cls;
      g.append(...hijos);
      return g;
    };

    this.btnUndo = mk('<path d="M4 9h11a5 5 0 0 1 0 10h-6"/><path d="m8 5-4 4 4 4"/>',
      'Deshacer [Ctrl+Z]', () => this.undoLast());
    this.btnRedo = mk('<path d="M20 9H9a5 5 0 0 0 0 10h6"/><path d="m16 5 4 4-4 4"/>',
      'Rehacer [Ctrl+Mayús+Z]', () => this.redoLast());

    // Añadir abre la misma caja de piezas que la barra de herramientas.
    const btnAdd = mk('<path d="M12 5v14M5 12h14"/>', 'Añadir una pieza', () => this.openPieceSheet());

    this.btnDup = mk('<rect x="9" y="9" width="11" height="11" rx="3"/>'
      + '<path d="M15.5 9V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v5.5a3 3 0 0 0 3 3h2"/>',
      'Duplicar la pieza', () => this.duplicatePart());

    // El color de la pieza es el de su material: el botón enseña el que lleva y
    // despliega los demás, con su muestra, para cambiarlo de un toque.
    this.btnColor = mk('', 'Color de la pieza', null);
    this.btnColor.innerHTML = '<i class="studio-swatch studio-swatch-big"></i>';
    this.padMenu(bar, this.btnColor, (pop) => {
      const part = this.design?.parts[this.selected];
      if (!part) return;
      const grid = document.createElement('div');
      grid.className = 'studio-mat-grid';
      const opciones = [...MATERIALS.map((m) => [m.key, m.label]), [PLAYER_MAT, 'Color del jugador']];
      for (const [key, label] of opciones) {
        const b = document.createElement('button');
        b.className = 'studio-mat' + (part.m === key ? ' active' : '');
        b.title = label;
        const sw = document.createElement('i');
        sw.className = 'studio-swatch';
        sw.style.background = this.matColor(key);
        const t = document.createElement('span');
        t.textContent = label;
        b.append(sw, t);
        b.onclick = () => { closeMenus(); this.pushUndo(); part.m = key; this.afterChange(); };
        grid.appendChild(b);
      }
      pop.appendChild(grid);
    });

    this.btnDel = mk('<path d="M4.5 7h15"/><path d="M9.5 7V5.5a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2V7"/>'
      + '<path d="M6.5 7l.8 11a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7"/>'
      + '<path d="M10.2 11v5M13.8 11v5"/>',
      'Borrar la pieza', () => this.deletePart(), 'studio-del');

    const rejilla = document.createElement('div');
    rejilla.className = 'studio-pad-grid';
    rejilla.append(
      grupo('studio-hist', this.btnUndo, this.btnRedo),
      grupo('studio-make', btnAdd, this.btnDup),
      grupo('studio-look', this.btnColor, this.btnDel),
    );
    bar.prepend(rejilla);
  }

  /**
   * Un botón de barra con su menú. El menú se cuelga de la barra y no del
   * grupo: los grupos recortan lo que se sale de sus esquinas redondeadas, y
   * dentro se quedaba en una rendija detrás del grupo de al lado.
   */
  padMenu(bar, btn, build) {
    const pop = document.createElement('div');
    pop.className = 'studio-pop hidden';
    pop.owner = btn;
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.appendChild(pop);
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.onclick = (e) => {
      e.stopPropagation();
      const abierto = !pop.classList.contains('hidden');
      closeMenus();
      if (abierto) return;
      pop.innerHTML = '';
      build(pop);
      pop.classList.remove('hidden');
      btn.classList.add('on');
      // Centrado bajo su botón, y sin salirse de la barra por ningún lado.
      pop.style.left = '0px';
      const b = btn.getBoundingClientRect(), caja = bar.getBoundingClientRect();
      const ancho = pop.getBoundingClientRect().width;
      const x = Math.min(Math.max(0, b.left - caja.left + (b.width - ancho) / 2), caja.width - ancho);
      pop.style.left = `${Math.round(x)}px`;
    };
    return btn;
  }

  /** El color con el que se pinta un material en este modelo. */
  matColor(key) {
    if (key === PLAYER_MAT) return PLAYER_COLORS[this.colorIdx].main;
    return this.design?.palette?.[key] || DEFAULT_PALETTE[key] || '#888';
  }

  /** Qué campo de esta pieza hace de ancho, de largo o de alto. */
  scaleField(part, eje) {
    const campos = PARTS[part.k]?.fields || [];
    return SCALE_FIELDS[eje].find((k) => campos.includes(k)) || null;
  }

  /** Estira o encoge la pieza por uno de sus tres lados. */
  scale(eje, dir) {
    const part = this.design?.parts[this.selected];
    if (!part) return;
    const key = this.scaleField(part, eje);
    if (!key) return;
    const paso = FIELDS[key].step;
    this.pushUndo();
    part[key] = clampField(key, part[key] + dir * paso);
    // El radio de arriba acompaña al de abajo: por separado el cilindro se
    // convierte en cono, y eso se afina en la ficha, no aquí.
    if (key === 'r0' && part.r1 !== undefined) part.r1 = clampField('r1', part.r1 + dir * paso);
    this.afterChange();
  }

  /** Empuja la pieza un paso de rejilla en la dirección que se ve. */
  nudge(dxr, dyr, dz) {
    const part = this.design?.parts[this.selected];
    if (!part) return;
    const step = this.snap || 0.05;
    this.pushUndo();
    if (dz && part.z !== undefined) part.z = clampField('z', snapTo(part.z + dz * step, step));
    if ((dxr || dyr) && part.x !== undefined) {
      const [dx, dy] = this.unspin(dxr * step, dyr * step);
      part.x = clampField('x', snapTo(part.x + dx, step));
      part.y = clampField('y', snapTo(part.y + dy, step));
    }
    this.afterChange();
  }

  /**
   * Con la mesa muy corta —hoja desplegada en un teléfono pequeño— las dos
   * barras y el modelo no caben, y el modelo se quedaría en un hilo. Entonces
   * la de arriba se aparta: lo suyo está también en la barra de herramientas y
   * en la ficha de la pieza, y lo de abajo, que es colocar, no está en ninguna
   * otra parte.
   */
  hayHuecoArriba() {
    return el('studio-stage').getBoundingClientRect().height >= 24 + 2 * this.padH() + 120;
  }

  /** Lo que mide de alto una de las dos barras, según lo diga la hoja. */
  padH() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pad-h')) || 86;
  }

  /** Las barras de la pieza sólo están cuando hay una pieza. */
  updatePad() {
    const part = this.design?.parts[this.selected];
    el('studio-pad').classList.toggle('hidden', !part);
    /*
     * La de arriba no espera a que haya pieza elegida: deshacer y añadir hacen
     * falta antes de que la haya —una pieza propia recién empezada está vacía y
     * sin «+» no habría por dónde—. Lo que sí depende de la pieza se apaga.
     */
    el('studio-topbar').classList.toggle('hidden', !this.design || !this.hayHuecoArriba());
    for (const b of document.querySelectorAll('.studio-scale button')) {
      b.disabled = !part || !this.scaleField(part, b.dataset.eje);
    }
    if (this.btnUndo) {
      this.btnUndo.disabled = !this.undo.length;
      this.btnRedo.disabled = !this.redo.length;
      this.btnDup.disabled = !part || this.design.parts.length >= MAX_PARTS;
      this.btnDel.disabled = !part;
      this.btnColor.disabled = !part;
      const sw = this.btnColor.querySelector('.studio-swatch');
      if (sw && part) sw.style.background = this.matColor(part.m);
    }
    el('studio-view').classList.toggle('lifting', this.moveMode === 'z');
  }

  // --- Vista previa horneada --------------------------------------------------

  schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderPreview(), 220);
  }

  /**
   * Las tres etapas de obra tal y como saldrán en la partida: mismo horneado,
   * mismo tamaño. Es la prueba de fuego de un modelo, porque a tamaño de juego
   * se ven las siluetas y no la micro-geometría.
   */
  renderPreview() {
    const wrap = el('studio-shots');
    wrap.innerHTML = '';
    if (this.enPieza()) { this.renderPiecePreview(wrap); return; }
    if (!this.type) return;
    let tris = 0, px = 0;
    for (let stage = 0; stage < 3; stage++) {
      const cell = document.createElement('div');
      cell.className = 'studio-shot';
      const c = document.createElement('canvas');
      const label = document.createElement('span');
      label.textContent = STAGE_NAMES[stage];
      try {
        const mesh = this.viewMesh(stage);
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
    const n = this.design ? this.design.parts.length : 0;
    el('studio-info').textContent = (this.design
      ? `${n} pieza${n === 1 ? '' : 's'} · `
      : 'Modelo del juego · ')
      + `${tris} triángulos · sprite de ${px || '—'} px`;
  }

  // --- Panel de propiedades ---------------------------------------------------

  renderPanel() {
    const box = el('studio-panel');
    box.innerHTML = '';
    if (!this.type && !this.enPieza()) {
      box.innerHTML = '<p class="cat-empty">Elige un edificio para empezar.</p>';
      return;
    }
    // El panel se quedó con una sola cosa: la ficha de lo que hay en la mesa.
    // Las piezas viven en su hoja y el color de cada una, en su barra.
    box.appendChild(this.enPieza() ? this.piecePanel() : this.buildPanel());
  }

  /** Las plantillas por las que empezar (o volver a empezar) un modelo. */
  templateList(title) {
    const wrap = document.createElement('div');
    const h = document.createElement('h4');
    h.className = 'studio-h';
    h.textContent = title;
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
      const thumb = this.partThumb(p, 34);
      thumb.className = 'studio-part-thumb';
      const swatch = document.createElement('i');
      swatch.className = 'studio-swatch';
      swatch.style.background = this.matColor(p.m);
      const name = document.createElement('span');
      name.textContent = PARTS[p.k].label;
      li.append(thumb, swatch, name);
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
    if (f.type === 'choice') {
      const input = document.createElement('select');
      for (const [v, label] of f.options) input.add(new Option(label, v));
      input.value = part[key];
      input.onchange = () => { this.pushUndo(); part[key] = input.value; this.afterChange(); };
      row.append(name, input);
      return row;
    }
    const stepper = numberStepper(part[key], f, (v) => {
      this.pushUndo();
      part[key] = clampField(key, v);
      this.afterChange();
      return part[key];
    });
    row.append(name, stepper);
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

  /**
   * La ficha del edificio del juego: qué es, qué cuesta y qué hace. Aquí no se
   * toca nada de eso —para eso está el catálogo—; lo que se hace es empezar,
   * rehacer o deshacer **su modelo**.
   */
  buildPanel() {
    const type = this.type;
    const def = BUILDINGS[type];
    const wrap = document.createElement('div');

    const h = document.createElement('h4');
    h.className = 'studio-h';
    h.textContent = def.name;
    const desc = document.createElement('p');
    desc.className = 'studio-hint-text';
    desc.textContent = def.desc;
    wrap.append(h, desc);
    // Antes que la ficha: en la hoja del teléfono lo que va detrás queda
    // siempre fuera de vista, y estos tres son lo que se viene a hacer.
    wrap.appendChild(this.buildingActions(type));

    const rows = [
      infoRow('Huella', `${def.size}×${def.size} casillas`),
      infoRow('Edad', AGES[def.age].name),
      infoRow('Coste', RESOURCES.filter((r) => def.cost?.[r])
        .map((r) => `${def.cost[r]} de ${RES_NAME[r].toLowerCase()}`).join(', ') || 'Nada'),
      infoRow('Resistencia', `${def.hp} puntos de vida`),
    ];
    if (def.pop) rows.push(infoRow('Población', `+${def.pop}`));
    if (def.trains) rows.push(infoRow('Entrena', def.trains.map((t) => UNITS[t].name).join(', ')));
    if (def.dropoff) rows.push(infoRow('Almacena', def.dropoff.map((r) => RES_NAME[r]).join(', ')));
    if (def.attack) rows.push(infoRow('Defensa', `${def.attack} de ataque · ${def.range} de alcance`));
    wrap.appendChild(group('Lo que pone el juego', rows));

    const note = document.createElement('div');
    note.className = 'studio-builtin-note';
    const p = document.createElement('p');
    p.textContent = this.design
      ? 'Estás cambiándole la cara, no la ficha: lo que cuesta, lo que aguanta y lo '
        + 'que hace lo sigue poniendo el juego. Sus números se retocan en el catálogo.'
      : `${def.name} se dibuja con el modelo que trae el juego, escrito en código y no `
        + 'hecho de piezas, así que no se puede abrir y retocar. Empieza por una plantilla '
        + 'y a partir de ahí queda como tú quieras: se ajusta sola a su huella.';
    note.appendChild(p);
    wrap.appendChild(note);

    if (!this.design) {
      wrap.appendChild(this.templateList('Empezar por...'));
      return wrap;
    }

    // Volver a empezar se deja plegado: es tirar lo hecho, no algo de todos los días.
    const again = document.createElement('details');
    again.className = 'studio-more';
    const sum = document.createElement('summary');
    sum.textContent = 'Empezar de nuevo';
    again.append(sum, this.templateList('Cambiar por...'));
    wrap.appendChild(again);
    return wrap;
  }

  /**
   * Lo que se puede hacer con el edificio de la mesa. Vivía en una columna
   * aparte con la lista de edificios; quitada la lista —el edificio ya se elige
   * al entrar—, su sitio es la ficha del edificio, que es de lo que hablan.
   */
  buildingActions(type) {
    const wrap = document.createElement('div');
    const mk = (text, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.className = cls;
      b.onclick = fn;
      return b;
    };

    const pasa = document.createElement('div');
    pasa.className = 'studio-actions';
    const share = mk('Compartir', 'Saca el modelo como texto para llevarlo a otro sitio',
      () => this.openShare('export'), 'studio-share-btn');
    share.disabled = !this.design;
    pasa.append(share, mk('Importar', 'Pega aquí un modelo que te hayan pasado',
      () => this.openShare('import')));
    wrap.appendChild(pasa);

    const deshacer = document.createElement('div');
    deshacer.className = 'studio-actions';
    const undo = mk('Restablecer', isBuiltin(type)
      ? 'Vuelve al modelo que trae el juego'
      : 'Vuelve al aspecto original del edificio',
      (e) => this.confirmReset(e.currentTarget), 'studio-del studio-reset-btn');
    undo.disabled = !isCustom(type);
    deshacer.appendChild(undo);
    wrap.appendChild(deshacer);
    return wrap;
  }

}

// --- Ayudas -----------------------------------------------------------------

/** Cierra cualquier menú desplegable que hubiera abierto. */
/*
 * Iconos de trazo en vez de caracteres: ▲ y ↖ los pinta la tipografía con pesos
 * distintos —uno macizo y el otro un hilo— y en fila no parecían la misma
 * familia. Dibujados aquí, todos llevan el mismo grosor y las mismas puntas
 * redondas, y las dos barras de la pieza tiran del mismo sitio.
 */
function icono(d) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"`
    + ` stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"`
    + ` aria-hidden="true">${d}</svg>`;
}

function closeMenus() {
  for (const pop of document.querySelectorAll('.studio-pop:not(.hidden)')) {
    pop.classList.add('hidden');
    // Los de la barra de herramientas van pegados a su botón; los de las barras
    // de la pieza cuelgan de la barra y apuntan al suyo a mano.
    (pop.owner || pop.previousElementSibling)?.classList.remove('on');
  }
}
document.addEventListener('pointerdown', closeMenus);

function pointInTri(px, py, [a, b, c]) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d;
  const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d;
  return u >= 0 && v >= 0 && u + v <= 1;
}

const snapTo = (v, step) => (step ? Math.round(v / step) * step : v);

/**
 * La imagen, achicada a un tamaño razonable y en PNG (que conserva la
 * transparencia). Una foto de móvil son varios megas y el navegador no guarda
 * tanto; para calcar sobran seiscientos píxeles.
 */
function shrinkImage(img) {
  const k = Math.min(1, REF_MAX / Math.max(img.width, img.height));
  if (k === 1) return img.src;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  try {
    return c.toDataURL('image/png');
  } catch {
    return img.src;
  }
}

/** Fila con un deslizador: para lo que se ajusta a ojo, como la opacidad. */
function rangeRow(label, value, min, max, step, onChange) {
  const row = document.createElement('label');
  row.className = 'cat-field studio-range';
  const name = document.createElement('span');
  name.className = 'cat-label';
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step;
  input.value = value;
  input.oninput = () => onChange(Number(input.value));
  row.append(name, input);
  return row;
}

/**
 * Un número con sus botones de menos y más. Escribir a mano sigue valiendo,
 * pero en un móvil los pasos evitan sacar el teclado para bajar dos décimas, y
 * los botoncitos que trae el navegador son inpulsables con el dedo.
 */
function numberStepper(value, f, apply) {
  const wrap = document.createElement('span');
  wrap.className = 'studio-num';
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = f.min; input.max = f.max; input.step = f.step;
  input.value = round(value);
  const set = (v) => { input.value = round(apply(v)); };
  const bump = (dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'studio-bump';
    b.textContent = dir > 0 ? '+' : '−';
    b.title = dir > 0 ? 'Subir un paso' : 'Bajar un paso';
    b.onclick = (e) => {
      e.preventDefault();
      const v = Number(input.value);
      set((Number.isFinite(v) ? v : f.min) + dir * f.step);
    };
    return b;
  };
  input.onchange = () => {
    const v = Number(input.value);
    set(Number.isFinite(v) ? v : f.min);
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
  wrap.append(bump(-1), input, bump(1));
  return wrap;
}

/**
 * Distancia al cuadrado de un punto al borde de un triángulo. Sirve para el
 * margen de acierto: cuánto se ha fallado contra el cuerpo de una pieza.
 */
function distToTri(px, py, pts) {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % 3];
    const dx = bx - ax, dy = by - ay;
    const largo = dx * dx + dy * dy;
    const t = largo ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / largo)) : 0;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    best = Math.min(best, qx * qx + qy * qy);
  }
  return best;
}

function clampField(key, v) {
  const f = FIELDS[key];
  if (!f) return v;
  return Math.min(f.max, Math.max(f.min, Math.round(v * 1000) / 1000));
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

/**
 * Un grupo de campos que se puede plegar. Con título sale como desplegable
 * (abierto de partida) para poder cerrar lo que no se está tocando; sin título
 * es una rejilla suelta.
 */
function group(title, rows, open = true) {
  const grid = document.createElement('div');
  grid.className = 'cat-grid';
  for (const r of rows) grid.appendChild(r);
  if (!title) {
    const sec = document.createElement('section');
    sec.className = 'cat-group';
    sec.appendChild(grid);
    return sec;
  }
  const sec = document.createElement('details');
  sec.className = 'cat-group studio-group';
  sec.open = open;
  const sum = document.createElement('summary');
  sum.textContent = title;
  sec.append(sum, grid);
  return sec;
}

/** Fila de sólo lectura: un dato del edificio que aquí no se toca. */
function infoRow(label, value) {
  const row = document.createElement('div');
  row.className = 'cat-field studio-info-row';
  const name = document.createElement('span');
  name.className = 'cat-label';
  name.textContent = label;
  const v = document.createElement('span');
  v.className = 'studio-info-value';
  v.textContent = value;
  row.append(name, v);
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
