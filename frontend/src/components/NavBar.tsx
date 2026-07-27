import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';

export default function NavBar() {
  const { username, logout, isAdmin } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 px-6 md:px-14 py-3 flex items-center gap-6 transition-all duration-500 ${
      scrolled ? 'bg-netflix-dark/95 backdrop-blur-md shadow-lg shadow-black/30' : 'bg-gradient-to-b from-black/70 via-black/40 to-transparent'
    }`}>
      <Link to="/" className="text-netflix-red font-bold text-2xl md:text-[1.65rem] tracking-tighter hover:opacity-85 transition-opacity shrink-0 mr-2">
        MOVIES&CHILL
      </Link>

      <div className="hidden md:flex items-center gap-1">
        <Link to="/" className={`px-3 py-1 text-sm rounded-lg transition-all duration-200 ${
          location.pathname === '/' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
        }`}>Inicio</Link>
        <Link to="/movies" className={`px-3 py-1 text-sm rounded-lg transition-all duration-200 ${
          location.pathname === '/movies' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
        }`}>Películas</Link>
        <Link to="/series" className={`px-3 py-1 text-sm rounded-lg transition-all duration-200 ${
          location.pathname === '/series' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
        }`}>Series</Link>
        {isAdmin && (
          <Link to="/channels" className={`px-3 py-1 text-sm rounded-lg transition-all duration-200 ${
            location.pathname === '/channels' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
          }`}>Canales</Link>
        )}
        <Link to="/settings" className={`px-3 py-1 text-sm rounded-lg transition-all duration-200 ${
          location.pathname === '/settings' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
        }`}>Ajustes</Link>
      </div>

      <div className="flex-1" />

      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-netflix-red to-red-800 flex items-center justify-center text-white font-semibold text-xs shadow-lg">
            {(username || 'A')[0].toUpperCase()}
          </div>
          <span className="hidden md:inline">{username}</span>
          <svg className="w-3 h-3 text-gray-400 hidden md:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-2 w-56 bg-black/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 py-2 z-50 animate-scale-in overflow-hidden">
              <div className="px-4 py-2.5 text-sm text-gray-400 border-b border-white/10">{username}</div>
              <Link to="/settings" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors">Ajustes</Link>
              <Link to="/logs" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors">Logs</Link>
              <hr className="border-white/10 my-1" />
              <button onClick={() => { logout(); setMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors">
                Cerrar sesion
              </button>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
