# Age of Realms II

Juego de **estrategia medieval en tiempo real** para navegador, inspirado en los
clásicos del género. Recolecta recursos, haz crecer tu aldea, avanza por cuatro
edades y conquista a tus rivales.

Se juega en solitario contra la máquina o **con otras personas**, hasta ocho
jugadores, cada quien desde su dispositivo.

El juego es HTML, CSS y JavaScript modular puro, sin compilación. Todo el arte
(unidades, edificios, terreno, iconos) y todo el sonido se **generan por código**
en tiempo de ejecución, así que pesa unos pocos cientos de kilobytes y no
descarga ningún recurso externo.

El arte sigue la técnica de los clásicos del género: las unidades, los
edificios y los recursos son **modelos 3D de polígonos bajos pre-renderizados a
sprites isométricos 2D**. Los modelos se construyen por código, un rasterizador
propio los hornea con luz, sombra arrojada y contorno al cargar (y bajo
demanda), y la partida sólo copia mapas de bits: el aspecto de render de
estudio del original, sin un solo fichero de imagen.

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
- Los modelos del taller que se reparten al empezar tienen un tope de tamaño; si
  el anfitrión hubiera rehecho muchísimos edificios y muy recargados, los últimos
  se quedarían con su aspecto de siempre en esa partida.

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
- En **multijugador manda quien invita**: sus valores se usan en todos los
  dispositivos, de modo que todos ven y juegan con las mismas cifras.
- Los valores se validan y se recortan a un rango razonable, así que no es
  posible dejar el juego en un estado inservible desde el catálogo.

## Taller de edificios

Desde el menú principal, **Taller de edificios**: un editor 3D dentro del propio
juego para **rehacerle el modelo a los edificios que ya trae**. Aquí no se
inventan edificios nuevos: se elige uno —la casa, el molino, el castillo— y se
le hace otra cara. Lo que cuesta, lo que aguanta y lo que hace lo sigue poniendo
el juego (y el catálogo, si se retoca allí), así que el taller cambia cómo se ve
una partida sin poder desequilibrarla. Y siempre se puede **restablecer**.

**Lo primero al entrar es elegir el edificio**: una parrilla con todos los del
juego, en el mismo orden de la barra de obra, cada uno con la cara que tenga
ahora mismo y una línea que dice de quién es esa cara —la original del juego, la
que trae hecha el juego o la que le has hecho tú—. Al elegir uno se pone en la
mesa; **Elegir otro** vuelve a la parrilla, y desde ella se sale al menú. Esa
parrilla es la única lista de edificios que hay: elegido uno, la mesa habla
sólo de él.

En la pestaña **Edificio** está lo que se puede hacer con el que hay puesto:
**Compartir** lo saca como texto, **Importar** pega uno que te hayan pasado y
**Restablecer** le devuelve la cara que tenía. Debajo, su ficha —huella, edad,
coste, resistencia— y, plegado, empezar de nuevo por otra plantilla.

Un modelo se arma con **piezas** —cajas, cilindros, cúpulas, tejados a dos y a
cuatro aguas, faldones, vigas, ruedas, almenas, torreones, puertas, ventanas,
estandartes, escalinatas, cercas, pilas de troncos y barriles— colocadas sobre
la huella que ese edificio ocupa en el mapa, que es la que manda.

Los edificios que aún llevan su aspecto de siempre se ven en la mesa, pero su
modelo está escrito en código y no hecho de piezas, así que no se puede abrir y
retocar: se **empieza por una plantilla** (en blanco, cabaña, torreón,
cobertizo o casa grande) y desde ahí queda como se quiera. La plantilla se
ajusta sola a la huella del edificio, mida lo que mida.

La mesa de trabajo va despejada a propósito: encima del modelo sólo hay cuatro
controles, y lo demás sale en **menús desplegables** —**Añadir** abre la caja de
piezas y **Vista** el giro, el encaje, la rejilla y el color del jugador—.
Al elegir un edificio **se llega con todo plegado**: no hay más que el modelo, a
toda la tarjeta, y una tira de pestañas al lado. Es como se entra a mirarlo.
Tocar cualquier pestaña saca las herramientas, la vista previa, la columna de
edificios y el panel; el botón de la esquina, o volver a tocar la pestaña que ya
está puesta, lo pliega otra vez. Mientras no se toque el zoom ni el encuadre a
mano, el modelo se vuelve a encajar solo cada vez que la mesa cambia de alto;
en cuanto se toca, manda lo que haya puesto quien modela.

Para colocar:

- **Se coloca arrastrando**: pulsa una pieza en el modelo y muévela por el
  suelo. La rueda acerca y aleja, y arrastrar el fondo mueve la vista.
- Al elegir una pieza sale al pie del lienzo su **barra**, en cuatro piezas
  redondeadas con los botones dentro separados por un pelo, al modo de los
  mandos agrupados de iOS: las cuatro flechas **en cruz de dos por dos** la
  empujan un paso de rejilla en la dirección que se ve; subir y bajar van **uno
  encima de otro**; **estirar y encoger** tiene una columna por lado —ancho,
  largo y alto—, con las flechas dobles apuntando por el mismo diagonal por el
  que crece ese lado en la mesa; y duplicar y borrar cierran la fila. Las
  piezas no llaman igual a sus lados —la caja tiene ancho y fondo, el cilindro
  radios, la viga largo y grueso—, así que cada botón toca el campo que a esa
  pieza le hace de ese lado, los dos radios del cilindro a la vez para que no
  se vuelva cono, y se apaga en las que no lo tienen (un barril no se estira
  desde aquí). La barra es una rejilla de siete columnas, así que cabe igual en
  un teléfono pequeño que en uno grande. Los iconos están dibujados a
  trazo, todos con el mismo grosor, y borrar se distingue por el color del
  icono y no por un botón rojo entero. Sin pieza elegida no hay barra: al poner
  un edificio en la mesa se llega a verlo, no con una pieza cogida de antemano.
- Para **subir y bajar arrastrando**, el botón **Mover / Altura** (o mantener
  **Mayús**) cambia lo que hace el arrastre.
- **Girar vista** enseña el modelo desde otro lado sin tocar el edificio, que
  para eso la cámara del juego es fija.
- **Guía** pone una imagen de referencia —una foto, un dibujo, un boceto con
  transparencia— para copiarla: aparece **de pie sobre la huella**, al ancho de
  las casillas del edificio, y por delante del modelo a media opacidad, para
  que no la tapen las piezas. Se le regula la opacidad y el tamaño, se puede
  mandar detrás para calcar encima, y se coloca arrastrándola (con la rueda se
  agranda). Mientras está suelta el arrastre es suyo y no toca las piezas;
  cuando esté en su sitio, **Bloquear la imagen** la deja fija y se vuelve a
  modelar con normalidad. Se guarda en ese navegador, achicada, hasta que se
  quite. Las flechas del teclado y las de la barra giran con la vista:
  siempre empujan hacia donde apuntan en la pantalla.
- Con **teclado**: flechas para mover (con **Alt**, arriba y abajo), **Mayús**
  para ir de cuatro en cuatro, **Supr** borra y **Ctrl+Z** deshace.
- Mientras se arrastra, la mesa pinta las caras ordenadas de lejos a cerca, que
  es rápido y responde al dedo al instante; **en cuanto se suelta, hornea el
  modelo de verdad** y enseña ese sprite. Lo que se ve con la vista quieta es,
  píxel a píxel, lo que se verá en la partida —sombra y contorno incluidos—, así
  que no hay sorpresas al construirlo. Debajo están además las **tres etapas de
  obra horneadas** a tamaño de partida: cimientos, en obra y terminado. Las de
  en medio salen solas, no hay que modelarlas.
- En **Edificio** está la ficha de lo que pone el juego —huella, edad, coste,
  resistencia y qué hace—, para tenerla delante mientras se modela. Ahí no se
  toca nada de eso: sus números se retocan en el **catálogo**. Lo que hay ahí es
  **Restablecer** (devolverle su cara anterior) y **Empezar de nuevo** por otra
  plantilla.
- En **Colores** se le da color a cada material que use. El **color del
  jugador** no se elige: lo pone quien construya el edificio, así que conviene
  darle a alguna pieza (un estandarte, un paño) ese material.

### En móvil y tablet

El taller cabe en un teléfono sin renunciar a nada:

- El taller va **de borde a borde**, sin tarjeta ni marco: deja el mismo hueco
  por los cuatro lados —una sola ficha, `--marco`— y llega hasta el canto de
  abajo. Arriba sí respeta la zona segura, que es donde está el reloj.
- Las **esquinas de abajo copian las del teléfono**. No hay forma de
  preguntarle al navegador cuánto redondea la pantalla, así que se reconoce el
  modelo por lo que mide —del SE, con los cantos rectos, al 16 Pro Max— y la
  curva sale concéntrica con la suya: el radio de la pantalla menos el marco.
  Un modelo que no esté en la lista se lleva un valor intermedio, que un canto
  de más o de menos no rompe nada.
- **Los mandos, arriba; el modelo, abajo.** Bajo la cabecera van las pestañas
  —Pieza, Edificio y Colores—, el panel que toque y las
  herramientas, y el modelo se lleva de una pieza todo lo que queda. Al pie del
  propio lienzo va la barra de la pieza elegida, cuando hay una. De los paneles sólo se ve uno a la vez, y
  se **pliegan** con el botón de la esquina o tocando otra vez la pestaña que
  ya está puesta: entonces el modelo pasa del 43 % de la pantalla al 89 %. En
  apaisado la tira de pestañas se pone de pie a la derecha.
- **Un dedo** elige y arrastra piezas; con el botón **Altura** puesto, ese mismo
  arrastre las sube y las baja. **Dos dedos** acercan, alejan y mueven la vista,
  y nunca descolocan la pieza: al apoyar el segundo dedo, lo que hubiera movido
  el primero se deshace.
- Los toques tienen **margen**: si no aciertas de lleno en una pieza se coge la
  que tengas más cerca, que un dedo tapa más de lo que apunta. El margen es de
  toda su silueta, no sólo de su punto de anclaje, y dentro de él **manda la
  pieza que ya estuviera elegida**: fallar por unos píxeles junto a la que
  estás colocando no la suelta ni salta a la de al lado. Para cambiar de pieza
  se toca encima, que un acierto de lleno siempre gana; y para soltarla, en el
  suelo, lejos de todo.
- Los números llevan botones de **menos y más** para afinar sin sacar el
  teclado.

Lo que se hace aquí se guarda **en ese navegador** y se ve al momento en la
partida y en el catálogo, que además deja retocarle los colores a cualquier
edificio. Un modelo puede llegar a 200 piezas.

### El taller compartido

Con un proyecto de **Supabase** detrás, los modelos dejan de ser de un navegador:
se guardan en una tabla y **los ve todo el mundo**, en cualquier dispositivo.
Rehaces el molino en el móvil y sale rehecho en el ordenador y en el juego de
quien entre. En la cinta de arriba del taller se ve en qué anda («al día», «sin
enviar», «sin conexión»).

Sigue habiendo copia en el navegador, así que el juego arranca al instante y se
puede modelar sin cobertura: lo que hagas se guarda aquí y sale en cuanto haya
conexión. Los modelos que trae el código (`builtin-designs.js`) son el suelo:
por debajo de lo que diga la nube, y por encima el aspecto original.

Se configura en dos pasos, y están explicados en
[`supabase/README.md`](supabase/README.md): aplicar la migración de
`supabase/migrations/` (si el proyecto está conectado a este repositorio, se
aplica sola) y poner la dirección del proyecto y la clave *anon public* en
`js/data/cloud-config.js`. **Con esos dos valores en blanco el juego funciona
exactamente como siempre**, guardando sólo en el navegador.

Tal y como está montado, cualquiera que abra el juego puede rehacer o
restablecer cualquier edificio: no hay cuentas ni clave de edición. La tabla sí
impide que entre basura (edificio conocido, tope de piezas y de tamaño), y el
juego valida pieza a pieza al leer.

### Compartir el modelo de un edificio

Un modelo es sólo datos, así que cabe en una línea de texto y viaja por donde
sea:

- **Compartir** saca el modelo del edificio que tengas puesto como texto, con
  botones para copiarlo al portapapeles o descargarlo como fichero.
- **Importar** hace lo contrario: se pega el texto y ese modelo pasa a ser la
  cara del edificio que tengas puesto, se hiciera para el que se hiciera —se
  ajusta solo a su huella—. Así el mismo modelo sirve para vestir el molino o el
  cuartel, y es también la forma de llevarse una cara de un edificio a otro.
  Pasa por el mismo validador que todo lo demás, de modo que un texto raro se
  queda en un edificio soso y nunca en una partida rota.

Y para que un modelo deje de ser de un navegador y **le llegue a todo el
mundo**, su texto se pega en `js/data/builtin-designs.js`. Los de ese fichero
viajan con el código: se aplican al arrancar en cualquier dispositivo, sin que
nadie importe nada. Hay como mucho uno por edificio, y si quien juega le hace el
suyo a ese mismo edificio, el suyo manda mientras lo tenga.

La **casa** del juego es justo eso: su modelo sale del taller, con la ficha de
siempre (25 de madera, +5 de población, dos casillas).

Detalles a tener en cuenta:

- Al guardar en el taller manda el modelo sobre los colores de **ese** edificio:
  se retiran los retoques de aspecto que el catálogo tuviera puestos encima (sus
  números, y los del resto del juego, no se tocan).
- En **multijugador manda quien invita**: las caras de sus edificios viajan a los
  demás al empezar la partida y todos ven lo mismo en el mapa —también las que
  trae el juego, por si los dos lados no van con la misma versión—. Las propias
  vuelven al recargar la página, y nada de lo adoptado se sube a la nube.
- La nube se consulta **con el menú delante**, al arrancar y al abrir el taller,
  nunca a mitad de partida: un edificio no puede cambiar de dibujo de un
  fotograma al siguiente.

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

En **móvil y tablet** el dedo reparte el trabajo en dos gestos que no se pisan:
un **toque** manda la selección —coge lo que toques, cambia de unidad o suelta lo
que tuvieras al tocar el suelo— y **mantener el dedo** un momento da la orden
—moverse, recolectar, atacar, descargar en el centro urbano o un campamento,
plantar el punto de reunión de un cuartel— sin cambiar lo que tengas
seleccionado. Así un toque mal dado nunca manda a nadie a ninguna parte.
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
- **Catálogo** para consultar y editar todo el juego: sus valores y también el
  aspecto de cada objeto, con vista previa en vivo.
- **Taller de edificios**: modelado 3D dentro del juego para rehacerle la cara a
  cualquier edificio del juego, sin tocar lo que cuesta ni lo que hace. Con un
  proyecto de Supabase detrás, lo que se hace ahí lo ve todo el mundo.

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
js/sprites.js       Sprites: terreno a mano y horneado/caché de los renders 3D
js/studio.js        Taller de edificios: editor 3D dentro del juego
js/gfx3d/engine.js  Rasterizador 3D por software: proyección dimétrica, z-buffer,
                    luz, sombras y horneado a sprite
js/gfx3d/units.js   Modelos 3D de las unidades, con posturas y 8 orientaciones
js/gfx3d/buildings.js Modelos 3D de los edificios y sus etapas de obra
js/gfx3d/nodes.js   Modelos 3D de árboles, minas, bayas y animales
js/gfx3d/parts.js   Piezas del taller: el modelo de un edificio hecho de datos
js/gfx3d/GUIDE.md   Guía del sistema de arte: coordenadas, primitivas y flujo
tools/viewer.html   Visor de modelos: cada tipo a cualquier zoom, con todas sus
                    vistas y superposición de imágenes de referencia
tools/snapshot-models.mjs  Captura los modelos a PNG (necesita Playwright)
js/ai.js            IA de los rivales
js/ui.js            HUD, panel de órdenes, ratón, teclado y táctil
js/audio.js         Efectos de sonido sintetizados con WebAudio
js/catalog.js       Catálogo: fichas y edición de los datos del juego
js/data/appearance.js Colores y tamaño con los que se dibuja cada objeto
js/data/overrides.js  Valores editados: validación, guardado y aplicación
js/data/designs.js  Modelos del taller: validación, guardado y aplicación
js/data/builtin-designs.js  Modelos de edificio que vienen con el juego
js/data/cloud.js    El taller compartido: los modelos, contra la API de Supabase
js/data/cloud-config.js  A qué proyecto de Supabase se conecta (o a ninguno)
supabase/migrations/  La tabla de los modelos y sus permisos
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

- La interfaz va en **claro**: papel de fondo, tinta para las letras y el
  dorado de siempre para lo que manda. Los tonos que se repiten están en las
  fichas de `:root` (`--papel`, `--tinta`, `--tinta-2`, `--tinta-3`, `--borde`,
  `--gold`, `--gold-l`), así que se repinta todo desde ahí. Cada letra llega a
  4,5:1 contra su fondo y el borde de los controles a 3:1, que es lo que hace
  falta para que un tema claro se lea. El arte del juego —el mapa, los sprites
  y el lienzo verde del taller— no es interfaz y no cambia.
- `theme-color` en blanco tiñe las barras del navegador y, con ellas, la franja
  del reloj y la batería del teléfono. Es sólo el tinte del navegador: no toca
  la pantalla completa ni las zonas seguras, que tienen su propia historia en
  `CLAUDE.md`.
- El terreno se dibuja una sola vez en un lienzo fuera de pantalla y se compone
  con transformaciones; la niebla se calcula a un quinto de resolución y sólo se
  rehace cuando cambian la cámara o la visibilidad.
- Los sprites se hornean una vez por combinación de tipo, color, orientación y
  fotograma, y se guardan en caché. Las unidades miran en ocho direcciones pero
  sólo se hornean cinco: las otras tres salen volteando el mapa de bits, igual
  que hacía el original con sus SLP.
- El horneado rasteriza a 2× con sobremuestreo, endurece el borde y oscurece el
  perfil: interior suave, silueta a un bit. Al acercar la cámara se ven los
  píxeles del sprite, como al ampliar el clásico.
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
Ensemble Studios. No contiene ningún recurso de *Age of Empires*: todo el
contenido audiovisual se genera por código dentro de este repositorio.
