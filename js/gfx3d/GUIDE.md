# Guía del arte 3D pre-renderizado

Cómo está montado el sistema de modelos y cómo trabajar sobre él: retocar un
modelo concreto, subirle el detalle o igualarlo a una imagen de referencia.

## La idea en una frase

Cada unidad, edificio y recurso es un **modelo 3D de triángulos construido por
código** (`units.js`, `buildings.js`, `nodes.js`) que el motor (`engine.js`)
**hornea a un sprite isométrico 2D** con luz, sombra y contorno, una sola vez
por combinación de tipo/color/orientación/fotograma. El juego en marcha sólo
copia mapas de bits; el coste de un modelo detallado se paga al hornear, no por
fotograma. Un modelo puede tener miles de triángulos sin que la partida lo note.

## Sistema de coordenadas

- **x, y**: ejes del suelo, en casillas. +x es "abajo-derecha" en pantalla,
  +y "abajo-izquierda". **z**: altura, en la misma unidad de longitud (un cubo
  `1×1×1` se ve como un cubo).
- Proyección: `pantalla_x = (x−y)·32`, `pantalla_y = (x+y)·16 − z·39`. La cámara
  es la dimétrica 2:1 del juego; los sprites encajan en la rejilla sin ajustes.
- **Origen del modelo = punto de anclaje del sprite**: los pies de la unidad,
  la esquina (0,0) de la huella del edificio (que va de `(0,0)` a `(s,s)`
  casillas), el centro del rombo del recurso.
- Alturas de referencia: un soldado mide ~1.05 (≈41 px), un caballo con jinete
  ~1.35, una casa con tejado ~1.7, el castillo ~3.5.
- La cara `+x` y la cara `+y` de una caja son las dos que ve la cámara; las
  "calcomanías" (puertas, ventanas, saeteras) van sobre esas caras.

## Luz, sombra y acabado (engine.js)

- Sol alto por la derecha de pantalla (`SUN`): techos a plena luz, caras `+x` a
  media luz, caras `+y` en penumbra (sólo ambiente). `AMBIENT`/`DIFFUSE`
  gradúan el contraste.
- La **sombra arrojada** es independiente de la luz, como en el clásico:
  `SHADOW_DX/DY` la tiran hacia abajo-izquierda, acortada.
- El horneado rasteriza con z-buffer a `res`× (2× en juego) con sobremuestreo
  2×, endurece el borde a un bit, oscurece el perfil (contorno) y cuantiza
  ligeramente el color. Ese pos-proceso es el "look SLP"; no intentes imitarlo
  desde los modelos.
- La profundidad crece alejándose de la cámara: `depth = −0.61(x+y) − 0.50z`.
  Si algo "se mete dentro" de otra cosa, revisa solapes reales de geometría; si
  es una calcomanía sobre una cara, dale `bias`.

## Primitivas y banderas

Todas añaden triángulos a un array `out` y aceptan color `'#rrggbb'` o `[r,g,b]`:

| Primitiva | Para qué |
| --- | --- |
| `box(out, cx, cy, z0, w, d, h, color, {yaw})` | cajas; muros, torsos, yelmos |
| `cyl(out, cx, cy, z0, r0, r1, h, color, {seg})` | cilindros/conos; torres, troncos |
| `sphere(out, cx, cy, cz, r, color, {rings, seg, flat})` | cabezas, follaje, rocas |
| `lathe(out, cx, cy, perfil, color, {seg, squash})` | revolución de un perfil `[r,z]`; barriles, copas |
| `limb(out, a, b, r, color, {r2})` | caja orientada entre dos puntos; brazos, lanzas, vigas |
| `tube(out, puntos, r, color)` | cadena de tramos con juntas; cuerdas, arcos, ramas |
| `wheel(out, cx, cy, cz, r, th, color, {axis})` | discos de eje horizontal; ruedas, aspas, escudos |
| `quad / tri` | caras sueltas; tejados, calcomanías |

Transformaciones (mutan): `translate`, `rotZ`, `rotX`, `rotY`, `scaleMesh`.
`mirrorY(tris)` devuelve una copia espejada (modela una mitad y dóblala).

Banderas por cara: `unlit` (sin luz: brasas, gemas), `noshadow` (no arroja
sombra: detalles finos, para no ensuciar la silueta de la sombra), `bias`
(gana profundidad a la cara en que se apoya: calcomanías), `rough` (varía el
tono al azar: follaje, roca, bálago — usa `srand(semilla)` antes para que el
horneado sea repetible).

## Dónde vive cada cosa

- `units.js`: tabla `SPEC` (yelmo, armadura, arma, escudo, montura...) y piezas
  paramétricas (`torso`, `headAndHelm`, armas...). Para cambiar el diseño de
  una unidad casi siempre basta tocar `SPEC` o una pieza; el andar, el ataque y
  las 8 orientaciones salen gratis. Fotogramas: 0–3 andar (0 vale de reposo),
  4 preparación, 5 golpe; la postura la da `stance(f)`.
- `buildings.js`: un constructor por edificio en `BUILDERS`, sobre un kit común
  (`walls`, `gableRoof`, `hipRoof`, `battlements`, `roundTower`, `flag`,
  `scaffold`, `foundation`...). Cada constructor recibe `(out, s, M, C, stage)`:
  tamaño en casillas, colores del catálogo (`M`), color del jugador (`C`) y
  etapa de obra (0 cimientos, 1 a medias, 2 terminado).
- `parts.js`: el vocabulario del **taller de edificios**. El modelo con el que
  el jugador re-viste un edificio no es código sino **datos**: a qué edificio
  viste (`target`) y una lista de piezas (`{k, x, y, z, ...}`) que `designParts`
  convierte en malla con las mismas primitivas y el mismo kit de obra que
  `buildings.js`. Añadir una pieza nueva es meter una entrada en `PARTS` con sus
  campos y su `build()`; el editor monta sus controles y el validador la recorta
  solo, a partir de la tabla `FIELDS`. El catálogo va partido en **básicas** —un
  solo cuerpo, `BASICAS`— y **compuestas** —varias en una—; las básicas salen
  delante en el taller, porque son con las que se hace el detalle. Los cuerpos
  que el kit de obra no traía (cuña, tubo, bóveda, arco, aro) se arman aquí
  mismo, centrados en el origen y apoyados en z=0, y terminan en `place()`, que
  los gira y los lleva a su sitio. Si la pieza no es un cuerpo sino varios
  —las almenas, la escalinata, la cerca—, dale además un `explode(p)` que
  devuelva las piezas sueltas que dibujan lo mismo: es lo que deja al jugador
  tocarlas una a una desde el taller. Comprueba que la caja y el número de
  triángulos no cambien al descomponer, y si algo se pierde por el camino
  (la saetera del torreón, que es un hueco pintado y no un cuerpo), dilo en
  `explodeNota`.
- `nodes.js`: árboles, minas, bayas y animales; `variant` siembra el azar para
  que cada ejemplar sea distinto y siempre el mismo; `depleted` lo muestra
  menguado.
- Los colores editables del catálogo están en `js/data/appearance.js` (`LOOK`);
  los modelos los leen en el momento de hornear, así que el catálogo re-hornea
  con `clearSpriteCaches()` y todo se actualiza solo. Si añades un material
  nuevo a un modelo, dale una entrada en `LOOK` para que sea editable.

## Flujo de trabajo para retocar un modelo

1. Arranca el servidor: `npm start`.
2. Abre el **visor**: `http://localhost:8000/tools/viewer.html?kind=unit&type=knight&zoom=6`.
   Muestra el detalle a cualquier zoom y la rejilla completa (8 orientaciones ×
   6 fotogramas, o etapas, o variantes). "Volver a hornear" recarga tras editar.
3. Edita el modelo, recarga, repite. Con Playwright se automatiza:
   `node tools/snapshot-models.mjs shots knight` captura la rejilla a PNG.
4. Para **igualar una imagen de referencia**: cárgala en el visor (control
   "Referencia"), ajusta opacidad y escala, y arrástrala sobre el detalle para
   compararla superpuesta con el sprite.

Para los edificios hay además el **taller** del propio juego (menú principal →
Taller de edificios): se elige un edificio del juego y se le coloca otro modelo
pieza a pieza sobre su huella, con la vista en vivo a la izquierda y las tres
etapas horneadas debajo. No da de alta edificios: sólo les cambia la cara, así
que la tabla `BUILDINGS` no se mueve. Tiene la misma idea de la imagen de
referencia que el visor, en el menú **Guía**: se pone debajo del modelo, con su
opacidad y su tamaño, y se calca encima. El visor de modelos enseña lo que salga
de ahí, porque va por `BUILD_ORDER` y por `modelForBuilding`.

## Reglas de oro

- Modela en unidades de mundo y respecto al origen-ancla; nunca pienses en
  píxeles.
- El detalle que se lee a tamaño de juego son siluetas y cambios de tono entre
  caras, no micro-geometría: franjas de tejado, vigas, correas, escudos. La
  micro-geometría sí luce al hacer zoom, así que ambas valen la pena.
- El color del jugador (`C.main/dark/light`, `P.main/...`) tiene que verse en
  cada unidad y edificio (ropa, estandartes, gualdrapas): es cómo se distingue
  de quién es cada cosa.
- Los sprites se cachean por clave: cualquier dato nuevo que cambie el dibujo
  debe formar parte de la clave de caché en `js/sprites.js` o limpiarse con
  `clearSpriteCaches()`.
- Un modelo del taller se corta solo para la etapa "en obra" (los triángulos
  que quedan por encima de la mitad de su altura se van y al resto se le baja lo
  que sobresale) y sus cimientos son los del kit. Si modelas piezas sueltas muy
  altas, míralas en esa etapa antes de darlas por buenas.
- Triángulos: sin miedo dentro de lo razonable (un edificio puede ir de miles);
  el horneado es perezoso y por combinación, no por fotograma de juego.
