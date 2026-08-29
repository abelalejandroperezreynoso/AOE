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

- **Instalado en el móvil, la pantalla no mide lo que dice medir.** En modo
  aplicación iOS descuenta la franja de la hora del alto de la página pero
  empieza a pintar arriba del todo, así que esos píxeles sobran por abajo y
  aparece una franja muerta. `inset: 0`, `height: 100%`, `innerHeight`, `dvh` y
  `svh` valen todos lo mismo y ninguno sirve; sólo `vh` da la pantalla entera.
  Por eso la partida (`#app`) y las superposiciones (`.overlay`) cuelgan de
  `--app-h`, y **cualquier capa nueva que tenga que llegar al filo va igual**.
  Las medidas del aparato donde falla y el porqué están en el CSS, junto a la
  variable, y en «Instalado en el móvil» del README.

  Esto ya costó un revertido entero (`db352fe`): se dio por culpables a las
  etiquetas de iOS, que no lo eran. Medir con `visualViewport` también se probó
  y salió peor.

- **IDs y funciones en archivos grandes.** Un `getElementById` que apunta a un
  elemento que ya no está revienta con `TypeError` y aborta el resto de la
  función sin aviso visible. Al tocar el HUD o el taller conviene comprobar que
  los ids referenciados existan.
