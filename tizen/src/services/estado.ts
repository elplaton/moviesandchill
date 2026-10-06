/**
 * Estado de la interfaz que es de la cuenta, no del aparato.
 *
 * Ahora mismo solo lo último que se buscó. Vivía en el almacenamiento del
 * navegador y eso tenía dos problemas: se queda escrito en un aparato que
 * puede ser de más gente, y no sirve de nada en el resto (buscas algo en el
 * móvil y en la tele no está). Ahora es de la cuenta y se ve desde donde
 * entres.
 *
 * Lo que se escribe se guarda **con retardo**: el buscador dispara una
 * búsqueda por cada tecla, y eso serían veinte escrituras en la base para
 * teclear un título. Y se queda también en memoria, así que moverse por la app
 * no cuesta un viaje al servidor.
 *
 * Es el mismo archivo en `frontend/`, `mobile/` y `tizen/`.
 */
import { apiFetch } from './api';

const RETARDO_MS = 1500;

let enMemoria: string | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;

/** Lo último buscado, si ya se sabe en esta sesión. null = aún no se ha leído. */
export function ultimaBusquedaEnMemoria(): string | null {
  return enMemoria;
}

/** Lo último buscado según el servidor. Se lee una vez por sesión. */
export async function leerUltimaBusqueda(): Promise<string> {
  if (enMemoria !== null) return enMemoria;
  let valor = '';
  try {
    const d = await (await apiFetch('/state')).json();
    if (typeof d.last_search === 'string') valor = d.last_search;
  } catch { /* sin red: se asume que no hay nada guardado */ }
  enMemoria = valor;
  return valor;
}

export function guardarUltimaBusqueda(termino: string) {
  const valor = termino.trim();
  if (valor === enMemoria) return;
  enMemoria = valor;
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    temporizador = null;
    // Lo que se manda es lo último que se sabe y no el valor con el que se
    // programó el retardo: entre una cosa y otra han podido pasar varias
    // teclas, y guardar un término a medias no tiene ningún sentido.
    const aGuardar = enMemoria ?? '';
    apiFetch('/state', { method: 'PUT', body: JSON.stringify({ last_search: aGuardar }) })
      .catch(() => { /* se guardará con la siguiente búsqueda */ });
  }, RETARDO_MS);
}

/** Al cambiar de cuenta no vale lo que supiéramos de la anterior. */
export function olvidarEstado() {
  enMemoria = null;
  if (temporizador) { clearTimeout(temporizador); temporizador = null; }
}
