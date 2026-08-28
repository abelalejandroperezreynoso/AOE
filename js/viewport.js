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
 * Es lo que se veía: una franja muerta abajo cortando el contenido. Así que no
 * se maqueta contra ninguna de las dos a ciegas. Se pregunta por la ventana
 * visual —`visualViewport`, lo que el usuario tiene delante— y su alto se
 * publica en `--app-h`, que es de lo que cuelgan la partida y las
 * superposiciones. Sin `visualViewport` se cae al alto de la raíz, que es lo
 * que se hacía antes.
 */

/** ¿Hay algo escrito a medias? Entonces el teclado está abierto. */
function editando() {
  const a = document.activeElement;
  if (!a) return false;
  return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable;
}

/**
 * Publica en `--app-h` el alto de lo que se ve y lo mantiene al día.
 * Se llama una vez al arrancar, antes de nada: la miden ya el menú y todas las
 * superposiciones, no sólo la partida.
 */
export function watchViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  let last = 0;
  let settle = 0;

  const apply = () => {
    /*
     * Con el teclado abierto la ventana visual encoge hasta la mitad. Encoger
     * la partida con ella sería rehacer la maquetación entera para escribir un
     * nombre en la sala, así que mientras se escribe se deja como estaba; al
     * salir del campo (`focusout`) se vuelve a medir.
     */
    if (editando()) return;
    let h = root.clientHeight;
    /*
     * El pellizco para acercar también encoge la ventana visual, y ahí lo que
     * cambia es la lupa, no la pantalla. La página lo lleva desactivado, pero
     * hay navegadores que lo permiten igual: con la lupa puesta, la medida
     * buena sigue siendo la de la raíz.
     */
    if (vv && vv.scale <= 1.01 && vv.height > 0) h = Math.round(vv.height);
    if (!h || h === last) return;
    last = h;
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
