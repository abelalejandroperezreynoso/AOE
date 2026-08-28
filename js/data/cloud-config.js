// A qué proyecto de Supabase se conecta el taller.
//
// Los dos valores salen del panel de Supabase, en Settings → API: la dirección
// del proyecto y la clave **anon public**. Esa clave es pública a propósito —va
// en el propio navegador de quien juega, no hay forma de esconderla— y quien
// manda de verdad son las políticas de la tabla, que están en
// `supabase/migrations/`. La clave *service_role* no pinta nada aquí y no debe
// acabar nunca en este fichero.
//
// Con los dos en blanco el juego funciona igual que siempre: el taller guarda
// en el navegador y no habla con nadie.
//
// Para probar contra otro proyecto sin tocar el código, en la consola:
//
//   localStorage.setItem('aor-cloud', JSON.stringify({ url: '...', key: '...' }))
//
// y para volver a lo de aquí, `localStorage.removeItem('aor-cloud')`.

export const CLOUD_URL = '';
export const CLOUD_KEY = '';
