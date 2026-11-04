/*
 * Si hay algo a pantalla completa encima de la portada (una ficha, el
 * reproductor, un diálogo). El tráiler del panel de arriba lo mira para
 * pararse: los paneles van por portal en #overlays y la portada sigue montada
 * debajo, así que sin esto sonarían dos tráileres (o uno detrás de la
 * película). Los avisos (Toasts) no cuentan: no tapan nada.
 */
import { useEffect, useSyncExternalStore } from 'react';

let abiertos = 0;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

/** Lo llama cada panel que tapa la portada mientras está montado. */
export function useTapa(activa = true): void {
  useEffect(() => {
    if (!activa) return;
    abiertos += 1;
    avisar();
    return () => { abiertos -= 1; avisar(); };
  }, [activa]);
}

export function useTapado(): boolean {
  return useSyncExternalStore(
    (f) => { oyentes.add(f); return () => { oyentes.delete(f); }; },
    () => abiertos > 0,
  );
}
