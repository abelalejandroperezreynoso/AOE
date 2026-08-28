# El taller compartido

Aquí vive lo único que el juego guarda fuera del navegador: **la cara de cada
edificio**, la que se le hace en el taller. Con esto, rehacer el molino desde el
móvil se ve en el ordenador y en el juego de cualquiera que entre.

Lo demás no sale de aquí. La partida se juega entre navegadores (WebRTC), la
sala de espera es una función de Netlify y los valores del catálogo siguen
siendo de cada quien.

## Poner el proyecto en marcha

1. **Aplica la migración.** Por cualquiera de estos tres caminos:

   - **Fusionando a la rama que vigila la integración.** Si el proyecto está
     conectado a este repositorio (panel de Supabase → Integrations → GitHub),
     aplica las migraciones de esta carpeta al llegar algo a su *production
     branch*. Para que funcione tienen que cuadrar tres cosas en esa pantalla:
     el repositorio conectado, que la rama vigilada sea a la que fusionas
     (normalmente `main`) y que el directorio apuntado sea `supabase`.
   - **Pegando el SQL a mano.** El contenido de `migrations/` en el SQL Editor
     del panel, y ejecutar. Es lo más corto y no depende de nada.
   - **Con la CLI**, si la tienes enlazada:

     ```bash
     supabase link --project-ref fylzlwhxqaaehwrwuynt
     supabase db push
     ```

   La migración está escrita para poder aplicarse dos veces sin romper nada, así
   que da igual pegarla a mano y luego fusionar.

2. **Apunta el juego al proyecto.** Ya está hecho: en `js/data/cloud-config.js`
   están la dirección del proyecto y su clave **anon public**, los dos valores
   que salen del panel en *Settings → API*. Si algún día se cambia de proyecto,
   se sustituyen ahí; con los dos en blanco el juego funciona igual que siempre,
   guardando sólo en el navegador.

Mientras la tabla no exista, el taller lo dice en su cinta de arriba («falta la
tabla») y se sigue trabajando contra el navegador, sin perder nada: lo hecho
queda apuntado y sube en cuanto la tabla esté.

La clave *anon* es pública a propósito: viaja al navegador de quien juega y no
hay forma de esconderla. Quien manda de verdad son las políticas de la tabla.
La clave *service_role* no pinta nada en este juego y no debe acabar nunca en
el repositorio.

El `config.toml` de al lado es lo que marca esta carpeta como un proyecto de
Supabase, que es lo que la CLI y la integración buscan. Va al mínimo a
propósito: aquí no se levanta Supabase en local, así que los cientos de ajustes
de desarrollo que genera `supabase init` sólo serían ruido.

## Qué hay en la tabla

`public.building_models`, una fila por edificio:

| columna      | qué es                                                        |
| ------------ | ------------------------------------------------------------- |
| `target`     | el edificio del juego al que viste: `house`, `mill`, `castle`… |
| `model`      | el modelo entero: `{ target, size, palette, parts }`           |
| `updated_at` | cuándo se tocó por última vez (lo lleva un disparador)          |

La ficha del edificio —lo que cuesta, lo que aguanta, lo que entrena— **no está
aquí** ni tiene por qué: la pone el juego. De la tabla sale sólo el aspecto.

## Quién puede qué

Tal y como está, **cualquiera que abra el juego puede rehacer o restablecer
cualquier edificio**, sin registrarse. Es una decisión deliberada y tiene su
precio: con la clave anon a la vista, cualquiera puede repintar el juego de
todos o dejar un edificio como estaba, y no hay forma de distinguir quién fue.

Lo que sí impide la tabla es que entre basura: el `target` tiene que parecer el
nombre de un edificio, el modelo tiene que decir que viste a ese mismo edificio,
no puede pasar de 200 piezas y no puede pasar de 64 KB. Eso corta que alguien
use la tabla de almacén o meta un modelo que el juego no sabría leer; el
validador del juego, además, recorta pieza a pieza al leer.

Si algún día hace falta cerrarlo, la forma más corta sin montar cuentas es una
clave de edición: una tabla `settings` con la clave, y cambiar las políticas de
escritura por una que la compruebe. Las de lectura pueden quedarse como están.
