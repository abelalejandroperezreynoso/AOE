// Los modelos de edificio que vienen con el juego.
//
// Un modelo hecho en el taller vive en el navegador de quien lo hizo. Los que
// se ponen aquí viajan con el código: se aplican al arrancar, en todos los
// dispositivos y sin que nadie tenga que importar nada. Es la forma de que un
// edificio bien resuelto deje de ser de uno y pase a ser la cara que ese
// edificio tiene en el juego.
//
// Un modelo **no es un edificio nuevo**: es la cara de uno que ya existe. Su
// campo `target` dice a cuál viste (`house`, `mill`, `barracks`...), su ficha
// —lo que cuesta, lo que aguanta y lo que hace— la sigue poniendo el juego, y
// su modelo se ajusta solo a la huella de ese edificio.
//
// Para añadir uno:
//
//   1. Hazlo en el taller (menú principal → Taller de edificios), sobre el
//      edificio al que quieras cambiarle la cara.
//   2. **Compartir** → **Copiar**: sale el modelo entero como una línea de JSON,
//      con su `target` puesto.
//   3. Pega esa línea en la lista de abajo. Con eso basta: el resto se valida y
//      se recorta solo al cargar.
//
// Aquí hay como mucho una entrada por edificio: si hubiera dos para el mismo,
// manda la primera. Y si quien juega le hace el suyo a ese mismo edificio, el
// suyo manda sobre este mientras lo tenga.

export const BUILTIN_DESIGNS = [
  // La casa de aldea: le da la cara al edificio «Casa» del juego, que sigue
  // costando lo mismo, dando la misma población y midiendo sus dos casillas.
  {"target":"house","size":2,"palette":{"wall":"#d8cba6","wall2":"#c6c0ad","stone":"#9a9a94","base":"#ab9668","wood":"#8a6234","roof":"#a8452f","thatch":"#b09a62","door":"#3b2a17","accent":"#c9553f","chimney":"#5c5c58","ground":"#948763","soil":"#8a6a3c","crop":"#a8c24a","glow":"#ff9a3c"},"parts":[{"k":"box","x":1,"y":1,"z":0,"w":1.8,"d":1.8,"h":0.15,"yaw":0,"m":"base"},{"k":"box","x":1,"y":1,"z":0.15,"w":0.9,"d":0.95,"h":0.4,"yaw":0,"m":"stone"},{"k":"box","x":1,"y":1,"z":0.55,"w":0.55,"d":0.7,"h":0.4,"yaw":0,"m":"wall"},{"k":"beam","x":1.1,"y":0.25,"z":0.2,"len":0.4,"yaw":0,"pitch":90,"th":0.02,"m":"wood"},{"k":"beam","x":1.85,"y":1,"z":0.55,"len":0.4,"yaw":0,"pitch":90,"th":0.02,"m":"wood"},{"k":"beam","x":1.85,"y":1.75,"z":0.55,"len":0.4,"yaw":0,"pitch":90,"th":0.02,"m":"wood"},{"k":"hip","x":1,"y":1,"z":0.95,"w":1,"d":0.65,"rise":0.5,"over":0.14,"m":"roof"},{"k":"door","x":1.55,"y":0.95,"z":0.15,"w":0.35,"h":0.4,"face":"x","m":"door"},{"k":"window","x":1,"y":1.85,"z":0.65,"w":0.15,"h":0.15,"face":"y","m":"wood"},{"k":"stairs","x":1.95,"y":1,"z":0,"w":0.45,"d":0.2,"h":0.15,"steps":2,"axis":"x","m":"base"},{"k":"flag","x":0.25,"y":0.25,"z":0.95,"h":0.4,"m":"player"}]},
];
