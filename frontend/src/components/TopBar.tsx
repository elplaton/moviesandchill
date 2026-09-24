import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { IconClose, IconLogout, IconSearch, IconShield, IconUser } from './ui/Icon';

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

const LINKS = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/peliculas', label: 'Películas' },
  { to: '/series', label: 'Series' },
  { to: '/descargas', label: 'Descargas' },
];

/**
 * Barra superior: navegación, buscador y cuenta.
 *
 * Transparente sobre el destacado de la portada y sólida en cuanto se baja,
 * para que no compita con la imagen ni se pierda sobre el contenido. El
 * buscador vive aquí (con «/» como atajo) en vez de ocupar media portada.
 */
export default function TopBar() {
  const { username, isAdmin, usedBytes, quotaBytes, logout } = useAuth();
  const [solid, setSolid] = useState(false);
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [openSearch, setOpenSearch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // «/» abre el buscador desde cualquier parte, como en cualquier catálogo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
      if (e.key === '/' && !typing) { e.preventDefault(); setOpenSearch(true); setTimeout(() => inputRef.current?.focus(), 0); }
      if (e.key === 'Escape' && openSearch) { setOpenSearch(false); setQuery(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);

  useEffect(() => { setMenu(false); }, [location.pathname]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    navigate(`/buscar?q=${encodeURIComponent(query.trim())}`);
  };

  const quota = quotaBytes != null ? `${gb(usedBytes)} de ${gb(quotaBytes)}` : usedBytes > 0 ? `${gb(usedBytes)} en disco` : '';

  return (
    <header className={`fixed inset-x-0 top-0 z-50 h-[var(--nav-h)] px-gutter flex items-center gap-7 transition-colors duration-300 ${
      solid ? 'bg-nf-bg/95 border-b border-nf-line' : 'bg-gradient-to-b from-black/80 to-transparent'}`}>
      <Link to="/" className="shrink-0 text-nf-red font-bold text-title tracking-tighter leading-none hover:opacity-80">
        MOVIES<span className="text-white">&amp;</span>CHILL
      </Link>

      <nav className="hidden md:flex items-center gap-1">
        {LINKS.map(l => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => `px-3 py-1.5 rounded text-base transition-colors ${
              isActive ? 'text-white font-semibold' : 'text-nf-dim hover:text-white'}`}>
            {l.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1" />

      <form onSubmit={submit} className="relative flex items-center">
        {openSearch ? (
          <>
            <span className="absolute left-3 w-4 h-4 text-nf-faint pointer-events-none"><IconSearch /></span>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              onBlur={() => !query && setOpenSearch(false)}
              placeholder="Buscar película o serie"
              className="w-[280px] h-9 rounded bg-black/70 border border-nf-line pl-9 pr-9 text-base outline-none focus:border-white/40" />
            <button type="button" onClick={() => { setOpenSearch(false); setQuery(''); }}
              className="absolute right-2 w-4 h-4 text-nf-faint hover:text-white" aria-label="Cerrar búsqueda">
              <IconClose />
            </button>
          </>
        ) : (
          <button type="button" onClick={() => { setOpenSearch(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="w-9 h-9 grid place-items-center rounded text-nf-dim hover:text-white hover:bg-white/10" aria-label="Buscar (/)">
            <span className="w-5 h-5"><IconSearch /></span>
          </button>
        )}
      </form>

      <div className="relative">
        <button onClick={() => setMenu(m => !m)} className="flex items-center gap-2 rounded pl-1 pr-2 py-1 hover:bg-white/10">
          <span className="grid h-8 w-8 place-items-center rounded bg-nf-red text-sm font-bold">{(username || 'U')[0].toUpperCase()}</span>
          <span className="hidden lg:block text-base text-nf-dim max-w-[120px] truncate">{username}</span>
        </button>

        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-panel border border-nf-line bg-nf-surface shadow-panel animate-scale-in">
              <div className="border-b border-nf-line px-4 py-3">
                <p className="text-base font-medium">{username}</p>
                {quota && <p className="text-xs text-nf-faint mt-0.5">{quota}</p>}
              </div>
              <Link to="/cuenta" className="flex items-center gap-3 px-4 py-2.5 text-base text-nf-dim hover:bg-white/5 hover:text-white">
                <span className="w-4 h-4"><IconUser /></span>Mi cuenta
              </Link>
              {isAdmin && (
                <Link to="/admin" className="flex items-center gap-3 px-4 py-2.5 text-base text-nf-dim hover:bg-white/5 hover:text-white">
                  <span className="w-4 h-4"><IconShield /></span>Administración
                </Link>
              )}
              <button onClick={logout} className="flex w-full items-center gap-3 border-t border-nf-line px-4 py-2.5 text-base text-nf-dim hover:bg-white/5 hover:text-white">
                <span className="w-4 h-4"><IconLogout /></span>Cerrar sesión
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
