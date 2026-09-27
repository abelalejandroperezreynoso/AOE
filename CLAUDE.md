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
- Las unidades, los edificios y los recursos son sprites: atlas PNG en
  `assets/sprites/` con su `indice.json` (hoja, posición y anclaje de cada uno).
  Hay una hoja de unidades y otra de edificios por color de jugador, y una de
  recursos, y las unidades dibujadas a mano llevan la suya por color
  (`villager-<color>.png`). Un sprite nuevo o cambiado tiene que respetar ese
  formato: cinco orientaciones (las otras tres se voltean), tres etapas por
  edificio y los ocho colores. Los fotogramas de cada unidad los dice `anim`
  en el índice (por defecto, cuatro de andar y dos de golpe). Una hoja
  dibujada entra con `tools/importar-unidad.mjs`, y un edificio con
  `tools/importar-edificio.mjs`; el original se guarda en `assets/fuentes/`.
  El explorador se dibuja por código con `tools/dibujar-jinete.mjs`. El terreno, los iconos de
  tecnologías y el sonido siguen generándose por código.
- Los modelos 3D por código y el taller de edificios se retiraron para no
  volver, y se borraron también del historial: no hay commit del que
  recuperarlos.
- El README documenta el juego, la estructura del código y las notas técnicas.

## Verificación

No hay suite de pruebas.

- Sintaxis: `node --check` sobre el módulo tocado.
- A mano: `npm start` levanta el juego y la sala en `http://localhost:8000`.
- Comportamiento y aspecto: Chromium viene preinstalado en `/opt/pw-browsers`.
  Sirve para medir la maquetación y tomar capturas a tamaño de teléfono
  (375×812 aproxima el iPhone que se usa para jugar).

## Trampas conocidas

- **La pantalla completa en el móvil se ha intentado tres veces y las tres se
  han revertido.** No lo intentes una cuarta sin una captura del teléfono
  delante: los tres arreglos salieron bien en todas las pruebas y ninguno
  funcionó en el aparato, así que probar a ciegas ya sólo gasta despliegues.

  El efecto que se busca —el contenido pasando por debajo del reloj, como en la
  aplicación de finanzas del usuario— lo da
  `apple-mobile-web-app-status-bar-style` en `black-translucent`. Su precio es
  que iOS le dice a la página que mide 762 en una pantalla de 812 —los 50 de la
  franja del reloj— pero la coloca empezando arriba del todo: esos 50 sobran
  por abajo. Medido en el aparato, en un iPhone de 375×812 instalado: `vh` y
  `lvh` dan 812; `dvh`, `svh`, `innerHeight` e `inset: 0`, 762.

  Gastados, y sin que la franja se fuera:

  1. medir la pantalla a mano con `visualViewport` (`fe5c2b9`): la medida
     encoge con el teclado, en iOS el teclado se cierra sin soltar el campo y
     se quedaba clavada, dejando media pantalla en negro;
  2. maquetar contra `100vh` en modo aplicación en vez de `inset: 0`
     (`ef9a008`, y otra vez `7c4fd20`): «solo moviste todo el contenido hacia
     arriba, pero ahora el espaciado lo tengo abajo»;
  3. no depender del alto: el fondo al lienzo de la ventana con el fondo de
     `html`, que cubre la pantalla física entera, y las pantallas sin fondo
     propio (`8d1b470`): «no funciona».

  Los revertidos son `68d2ac7`, `00bffe4` y `435afb1`.

  **Lo que falta por saber, y sin ello no hay cuarto intento**: si el teléfono
  llegó a ejecutar el código nuevo. Los despliegues de agosto se persiguieron
  dos veces contra la copia guardada, y en los tres intentos el usuario ha
  respondido sin poder confirmarlo. Lo que hay que reponer primero es lo que se
  quitó con todo lo demás: el marcador de versión en la letra pequeña del menú
  y `diag.html` (`fbbe36a`), la página que mide en el propio aparato —sin
  ninguna regla de estilo del juego, que cualquiera podría ser la culpable— y
  dice qué vale cada unidad, las zonas seguras y el modo.

  Queda además una vía sin probar, y es renunciar al efecto: `status-bar-style`
  en `default` o `black`, dejando que iOS se reserve la franja. Entonces no
  sobra nada por ningún lado y el juego se abre sin barras de navegador, pero
  el contenido no pasa por debajo del reloj, que era la parte que gustaba.

- **IDs y funciones en archivos grandes.** Un `getElementById` que apunta a un
  elemento que ya no está revienta con `TypeError` y aborta el resto de la
  función sin aviso visible. Al tocar el HUD o el catálogo conviene comprobar que
  los ids referenciados existan.
