# Age of Realms II

Juego de **estrategia medieval en tiempo real** para navegador, inspirado en los
clásicos del género. Recolecta recursos, haz crecer tu aldea y conquista a tus
rivales. Hay una sola edad, la Oscura: todo está disponible desde el principio.

Se juega en solitario contra la máquina o **con otras personas**, hasta ocho
jugadores, cada quien desde su dispositivo.

El juego es HTML, CSS y JavaScript modular puro, sin compilación.

Las unidades, los edificios y los recursos son **sprites isométricos**: atlas
PNG en `assets/sprites/`, como los pre-renderizados de los clásicos del género.
Cada hoja lleva un color de jugador, y la partida sólo descarga las de los
colores que juegan (con dos jugadores, unos 2,6 MB). El terreno, los iconos de
las tecnologías y todo el sonido se siguen generando por código.

## Jugar

Sirve la carpeta con cualquier servidor estático:

```bash
npm start          # equivale a: node tools/dev-server.mjs
# y entra en http://localhost:8000
```

Hace falta un servidor (no vale abrir el archivo con `file://`) porque el juego
usa módulos ES. `tools/dev-server.mjs` no tiene dependencias y sirve además la
sala del multijugador, de modo que se puede probar una partida entre varios
dispositivos de la misma red local. Para jugar sólo en solitario vale cualquier
servidor estático, por ejemplo `python3 -m http.server 8000`.

## Publicar en Netlify

El repositorio está listo para desplegarse tal cual:

- **Desde Git**: conecta el repositorio en Netlify. `netlify.toml` indica que no
  hay comando de compilación y que la carpeta a publicar es la raíz. Netlify
  instalará por su cuenta la única dependencia del proyecto (`@netlify/blobs`),
  que usa la función de la sala; el juego en sí no depende de nada.
- **Arrastrando**: suelta la carpeta del proyecto en [Netlify Drop](https://app.netlify.com/drop).
  Así se publica el juego, pero sin la función de la sala: el multijugador
  necesita el despliegue desde Git o la CLI.
- **Con la CLI**: `npx netlify-cli deploy --prod --dir=.`

## Multijugador

De dos a ocho jugadores, cada quien desde su dispositivo:

1. **Comenzar partida** y, arriba, el modo **Con otra persona**.
2. Escribe tu nombre, elige el tamaño del mapa y entra en la sala. Verás a
   quienes estén conectados.
3. Pulsa **Invitar** en cada persona que quieras meter en tu partida. Según van
   aceptando aparecen en «Tu partida», con el color que les tocará.
4. Cuando estén listas, pulsa **Empezar partida**. Arranca en todos los
   dispositivos a la vez, en cuestión de segundos.

Sólo hace falta que **una** persona invite: quien ya está montando una partida
aparece en la lista de los demás con un botón **Pedir unirse**, y con aceptar la
petición entra sin más. Si dos os invitáis a la vez tampoco pasa nada: se
resuelve solo y los dos acabáis en la misma partida. Y si alguien no ha
aceptado todavía, el botón avisa (**Empezar sin esperar**) de que se quedará
fuera.

Quien invita hace de anfitrión: su dispositivo lleva la simulación de todos y
los demás le mandan sus órdenes. **La partida viaja directa de un navegador a
otro por WebRTC**, sin pasar por ningún servidor.

El anfitrión mantiene una conexión con cada invitado y les manda una instantánea
distinta a cada uno, así que es su subida la que marca el límite: con dos o tres
jugadores van diez instantáneas por segundo, y a partir de ahí se espacian hasta
cinco por segundo con la partida llena (el movimiento se sigue interpolando, así
que se ve igual de fluido). Conviene que haga de anfitrión quien tenga mejor
conexión.

El servidor sólo interviene para que los jugadores se encuentren, y deja de
usarse en cuanto la partida empieza. En Netlify eso lo resuelve una función
(`netlify/functions/lobby.mjs`) que guarda la presencia y las invitaciones en
Netlify Blobs; no hace falta ningún servicio externo ni cuenta de terceros.

Qué pasa cuando alguien se cae:

- Si se cae **un invitado**, queda eliminado y los demás siguen jugando.
- Si se cae **el anfitrión**, la partida sí termina para todos: es quien la
  simula.
- Si al anfitrión lo eliminan dentro de la partida, su equipo **sigue llevando
  la simulación** de los demás; puede quedarse mirando hasta que acabe. Si
  cierra la página, corta la partida al resto, y se le avisa de ello.
- Quien reserve sitio y no llegue a conectarse a tiempo se queda fuera: la
  partida empieza sin él y sin su base.

Limitaciones conocidas:

- Hace falta que **los navegadores puedan establecer una conexión directa**.
  Funciona en la misma red local y en la mayoría de conexiones domésticas
  gracias a los servidores STUN públicos, pero algunas redes muy restrictivas
  (ciertas corporativas o móviles) lo impiden; para cubrir esos casos haría
  falta un servidor TURN, que no es gratuito.
- No hay reconexión: quien pierde la conexión no puede volver a la partida.
- El anfitrión manda el estado completo, así que un invitado que abriese las
  herramientas del navegador podría ver el mapa entero. En pantalla la niebla
  de guerra funciona con normalidad para cada jugador.
- No hay equipos ni alianzas: todos contra todos.

## Catálogo del juego

Desde el menú principal, **Catálogo del juego**: una ficha de cada unidad,
edificio, recurso y tipo de terreno, con su dibujo y todos sus valores.

Cada ficha tiene una **lupa**: el sprite a aumento entero con la **cuadrícula
de todos sus píxeles**, del tamaño de la imagen, y aparte una tarjeta con sus
datos (tamaño, lienzo, aumento y, en las unidades, dirección y fotograma). El
aumento nunca baja de ×3; los edificios grandes no caben y la lupa se desplaza.
Las unidades a pie van siempre en un **lienzo estándar de 100×100** píxeles,
con los pies centrados a lo ancho y a 88 del borde de arriba, así que toda
plantilla descargada mide igual.
En las unidades sigue la animación: tocar una dirección la enseña en la lupa y
tocar un fotograma de la tira lo deja fijo. **Descargar PNG** guarda lo que
enseña la lupa, con su cuadrícula (en el teléfono, por el menú de compartir,
desde el que se guarda en Fotos o en Archivos).

Cada unidad enseña sus **animaciones** en marcha: moverse, quieta y
atacar (trabajar, en el aldeano), a la vez en las ocho direcciones y con sus
fotogramas sueltos debajo. Sus cifras se pueden consultar pero **no cambiar**:
son fijas, y no se aplica ninguna que se hubiera guardado antes ni la que
mande un anfitrión.

Lo demás **se puede editar ahí mismo**: coste, tiempo, puntos de vida, ataque,
armadura y alcance de los edificios, cantidad de los yacimientos, velocidad de
recolección y el color de cada terreno. Cada campo modificado se
resalta y, al pasar el ratón por su nombre, indica cuál era el valor original.
Hay un botón para restablecer un elemento suelto y otro para dejarlo todo como
venía de fábrica.

### Modelos 3D

Las fichas de unidades, edificios y recursos tienen una sección **Modelo 3D**:
**Importar modelo 3D** pide un `.usdz` (como lo exporta Gravity Sketch) o
`.obj` con su `.mtl` (sueltos o en un `.zip`), y el juego lo pinta él mismo en
su perspectiva isométrica y lo recorta en sprites, que sustituyen a los de lo
que esté abierto:

- **Edificio**: se encaja en su huella y salen las tres etapas (cimientos,
  obra y terminado, cortando el modelo a distintas alturas) en los ocho
  colores.
- **Unidad**: se ajusta a la altura de la que sustituye y sale en sus
  direcciones, con una **pose por fotograma**. En un `.usdz`, cada capa es una
  pose y su nombre dice cuál: `quieto`, `andar1`, `andar2`… y `golpe1`,
  `golpe2` (con o sin `-` o `_` antes del número). Con `.obj`, un archivo por
  pose con ese nombre; un `.obj` solo es la pose quieta. La escala y el punto
  de los pies salen de la quieta y valen para todas, así que la figura no
  crece ni resbala entre poses. Lo que falte se hace con la quieta.
- **Recurso**: cabe en una casilla y salen cuatro variantes, girado de 90 en
  90 grados. Lo agotado sigue siendo lo de antes.

Lo pintado en **magenta** (rojo y azul altos, poco verde), o los materiales
que se llamen *jugador* (o *equipo*, *player*, *team*), toma el color de cada
bando. Si no hay nada así, el color va en un banderín (edificios) o en un aro
a los pies (unidades). Las texturas aún no se usan: cada material sale con su
color liso. **Z arriba / Y arriba** elige qué eje del modelo es la vertical
(un `.usdz` ya lo dice, y viene elegido; en un `.obj` de 3ds Max es Z y de
Gravity Sketch, Y) y **Girar 90°** lo orienta.

Debajo, **Poses que hay que modelar** lista lo que pide cada elemento, con el
nombre de cada pose y su postura: una unidad, la quieta, cuatro de paso (seis
de trote a caballo) y dos de golpe; un edificio o un recurso, un solo modelo.
Todas mirando hacia el mismo lado y con los pies en el mismo punto: el juego
gira cada una para sacar las direcciones. En Gravity Sketch, cada pose en su
capa con ese nombre, que empiece por letra y sin guiones ni espacios (USD
cambia un nombre como «1» por `_`, y dos capas así se funden en una).

Lo importado se ve al momento en el catálogo y en las partidas de esa sesión,
sólo en ese aparato; al recargar vuelve lo de siempre. Para que quede en el
juego de todos, **Descargar paquete** guarda un `.zip` con el modelo y los
ajustes elegidos (`ajustes.json`), que se mete en los atlas con
`node tools/importar-modelo.mjs modelo-<clave>.zip` y un commit: pinta con el
mismo código, así que sale igual que en la vista previa.

Detalles a tener en cuenta:

- Los cambios de valores se guardan **en ese navegador** y se aplican a las **partidas
  nuevas**, no a una que ya esté en marcha.
- En **multijugador manda quien invita**: sus valores se usan en todos los
  dispositivos, de modo que todos ven y juegan con las mismas cifras.
- Los valores se validan y se recortan a un rango razonable, así que no es
  posible dejar el juego en un estado inservible desde el catálogo.

## Cómo se juega

| Acción | Control |
| --- | --- |
| Seleccionar | Clic izquierdo (arrastra para seleccionar varias unidades) |
| Dar órdenes | Clic derecho: mover, recolectar, construir, atacar o reparar |
| Todas las del mismo tipo | Doble clic sobre una unidad |
| Añadir a la selección | Mayús + clic |
| Mover la cámara | WASD, flechas, borde de la pantalla o clic central |
| Acercar / alejar | Rueda del ratón |
| Grupos de control | Ctrl + 0-9 para guardar, 0-9 para recuperar |
| Aldeano ocioso | `.` |
| Centrar en la selección | Espacio |
| Eliminar lo seleccionado | Supr |
| Pausa y menú | `P` o `Esc` |
| Construir en cadena | Mantén Mayús al colocar un edificio |
| Pastorear ovejas | Selecciona las tuyas y clic derecho donde quieras llevarlas |
| Ver a dónde va | Selecciónalo: una bandera marca su destino (verde ir, ámbar recurso, roja objetivo) |
| Ayuda | `F1` |

En **móvil y tablet**, con unidades tuyas seleccionadas, **tocar da la orden**:
en el suelo se mueven, en un enemigo atacan y en un recurso recolectan; los
aldeanos, además, trabajan en una obra o una granja, descargan en un almacén o
van a por una oveja tuya. Tocar otra cosa tuya la selecciona (dos toques en una
unidad cogen todas las de su tipo) y la selección se suelta tocando su ficha de
abajo. Sin nada seleccionado, o con un edificio, el toque selecciona.
**Mantener el dedo** da la orden sin cambiar la selección, también sobre algo
propio, y planta el punto de reunión de un edificio.
Arrastrar mueve la cámara y pellizcar acerca o aleja.

### Bucle de juego

1. **Economía.** Manda aldeanos a bayas, ovejas, ciervos, árboles, oro y piedra.
   Levanta molinos y campamentos junto a los yacimientos para acortar los viajes,
   y granjas cuando se agote la caza. Las **ovejas se domestican**: pasan al bando
   de quien tenga unidades cerca —y cambian de dueño si se acerca otro—, así que
   conviene llevarlas a la base antes de sacrificarlas.
   Las **granjas** funcionan como en el clásico: necesitan un molino, las cultiva
   un solo aldeano puesto en el centro de la parcela, las unidades pasan por
   encima de ellas y, cuando se agotan, su aldeano las vuelve a sembrar solo si
   queda madera (si no, se queda en reposo y aparece en el contador de aldeanos
   ociosos).
2. **Población.** Cada casa da 5 de población, y el centro urbano, 5.
3. **Ejército.** El cuartel entrena la milicia. El explorador es el jinete con el
   que empieza cada jugador: no se entrena en ningún edificio.
4. **Victoria.** Gana quien destruya todo lo que tengan sus rivales.

## Contenido

- **Una sola edad**, la Oscura, con sus 3 unidades (aldeano, milicia y
  explorador) y sus 7 edificios (centro urbano, casa, molino, granja,
  campamento maderero, campamento minero y cuartel).
- **1 tecnología**: el telar, en el centro urbano.
- **Mapas aleatorios** con semilla reproducible, en cuatro tamaños y con hasta
  7 rivales (ocho jugadores, uno por color). Si el mapa elegido se queda corto
  para tanta base, se agranda solo.
- **IA rival** al estilo del juego original: explora el mapa con el jinete
  inicial, reparte a sus aldeanos por proporciones de recursos, se expande con
  más campamentos, granjas, cuarteles y un segundo centro urbano según crece el
  pueblo, e investiga. En lo militar responde a las
  incursiones donde ocurren (con campana para los aldeanos), repara lo dañado,
  reconstruye lo que le derriban, concentra al ejército antes de salir, compone
  las tropas con las contras de lo que se le ha visto al enemigo y lleva cada
  oleada de objetivo en objetivo hasta arrasar la base o retirarse. Tres niveles
  de dificultad.
- Niebla de guerra, minimapa, puntos de reunión, colas de producción, control
  de velocidad (1x a 3x) y estadísticas finales.
- **Catálogo** para consultar y editar todo el juego: sus valores y los colores
  del terreno, con vista previa en vivo.

## Estructura del código

```
index.html          Estructura de la página y el HUD
css/style.css       Interfaz, incluida la adaptación a móvil y la paleta clara
js/config.js        Datos de juego: unidades, edificios, tecnologías
js/main.js          Menú, arranque y bucle principal
js/game.js          Estado de la partida, simulación, combate y órdenes
js/entities.js      Jugadores, unidades, edificios y proyectiles
js/map.js           Generación del mapa y de los recursos
js/path.js          Búsqueda de caminos A* sobre la rejilla
js/render.js        Renderizador isométrico y niebla de guerra
js/sprites.js       Sprites: carga de los atlas, terreno a mano e iconos
js/modelo3d.js      Modelos 3D: lee .usdz/.obj y los pinta en sprites, pose a pose
js/usdz.js          Lector del USD binario que va dentro de un .usdz
assets/sprites/     Atlas PNG de unidades, edificios y recursos, e indice.json
tools/importar-unidad.mjs  Mete en los atlas una hoja de animación dibujada
tools/importar-edificio.mjs  Mete en los atlas el dibujo de un edificio terminado
tools/importar-modelo.mjs  Mete en los atlas un modelo 3D del catálogo
tools/importar-direcciones.mjs  Añade a una unidad las posturas de otras orientaciones
tools/importar-fotogramas.mjs  Mete fotogramas sueltos como el andar (o la quieta) de una orientación
tools/importar-posturas.mjs  Mete posturas sueltas de pixel art, una por orientación
tools/importar-terreno.mjs  Mete en los atlas losetas de terreno dibujadas
tools/importar-arbol.mjs  Mete en los atlas el dibujo del árbol
tools/dibujar-jinete.html  Dibuja por código al explorador (caballo y jinete)
tools/dibujar-jinete.mjs   Escribe sus hojas de sprites
assets/fuentes/     Las hojas dibujadas tal como llegaron, para reimportarlas
tools/icon.html     Dibujo del icono de la aplicación: el castillo al atardecer
tools/make-icons.mjs  Saca de él los PNG de icons/ (necesita Playwright)
icons/, manifest.webmanifest  Icono y nombre del juego instalado en el móvil
diag.html           Mide la pantalla en el propio aparato (enlace en el menú)
js/ai.js            IA de los rivales
js/ui.js            HUD, panel de órdenes, ratón, teclado y táctil
js/audio.js         Efectos de sonido sintetizados con WebAudio
js/catalog.js       Catálogo: fichas y edición de los datos del juego
js/data/overrides.js  Valores editados: validación, guardado y aplicación
js/lobby-ui.js      Pantalla de la sala de espera
js/net/lobby.js     Cliente de la sala y conexión WebRTC entre navegadores
js/net/protocol.js  Codificación binaria del estado y de las órdenes
js/net/session.js   Partida en red: anfitrión que simula, invitado que pinta
netlify/functions/  Sala de espera (sólo para que los jugadores se encuentren)
tools/dev-server.mjs  Servidor local: juego + sala, sin dependencias
```

Para depurar, el objeto de la partida está disponible en la consola como
`window.game`.

## Notas técnicas

- La interfaz usa los **colores de iOS**: blanco y el gris agrupado
  (`#f2f2f7`) de fondo, negro y los grises del sistema para las letras, rayas
  finas de separación y el azul del sistema (`#007aff`) para lo que se pulsa o
  está elegido, con el verde, el rojo y el naranja de iOS para lo bueno, lo
  malo y los avisos, y la letra del sistema. Están en las fichas de `:root`
  (`--papel`, `--fondo`, `--tinta`, `--tinta-2`, `--tinta-3`, `--raya`,
  `--relleno`, `--acento`…), así que se repinta todo desde ahí. El arte del
  juego —el mapa, los sprites, y los colores de cada recurso y de cada
  jugador— no es interfaz y no cambia.
- `theme-color` en blanco tiñe las barras del navegador. Instalado en iOS, la
  franja del reloj la decide `apple-mobile-web-app-status-bar-style` en
  `black-translucent`: el contenido pasa por debajo de la hora, que va siempre
  en blanco. Como iOS mide entonces la ventana 50 px más corta de lo que pinta,
  `#app` es absoluto y se alarga esa zona segura, los menús y el
  catálogo también son absolutos y se alargan igual, y `main.js` devuelve la página arriba si se desplaza. La
  historia completa, en `CLAUDE.md`.
- La letra pequeña del menú lleva la versión (la misma que va en la URL del CSS
  y de `main.js`; se cambia a mano en `index.html` y `diag.html`) y el enlace a
  `diag.html`.
- El terreno se dibuja una sola vez en un lienzo fuera de pantalla y se compone
  con transformaciones; la niebla se calcula a un quinto de resolución y sólo se
  rehace cuando cambian la cámara o la visibilidad.
- Los sprites vienen en atlas: una hoja de unidades y otra de edificios por
  color de jugador, y una de recursos. `indice.json` dice, para cada clave
  (`u|tipo|color|orientación|fotograma`, `b|tipo|color|etapa`,
  `r|tipo|variante|agotado`), en qué hoja está, dónde y por qué punto se ancla,
  en píxeles de mundo. Cada sprite se recorta de su hoja la primera vez que se
  pide y se guarda en caché.
- Las unidades miran en ocho direcciones pero sólo hay cinco en las hojas: las
  otras tres salen volteando el mapa de bits, igual que hacía el original con
  sus SLP. Cada una tiene seis fotogramas: cuatro de andar y dos de golpe.
- Las hojas están a 2× la resolución del mundo. Al acercar la cámara se ven los
  píxeles del sprite, como al ampliar el clásico.
- Para cambiar un dibujo se sustituye su trozo en la hoja, con el mismo tamaño
  y anclaje, o se reempaqueta la hoja y se actualiza el índice.
- Una unidad dibujada a mano entra con `tools/importar-unidad.mjs <tipo>
  <hoja.png> --quieto N`: la hoja trae los fotogramas de andar en fila, con la
  figura mirando abajo a la derecha y una sombra gris bajo los pies. La
  herramienta ancla en el centro de la sombra, la iguala en altura a la unidad
  que sustituye, pinta el verde del uniforme con el color de cada jugador y
  escribe una hoja por color (`<tipo>-<color>.png`) y su animación en el
  índice (`anim`: los fotogramas que recorre al andar, el de quieto, los de
  golpe y la altura de referencia). Si sólo hay una orientación dibujada, vale
  para las ocho (las de la izquierda, volteadas). Así entró el aldeano, desde
  `assets/fuentes/aldeano-andar.png`, con `--quieto 4 --andar 0,1,2,3,4`: el
  sexto fotograma de esa hoja es casi igual que el primero (difieren en un
  11 %) y, dejándolo, el aldeano se paraba un instante en cada zancada.
- Las demás orientaciones del aldeano (↓, →, ↗ y ↑; las de la izquierda,
  volteadas) vienen de una rosa de 3×3 con una postura por dirección,
  `assets/fuentes/aldeano-direcciones.jpg`, con `tools/importar-direcciones.mjs`.
  Separa cada figura del fondo y de su halo de JPG, la ancla en su sombra, la
  iguala a la altura de referencia y pinta el azul del uniforme con el color
  del jugador (`villager-dir-<color>.png`). Como es una sola postura, al andar
  alterna con ella misma un píxel más arriba; ↘ conserva su ciclo completo.
- El andar de ↘ (y, volteado, el de ↙) es el del aldeano nuevo, con delantal y
  pico: cuatro fotogramas sueltos, `assets/fuentes/aldeano-andar-1..4`, metidos
  con `tools/importar-fotogramas.mjs villager 0 --espejo --quieto 1`. Vienen
  retocados sobre la cuadrícula de la lupa: se quitan el fondo y las líneas
  (claros y sin color), la sombra se distingue de las líneas por ser gris
  continuo, se reducen a la altura de referencia y el azul de la ropa toma el
  color del jugador (`villager-andar-0-<color>.png`). El retrato y las vistas
  del catálogo usan ↘, la orientación dibujada de todas las unidades.
  Mientras no haya dibujo de las demás orientaciones, el aldeano usa ese
  mismo andar en todas (las de la izquierda, volteadas), para que sea siempre
  el mismo personaje; `tools/podar-indice.mjs` quitó las hojas del soldado.
  Esas orientaciones son copias en el índice de las entradas de ↘, y la
  herramienta las rehace cada vez que reimporta ↘.
- Ahora el andar de ↘/↙ es el de la armadura verde
  (`assets/fuentes/aldeano-andar-*-armadura.jpg`, el 0 repetido como 2):
  `importar-fotogramas.mjs villager 0 --espejo --quieto 1 --rellenar 0,1,2,3`.
  Un fotograma casi sin azul no se pinta con el color del jugador, y
  `--rellenar` tapa los brillos grises que pasarían por fondo (no los huecos
  blancos, que son rendijas de verdad). En el índice el golpe es el 4 y la
  quieta el 5, para que una orientación tenga quieta propia sin tocar el
  golpe: la de ↓ (`aldeano-quieta-s-armadura.webp`) entra con
  `importar-fotogramas.mjs villager 1 --quieta --rellenar 0` en
  `villager-quieta-1-<color>.png`, y se conserva al reimportar ↘.
- ↓ anda con sus tres dibujos de frente (`aldeano-andar-s-1..3-armadura.jpg`:
  pies juntos y las dos zancadas, la segunda volteada de la tercera), con
  `importar-fotogramas.mjs villager 1 --fotogramas 0,1,2 --andar-propio
  --rellenar 0,1,2`: `andarCara` en el índice le da su propia lista de
  fotogramas, y `unitAnim(tipo, cara)` la devuelve (las volteadas usan la de
  la suya). → tiene de perfil sólo el fotograma 0
  (`aldeano-andar-e-1-armadura.webp`, con `villager 7 --fotogramas 0
  --rellenar 0`); los otros tres, y ← volteado, siguen siendo los de ↘. Las
  copias van fotograma a fotograma: reimportar ↘ rehace las que apuntan a su
  hoja y deja las propias de cada orientación.
- Después, → anda de perfil con un vídeo (`aldeano-andar-e-armadura.mov`, 24
  fotogramas por segundo, un ciclo de dos pasos cada 32): ocho fotogramas,
  del 0 al 28 de cuatro en cuatro, guardados en
  `assets/fuentes/aldeano-andar-e-armadura/e-0..7.png` y metidos con
  `importar-fotogramas.mjs villager 7 --fotogramas 0,1,2,3,6,7,8,9
  --andar-propio --rellenar 0,1,2,3,4,5,6,7` (el 4 y el 5 son el golpe y la
  quieta). Con ocho, el paso va con el suelo: se avanza un fotograma cada
  séptimo de casilla, unos 6,5 px de pantalla hacia →.
- **Resolución.** Las hojas de serie van a 2 píxeles por píxel de mundo, y en
  el iPhone (3 de pantalla por píxel de mundo, más con zoom) se ampliaban a
  píxel visto: se veían los bloques. Las del aldeano van ahora a 6
  (`--res 6` en `importar-fotogramas.mjs`, apuntado en `resHojas` del
  índice): `drawSprite` las reduce con filtro y sólo las copia a píxel visto
  si se amplían más allá de 6. La altura de referencia (`anim.altura`, a la
  resolución de serie) escala con ella, así que mide lo mismo en el mapa. En
  la lupa el lienzo estándar pasa a 300×300 y la cuadrícula sólo se pinta si
  cada píxel se ve de 4 o más. Como la armadura no lleva color de jugador, la
  herramienta escribe una sola hoja por orientación, `-comun.png`, que se
  carga siempre y sirve a los ocho colores.
- **Milicia.** Cinco posturas de pixel art de 48×48 sobre fondo transparente
  (`assets/fuentes/milicia/`), metidas con `tools/importar-posturas.mjs militia
  --res 6 0=sur 1=sur 3=oeste 4=noroeste 5=noreste 6=noreste 7=este`: se
  amplían con filtro hasta la altura de las unidades a pie (el dibujo mide 44
  px, así que se ven suaves y no a bloques), llevan una sombra elíptica y, como
  es una sola postura, al andar botan un píxel. Sin color de jugador, en una
  hoja común. ← y ↖ tienen dibujo propio: `unitSprite` usa el de la
  orientación si está en el índice y sólo si no lo voltea. Faltan ↘ (usa la de
  frente) y ↑ (usa la de espaldas hacia ↗).
- Un edificio dibujado entra con `tools/importar-edificio.mjs <tipo>
  <dibujo.png>`: busca la base (desde la esquina de abajo el contorno sube en
  pendiente 2:1 hasta donde las paredes se vuelven verticales), la escala a la
  huella que ocupa en el mapa y la ancla por su esquina de arriba. Le pone
  debajo una sombra suave y en lo más alto un banderín con el color de cada
  jugador, y escribe `<tipo>-<color>.png`. Sólo cambia la etapa terminada:
  los cimientos y la obra siguen con los de antes. Las barras de vida y de
  producción se colocan encima de lo más alto de cada dibujo. Así entró el
  centro urbano, desde `assets/fuentes/centro-urbano.png`.
- El `.usdz` se lee sin librerías (`js/usdz.js`): es un `.zip` con la escena
  en el USD binario de Pixar («Crate», versión 0.8 en lo de Gravity Sketch).
  Se descomprimen sus secciones (LZ4 y la compresión de enteros de USD), se
  rehace el árbol de rutas y se leen, de cada malla, vértices, caras,
  normales, transformación y material, y de cada material su `diffuseColor`,
  que va en luz lineal y se pasa a sRGB. Cada hijo del nodo principal es una
  capa de Gravity Sketch. Comprobado contra la librería oficial de Pixar con
  los archivos de prueba de Abel: mismos vértices y triángulos, sin
  diferencia.
- Un modelo 3D se pinta sin motor ni librerías (`js/modelo3d.js`): el `.zip`
  se abre con `DecompressionStream`, los polígonos se parten en
  triángulos y se rasterizan con búfer de profundidad a triple resolución, con
  la misma proyección del mapa (`x = 45,25·e`, `y = −22,63·n − 39,19·h`
  píxeles de mundo por casilla). La luz viene de la derecha y de arriba, cada
  vértice con su normal (vuelta hacia la cámara si el modelo la trae al
  revés), y la sombra es el modelo proyectado en el suelo según ese sol. Se
  reduce a píxeles duros con un contorno oscuro, como los dibujos, a 4 píxeles
  de hoja por píxel de mundo (`resHojas`). `tools/importar-modelo.mjs` quita
  del índice lo que tenía ese elemento, escribe `<clave>-modelo-<color>.png`
  y retira las hojas que se quedan sin uso; el paquete se guarda en
  `assets/fuentes/<clave>-modelo.zip`.
- **El aldeano es ahora un modelo 3D**: un maniquí hecho en Gravity Sketch
  (`assets/fuentes/villager-modelo.zip`, con Y arriba), metido con
  `tools/importar-modelo.mjs`. Es una sola pose, así que no mueve las piernas
  al andar, y el color del jugador va en el aro de los pies. Lo que se cuenta
  más abajo de sus dibujos a mano es historia: esas hojas se retiraron y
  siguen en el historial de git. En `.obj`, Gravity Sketch exporta un grupo
  por trazo, con nombres automáticos (`g s.0027`…), sin los de sus grupos ni
  capas; en `.usdz` sí van las capas con su nombre (no los grupos) y los
  colores: por eso las poses van en capas y se exporta en USDZ.
- El explorador está dibujado por código (`tools/dibujar-jinete.html`): caballo
  y jinete son piezas simples (elipsoides, cápsulas y cajas) con un esqueleto
  que anima el trote en pares diagonales y el golpe de espada. Se ven con la
  cámara isométrica del juego, lanzando un rayo por píxel, y se pasan a pixel
  art con tres tonos de luz, contorno oscuro, la sombra proyectada en el suelo
  y el camuflaje del color de cada jugador. Salen las cinco orientaciones con
  nueve fotogramas: seis de trote, dos de golpe y uno parado. Se regeneran con
  `node tools/dibujar-jinete.mjs`.
- La hierba (los tres tipos) va con losetas dibujadas, de
  `assets/fuentes/terreno-hierba.jpg` con `tools/importar-terreno.mjs`: de cada
  loseta en bloque se toma sólo la cara de arriba, recortada al rombo del
  juego y un 6 % más grande para que no se vea la junta, y se guardan ocho
  variantes por terreno en `terreno.png` (claves `t|terreno|n`). La oscura es
  la misma hierba algo más apagada; la frondosa lleva tréboles, flores y matas.
  El resto de terrenos sigue pintándose por código, y el color de la hierba ya
  no se edita en el catálogo.
- El árbol viene de `assets/fuentes/arbol.jpg` con `tools/importar-arbol.mjs`:
  se queda con la copa, el tronco y las raíces (lo unido al tronco), sin la
  loseta en la que está plantado ni el fondo, anclado al pie del tronco y con
  74 px de mundo de alto. Salen cuatro variantes (volteado, de otro tamaño y
  otro verde) y, de cada una, la casi talada, más pequeña y apagada.
- Probado con unas 250 unidades combatiendo a la vez sin bajar de 60 fps en
  hardware normal.
- En multijugador el anfitrión manda hasta diez instantáneas por segundo en
  binario y los invitados interpolan entre ellas para pintar a 60 fps. Tras una
  batalla de 80 unidades, el estado de ambos coincide exactamente y las
  posiciones difieren menos de una décima de casilla.
- Con la partida llena, el anfitrión reparte los envíos a lo largo del ciclo en
  vez de mandárselos a los siete a la vez, para no dar un tirón cada 200 ms.

## Aviso legal

Proyecto original de aficionados, sin relación alguna con Microsoft ni con
Ensemble Studios. No contiene ningún recurso de *Age of Empires*: los sprites
son propios del proyecto y el resto del contenido audiovisual se genera por
código dentro de este repositorio.
