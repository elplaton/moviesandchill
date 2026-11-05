import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hoja que sube desde abajo, montada por portal en el `<body>`.
 *
 * Dentro de la página no sirve: `.app-main` lleva
 * `-webkit-overflow-scrolling: touch`, que en iOS crea su propio contexto de
 * apilado, así que un `position: fixed` de dentro solo compite con sus
 * hermanos y la barra de pestañas (hermana del `<main>`) se pinta **encima**
 * aunque tenga menos `z-index`. Tapaba justo lo último de la hoja, que es
 * donde va el botón: «Editar usuario» se quedaba sin «Guardar». Es lo mismo
 * que obligó a montar así el reproductor.
 */
export default function Hoja({ onClose, children, className = '' }: {
  onClose: () => void; children: ReactNode; className?: string;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[65] bg-black/70 flex items-end" onClick={onClose}>
      <div className={`w-full max-h-[90%] overflow-y-auto bg-nf-raised rounded-t-2xl p-4 rise ${className}`}
        style={{ paddingBottom: 'calc(16px + var(--safe-b))' }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
