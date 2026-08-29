# Age of Realms II

Juego de estrategia en tiempo real que corre en el navegador. Son archivos
estáticos: HTML, CSS y módulos de JavaScript servidos tal cual, sin compilar ni
empaquetar. Se edita el archivo y se recarga la página. La única dependencia
(`@netlify/blobs`) es de la función de la sala de espera, no del juego.

## Flujo de trabajo con git

**Fusiona siempre los cambios a `main` al terminar.** No hay que preguntar ni
esperar aprobación: desarrolla en la rama que corresponda, haz commit, y
enseguida fusiona a `main` y empuja.

```
git checkout main
git merge --ff-only <rama>
git push -u origin main
```

Única excepción: si el merge **no** es limpio porque `main` avanzó por otro
lado, no lo fuerces — avisa primero y resuelve el conflicto de común acuerdo.

No abras pull requests salvo que se pidan explícitamente.

Los mensajes de commit van en español, y dicen qué se ha comprobado.

## Convenciones

- Textos de interfaz, nombres de variables y comentarios: en español.
- Todo el arte se genera por código: no hay imágenes de dibujo a mano. Los
  sprites se hornean desde los modelos de `js/gfx3d/`.
- El README documenta el juego, la estructura del código y las notas técnicas;
  `js/gfx3d/GUIDE.md`, el sistema de arte.

## Verificación

No hay suite de pruebas.

- Sintaxis: `node --check` sobre el módulo tocado.
- A mano: `npm start` levanta el juego y la sala en `http://localhost:8000`.
- Comportamiento y aspecto: Chromium viene preinstalado en `/opt/pw-browsers`.
  Sirve para medir la maquetación y tomar capturas a tamaño de teléfono
  (375×812 aproxima el iPhone que se usa para jugar).

## Trampas conocidas

- **Instalado en el móvil, la pantalla no mide lo que dice medir.** Con
  `apple-mobile-web-app-status-bar-style` en `black-translucent` el contenido
  llega arriba —pasa por debajo del reloj, que es lo que se pide—, pero iOS le
  dice a la página que mide 762 en una pantalla de 812 —los 50 de la franja del
  reloj— y la coloca empezando arriba del todo: esos 50 sobran por abajo.
  Medido en el iPhone donde falla, de 375×812: `vh` y `lvh` dan 812; `dvh`,
  `svh`, `innerHeight` e `inset: 0`, 762. **No hay ninguna medida en CSS con la
  que una capa acierte con la pantalla**, y dos intentos de encontrarla
  acabaron revertidos (`db352fe` y el revertido de `da25624`): medirla a mano
  con `visualViewport` se queda vieja con el teclado, y maquetar contra `100vh`
  no funcionó en el teléfono aunque saliera bien en todas las pruebas.

  Por eso **el fondo de las pantallas no lo pinta ninguna capa: lo pinta el
  lienzo de la ventana**, con el fondo de `html`. El navegador propaga el fondo
  de la raíz a la pantalla física entera, por encima del reloj y por debajo del
  último píxel, sin depender de que nada acierte con el alto. Que en iOS lo hace
  está comprobado en el aparato: cuando había franja, era exactamente del color
  de fondo del juego (`72edbbd`). Lo que fallaba era el color, no el lienzo.

  De ahí las reglas:

  - una pantalla entera lleva `class="overlay pantalla"` y **no pinta fondo**;
    el `background-color` de `html` es el color en que acaba su degradado, y
    ese degradado va con `no-repeat` o se repite en los 50 px que faltan;
  - las capas que se abren **encima** de otra cosa (pausa, fin, invitación,
    compartir) sí llevan su atenuado: son pequeñas y centradas, y que su borde
    no llegue al filo no se nota;
  - la única que tiene que medir la pantalla de verdad es la partida (`#app`),
    porque el mapa y las dos barras se reparten ese alto. Lo que le falta a
    `100%` es exactamente `--sa-top`, y así se lo suma la regla bajo
    `(display-mode: standalone)`. Donde iOS no falla, `--sa-top` vale cero.

  **Una pantalla nueva va igual**: `.pantalla`, sin fondo propio.

  Un cambio en el manifiesto sólo se aplica **quitando el icono de la pantalla
  de inicio y volviéndolo a añadir**: iOS congela el que había. Y en la letra
  pequeña del menú va la versión, que es lo único que distingue «el arreglo no
  sirve» de «el móvil trae la copia de antes» — ya pasó dos veces.

- **IDs y funciones en archivos grandes.** Un `getElementById` que apunta a un
  elemento que ya no está revienta con `TypeError` y aborta el resto de la
  función sin aviso visible. Al tocar el HUD o el taller conviene comprobar que
  los ids referenciados existan.
