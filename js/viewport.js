/*
 * Cuánto mide de verdad lo que se ve.
 *
 * En un móvil, "toda la pantalla" no es un número: el navegador maqueta contra
 * una ventana (la de `position: fixed`, `inset: 0` y `height: 100%`) y enseña
 * otra distinta, la que queda libre entre sus barras. Las dos se separan en
 * los dos sentidos y las dos se notan:
 *
 * - Si la de maquetar es la más alta, la barra de abajo del juego cae por
 *   debajo del filo visible y se queda cortada.
 * - Si es la más baja, sobra una franja del color del fondo entre el juego y
 *   el borde de la pantalla, y el mapa se recorta justo donde empieza.
 *
 * Y no se separan sólo de alto: también de dónde empiezan. Hay navegadores
 * —Safari en iOS— que ponen su barra de direcciones *encima* de la ventana de
 * maquetar en vez de por fuera. Ahí, un `top: 0` cae por debajo del filo
 * visible: la interfaz se dibuja tapada por la barra del navegador, y como lo
 * que sobra sale por el otro lado parece que todo se haya subido para esquivar
 * el hueco de arriba, con la franja vacía abajo.
 *
 * Es lo que se veía: una franja muerta abajo cortando el contenido. Así que no
 * se maqueta contra ninguna de las dos a ciegas. Se pregunta por la ventana
 * visual —`visualViewport`, lo que el usuario tiene delante— y se publican las
 * dos cosas: dónde empieza en `--app-t` y cuánto mide en `--app-h`. De ellas
 * cuelgan la partida y las superposiciones. Sin `visualViewport` se cae al
 * alto de la raíz y a empezar en cero, que es lo que se hacía antes.
 */

/** ¿Hay algo escrito a medias? Entonces el teclado está abierto. */
function editando() {
  const a = document.activeElement;
  if (!a) return false;
  return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable;
}

/**
 * Publica en `--app-t` y `--app-h` dónde empieza y cuánto mide lo que se ve, y
 * lo mantiene al día. Se llama una vez al arrancar, antes de nada: las miden
 * ya el menú y todas las superposiciones, no sólo la partida.
 */
export function watchViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  let last = '';
  let settle = 0;

  const apply = () => {
    /*
     * Con el teclado abierto la ventana visual encoge hasta la mitad. Encoger
     * la partida con ella sería rehacer la maquetación entera para escribir un
     * nombre en la sala, así que mientras se escribe se deja como estaba; al
     * salir del campo (`focusout`) se vuelve a medir.
     */
    if (editando()) return;
    let h = root.clientHeight, t = 0;
    /*
     * El pellizco para acercar también encoge la ventana visual y la desplaza,
     * y ahí lo que cambia es la lupa, no la pantalla. La página lo lleva
     * desactivado, pero hay navegadores que lo permiten igual: con la lupa
     * puesta, la medida buena sigue siendo la de la raíz empezando en cero.
     */
    if (vv && vv.scale <= 1.01 && vv.height > 0) {
      h = Math.round(vv.height);
      /*
       * Cuánto queda tapado por arriba. En los navegadores que dejan su barra
       * por fuera de la página esto vale cero y no cambia nada; en los que la
       * ponen encima es justo lo que hay que bajar la interfaz para que se vea
       * entera. Nunca negativo: durante el rebote de un desplazamiento hay
       * quien contesta con un número por debajo de cero un instante.
       */
      t = Math.max(0, Math.round(vv.offsetTop));
    }
    const key = `${t}/${h}`;
    if (!h || key === last) return;
    last = key;
    root.style.setProperty('--app-t', `${t}px`);
    root.style.setProperty('--app-h', `${h}px`);
  };

  /*
   * Al girar, y al entrar y salir de pantalla completa, hay navegadores que
   * durante la animación contestan con las medidas de antes, y si el último
   * aviso llega con las viejas nadie vuelve a corregirlo. Se remide un par de
   * veces después, que son dos lecturas y sólo escriben si de verdad cambia.
   */
  const applyLater = () => {
    apply();
    clearTimeout(settle);
    settle = setTimeout(apply, 200);
    setTimeout(apply, 600);
  };

  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', applyLater);
  window.addEventListener('pageshow', applyLater);
  window.addEventListener('focusout', () => setTimeout(apply, 50));
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange']) {
    document.addEventListener(ev, applyLater);
  }
  applyLater();
}
