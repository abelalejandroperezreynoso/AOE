// IA de los rivales: economía, expansión, tecnología y ataques por oleadas.
//
// El comportamiento reproduce el del Age of Empires II: explorar el mapa con el
// jinete inicial, repartir aldeanos por proporciones de recursos, ahorrar para
// la siguiente edad, responder a las incursiones en el sitio donde ocurren
// (campana incluida), reparar lo dañado, concentrar el ejército antes de salir,
// componer las tropas según lo que se le haya visto al enemigo y llevar la
// oleada de objetivo en objetivo hasta arrasar la base o retirarse.

import { UNITS, BUILDINGS, TECHS, UPGRADES, AGES, RESOURCES } from './config.js';
import { dist, clamp } from './utils.js';
import { nearestFree } from './path.js';

const RATIOS = [
  { food: 0.48, wood: 0.40, gold: 0.08, stone: 0.04 }, // oscura
  { food: 0.38, wood: 0.40, gold: 0.16, stone: 0.06 }, // feudal
  { food: 0.34, wood: 0.34, gold: 0.24, stone: 0.08 }, // castillos
  { food: 0.32, wood: 0.32, gold: 0.28, stone: 0.08 }, // imperial
];

// Aldeanos mínimos antes de empezar a ahorrar para la siguiente edad.
const AGE_MIN_VILLAGERS = [14, 20, 26];

const ARMY_MIX = [
  ['militia', 'scout'],
  ['archer', 'spearman', 'skirmisher', 'militia'],
  ['knight', 'crossbowman', 'pikeman', 'longswordsman', 'ram'],
  ['cavalier', 'arbalester', 'champion', 'knight', 'ram', 'mangonel'],
];

// --- Reglas de combate ------------------------------------------------------

// Radio en el que un enemigo junto a un edificio propio dispara la alarma.
const ALARM_RADIUS = 12;
// Desde cuán lejos acude un soldado a repeler una incursión. Más allá de esto
// no se mueve: en el juego original una escaramuza en un extremo del pueblo no
// deja el otro extremo sin guarnición.
const DEFEND_RADIUS = 26;
// Radio de la campana: los aldeanos de dentro sueltan lo que hacen y corren al
// centro urbano.
const BELL_RADIUS = 8;
// Segundos que un aldeano se queda a resguardo antes de volver al trabajo.
const PANIC_TIME = 6;
// Si la oleada baja de esta fracción de su tamaño máximo, se retira a casa.
const RETREAT_FRACTION = 0.3;

/**
 * Triángulo de contras del juego original: cuánto vale cada clase propia
 * (filas) frente a cada clase enemiga (columnas). Es lo que hace que la IA
 * saque lanceros cuando le llegan jinetes o caballería cuando le llegan
 * arqueros, en vez de repetir siempre la misma mezcla.
 */
const COUNTER_SCORE = {
  infantry: { infantry: 1.0, archer: 1.1, cavalry: 0.5, siege: 1.4, civilian: 1.2 },
  archer: { infantry: 1.5, archer: 1.0, cavalry: 0.7, siege: 1.3, civilian: 1.2 },
  cavalry: { infantry: 1.2, archer: 1.6, cavalry: 1.0, siege: 1.7, civilian: 1.6 },
  siege: { infantry: 0.6, archer: 0.9, cavalry: 0.4, siege: 0.6, civilian: 0.4 },
};

// Unidades que existen precisamente para frenar a una clase concreta.
const SPECIALIST = { spearman: 'cavalry', pikeman: 'cavalry', skirmisher: 'archer' };

// Máquinas de asedio que puede haber en el ejército a la vez, por edad.
const SIEGE_CAP = [0, 0, 2, 4];

/**
 * Qué merece la pena derribar primero. Se suma a la distancia, así que negativo
 * es «acércate a esto» y positivo «déjalo para el final»: torres y castillos
 * salen caros de asaltar y las murallas no dan nada.
 */
const TARGET_BONUS = {
  towncenter: -26, barracks: -12, archeryrange: -12, stable: -12, siegeworkshop: -12,
  mill: -5, lumbercamp: -5, miningcamp: -5, market: -4, blacksmith: -4,
  house: 4, farm: 7, tower: 9, castle: 14, wall: 22,
};

export class AI {
  constructor(game) {
    this.game = game;
    this.brains = [];
    for (const p of game.players) {
      if (p.isHuman) { this.brains.push(null); continue; }
      p.gatherBonus = game.difficulty.bonus;
      const base = game.map.starts[p.id] || { x: 20, y: 20 };
      const b = {
        player: p,
        timer: Math.random() * 0.6,
        assignTimer: 0,
        attackTimer: game.difficulty.attackEvery * 0.45,
        wave: 0,
        base,
        farmSlots: 0,
        target: null,
        defending: false,
        threat: null,
        threatCount: 0,
        // Grupo de asalto: las unidades que salieron en la oleada en curso.
        attackers: new Set(),
        waveSize: 0,
        retreating: false,
        reinforceCd: 0,
        // Punto de reunión donde se junta el ejército antes de salir.
        staging: { x: base.x, y: base.y },
        stagingCd: 0,
        // Explorador inicial y su ruta.
        scout: null,
        scoutRoute: null,
        scoutIdx: 0,
        // Lo que se le ha visto al enemigo, por clase, con memoria que se
        // desvanece: la IA no adivina, responde a lo que ha llegado a ver.
        seen: { infantry: 0, archer: 0, cavalry: 0, siege: 0, civilian: 0 },
        seenCd: 0,
        repairCd: 0,
        tradeCd: 0,
      };
      for (const u of p.units) if (u.type === 'scout') { b.scout = u; break; }
      b.staging = this.stagingPoint(b);
      this.brains.push(b);
    }
  }

  update(dt) {
    for (const b of this.brains) {
      if (!b || b.player.defeated) continue;
      b.timer -= dt;
      b.assignTimer -= dt;
      b.attackTimer -= dt;
      if (b.timer <= 0) { b.timer = 1.0; this.think(b, dt); }
      if (b.assignTimer <= 0) { b.assignTimer = 2.5; this.assignVillagers(b); }
    }
  }

  think(b) {
    this.observe(b);
    this.defend(b);
    this.scoutMap(b);
    this.trainVillagers(b);
    this.buildHouses(b);
    this.buildMilitary(b);
    this.buildEconomy(b);
    this.advanceAge(b);
    this.trainArmy(b);
    this.research(b);
    this.trade(b);
    this.manageArmy(b);
  }

  // --- Economía -------------------------------------------------------------

  villagers(p) {
    const out = [];
    for (const u of p.units) if (u.type === 'villager') out.push(u);
    return out;
  }

  army(p) {
    const out = [];
    for (const u of p.units) if (u.isMilitary && u.type !== 'villager') out.push(u);
    return out;
  }

  mainTC(p) {
    for (const b of p.buildings) if (b.type === 'towncenter' && b.built) return b;
    for (const b of p.buildings) if (b.type === 'towncenter') return b;
    return null;
  }

  /**
   * ¿Estamos ahorrando para subir de edad? Si ya hay aldeanos suficientes,
   * la prioridad absoluta es reunir el coste de la siguiente edad.
   */
  savingForAge(b) {
    const p = b.player;
    if (p.age >= 3) return false;
    const tc = this.mainTC(p);
    if (!tc || !tc.built) return false;
    if (tc.queue.some((q) => q.kind === 'age')) return false;
    if (this.villagers(p).length < AGE_MIN_VILLAGERS[p.age]) return false;
    return !p.canAfford(AGES[p.age + 1].cost);
  }

  /**
   * ¿Podemos permitirnos este gasto sin comernos lo reservado para la edad?
   * Sin esta regla el ahorro oscila justo por debajo del coste y nunca se llega.
   */
  spendOk(b, cost) {
    if (!this.savingForAge(b)) return true;
    const p = b.player;
    const need = AGES[p.age + 1].cost;
    for (const r of RESOURCES) {
      if (!cost[r] || !need[r]) continue;
      if (p.res[r] - cost[r] < need[r]) return false;
    }
    return true;
  }

  trainVillagers(b) {
    const p = b.player;
    const tc = this.mainTC(p);
    if (!tc || !tc.built) return;
    const target = this.game.difficulty.villagerTarget + p.age * 4;
    const count = this.villagers(p).length;
    const queued = tc.queue.filter((q) => q.kind === 'unit').length;
    if (count + queued >= target) return;
    if (tc.queue.length >= 3) return;
    if (p.pop >= p.popCap) return;
    if (p.res.food < 50) return;
    if (!this.spendOk(b, UNITS.villager.cost)) return;
    this.game.queueUnit(tc, 'villager', p);
  }

  buildHouses(b) {
    const p = b.player;
    if (p.popCap >= 200) return;
    const pending = p.countBuildings((x) => x.type === 'house' && !x.built);
    if (p.pop < p.popCap - 4 - pending * 5) return;
    if (p.res.wood < 25) return;
    if (pending >= 2) return;
    this.tryBuild(b, 'house');
  }

  buildEconomy(b) {
    const p = b.player, g = this.game;
    const has = (t) => p.countBuildings((x) => x.type === t);

    // Sin centro urbano no hay aldeanos, ni edades, ni almacén: reponerlo va
    // por delante de todo lo demás.
    if (!this.mainTC(p) && p.canAfford(BUILDINGS.towncenter.cost)) {
      const spot = this.findSpot(b, 'towncenter', b.base.x, b.base.y, 16);
      if (spot && this.build(b, 'towncenter', spot.x, spot.y)) return;
    }

    // Campamentos junto a los recursos que se están explotando.
    if (p.res.wood >= 100 && has('lumbercamp') < 1 + p.age) {
      const spot = this.resourceSpot(b, 'wood', 'lumbercamp');
      if (spot) { this.build(b, 'lumbercamp', spot.x, spot.y); return; }
    }
    if (p.res.wood >= 100 && has('miningcamp') < 1 + Math.min(2, p.age)) {
      const spot = this.resourceSpot(b, 'gold', 'miningcamp') || this.resourceSpot(b, 'stone', 'miningcamp');
      if (spot) { this.build(b, 'miningcamp', spot.x, spot.y); return; }
    }
    if (p.res.wood >= 100 && has('mill') < 1) { this.tryBuild(b, 'mill'); return; }

    // Granjas: fuente de comida estable a partir de la Feudal.
    const farms = p.countBuildings((x) => x.type === 'farm');
    const wantFarms = p.age === 0 ? 2 : 3 + p.age * 2;
    if (has('mill') && farms < wantFarms && p.res.wood >= 120) {
      const mill = [...p.buildings].find((x) => x.type === 'mill' && x.built) || this.mainTC(p);
      if (mill) {
        const spot = this.findSpot(b, 'farm', mill.cx, mill.cy, 6);
        if (spot) { this.build(b, 'farm', spot.x, spot.y); return; }
      }
    }
    // El mercado permite convertir excedentes en lo que falta (ver `trade`).
    if (p.age >= 1 && has('market') < 1 && p.res.wood >= 250) { this.tryBuild(b, 'market'); return; }
    // Un segundo centro urbano en la Edad de los Castillos.
    if (p.age >= 2 && has('towncenter') < 2 && p.res.wood >= 400 && p.res.stone >= 200) {
      const spot = this.findSpot(b, 'towncenter', b.base.x, b.base.y, 14);
      if (spot) this.build(b, 'towncenter', spot.x, spot.y);
    }
  }

  /** Busca un hueco cerca de un yacimiento del recurso indicado. */
  resourceSpot(b, res, buildingType) {
    const g = this.game, p = b.player;
    const node = g.findResourceNear(b.base.x, b.base.y, res, 26, p);
    if (!node) return null;
    // ¿Ya hay un almacén cerca?
    for (const bb of p.buildings) {
      const d = BUILDINGS[bb.type].dropoff;
      if (d && d.includes(res) && dist(bb.cx, bb.cy, node.x, node.y) < 7) return null;
    }
    return this.findSpot(b, buildingType, node.x, node.y, 4);
  }

  assignVillagers(b) {
    const g = this.game, p = b.player;
    const vils = this.villagers(p);
    if (!vils.length) return;
    const ratio = RATIOS[clamp(p.age, 0, 3)];
    const counts = { food: 0, wood: 0, gold: 0, stone: 0 };
    const idle = [];
    for (const v of vils) {
      // A los que están a resguardo por la campana no se les manda a trabajar
      // todavía: volverían derechos a la incursión.
      if (v.panicUntil > g.time) continue;
      const t = v.task;
      if (!t) { idle.push(v); continue; }
      if (t.type === 'build') continue;
      const tgt = t.type === 'gather' ? t.target : t.type === 'deliver' ? t.back : null;
      if (tgt) {
        const res = tgt.kind === 'building' ? 'food' : tgt.res;
        if (counts[res] !== undefined) counts[res]++;
      } else if (t.type === 'move') idle.push(v);
    }
    const working = counts.food + counts.wood + counts.gold + counts.stone;
    const total = Math.max(1, working + idle.length);

    // Recurso con mayor déficit.
    const deficit = (r) => ratio[r] - counts[r] / total;
    const order = RESOURCES.slice().sort((a, c) => deficit(c) - deficit(a));

    for (const v of idle) {
      let placed = false;
      for (const res of order) {
        const node = g.findResourceNear(v.x, v.y, res, 26, p, v);
        if (node) {
          v.stopTask();
          v.task = { type: 'gather', target: node };
          counts[res]++;
          placed = true;
          break;
        }
      }
      if (!placed) {
        const node = g.findResourceNear(v.x, v.y, 'wood', 40, p, v)
          || g.findResourceNear(v.x, v.y, 'food', 40, p, v);
        if (node) { v.stopTask(); v.task = { type: 'gather', target: node }; }
      }
    }

    // Reequilibrio suave y espaciado: mover aldeanos a menudo cuesta más de lo
    // que rinde, así que sólo se traslada uno de vez en cuando y sin carga.
    b.rebalanceCd = (b.rebalanceCd || 0) - 2.5;
    if (b.rebalanceCd > 0) return;
    b.rebalanceCd = 12;
    const worst = order[0], bestRes = order[order.length - 1];
    if (deficit(worst) > 0.14 && counts[bestRes] > 2) {
      for (const v of vils) {
        const t = v.task;
        if (!t || t.type !== 'gather' || !t.target || v.carry > 2) continue;
        const res = t.target.kind === 'building' ? 'food' : t.target.res;
        if (res !== bestRes) continue;
        const node = g.findResourceNear(v.x, v.y, worst, 30, p, v);
        if (node) { v.stopTask(); v.task = { type: 'gather', target: node }; break; }
      }
    }
  }

  /**
   * Mercado: se venden excedentes para completar lo que falta, que es lo que
   * hace la máquina en el juego original cuando se le atasca una edad o una
   * tanda de unidades por un solo recurso.
   */
  trade(b) {
    const g = this.game, p = b.player;
    if (!p.hasBuilding('market')) return;
    b.tradeCd -= 1;
    if (b.tradeCd > 0) return;
    b.tradeCd = 8;
    const need = p.age < 3 ? AGES[p.age + 1].cost : { gold: 500, food: 400 };
    for (const r of RESOURCES) {
      if ((p.res[r] || 0) >= (need[r] || 0)) continue;
      for (const s of RESOURCES) {
        // Sólo se vende lo que sobra de verdad, nunca lo que ya está reservado.
        if (s === r || s === 'gold' || p.res[s] < 400 + (need[s] || 0)) continue;
        g.tradeAt(p, s, 'sell');
        if (r !== 'gold') g.tradeAt(p, r, 'buy');
        return;
      }
    }
  }

  // --- Construcción ---------------------------------------------------------

  tryBuild(b, type) {
    const spot = this.findSpot(b, type, b.base.x, b.base.y, 13);
    if (spot) return this.build(b, type, spot.x, spot.y);
    return false;
  }

  build(b, type, tx, ty) {
    const g = this.game, p = b.player;
    if (!p.canAfford(BUILDINGS[type].cost)) return false;
    const builders = this.pickBuilders(b, tx, ty, type === 'towncenter' || type === 'castle' ? 3 : 2);
    const err = g.placeBuilding(type, tx, ty, p, builders);
    return !err;
  }

  pickBuilders(b, tx, ty, n) {
    const g = this.game;
    const list = this.villagers(b.player)
      .filter((v) => v.panicUntil <= g.time && (!v.task || v.task.type === 'gather' || v.task.type === 'move'))
      .sort((a, c) => dist(a.x, a.y, tx, ty) - dist(c.x, c.y, tx, ty));
    return list.slice(0, n);
  }

  /** Busca en espiral un lugar libre donde quepa el edificio con margen. */
  findSpot(b, type, cx, cy, radius) {
    const g = this.game, p = b.player;
    const size = BUILDINGS[type].size;
    const gap = type === 'farm' ? 0 : 1;
    cx = Math.round(cx); cy = Math.round(cy);
    for (let r = 2; r <= radius; r++) {
      const candidates = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          candidates.push([cx + dx - (size >> 1), cy + dy - (size >> 1)]);
        }
      }
      // Orden pseudoaleatorio estable para que no se amontonen en la misma dirección.
      candidates.sort(() => Math.random() - 0.5);
      for (const [tx, ty] of candidates) {
        if (!g.canPlace(type, tx, ty, p)) continue;
        let ok = true;
        for (let y = ty - gap; y < ty + size + gap && ok; y++) {
          for (let x = tx - gap; x < tx + size + gap; x++) {
            if (!g.map.inBounds(x, y)) { ok = false; break; }
            if (gap && !g.map.isBuildable(x, y)) { ok = false; break; }
          }
        }
        if (ok) return { x: tx, y: ty };
      }
    }
    return null;
  }

  // --- Tecnología y ejército ------------------------------------------------

  advanceAge(b) {
    const p = b.player;
    if (p.age >= 3) return;
    const tc = this.mainTC(p);
    if (!tc || !tc.built) return;
    if (tc.queue.some((q) => q.kind === 'age')) return;
    if (this.villagers(p).length < AGE_MIN_VILLAGERS[p.age]) return;
    this.game.queueAge(tc, p);
  }

  buildMilitary(b) {
    const p = b.player;
    const has = (t) => p.countBuildings((x) => x.type === t);
    if (p.res.wood < 175) return;
    // En la Edad Oscura la prioridad es la economía, salvo que nos ataquen.
    if (p.age === 0 && this.villagers(p).length < 11 && !b.defending) return;
    if (has('barracks') < 1) { this.tryBuild(b, 'barracks'); return; }
    if (p.age >= 1) {
      if (has('archeryrange') < 1) { this.tryBuild(b, 'archeryrange'); return; }
      if (has('stable') < 1) { this.tryBuild(b, 'stable'); return; }
      if (has('blacksmith') < 1 && p.res.wood >= 150) { this.tryBuild(b, 'blacksmith'); return; }
    }
    if (p.age >= 2) {
      if (has('barracks') + has('archeryrange') + has('stable') < 5) {
        const t = ['archeryrange', 'stable', 'barracks'][Math.floor(Math.random() * 3)];
        this.tryBuild(b, t); return;
      }
      if (has('siegeworkshop') < 1 && p.res.wood >= 200) { this.tryBuild(b, 'siegeworkshop'); return; }
      if (has('castle') < 1 && p.res.stone >= 650) {
        const spot = this.findSpot(b, 'castle', b.base.x, b.base.y, 12);
        if (spot) this.build(b, 'castle', spot.x, spot.y);
        return;
      }
    }
    // Torres defensivas.
    if (p.age >= 1 && p.res.stone >= 250 && has('tower') < 2 + p.age) {
      const tc = this.mainTC(p);
      if (tc) {
        const spot = this.findSpot(b, 'tower', tc.cx + (Math.random() - 0.5) * 12, tc.cy + (Math.random() - 0.5) * 12, 8);
        if (spot) this.build(b, 'tower', spot.x, spot.y);
      }
    }
  }

  trainArmy(b) {
    const p = b.player;
    if (p.pop >= p.popCap - 1) return;
    // No ahogar la economía inicial creando soldados demasiado pronto.
    if (p.age === 0 && this.villagers(p).length < 11 && !b.defending) return;
    const defending = b.defending;
    const mix = ARMY_MIX[clamp(p.age, 0, 3)];
    let siege = 0;
    for (const u of p.units) if (UNITS[u.type].class === 'siege') siege++;
    const producers = [...p.buildings].filter((x) => x.built && BUILDINGS[x.type].trains
      && x.type !== 'towncenter' && x.queue.length < 3);
    for (const prod of producers) {
      let options = BUILDINGS[prod.type].trains.filter((t) => p.unitAvailable(t) && mix.includes(t));
      // El asedio es caro, lento y ocupa el doble: unas pocas piezas bastan.
      if (siege >= SIEGE_CAP[clamp(p.age, 0, 3)]) {
        options = options.filter((t) => UNITS[t].class !== 'siege');
      }
      if (!options.length) continue;
      const type = this.pickUnit(b, options);
      const def = UNITS[type];
      if (!p.canAfford(def.cost)) continue;
      if (!defending && !this.spendOk(b, def.cost)) continue;
      if (this.game.queueUnit(prod, type, p) === null && def.class === 'siege') siege++;
    }
  }

  /**
   * Qué entrenar de entre lo que sabe hacer este edificio. Como en el juego
   * original se responde con la contra de lo que se le ha visto al enemigo:
   * lanceros a la caballería, guerrilleros a los arqueros, jinetes a los
   * arqueros... Mientras no se haya visto nada se reparte al azar, para no
   * empezar la partida con un ejército de un solo tipo.
   */
  pickUnit(b, options) {
    const seen = b.seen;
    const total = seen.infantry + seen.archer + seen.cavalry + seen.siege;
    if (total < 3) return options[Math.floor(Math.random() * options.length)];
    const weights = [];
    let sum = 0;
    for (const type of options) {
      const cls = UNITS[type].class;
      let score;
      if (cls === 'siege') {
        // El asedio no se elige por contras sino por necesidad: cuantas más
        // oleadas se hayan estrellado contra la base enemiga, más falta hace.
        score = 0.9 + Math.min(0.7, b.wave * 0.12);
      } else {
        score = 0;
        for (const k of ['infantry', 'archer', 'cavalry', 'siege']) {
          const share = seen[k] / total;
          score += share * (COUNTER_SCORE[cls][k] ?? 1);
          if (SPECIALIST[type] === k) score += share * 1.2;
        }
      }
      // Sorteo proporcional en vez de coger siempre el mejor: la contra sale
      // la mayoría de las veces, pero el ejército no acaba siendo de un solo
      // tipo, que es un punto ciego que el rival aprovecharía enseguida.
      const w = Math.max(0.05, score) ** 4;
      weights.push(w);
      sum += w;
    }
    let r = Math.random() * sum;
    for (let i = 0; i < options.length; i++) {
      r -= weights[i];
      if (r <= 0) return options[i];
    }
    return options[options.length - 1];
  }

  research(b) {
    const p = b.player;
    for (const bd of p.buildings) {
      if (!bd.built || bd.queue.length >= 2) continue;
      const list = BUILDINGS[bd.type].techs || [];
      for (const key of list) {
        const t = TECHS[key];
        if (p.techs.has(key) || p.age < t.age) continue;
        if (t.requires && !p.techs.has(t.requires)) continue;
        if (!p.canAfford(t.cost) || !this.spendOk(b, t.cost)) continue;
        if (this.game.queueTech(bd, key, p) === null) return;
      }
      for (const key in UPGRADES) {
        const up = UPGRADES[key];
        if (up.building !== bd.type || p.techs.has(key) || p.age < up.age) continue;
        if (!p.canAfford(up.cost) || !this.spendOk(b, up.cost)) continue;
        if (this.game.queueUpgrade(bd, key, p) === null) return;
      }
    }
  }

  // --- Exploración ----------------------------------------------------------

  /**
   * El jinete inicial recorre el mapa como en el juego original: primero se
   * asoma a las bases rivales —sin meterse debajo de sus torres— y después da
   * vueltas por el terreno. Sirve para descubrir el mapa y, sobre todo, para
   * ver con qué ejército cuenta el enemigo (ver `observe`). Si lo matan, no se
   * repone: los exploradores que salgan luego del establo son tropa de combate.
   */
  scoutMap(b) {
    const p = b.player;
    if (!b.scout) return;
    if (b.scout.dead || b.scout.owner !== p.id) { b.scout = null; return; }
    // En cuanto hay ejército de verdad, el explorador se suma a él.
    if (p.age >= 2) { b.scout = null; return; }
    const s = b.scout;
    // Mientras esté ocupado —de camino, o peleando porque le han salido al
    // paso— no se le da otra orden.
    if (s.task) return;
    if (!b.scoutRoute) b.scoutRoute = this.buildScoutRoute(b);
    if (!b.scoutRoute.length) { b.scout = null; return; }
    const spot = b.scoutRoute[b.scoutIdx % b.scoutRoute.length];
    b.scoutIdx++;
    s.task = { type: 'move', x: spot.x, y: spot.y };
  }

  buildScoutRoute(b) {
    const g = this.game, out = [];
    const S = g.map.size, c = S / 2;
    // Las salidas rivales, pero acercándose sólo hasta las afueras.
    g.map.starts.forEach((s, i) => {
      if (i === b.player.id) return;
      const dx = c - s.x, dy = c - s.y, d = Math.hypot(dx, dy) || 1;
      out.push({ x: clamp(s.x + (dx / d) * 9, 3, S - 4), y: clamp(s.y + (dy / d) * 9, 3, S - 4) });
    });
    // Y una vuelta al mapa para descubrir el terreno de en medio.
    const r = S * 0.33;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      out.push({ x: clamp(c + Math.cos(a) * r, 3, S - 4), y: clamp(c + Math.sin(a) * r, 3, S - 4) });
    }
    return out;
  }

  /**
   * Inteligencia militar: qué tipo de ejército tiene enfrente. Se cuenta lo que
   * ven los edificios y las tropas propias, y la memoria se desvanece poco a
   * poco, así que la IA reacciona a lo que el enemigo saca *ahora* y no a lo
   * que sacó al principio de la partida. Es la entrada de `pickUnit`.
   */
  observe(b) {
    const g = this.game, p = b.player;
    b.seenCd -= 1;
    if (b.seenCd > 0) return;
    b.seenCd = 3;
    for (const k in b.seen) b.seen[k] *= 0.82;
    // Cada enemigo cuenta una vez por vistazo, lo vean uno o veinte ojos.
    const counted = new Set();
    const scan = (x, y, r) => {
      for (const u of g.unitsNear(x, y, r)) {
        if (u.owner === p.id || u.dead || counted.has(u.id)) continue;
        counted.add(u.id);
        const cls = UNITS[u.type].class;
        if (b.seen[cls] !== undefined) b.seen[cls] += 1;
      }
    };
    for (const bd of p.buildings) if (bd.built) scan(bd.cx, bd.cy, BUILDINGS[bd.type].los);
    for (const u of p.units) if (u.isMilitary) scan(u.x, u.y, UNITS[u.type].los);
  }

  // --- Defensa --------------------------------------------------------------

  /**
   * Respuesta a las incursiones. A diferencia de un «todo el mundo al ataque»,
   * aquí sólo acude quien tiene la pelea cerca, la oleada que ya salió no da
   * media vuelta por una escaramuza y los aldeanos del entorno se ponen a
   * resguardo: es el comportamiento de la campana del juego original.
   */
  defend(b) {
    const g = this.game, p = b.player;
    let threat = null, threatD = Infinity;
    for (const bd of p.buildings) {
      const e = g.findEnemyNear(p.id, bd.cx, bd.cy, ALARM_RADIUS, true);
      if (!e) continue;
      const d = dist(bd.cx, bd.cy, e.x, e.y);
      if (d < threatD) { threatD = d; threat = e; }
    }
    b.threat = threat;
    if (!threat) {
      b.defending = false;
      b.threatCount = 0;
      this.repair(b);
      return;
    }
    b.defending = true;
    b.threatCount = g.findEnemiesNear(p.id, threat.x, threat.y, 12, 8).length;

    for (const u of this.army(p)) {
      // Las tropas que están en la oleada siguen a lo suyo salvo que la base
      // esté en serio peligro; volver por cada jinete que pasa es regalar el
      // ataque.
      if (b.attackers.has(u) && b.threatCount < 4) continue;
      if (dist(u.x, u.y, threat.x, threat.y) > DEFEND_RADIUS) continue;
      const t = u.task;
      if (t && t.type === 'attack' && t.target && !t.target.dead) continue;
      b.attackers.delete(u);
      u.stopTask();
      u.task = { type: 'attack', target: threat, guard: { x: u.x, y: u.y } };
    }

    this.ringBell(b, threat);
  }

  /**
   * La campana: los aldeanos que tienen la incursión encima sueltan lo que
   * estén haciendo y corren al centro urbano, donde las flechas del edificio
   * los cubren. Vuelven al trabajo solos pasado el susto (ver
   * `assignVillagers`).
   */
  ringBell(b, threat) {
    const g = this.game, p = b.player;
    // Sin centro urbano vale cualquier edificio en pie: lo que importa es no
    // quedarse a campo abierto delante del que ataca.
    const shelter = this.mainTC(p) || [...p.buildings].find((x) => x.built);
    if (!shelter) return;
    for (const v of this.villagers(p)) {
      if (dist(v.x, v.y, threat.x, threat.y) > BELL_RADIUS) continue;
      if (dist(v.x, v.y, shelter.cx, shelter.cy) < 3) continue;   // ya está a salvo
      v.panicUntil = g.time + PANIC_TIME;
      v.stopTask();
      v.task = {
        type: 'move',
        x: shelter.cx + (Math.random() - 0.5) * 4,
        y: shelter.cy + (Math.random() - 0.5) * 4,
      };
    }
  }

  /**
   * Reparaciones: pasada la incursión, un par de aldeanos arregla lo más
   * tocado. `doBuild` ya sabe reparar un edificio terminado que ha perdido
   * vida, así que basta con mandarlos.
   */
  repair(b) {
    const p = b.player;
    b.repairCd -= 1;
    if (b.repairCd > 0) return;
    b.repairCd = 4;
    let worst = null, worstFrac = 0.9;
    for (const bd of p.buildings) {
      if (!bd.built || bd.dead) continue;
      const frac = bd.hp / bd.maxHp;
      if (frac < worstFrac) { worstFrac = frac; worst = bd; }
    }
    if (!worst) return;
    let crew = 0;
    for (const v of this.villagers(p)) {
      if (v.task && v.task.type === 'build' && v.task.target === worst) crew++;
    }
    if (crew >= 2) return;
    for (const v of this.pickBuilders(b, worst.cx, worst.cy, 2 - crew)) {
      v.stopTask();
      v.task = { type: 'build', target: worst };
    }
  }

  // --- Militar --------------------------------------------------------------

  /** ¿Está ya metida en faena? A quien pelea no se le cambia la orden. */
  busy(u) {
    const t = u.task;
    if (!t) return false;
    if (t.type === 'attack') return !!t.target && !t.target.dead;
    return t.type === 'attackmove';
  }

  /**
   * Punto de reunión del ejército: a unas casillas del centro urbano en
   * dirección al centro del mapa. Es a donde apuntan los cuarteles y donde
   * espera la reserva, para salir en grupo y no de uno en uno.
   */
  stagingPoint(b) {
    const g = this.game;
    const tc = this.mainTC(b.player);
    const ox = tc ? tc.cx : b.base.x, oy = tc ? tc.cy : b.base.y;
    const c = g.map.size / 2;
    const dx = c - ox, dy = c - oy;
    const d = Math.hypot(dx, dy) || 1;
    const free = nearestFree(g.map, Math.round(ox + (dx / d) * 7), Math.round(oy + (dy / d) * 7), 10);
    return free ? { x: free.x + 0.5, y: free.y + 0.5 } : { x: ox, y: oy };
  }

  /**
   * Ciclo militar completo: se mantiene el punto de reunión, se lleva la oleada
   * en curso si la hay y, si no, se junta la reserva y se decide si ya toca
   * salir.
   */
  manageArmy(b) {
    const g = this.game, p = b.player;

    b.stagingCd -= 1;
    if (b.stagingCd <= 0) { b.stagingCd = 10; b.staging = this.stagingPoint(b); }
    this.setRallies(b);

    // Bajas y unidades que ya no son suyas fuera del grupo de asalto.
    for (const u of [...b.attackers]) if (u.dead || u.owner !== p.id) b.attackers.delete(u);
    if (b.attackers.size) { this.driveWave(b); return; }

    // Sin oleada en marcha: la reserva se concentra en el punto de reunión.
    const army = this.army(p);
    for (const u of army) {
      if (this.busy(u) || u === b.scout) continue;
      if (u.task) continue;
      if (dist(u.x, u.y, b.staging.x, b.staging.y) < 6) continue;
      u.task = {
        type: 'move',
        x: b.staging.x + (Math.random() - 0.5) * 5,
        y: b.staging.y + (Math.random() - 0.5) * 5,
      };
    }

    // Con la base bajo un ataque serio no se sale: primero la casa.
    if (b.defending && b.threatCount >= 3) return;
    const need = g.difficulty.armyTarget + b.wave * 4;
    if (b.attackTimer > 0 && army.length < need + 8) return;
    if (army.length < Math.max(4, need * 0.7)) return;
    this.launchWave(b);
  }

  /**
   * Los edificios militares apuntan al punto de reunión. Sin esto las unidades
   * recién entrenadas se quedaban plantadas en la puerta del cuartel hasta la
   * siguiente oleada.
   */
  setRallies(b) {
    const p = b.player, s = b.staging;
    for (const bd of p.buildings) {
      if (!bd.built || bd.type === 'towncenter') continue;
      if (!BUILDINGS[bd.type].trains) continue;
      if (bd.rally && dist(bd.rally.x, bd.rally.y, s.x, s.y) < 2) continue;
      bd.rally = { x: s.x, y: s.y };
    }
  }

  launchWave(b) {
    const g = this.game, p = b.player;
    const target = this.pickTarget(b, b.staging);
    if (!target) return;
    b.target = target;
    b.wave++;
    b.attackTimer = g.difficulty.attackEvery;
    b.retreating = false;
    b.reinforceCd = 12;
    b.attackers = new Set(this.army(p).filter((u) => u !== b.scout));
    b.waveSize = b.attackers.size;
    if (!b.waveSize) return;
    this.orderWave(b, target);
    if (g.ui && this.targetOwnerIsHuman(target)) g.ui.notify(`¡${p.name} lanza un ataque!`, 'bad');
  }

  orderWave(b, target) {
    const tx = target.cx ?? target.x, ty = target.cy ?? target.y;
    for (const u of b.attackers) {
      u.stopTask();
      u.task = { type: 'attackmove', x: tx, y: ty, ax: tx, ay: ty };
    }
  }

  /**
   * Conducción de la oleada, tick a tick. Es la pieza que faltaba: antes se
   * daba una sola orden al salir y, en cuanto el grupo llegaba a destino, se
   * quedaba parado junto a los edificios enemigos hasta la oleada siguiente.
   * Ahora, cada segundo:
   *  - a quien se ha quedado sin nada que hacer se le busca a quién atacar;
   *  - si el objetivo ya ha caído, se elige el siguiente desde donde está el
   *    grupo, no desde la base;
   *  - las tropas nuevas se suman a la oleada como refuerzos;
   *  - y si el grupo se ha deshecho, los supervivientes se retiran a casa.
   */
  driveWave(b) {
    const g = this.game, p = b.player;

    if (!b.retreating && b.attackers.size <= Math.max(1, Math.floor(b.waveSize * RETREAT_FRACTION))) {
      b.retreating = true;
      b.attackTimer = Math.max(b.attackTimer, g.difficulty.attackEvery * 0.6);
      for (const u of b.attackers) {
        u.stopTask();
        u.task = { type: 'move', x: b.staging.x, y: b.staging.y };
      }
    }
    if (b.retreating) {
      // En cuanto llegan a casa se disuelve el grupo y vuelven a la reserva.
      for (const u of [...b.attackers]) {
        if (!u.task || dist(u.x, u.y, b.staging.x, b.staging.y) < 8) b.attackers.delete(u);
      }
      return;
    }

    // Refuerzos: lo que se ha entrenado mientras tanto se suma al frente.
    b.reinforceCd -= 1;
    if (b.reinforceCd <= 0) {
      b.reinforceCd = 12;
      for (const u of this.army(p)) {
        if (b.attackers.has(u) || u === b.scout || this.busy(u)) continue;
        b.attackers.add(u);
      }
      b.waveSize = Math.max(b.waveSize, b.attackers.size);
    }

    const from = this.centroid(b);
    if (!b.target || b.target.dead) b.target = this.pickTarget(b, from);
    if (!b.target) { b.attackers.clear(); return; }
    const tx = b.target.cx ?? b.target.x, ty = b.target.cy ?? b.target.y;

    for (const u of b.attackers) {
      const t = u.task;
      if (t && t.type === 'attack' && t.target && !t.target.dead) continue;
      if (t && t.type === 'attackmove' && dist(u.x, u.y, t.x, t.y) > 3) continue;
      // Parado, o ya encima del objetivo: se le busca a quién pegar.
      const near = g.findAttackTarget(u, UNITS[u.type].los + 3);
      u.stopTask();
      u.task = near
        ? { type: 'attack', target: near }
        : { type: 'attackmove', x: tx, y: ty, ax: tx, ay: ty };
    }
  }

  /** Centro de masas de la oleada: desde ahí se elige el siguiente objetivo. */
  centroid(b) {
    let x = 0, y = 0, n = 0;
    for (const u of b.attackers) { x += u.x; y += u.y; n++; }
    return n ? { x: x / n, y: y / n } : b.staging;
  }

  targetOwnerIsHuman(t) {
    return t && t.owner === this.game.human.id;
  }

  /**
   * Siguiente edificio a derribar, medido desde `from`. Se va a por el centro
   * urbano y la producción militar antes que por las casas, se deja para el
   * final lo que sale caro de asaltar (torres, castillos, murallas) y, en
   * igualdad, se prefiere al jugador humano.
   */
  pickTarget(b, from) {
    const g = this.game, p = b.player;
    const origin = from || b.base;
    let best = null, bestScore = Infinity;
    for (const other of g.players) {
      if (other === p || other.defeated) continue;
      const bias = other.isHuman ? -20 : 0;
      for (const bd of other.buildings) {
        const d = dist(origin.x, origin.y, bd.cx, bd.cy);
        const score = d + (TARGET_BONUS[bd.type] || 0) + bias;
        if (score < bestScore) { bestScore = score; best = bd; }
      }
    }
    return best;
  }
}
