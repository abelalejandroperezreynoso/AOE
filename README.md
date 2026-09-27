# Age of Realms II

Juego de **estrategia medieval en tiempo real** para navegador, inspirado en los
clásicos del género. Recolecta recursos, haz crecer tu aldea, avanza por cuatro
edades y conquista a tus rivales.

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

Detalles a tener en cuenta:

- Los cambios se guardan **en ese navegador** y se aplican a las **partidas
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
2. **Población.** Cada casa da 5 de población; el centro urbano, 5; el castillo, 20.
3. **Edades.** Desde el centro urbano se avanza a Feudal, Castillos e Imperial.
   Cada edad exige edificios de la anterior y desbloquea unidades, edificios y
   mejoras nuevas.
4. **Ejército.** El triángulo básico: los lanceros destrozan a la caballería, los
   guerrilleros a los arqueros y la caballería a los arqueros y a la artillería.
   Arietes y trabuquetes son para derribar edificios.
5. **Victoria.** Gana quien destruya todo lo que tengan sus rivales.

## Contenido

- **4 edades**, 17 tipos de unidad y 15 edificios distintos.
- **11 tecnologías** (armas, armaduras, arquería, economía) y 7 mejoras de línea
  que transforman las unidades ya creadas.
- **Mapas aleatorios** con semilla reproducible, en cuatro tamaños y con hasta
  7 rivales (ocho jugadores, uno por color). Si el mapa elegido se queda corto
  para tanta base, se agranda solo.
- **IA rival** al estilo del juego original: explora el mapa con el jinete
  inicial, reparte a sus aldeanos por proporciones de recursos, ahorra para
  subir de edad, se expande, investiga y comercia. En lo militar responde a las
  incursiones donde ocurren (con campana para los aldeanos), repara lo dañado,
  reconstruye lo que le derriban, concentra al ejército antes de salir, compone
  las tropas con las contras de lo que se le ha visto al enemigo y lleva cada
  oleada de objetivo en objetivo hasta arrasar la base o retirarse. Tres niveles
  de dificultad.
- Niebla de guerra, minimapa, puntos de reunión, colas de producción, mercado de
  recursos, control de velocidad (1x a 3x) y estadísticas finales.
- **Catálogo** para consultar y editar todo el juego: sus valores y los colores
  del terreno, con vista previa en vivo.

## Estructura del código

```
index.html          Estructura de la página y el HUD
css/style.css       Interfaz, incluida la adaptación a móvil y la paleta clara
js/config.js        Datos de juego: edades, unidades, edificios, tecnologías
js/main.js          Menú, arranque y bucle principal
js/game.js          Estado de la partida, simulación, combate y órdenes
js/entities.js      Jugadores, unidades, edificios y proyectiles
js/map.js           Generación del mapa y de los recursos
js/path.js          Búsqueda de caminos A* sobre la rejilla
js/render.js        Renderizador isométrico y niebla de guerra
js/sprites.js       Sprites: carga de los atlas, terreno a mano e iconos
assets/sprites/     Atlas PNG de unidades, edificios y recursos, e indice.json
tools/importar-unidad.mjs  Mete en los atlas una hoja de animación dibujada
tools/importar-edificio.mjs  Mete en los atlas el dibujo de un edificio terminado
tools/importar-direcciones.mjs  Añade a una unidad las posturas de otras orientaciones
tools/importar-terreno.mjs  Mete en los atlas losetas de terreno dibujadas
tools/importar-arbol.mjs  Mete en los atlas el dibujo del árbol
tools/dibujar-jinete.html  Dibuja por código al explorador (caballo y jinete)
tools/dibujar-jinete.mjs   Escribe sus hojas de sprites
assets/fuentes/     Las hojas dibujadas tal como llegaron, para reimportarlas
tools/icon.html     Dibujo del icono de la aplicación: el castillo al atardecer
tools/make-icons.mjs  Saca de él los PNG de icons/ (necesita Playwright)
icons/, manifest.webmanifest  Icono y nombre del juego instalado en el móvil
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
- `theme-color` en blanco tiñe las barras del navegador y, con ellas, la franja
  del reloj y la batería del teléfono. Es sólo el tinte del navegador: no toca
  la pantalla completa ni las zonas seguras, que tienen su propia historia en
  `CLAUDE.md`.
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
- Un edificio dibujado entra con `tools/importar-edificio.mjs <tipo>
  <dibujo.png>`: busca la base (desde la esquina de abajo el contorno sube en
  pendiente 2:1 hasta donde las paredes se vuelven verticales), la escala a la
  huella que ocupa en el mapa y la ancla por su esquina de arriba. Le pone
  debajo una sombra suave y en lo más alto un banderín con el color de cada
  jugador, y escribe `<tipo>-<color>.png`. Sólo cambia la etapa terminada:
  los cimientos y la obra siguen con los de antes. Las barras de vida y de
  producción se colocan encima de lo más alto de cada dibujo. Así entró el
  centro urbano, desde `assets/fuentes/centro-urbano.png`.
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
