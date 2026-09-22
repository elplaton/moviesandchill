/**
 * Al elegir una pantalla en el rail con OK, el foco tiene que pasar al
 * contenido cuando este monte, no quedarse en el rail. La pagina que llega
 * consume la intencion.
 */
let pending = false;
export function requestContentFocus() { pending = true; }
export function takeContentFocus(): boolean {
  const p = pending;
  pending = false;
  return p;
}
