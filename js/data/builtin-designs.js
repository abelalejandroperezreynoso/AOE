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
// Un diseño con `replaces: '<tipo>'` no es un edificio nuevo: es **la cara de
// uno que ya existe** (la casa, el molino, el cuartel...). Entonces su ficha no
// pinta nada —lo que cuesta, lo que aguanta y lo que hace lo sigue poniendo el
// juego— y su modelo se ajusta solo a la huella de ese edificio. Es la forma de
// cambiarle el aspecto a algo del juego sin tocar el equilibrio.
//
// Los de aquí salen en el taller marcados como «del juego» y no se pueden
// editar ni borrar desde la interfaz —son de todos, no de un navegador—, pero
// se duplican con un botón y la copia ya es tuya para cambiarla.

export const BUILTIN_DESIGNS = [
  // La casa de aldea: le da la cara al edificio «Casa» del juego, que sigue
  // costando lo mismo, dando la misma población y midiendo sus dos casillas.
  {"id":"b_casa2x2","name":"Casa","desc":"Casa de aldea con basamento, entramado y tejado a cuatro aguas.","replaces":"house","size":2,"palette":{"wall":"#d8cba6","wall2":"#c6c0ad","stone":"#9a9a94","base":"#ab9668","wood":"#8a6234","roof":"#a8452f","thatch":"#b09a62","door":"#3b2a17","accent":"#c9553f","chimney":"#5c5c58","ground":"#948763","soil":"#8a6a3c","crop":"#a8c24a","glow":"#ff9a3c"},"parts":[{"k":"box","x":1,"y":1,"z":0,"w":1.8,"d":1.8,"h":0.15,"yaw":0,"m":"base"},{"k":"box","x":1,"y":1,"z":0.15,"w":0.9,"d":0.95,"h":0.4,"yaw":0,"m":"stone"},{"k":"box","x":1,"y":1,"z":0.55,"w":0.55,"d":0.7,"h":0.4,"yaw":0,"m":"wall"},{"k":"beam","x":1.1,"y":0.25,"z":0.2,"len":0.4,"yaw":0,"pitch":90,"th":0.02,"m":"wood"},{"k":"beam","x":1.85,"y":1,"z":0.55,"len":0.4,"yaw":0,"pitch":90,"th":0.02,"m":"wood"},{"k":"beam","x":1.85,"y":1.75,"z":0.55,"len":0.4,"yaw":0,"pitch":90,"th":0.02,"m":"wood"},{"k":"hip","x":1,"y":1,"z":0.95,"w":1,"d":0.65,"rise":0.5,"over":0.14,"m":"roof"},{"k":"door","x":1.55,"y":0.95,"z":0.15,"w":0.35,"h":0.4,"face":"x","m":"door"},{"k":"window","x":1,"y":1.85,"z":0.65,"w":0.15,"h":0.15,"face":"y","m":"wood"},{"k":"stairs","x":1.95,"y":1,"z":0,"w":0.45,"d":0.2,"h":0.15,"steps":2,"axis":"x","m":"base"},{"k":"flag","x":0.25,"y":0.25,"z":0.95,"h":0.4,"m":"player"}]},
];
