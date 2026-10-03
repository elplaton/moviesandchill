import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLibrary } from '../contexts/LibraryContext';
import { IDown, IHeart, IHome, ISearch, IShield, IUser } from './Icons';

/** Barra de pestañas fija abajo, con margen para la barra de inicio del iPhone. */
export default function TabBar() {
  const { me } = useAuth();
  const { batches } = useLibrary();
  const active = batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status)).length;
  const tabs = [
    { to: '/', label: 'Inicio', icon: <IHome /> },
    { to: '/buscar', label: 'Buscar', icon: <ISearch /> },
    { to: '/favoritos', label: 'Favoritos', icon: <IHeart /> },
    { to: '/descargas', label: 'Descargas', icon: <IDown />, badge: active || undefined },
    ...(me?.role === 'admin' ? [{ to: '/admin', label: 'Admin', icon: <IShield /> }] : []),
    { to: '/perfil', label: 'Perfil', icon: <IUser /> },
  ];
  return (
    <nav className="shrink-0 z-40 bg-[#0A0A0A] border-t border-white/10" style={{ paddingBottom: 'var(--safe-b)' }}>
      <div className="flex">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'}
            className={({ isActive }) => `flex-1 min-w-0 flex flex-col items-center justify-center h-[56px] font-medium relative ${tabs.length > 5 ? 'text-[10px]' : 'text-[11px]'} ${isActive ? 'text-white' : 'text-nf-text3'}`}>
            <span className="w-6 h-6 mb-0.5">{t.icon}</span>
            <span className="max-w-full px-0.5 truncate">{t.label}</span>
            {t.badge && <span className="absolute top-1.5 right-[calc(50%-20px)] min-w-[18px] h-[18px] px-1 rounded-full bg-nf-red text-[11px] leading-[18px] font-bold text-center">{t.badge}</span>}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
