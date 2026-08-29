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

- **La pantalla completa en el móvil se ha intentado dos veces y se ha
  revertido dos veces.** No lo vuelvas a intentar por el mismo camino sin
  medir antes en el teléfono.

  Con `apple-mobile-web-app-status-bar-style` en `black-translucent` el
  contenido sí llega arriba —que es lo que se pide—, pero iOS descuenta la
  franja de la hora del alto de la página y **empieza a pintar arriba del
  todo**, así que esos píxeles sobran por abajo y aparece una franja muerta.
  Medido en un iPhone de 375×812 con el juego instalado: `vh` y `lvh` dan 812;
  `dvh`, `svh`, `innerHeight` e `inset: 0`, 762.

  Descartado ya, y sin que la franja se fuera:

  - medir la pantalla a mano con `visualViewport` (`1506810`): esa medida encoge
    con el teclado, en iOS el teclado se cierra sin soltar el campo, y la medida
    guardada se quedaba clavada dejando media pantalla en negro;
  - maquetar contra `100vh` en modo aplicación en vez de `inset: 0` (`c9bf985`,
    y otra vez en `da25624`): venía medido en el aparato y comprobado imitándolo
    en un navegador, y en el teléfono la franja siguió ahí.

  Los dos revertidos son `db352fe` y el que deshizo `da25624`.

  Lo que **no** se ha probado es lo contrario: dejar que iOS se reserve la
  franja —`status-bar-style` en `default` o `black`, sin `black-translucent`—.
  Entonces no hay banda que sobre, y esa franja la pinta el sistema con el
  fondo de `<html>`, así que se disimula haciendo que ese fondo sea el del
  elemento que quede pegado arriba. El contenido no pasa por debajo del reloj,
  que era la parte que gustaba.

- **IDs y funciones en archivos grandes.** Un `getElementById` que apunta a un
  elemento que ya no está revienta con `TypeError` y aborta el resto de la
  función sin aviso visible. Al tocar el HUD o el taller conviene comprobar que
  los ids referenciados existan.
