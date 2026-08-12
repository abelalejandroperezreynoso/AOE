// Edificios del taller que vienen con el juego.
//
// Un diseño hecho en el taller vive en el navegador de quien lo hizo. Los que
// se ponen aquí viajan con el código: se dan de alta al arrancar, en todos los
// dispositivos y sin que nadie tenga que importar nada, igual que la casa o el
// castillo. Es la forma de que un edificio bueno deje de ser de uno y pase a
// ser del juego.
//
// Para añadir uno:
//
//   1. Diséñalo en el taller (menú principal → Taller de edificios).
//   2. En la lista de tus edificios, **Compartir** → **Copiar**: sale el diseño
//      entero como una línea de JSON.
//   3. Pega esa línea en la lista de abajo y cámbiale el `id` por uno que
//      empiece por `b_` (los `c_` son los que hace cada jugador en su
//      navegador; los `b_` son los que trae el juego). Con eso basta: el resto
//      se valida y se recorta solo al cargar.
//
// Los de aquí salen en el taller marcados como «del juego» y no se pueden
// editar ni borrar desde la interfaz —son de todos, no de un navegador—, pero
// se duplican con un botón y la copia ya es tuya para cambiarla.

export const BUILTIN_DESIGNS = [
  // Todavía no hay ninguno: los que se peguen aquí les llegan a todos.
];
