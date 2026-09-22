import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentFocusId, subscribe } from '../focus/engine';
import { FocusScope, useFocusItem } from '../focus/react';
import { requestContentFocus } from '../tv/intent';
import { IconDownload, IconFilm, IconGear, IconHome, IconSearch, IconTv } from './Icons';

export const RAIL_ITEMS: { path: string; label: string; icon: ReactNode }[] = [
  { path: '/buscar', label: 'Buscar', icon: <IconSearch /> },
  { path: '/', label: 'Inicio', icon: <IconHome /> },
  { path: '/peliculas', label: 'Películas', icon: <IconFilm /> },
  { path: '/series', label: 'Series', icon: <IconTv /> },
  { path: '/descargas', label: 'Descargas', icon: <IconDownload /> },
  { path: '/ajustes', label: 'Ajustes', icon: <IconGear /> },
];

function RailItem({ path, label, icon, index, active, badge }: {
  path: string; label: string; icon: ReactNode; index: number; active: boolean; badge?: string;
}) {
  const navigate = useNavigate();
  const { ref } = useFocusItem<HTMLDivElement>({
    focusKey: `rail-${path}`,
    index,
    onEnter: () => {
      requestContentFocus();
      navigate(path);
    },
  });
  return (
    <div ref={ref} className={`tv-rail-item ${active ? 'is-active' : ''} relative flex items-center h-[64px] rounded-lg mx-3 px-[14px] overflow-hidden`}>
      <span className="w-9 h-9 shrink-0 flex items-center justify-center">{icon}</span>
      <span className="tv-rail-label ml-5 text-body font-semibold whitespace-nowrap">{label}</span>
      {badge && (
        <span className="absolute left-[38px] top-[10px] min-w-[22px] h-[22px] px-[6px] rounded-full bg-tv-red text-white text-[14px] leading-[22px] font-bold text-center">
          {badge}
        </span>
      )}
      {active && !badge && <span className="absolute left-0 top-[18px] w-[4px] h-[28px] rounded-r bg-tv-red tv-rail-mark" />}
    </div>
  );
}

interface Props {
  /** Texto del globo del rail de Descargas ("2", "45%"). */
  downloadBadge?: string;
}

/**
 * Rail de navegacion. Plegado enseña solo iconos; cuando el foco entra en el
 * se despliega con las etiquetas, por encima del contenido (no lo recoloca).
 * Es el mismo patron que usan las apps de television: siempre esta, nunca
 * estorba.
 */
export default function Rail({ downloadBadge }: Props) {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const check = (id: string | null) => setOpen(!!id && id.startsWith('rail-'));
    check(getCurrentFocusId());
    return subscribe(check);
  }, []);

  return (
    <FocusScope id="rail" index={0} orientation="vertical" as="none">
      <div className={`tv-rail fixed top-0 left-0 bottom-0 z-40 ${open ? 'is-open' : ''}`} style={{ width: 'var(--rail-w-open)' }}>
        {/* velo que oscurece el contenido cuando el rail esta abierto */}
        <div className="tv-rail-veil absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(90deg, #0A0A0A 0%, rgba(10,10,10,0.92) 55%, rgba(10,10,10,0) 100%)', width: '520px' }} />
        <div className="absolute inset-y-0 left-0 flex flex-col justify-center" style={{ width: 'var(--rail-w-open)' }}>
          <div className="absolute top-[44px] left-0 right-0 px-[18px]">
            <span className="text-tv-red font-bold text-[30px] tracking-tighter leading-none">M&amp;C</span>
          </div>
          <nav className="flex flex-col gap-2">
            {RAIL_ITEMS.map((it, i) => (
              <RailItem key={it.path} {...it} index={i}
                active={location.pathname === it.path}
                badge={it.path === '/descargas' ? downloadBadge : undefined} />
            ))}
          </nav>
        </div>
      </div>
    </FocusScope>
  );
}
