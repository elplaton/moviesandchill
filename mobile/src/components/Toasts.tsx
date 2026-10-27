import { createPortal } from 'react-dom';
import { useToasts } from '../utils/toast';
export default function Toasts() {
  const list = useToasts();
  if (!list.length) return null;
  // Por portal en el <body>, como la hoja de pedir (TopRow): dentro del
  // armazon, que es `position: fixed` y por tanto su propio contexto de
  // apilado, el z-index solo compite con sus hermanos y el aviso de «Pedida»
  // o del error quedaba debajo de la hoja que lo provoca. Por debajo del
  // reproductor (z-70) como hasta ahora.
  return createPortal(
    <div className="fixed left-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none" style={{ bottom: 'calc(70px + var(--safe-b))' }}>
      {list.map(t => (
        <div key={t.id} className={`rise px-4 py-3 rounded-xl text-[14px] bg-nf-raised border shadow-2xl ${t.kind === 'ok' ? 'border-nf-ok/40' : t.kind === 'error' ? 'border-nf-red/50' : 'border-white/10'}`}>{t.text}</div>
      ))}
    </div>,
    document.body,
  );
}
