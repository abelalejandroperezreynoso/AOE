// Lector de USDZ (el formato 3D de Apple y Pixar) sin librerías.
//
// Un .usdz es un .zip sin comprimir con la escena dentro, en texto (.usda) o,
// como la exporta Gravity Sketch, en binario (.usdc, el formato «Crate»).
// Aquí sólo se lee lo binario, y sólo lo que hace falta para pintar: el árbol
// de nodos con sus nombres (las capas de Gravity Sketch son las poses), las
// mallas con sus vértices, caras y normales, las transformaciones, qué
// material lleva cada malla y el color de cada material.
//
// El formato, a grandes rasgos: una cabecera con la versión y un índice de
// secciones. TOKENS son todas las palabras del archivo (nombres, tipos),
// comprimidas; FIELDS, pares nombre-valor; FIELDSETS, listas de campos;
// PATHS, el árbol de rutas (/Aldeano/quieto/pieza.points); SPECS, qué
// campos tiene cada ruta. Los valores pequeños van dentro del propio campo
// («inline») y los grandes, como las listas de vértices, en otra parte del
// archivo, a la que el campo apunta.

// --- Descompresión -------------------------------------------------------------

/** LZ4 en bloque (sin cabecera de trama), el que usa USD por debajo. */
function lz4(src, tam) {
  const out = new Uint8Array(tam);
  let i = 0, o = 0;
  while (i < src.length) {
    const tok = src[i++];
    let lit = tok >> 4;
    if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255); }
    out.set(src.subarray(i, i + lit), o);
    i += lit; o += lit;
    if (i >= src.length) break;
    const desp = src[i] | (src[i + 1] << 8);
    i += 2;
    let lon = tok & 15;
    if (lon === 15) { let b; do { b = src[i++]; lon += b; } while (b === 255); }
    lon += 4;
    for (let k = 0; k < lon; k++, o++) out[o] = out[o - desp];
  }
  return out.subarray(0, o);
}

/**
 * La compresión de USD (TfFastCompression): un byte con el número de trozos;
 * cero es un solo bloque LZ4, y si no, cada trozo va precedido de su tamaño.
 */
function descomprimir(src, tam) {
  const n = src[0];
  if (n === 0) return lz4(src.subarray(1), tam);
  const out = new Uint8Array(tam);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let i = 1, o = 0;
  for (let k = 0; k < n; k++) {
    const t = dv.getInt32(i, true);
    i += 4;
    const trozo = lz4(src.subarray(i, i + t), tam - o);
    out.set(trozo, o);
    o += trozo.length; i += t;
  }
  return out.subarray(0, o);
}

/**
 * Enteros comprimidos: tras el LZ4, un valor común, dos bits por entero que
 * dicen si es ese valor o cuántos bytes ocupa, y los enteros. Cada uno es la
 * diferencia con el anterior. `ancho` es 4 (int32) u 8 (int64).
 */
function decodificarEnteros(buf, n, ancho) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Array(n);
  const comun = ancho === 4 ? dv.getInt32(0, true) : Number(dv.getBigInt64(0, true));
  let codigos = ancho, datos = ancho + ((n * 2 + 7) >> 3);
  let previo = 0;
  for (let k = 0; k < n; k++) {
    const c = (buf[codigos + (k >> 2)] >> ((k & 3) * 2)) & 3;
    let d;
    if (c === 0) d = comun;
    else if (ancho === 4) {
      if (c === 1) { d = dv.getInt8(datos); datos += 1; }
      else if (c === 2) { d = dv.getInt16(datos, true); datos += 2; }
      else { d = dv.getInt32(datos, true); datos += 4; }
    } else if (c === 1) { d = dv.getInt16(datos, true); datos += 2; }
    else if (c === 2) { d = dv.getInt32(datos, true); datos += 4; }
    else { d = Number(dv.getBigInt64(datos, true)); datos += 8; }
    previo += d;
    out[k] = previo;
  }
  return out;
}

// Tamaño máximo que ocupa comprimir n enteros, para reservar el búfer.
const tamEnteros = (n, ancho) => ancho + ((n * 2 + 7) >> 3) + n * ancho;

// --- Lectura del Crate -----------------------------------------------------------

// Tipos de valor que se usan aquí (el número es el de USD).
const T = {
  Bool: 1, UChar: 2, Int: 3, UInt: 4, Int64: 5, UInt64: 6, Half: 7, Float: 8, Double: 9,
  String: 10, Token: 11, AssetPath: 12, Matrix4d: 15, Vec2f: 20, Vec3d: 23, Vec3f: 24,
  Dictionary: 31, TokenListOp: 32, PathListOp: 34, PathVector: 40, TokenVector: 41,
  Specifier: 42, Variability: 44,
};

class Crate {
  constructor(bytes) {
    this.b = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magia = new TextDecoder().decode(bytes.subarray(0, 8));
    if (magia !== 'PXR-USDC') throw new Error('No es un USD binario');
    this.version = [bytes[8], bytes[9], bytes[10]];
    if (this.version[0] === 0 && this.version[1] < 4) throw new Error(`USD ${this.version.join('.')}: versión demasiado antigua`);
    const toc = this.u64(16);
    const n = this.u64(toc);
    this.secciones = {};
    for (let k = 0; k < n; k++) {
      const p = toc + 8 + k * 32;
      const nombre = new TextDecoder().decode(bytes.subarray(p, p + 16)).replace(/\0.*$/, '');
      this.secciones[nombre] = { ini: this.u64(p + 16), tam: this.u64(p + 24) };
    }
    this.leerTokens();
    this.leerStrings();
    this.leerFields();
    this.leerFieldSets();
    this.leerPaths();
    this.leerSpecs();
  }

  u64(p) { return Number(this.dv.getBigUint64(p, true)); }
  i64(p) { return Number(this.dv.getBigInt64(p, true)); }

  /** Una lista de enteros comprimidos en `p`: su tamaño y los datos. */
  enteros(p, n, ancho = 4) {
    const tamC = this.u64(p);
    const buf = descomprimir(this.b.subarray(p + 8, p + 8 + tamC), tamEnteros(n, ancho));
    return { valores: decodificarEnteros(buf, n, ancho), fin: p + 8 + tamC };
  }

  leerTokens() {
    const s = this.secciones.TOKENS;
    const n = this.u64(s.ini), tam = this.u64(s.ini + 8), tamC = this.u64(s.ini + 16);
    const buf = descomprimir(this.b.subarray(s.ini + 24, s.ini + 24 + tamC), tam);
    this.tokens = new TextDecoder().decode(buf).split('\0').slice(0, n);
  }

  leerStrings() {
    const s = this.secciones.STRINGS;
    const n = this.u64(s.ini);
    this.strings = [];
    for (let k = 0; k < n; k++) this.strings.push(this.dv.getUint32(s.ini + 8 + k * 4, true));
  }

  leerFields() {
    const s = this.secciones.FIELDS;
    const n = this.u64(s.ini);
    const { valores: toks, fin } = this.enteros(s.ini + 8, n);
    const tamC = this.u64(fin);
    const reps = descomprimir(this.b.subarray(fin + 8, fin + 8 + tamC), n * 8);
    const dv = new DataView(reps.buffer, reps.byteOffset, reps.byteLength);
    this.fields = toks.map((t, k) => ({ nombre: this.tokens[t], rep: dv.getBigUint64(k * 8, true) }));
  }

  leerFieldSets() {
    const s = this.secciones.FIELDSETS;
    const n = this.u64(s.ini);
    this.fieldSets = this.enteros(s.ini + 8, n).valores;
  }

  leerPaths() {
    const s = this.secciones.PATHS;
    const total = this.u64(s.ini);
    const n = this.u64(s.ini + 8);
    const a = this.enteros(s.ini + 16, n);
    const e = this.enteros(a.fin, n);
    const j = this.enteros(e.fin, n);
    const indices = a.valores, elementos = e.valores, saltos = j.valores;
    this.paths = new Array(total);
    // El árbol va en preorden: cada entrada dice si tiene hijos (vienen
    // detrás) y a cuánto está su siguiente hermano.
    const pila = [[0, null]];
    while (pila.length) {
      let [i, padre] = pila.pop();
      for (;;) {
        const k = i++;
        let ruta;
        if (padre === null) ruta = { ruta: '/', nombre: '', prim: true, padre: null };
        else {
          const t = elementos[k], prim = t >= 0;
          const nombre = this.tokens[Math.abs(t)];
          ruta = { ruta: prim ? (padre.ruta === '/' ? `/${nombre}` : `${padre.ruta}/${nombre}`) : `${padre.ruta}.${nombre}`, nombre, prim, padre };
        }
        this.paths[indices[k]] = ruta;
        const hijo = saltos[k] > 0 || saltos[k] === -1;
        const hermano = saltos[k] >= 0;
        if (hijo) {
          if (hermano) pila.push([k + saltos[k], padre]);
          padre = ruta;
        } else if (!hermano) break;
      }
    }
  }

  leerSpecs() {
    const s = this.secciones.SPECS;
    const n = this.u64(s.ini);
    const p = this.enteros(s.ini + 8, n);
    const f = this.enteros(p.fin, n);
    const t = this.enteros(f.fin, n);
    this.specs = p.valores.map((pi, k) => ({ ruta: this.paths[pi], campos: this.camposDe(f.valores[k]), tipo: t.valores[k] }));
  }

  /** Los campos de un fieldset: índices seguidos hasta un −1. */
  camposDe(ini) {
    const out = {};
    for (let k = ini; k < this.fieldSets.length && this.fieldSets[k] !== -1; k++) {
      const f = this.fields[this.fieldSets[k]];
      out[f.nombre] = f.rep;
    }
    return out;
  }

  // --- Valores ---------------------------------------------------------------

  /** El valor de un campo a partir de su «ValueRep» de 64 bits. */
  valor(rep) {
    const esLista = (rep >> 63n) & 1n, enLinea = (rep >> 62n) & 1n, comprimido = (rep >> 61n) & 1n;
    const tipo = Number((rep >> 48n) & 0xffn);
    const carga = Number(rep & 0xffffffffffffn);
    if (enLinea) return this.enLinea(tipo, carga);
    if (esLista) return this.lista(tipo, carga, !!comprimido);
    const p = carga;
    switch (tipo) {
      case T.Matrix4d: return [...Array(16)].map((_, k) => this.dv.getFloat64(p + k * 8, true));
      case T.Vec3f: return [0, 1, 2].map((k) => this.dv.getFloat32(p + k * 4, true));
      case T.Vec3d: return [0, 1, 2].map((k) => this.dv.getFloat64(p + k * 8, true));
      case T.Double: return this.dv.getFloat64(p, true);
      case T.Int64: return this.i64(p);
      case T.TokenVector: {
        const n = this.u64(p);
        return [...Array(n)].map((_, k) => this.tokens[this.dv.getUint32(p + 8 + k * 4, true)]);
      }
      case T.PathListOp: return this.listaDeRutas(p);
      default: return undefined;
    }
  }

  enLinea(tipo, carga) {
    switch (tipo) {
      case T.Bool: case T.UChar: case T.Specifier: case T.Variability: case T.UInt: return carga >>> 0;
      case T.Int: return carga | 0;
      case T.Float: { const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, carga >>> 0, true); return dv.getFloat32(0, true); }
      case T.Double: { const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, carga >>> 0, true); return dv.getFloat32(0, true); }
      case T.Token: return this.tokens[carga >>> 0];
      case T.String: return this.tokens[this.strings[carga >>> 0]];
      case T.Vec3f: case T.Vec3d: {
        // Tres enteros de un byte con signo.
        const v = [carga & 0xff, (carga >> 8) & 0xff, (carga >> 16) & 0xff];
        return v.map((x) => (x > 127 ? x - 256 : x));
      }
      case T.Matrix4d: {
        // Sólo la diagonal, cuatro enteros de un byte.
        const d = [carga & 0xff, (carga >> 8) & 0xff, (carga >> 16) & 0xff, (carga >> 24) & 0xff].map((x) => (x > 127 ? x - 256 : x));
        return [d[0], 0, 0, 0, 0, d[1], 0, 0, 0, 0, d[2], 0, 0, 0, 0, d[3]];
      }
      default: return undefined;
    }
  }

  lista(tipo, p, comprimido) {
    const n = this.u64(p);
    const ini = p + 8;
    if (n === 0) return [];
    if ((tipo === T.Int || tipo === T.UInt) && comprimido) return this.enteros(ini, n, 4).valores;
    if ((tipo === T.Int64 || tipo === T.UInt64) && comprimido) return this.enteros(ini, n, 8).valores;
    if ((tipo === T.Float || tipo === T.Double) && comprimido) {
      const codigo = String.fromCharCode(this.b[ini]);
      if (codigo === 'i') return this.enteros(ini + 1, n, 4).valores;
      const tamTabla = this.dv.getUint32(ini + 1, true);
      const tabla = [];
      for (let k = 0; k < tamTabla; k++) tabla.push(tipo === T.Float ? this.dv.getFloat32(ini + 5 + k * 4, true) : this.dv.getFloat64(ini + 5 + k * 8, true));
      const idx = this.enteros(ini + 5 + tamTabla * (tipo === T.Float ? 4 : 8), n, 4).valores;
      return idx.map((k) => tabla[k]);
    }
    switch (tipo) {
      case T.Int: return [...Array(n)].map((_, k) => this.dv.getInt32(ini + k * 4, true));
      case T.UInt: return [...Array(n)].map((_, k) => this.dv.getUint32(ini + k * 4, true));
      case T.Float: return [...Array(n)].map((_, k) => this.dv.getFloat32(ini + k * 4, true));
      case T.Vec3f: {
        const out = new Array(n);
        for (let k = 0; k < n; k++) out[k] = [this.dv.getFloat32(ini + k * 12, true), this.dv.getFloat32(ini + k * 12 + 4, true), this.dv.getFloat32(ini + k * 12 + 8, true)];
        return out;
      }
      case T.Token: return [...Array(n)].map((_, k) => this.tokens[this.dv.getUint32(ini + k * 4, true)]);
      default: return undefined;
    }
  }

  /** Una lista de rutas con sus operaciones (los destinos de una relación). */
  listaDeRutas(p) {
    const cab = this.b[p];
    let q = p + 1;
    const rutas = [];
    // Explícitas, añadidas, antepuestas, pospuestas, borradas y ordenadas,
    // en ese orden, cada una sólo si su bit está puesto.
    for (const bit of [2, 4, 32, 64, 8, 16]) {
      if (!(cab & bit)) continue;
      const n = this.u64(q);
      q += 8;
      for (let k = 0; k < n; k++, q += 4) {
        const r = this.paths[this.dv.getUint32(q, true)];
        if (bit !== 8 && r) rutas.push(r.ruta);
      }
    }
    return rutas;
  }
}

// --- De la escena a mallas ------------------------------------------------------

// El color de USD va en luz lineal; los .obj y la pantalla, en sRGB.
const aSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const multiplica = (a, b) => {
  // Matrices 4×4 de USD: por filas, y los puntos se multiplican por la
  // izquierda (p · M), con la traslación en la última fila.
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
};
const IDENTIDAD = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Lee un USD binario y devuelve { eje, capas: { nombre: { V, N, tris,
 * materiales } } } con el formato de `leerModelo` de modelo3d.js. Las capas
 * son los hijos del nodo principal (en Gravity Sketch, las capas); cada una,
 * con todas sus mallas juntas y ya transformadas.
 */
export function leerUsdc(bytes) {
  const c = new Crate(bytes);
  const porRuta = new Map();
  for (const s of c.specs) porRuta.set(s.ruta.ruta, s);
  const campo = (ruta, nombre) => {
    const s = porRuta.get(ruta);
    return s && s.campos[nombre] !== undefined ? c.valor(s.campos[nombre]) : undefined;
  };
  const tipo = (ruta) => campo(ruta, 'typeName');
  const hijos = (ruta) => campo(ruta, 'primChildren') || [];
  const unir = (padre, n) => (padre === '/' ? `/${n}` : `${padre}/${n}`);

  const eje = String(campo('/', 'upAxis') || 'Y').toLowerCase();
  const principal = campo('/', 'defaultPrim') || hijos('/')[0];
  if (!principal) throw new Error('El USD está vacío');
  const raiz = `/${principal}`;

  // Color de cada material: el diffuseColor de su sombreador.
  const colores = new Map();
  for (const s of c.specs) {
    if (!s.ruta.prim || c.valor(s.campos.typeName ?? 0n) !== 'Material') continue;
    for (const h of hijos(s.ruta.ruta)) {
      const d = campo(`${unir(s.ruta.ruta, h)}.inputs:diffuseColor`, 'default');
      if (Array.isArray(d)) colores.set(s.ruta.ruta, d.map(aSrgb));
    }
  }

  const matriz = (ruta) => campo(`${ruta}.xformOp:transform`, 'default') || IDENTIDAD;

  // Las mallas de un nodo y de todo lo que cuelga de él, con su matriz.
  const mallas = (ruta, M, out) => {
    const Mi = multiplica(matriz(ruta), M);
    if (tipo(ruta) === 'Mesh') out.push([ruta, Mi]);
    for (const h of hijos(ruta)) mallas(unir(ruta, h), Mi, out);
    return out;
  };

  const Mraiz = multiplica(matriz(raiz), IDENTIDAD);
  const capas = {};
  const hijosRaiz = hijos(raiz).filter((h) => tipo(unir(raiz, h)) !== 'Scope');
  // Si el nodo principal tiene mallas sueltas, van en una capa sin nombre.
  const grupos = hijosRaiz.length ? hijosRaiz.map((h) => [h, unir(raiz, h)]) : [['', raiz]];
  for (const [nombre, ruta] of grupos) {
    const V = [], N = [], tris = [];
    const materiales = {};
    for (const [malla, M] of mallas(ruta, Mraiz, [])) {
      const pts = campo(`${malla}.points`, 'default') || [];
      const cuentas = campo(`${malla}.faceVertexCounts`, 'default') || [];
      const indices = campo(`${malla}.faceVertexIndices`, 'default') || [];
      const normales = campo(`${malla}.normals`, 'default') || [];
      const enlace = campo(`${malla}.material:binding`, 'targetPaths');
      const mat = enlace && enlace[0];
      const nombreMat = mat ? mat.split('/').pop() : 'gris';
      if (!materiales[nombreMat]) materiales[nombreMat] = { kd: colores.get(mat) || [0.7, 0.7, 0.7] };
      const base = V.length;
      for (const [x, y, z] of pts) {
        V.push([x * M[0] + y * M[4] + z * M[8] + M[12], x * M[1] + y * M[5] + z * M[9] + M[13], x * M[2] + y * M[6] + z * M[10] + M[14]]);
      }
      // Normales por vértice o por esquina de cara, giradas con la malla.
      const nBase = N.length;
      for (const [x, y, z] of normales) N.push([x * M[0] + y * M[4] + z * M[8], x * M[1] + y * M[5] + z * M[9], x * M[2] + y * M[6] + z * M[10]]);
      const porEsquina = normales.length === indices.length && normales.length !== pts.length;
      let k = 0;
      for (const n of cuentas) {
        const esq = [];
        for (let e = 0; e < n; e++, k++) {
          const ni = normales.length ? nBase + (porEsquina ? k : indices[k]) : -1;
          esq.push([base + indices[k], ni]);
        }
        for (let e = 1; e + 1 < esq.length; e++) tris.push({ p: [esq[0], esq[e], esq[e + 1]], mat: nombreMat });
      }
    }
    if (tris.length) capas[nombre] = { V, N, tris, materiales };
  }
  if (!Object.keys(capas).length) throw new Error('El USD no tiene mallas');
  return { eje, capas };
}
