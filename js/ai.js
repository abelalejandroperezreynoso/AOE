// IA de los rivales: economía, expansión, tecnología y ataques por oleadas.

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
  ['knight', 'crossbowman', 'pikeman', 'longswordsman'],
  ['cavalier', 'arbalester', 'champion', 'knight', 'ram'],
];

export class AI {
  constructor(game) {
    this.game = game;
    this.brains = [];
    for (const p of game.players) {
      if (p.isHuman) { this.brains.push(null); continue; }
      p.gatherBonus = game.difficulty.bonus;
      this.brains.push({
        player: p,
        timer: Math.random() * 0.6,
        assignTimer: 0,
        attackTimer: game.difficulty.attackEvery * 0.45,
        wave: 0,
        base: game.map.starts[p.id] || { x: 20, y: 20 },
        farmSlots: 0,
        target: null,
        defending: false,
      });
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
    const g = this.game, p = b.player;
    this.defend(b);
    this.trainVillagers(b);
    this.buildHouses(b);
    this.buildMilitary(b);
    this.buildEconomy(b);
    this.advanceAge(b);
    this.trainArmy(b);
    this.research(b);
    this.manageAttack(b);
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
        const node = g.findResourceNear(v.x, v.y, res, 26, p);
        if (node) {
          v.stopTask();
          v.task = { type: 'gather', target: node };
          counts[res]++;
          placed = true;
          break;
        }
      }
      if (!placed) {
        const node = g.findResourceNear(v.x, v.y, 'wood', 40, p) || g.findResourceNear(v.x, v.y, 'food', 40, p);
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
        const node = g.findResourceNear(v.x, v.y, worst, 30, p);
        if (node) { v.stopTask(); v.task = { type: 'gather', target: node }; break; }
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
    const list = this.villagers(b.player)
      .filter((v) => !v.task || v.task.type === 'gather' || v.task.type === 'move')
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
    const producers = [...p.buildings].filter((x) => x.built && BUILDINGS[x.type].trains
      && x.type !== 'towncenter' && x.queue.length < 3);
    for (const prod of producers) {
      const options = BUILDINGS[prod.type].trains.filter((t) => p.unitAvailable(t) && mix.includes(t));
      if (!options.length) continue;
      const type = options[Math.floor(Math.random() * options.length)];
      const def = UNITS[type];
      if (!p.canAfford(def.cost)) continue;
      if (!defending && !this.spendOk(b, def.cost)) continue;
      this.game.queueUnit(prod, type, p);
    }
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

  // --- Militar --------------------------------------------------------------

  defend(b) {
    const g = this.game, p = b.player;
    let threat = null, threatD = Infinity;
    for (const bd of p.buildings) {
      const e = g.findEnemyNear(p.id, bd.cx, bd.cy, 11, true);
      if (e) {
        const d = dist(bd.cx, bd.cy, e.x, e.y);
        if (d < threatD) { threatD = d; threat = e; }
      }
    }
    if (!threat) { b.defending = false; return; }
    b.defending = true;
    const army = this.army(p);
    for (const u of army) {
      if (u.task && u.task.type === 'attack' && u.task.target && !u.task.target.dead) continue;
      if (dist(u.x, u.y, threat.x, threat.y) < 40) {
        u.task = { type: 'attack', target: threat };
      }
    }
    // Los aldeanos cercanos huyen hacia el centro urbano.
    const tc = this.mainTC(p);
    if (tc) {
      for (const v of this.villagers(p)) {
        if (dist(v.x, v.y, threat.x, threat.y) < 5 && (!v.task || v.task.type === 'gather')) {
          v.task = { type: 'move', x: tc.cx + (Math.random() - 0.5) * 4, y: tc.cy + (Math.random() - 0.5) * 4 };
        }
      }
    }
  }

  manageAttack(b) {
    const g = this.game, p = b.player;
    if (b.defending) return;
    const army = this.army(p);
    const need = g.difficulty.armyTarget + b.wave * 4;
    if (b.attackTimer > 0 && army.length < need + 8) return;
    if (army.length < Math.max(4, need * 0.7)) return;

    // Elige objetivo: el enemigo con la base más cercana.
    if (!b.target || b.target.dead) b.target = this.pickTarget(b);
    if (!b.target) return;
    b.wave++;
    b.attackTimer = g.difficulty.attackEvery;
    const tx = b.target.cx ?? b.target.x, ty = b.target.cy ?? b.target.y;
    for (const u of army) {
      u.stopTask();
      u.task = { type: 'attackmove', x: tx, y: ty };
    }
    if (p.id !== g.human.id && g.ui) {
      const enemyIsHuman = this.targetOwnerIsHuman(b.target);
      if (enemyIsHuman) g.ui.notify(`¡${p.name} lanza un ataque!`, 'bad');
    }
  }

  targetOwnerIsHuman(t) {
    return t && t.owner === this.game.human.id;
  }

  pickTarget(b) {
    const g = this.game, p = b.player;
    let best = null, bestScore = Infinity;
    for (const other of g.players) {
      if (other === p || other.defeated) continue;
      for (const bd of other.buildings) {
        const d = dist(b.base.x, b.base.y, bd.cx, bd.cy);
        const priority = bd.type === 'towncenter' ? -25 : ['barracks', 'archeryrange', 'stable'].includes(bd.type) ? -10 : 0;
        const score = d + priority + (other.isHuman ? -20 : 0);
        if (score < bestScore) { bestScore = score; best = bd; }
      }
    }
    return best;
  }
}
