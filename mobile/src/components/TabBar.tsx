import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLibrary } from '../contexts/LibraryContext';
import { IDown, IHome, ISearch, IShield, IUser } from './Icons';

/** Barra de pestañas fija abajo, con margen para la barra de inicio del iPhone. */
export default function TabBar() {
  const { me } = useAuth();
  const { batches } = useLibrary();
  const active = batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status)).length;
  const tabs = [
    { to: '/', label: 'Inicio', icon: <IHome /> },
    { to: '/buscar', label: 'Buscar', icon: <ISearch /> },
    { to: '/descargas', label: 'Descargas', icon: <IDown />, badge: active || undefined },
    ...(me?.role === 'admin' ? [{ to: '/admin', label: 'Admin', icon: <IShield /> }] : []),
    { to: '/perfil', label: 'Perfil', icon: <IUser /> },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0A0A0A]/95 backdrop-blur border-t border-white/10" style={{ paddingBottom: 'var(--safe-b)' }}>
      <div className="flex">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'}
            className={({ isActive }) => `flex-1 flex flex-col items-center justify-center h-[56px] text-[11px] font-medium relative ${isActive ? 'text-white' : 'text-nf-text3'}`}>
            <span className="w-6 h-6 mb-0.5">{t.icon}</span>
            {t.label}
            {t.badge && <span className="absolute top-1.5 right-[calc(50%-20px)] min-w-[18px] h-[18px] px-1 rounded-full bg-nf-red text-[11px] leading-[18px] font-bold text-center">{t.badge}</span>}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
