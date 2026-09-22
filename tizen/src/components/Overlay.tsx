import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Saca un panel a pantalla completa fuera de la columna de contenido.
 *
 * La columna se desplaza con transform, y un ancestro con transform convierte
 * `position: fixed` en relativo a el: la ficha salia recortada, desplazada y
 * por debajo del panel de informacion. #overlays cuelga de #root (asi hereda
 * la escala de desarrollo) pero fuera de cualquier transform.
 */
export default function Overlay({ children }: { children: ReactNode }) {
  const host = document.getElementById('overlays') || document.body;
  return createPortal(children, host);
}
