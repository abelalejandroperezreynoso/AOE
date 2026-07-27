# Age of Realms II

Juego de **estrategia medieval en tiempo real** para navegador, inspirado en los
clásicos del género. Recolecta recursos, haz crecer tu aldea, avanza por cuatro
edades y conquista a tus rivales.

No necesita instalación, servidor de aplicaciones ni compilación: es HTML, CSS y
JavaScript modular puro. Todo el arte (unidades, edificios, terreno, iconos) y
todo el sonido se **generan por código** en tiempo de ejecución, así que el juego
completo pesa unos pocos cientos de kilobytes y no descarga ningún recurso
externo.

## Jugar

Sirve la carpeta con cualquier servidor estático:

```bash
python3 -m http.server 8000
# y entra en http://localhost:8000
```

Hace falta un servidor (no vale abrir el archivo con `file://`) porque el juego
usa módulos ES.

## Publicar en Netlify

El repositorio está listo para desplegarse tal cual:

- **Desde Git**: conecta el repositorio en Netlify. `netlify.toml` indica que no
  hay comando de compilación y que la carpeta a publicar es la raíz.
- **Arrastrando**: suelta la carpeta del proyecto en [Netlify Drop](https://app.netlify.com/drop).
- **Con la CLI**: `npx netlify-cli deploy --prod --dir=.`

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
| Ayuda | `F1` |

En **móvil y tablet**: un toque selecciona lo tuyo, un toque en el suelo da la
orden a lo que tengas seleccionado, arrastrar mueve la cámara y pellizcar acerca
o aleja.

### Bucle de juego

1. **Economía.** Manda aldeanos a bayas, ovejas, ciervos, árboles, oro y piedra.
   Levanta molinos y campamentos junto a los yacimientos para acortar los viajes,
   y granjas cuando se agote la caza.
2. **Población.** Cada casa da 5 de población; el centro urbano, 5; el castillo, 20.
3. **Edades.** Desde el centro urbano se avanza a Feudal, Castillos e Imperial.
   Cada edad exige edificios de la anterior y desbloquea unidades, edificios y
   mejoras nuevas.
4. **Ejército.** El triángulo básico: los lanceros destrozan a la caballería, los
   guerrilleros a los arqueros y la caballería a los arqueros y a la artillería.
   Arietes y trabuquetes son para derribar edificios.
5. **Victoria.** Gana quien destruya todo lo que tengan sus rivales.

## Contenido

- **4 edades**, 20 tipos de unidad y 15 edificios distintos.
- **11 tecnologías** (armas, armaduras, arquería, economía) y 7 mejoras de línea
  que transforman las unidades ya creadas.
- **Mapas aleatorios** con semilla reproducible, en tres tamaños y con hasta
  3 rivales.
- **IA rival** que reparte a sus aldeanos por proporciones de recursos, ahorra
  para subir de edad, se expande, investiga, defiende su base y ataca por oleadas
  crecientes. Tres niveles de dificultad.
- Niebla de guerra, minimapa, puntos de reunión, colas de producción, mercado de
  recursos, control de velocidad (1x a 3x) y estadísticas finales.

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

## Aviso legal

Proyecto original de aficionados, sin relación alguna con Microsoft ni con
Ensemble Studios. No contiene ningún recurso de *Age of Empires*: todo el
contenido audiovisual se genera por código dentro de este repositorio.
