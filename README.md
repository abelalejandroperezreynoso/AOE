# Age of Realms II

Juego de **estrategia medieval en tiempo real** para navegador, inspirado en los
clásicos del género. Recolecta recursos, haz crecer tu aldea, avanza por cuatro
edades y conquista a tus rivales.

Se juega en solitario contra la máquina o **contra otra persona**, cada quien
desde su dispositivo.

El juego es HTML, CSS y JavaScript modular puro, sin compilación. Todo el arte
(unidades, edificios, terreno, iconos) y todo el sonido se **generan por código**
en tiempo de ejecución, así que pesa unos pocos cientos de kilobytes y no
descarga ningún recurso externo.

## Jugar

Sirve la carpeta con cualquier servidor estático:

```bash
npm start          # equivale a: node tools/dev-server.mjs
# y entra en http://localhost:8000
```

Hace falta un servidor (no vale abrir el archivo con `file://`) porque el juego
usa módulos ES. `tools/dev-server.mjs` no tiene dependencias y sirve además la
sala del multijugador, de modo que se puede probar una partida entre dos
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

Uno contra uno, cada quien desde su dispositivo:

1. En el menú principal, **Jugar con otra persona**.
2. Escribe tu nombre y entra en la sala. Verás a quienes estén conectados.
3. Pulsa **Invitar** en la persona con la que quieras jugar.
4. Cuando acepte, la partida arranca en los dos dispositivos (unos 3 segundos).

Quien envía la invitación hace de anfitrión: su dispositivo lleva la simulación
y el otro le manda sus órdenes. **La partida viaja directa de un navegador al
otro por WebRTC**, sin pasar por ningún servidor, con un consumo de unos 8 kB/s
incluso con ejércitos grandes.

El servidor sólo interviene para que los dos jugadores se encuentren, y deja de
usarse en cuanto la partida empieza. En Netlify eso lo resuelve una función
(`netlify/functions/lobby.mjs`) que guarda la presencia y las invitaciones en
Netlify Blobs; no hace falta ningún servicio externo ni cuenta de terceros.

Limitaciones conocidas:

- Hace falta que **ambos navegadores puedan establecer una conexión directa**.
  Funciona en la misma red local y en la mayoría de conexiones domésticas
  gracias a los servidores STUN públicos, pero algunas redes muy restrictivas
  (ciertas corporativas o móviles) lo impiden; para cubrir esos casos haría
  falta un servidor TURN, que no es gratuito.
- Si se corta la conexión, la partida termina y se avisa: no hay reconexión.
- El anfitrión manda el estado completo, así que un invitado que abriese las
  herramientas del navegador podría ver el mapa entero. En pantalla la niebla
  de guerra funciona con normalidad para cada jugador.

## Catálogo del juego

Desde el menú principal, **Catálogo del juego**: una ficha de cada unidad,
edificio, recurso y tipo de terreno, con su dibujo y todos sus valores.

Los valores **se pueden editar ahí mismo**: coste, tiempo, puntos de vida,
ataque, armadura, alcance, velocidad, visión, cantidad de los yacimientos,
velocidad de recolección y el color de cada terreno. Cada campo modificado se
resalta y, al pasar el ratón por su nombre, indica cuál era el valor original.
Hay un botón para restablecer un elemento suelto y otro para dejarlo todo como
venía de fábrica.

### Aspecto

Cada ficha empieza por una sección **Aspecto** con la que se cambia cómo se
dibuja el objeto, no sólo sus cifras. La vista previa se rehace al instante,
mientras se arrastra el selector de color:

- **Unidades**: piel, calzas, yelmo, metal de las armas, madera de los mangos,
  montura de la caballería, ruedas de las máquinas de asedio y su **tamaño**
  (de 0,6 a 1,6 veces el normal).
- **Edificios**: muros, tejado, madera, puerta, basamento, chimenea, tierra y
  cultivo de la granja, empedrado, mostradores y toldos del mercado, y los
  detalles propios de cada uno (el fuego de la herrería, la tela del molino,
  el emblema de los edificios militares). No llevan tamaño: su huella la fija
  la cuadrícula.
- **Recursos**: tronco y hojas del árbol, roca y vetas de las minas, mata y
  bayas, cuerpo, cabeza, patas y cuerna de los animales, además del tamaño.

Sólo aparecen los campos que ese objeto usa de verdad: a un lancero no se le
pregunta por la montura. Los edificios se pintan en tres tonos por material
(cara al sol, cara base y sombra); mientras un color no se toque se usan los
tonos originales, elegidos a mano, y en cuanto se cambia se derivan del nuevo.

Detalles a tener en cuenta:

- Los cambios se guardan **en ese navegador** y se aplican a las **partidas
  nuevas**, no a una que ya esté en marcha.
- En **multijugador manda quien invita**: sus valores se usan en los dos lados,
  de modo que ambos jugadores ven y juegan con las mismas cifras.
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
| Ayuda | `F1` |

En **móvil y tablet**: un toque selecciona lo tuyo, un toque en el suelo da la
orden a lo que tengas seleccionado, arrastrar mueve la cámara y pellizcar acerca
o aleja.

### Bucle de juego

1. **Economía.** Manda aldeanos a bayas, ovejas, ciervos, árboles, oro y piedra.
   Levanta molinos y campamentos junto a los yacimientos para acortar los viajes,
   y granjas cuando se agote la caza. Las **ovejas se domestican**: pasan al bando
   de quien tenga unidades cerca —y cambian de dueño si se acerca otro—, así que
   conviene llevarlas a la base antes de sacrificarlas.
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
- **Mapas aleatorios** con semilla reproducible, en tres tamaños y con hasta
  3 rivales.
- **IA rival** que reparte a sus aldeanos por proporciones de recursos, ahorra
  para subir de edad, se expande, investiga, defiende su base y ataca por oleadas
  crecientes. Tres niveles de dificultad.
- Niebla de guerra, minimapa, puntos de reunión, colas de producción, mercado de
  recursos, control de velocidad (1x a 3x) y estadísticas finales.
- **Catálogo** para consultar y editar todo el juego: sus valores y también el
  aspecto de cada objeto, con vista previa en vivo.

## Estructura del código

```
index.html          Estructura de la página y el HUD
css/style.css       Interfaz, incluida la adaptación a móvil
js/config.js        Datos de juego: edades, unidades, edificios, tecnologías
js/main.js          Menú, arranque y bucle principal
js/game.js          Estado de la partida, simulación, combate y órdenes
js/entities.js      Jugadores, unidades, edificios y proyectiles
js/map.js           Generación del mapa y de los recursos
js/path.js          Búsqueda de caminos A* sobre la rejilla
js/render.js        Renderizador isométrico y niebla de guerra
js/sprites.js       Arte procedural: todo se dibuja con Canvas
js/ai.js            IA de los rivales
js/ui.js            HUD, panel de órdenes, ratón, teclado y táctil
js/audio.js         Efectos de sonido sintetizados con WebAudio
js/catalog.js       Catálogo: fichas y edición de los datos del juego
js/data/appearance.js Colores y tamaño con los que se dibuja cada objeto
js/data/overrides.js  Valores editados: validación, guardado y aplicación
js/lobby-ui.js      Pantalla de la sala de espera
js/net/lobby.js     Cliente de la sala y conexión WebRTC entre navegadores
js/net/protocol.js  Codificación binaria del estado y de las órdenes
js/net/session.js   Partida en red: anfitrión que simula, invitado que pinta
netlify/functions/  Sala de espera (sólo para que dos jugadores se encuentren)
tools/dev-server.mjs  Servidor local: juego + sala, sin dependencias
```

Para depurar, el objeto de la partida está disponible en la consola como
`window.game`.

## Notas técnicas

- El terreno se dibuja una sola vez en un lienzo fuera de pantalla y se compone
  con transformaciones; la niebla se calcula a un quinto de resolución y sólo se
  rehace cuando cambian la cámara o la visibilidad.
- Los sprites se generan una vez por combinación de tipo, color, orientación y
  fotograma, y se guardan en caché.
- Probado con unas 250 unidades combatiendo a la vez sin bajar de 60 fps en
  hardware normal.
- En multijugador el anfitrión manda diez instantáneas por segundo en binario y
  el invitado interpola entre ellas para pintar a 60 fps. Tras una batalla de
  80 unidades, el estado de ambos coincide exactamente y las posiciones difieren
  menos de una décima de casilla.

## Aviso legal

Proyecto original de aficionados, sin relación alguna con Microsoft ni con
Ensemble Studios. No contiene ningún recurso de *Age of Empires*: todo el
contenido audiovisual se genera por código dentro de este repositorio.
