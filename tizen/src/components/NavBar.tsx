import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState } from 'react';
import { FocusScope } from '../focus/react';
import FocusableButton from './FocusableButton';
import FocusableLink from './FocusableLink';

export default function NavBar() {
  const { username, logout, isAdmin } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Ya no hay listener de scroll: el contenido se desplaza con transform, asi
  // que window.scrollY siempre valdria 0 y el estado no cambiaba nunca.
  return (
    <FocusScope
      orientation="horizontal"
      index={0}
      className="fixed top-0 left-0 right-0 z-50 px-6 md:px-14 py-3 flex items-center gap-6 bg-gradient-to-b from-black/70 via-black/40 to-transparent"
    >
      <Link to="/" className="text-netflix-red font-bold text-2xl md:text-[1.65rem] tracking-tighter hover:opacity-85 transition-opacity shrink-0 mr-2">
        MOVIES&CHILL
      </Link>

      <div className="hidden md:flex items-center gap-1">
        <FocusableLink index={0} to="/" className={`px-3 py-1 text-sm rounded-lg ${
          location.pathname === '/' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
        }`}>Inicio</FocusableLink>
        <FocusableLink index={1} to="/movies" className={`px-3 py-1 text-sm rounded-lg ${
          location.pathname === '/movies' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
        }`}>Películas</FocusableLink>
        <FocusableLink index={2} to="/series" className={`px-3 py-1 text-sm rounded-lg ${
          location.pathname === '/series' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
        }`}>Series</FocusableLink>
        {isAdmin && (
          <FocusableLink index={3} to="/channels" className={`px-3 py-1 text-sm rounded-lg ${
            location.pathname === '/channels' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
          }`}>Canales</FocusableLink>
        )}
        <FocusableLink index={4} to="/settings" className={`px-3 py-1 text-sm rounded-lg ${
          location.pathname === '/settings' ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'
        }`}>Ajustes</FocusableLink>
      </div>

      <div className="flex-1" />

      <div className="relative">
        <FocusableButton
          index={5}
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 text-sm text-gray-300"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-netflix-red to-red-800 flex items-center justify-center text-white font-semibold text-xs shadow-lg">
            {(username || 'A')[0].toUpperCase()}
          </div>
          <span className="hidden md:inline">{username}</span>
          <svg className="w-3 h-3 text-gray-400 hidden md:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </FocusableButton>

        {menuOpen && (
          <FocusScope
            trap
            orientation="vertical"
            className="absolute right-0 top-full mt-2 w-56 bg-black/95 border border-white/10 rounded-xl shadow-2xl shadow-black/50 py-2 z-50 animate-scale-in overflow-hidden"
          >
            <div className="px-4 py-2.5 text-sm text-gray-400 border-b border-white/10">{username}</div>
            <FocusableLink index={0} to="/settings" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-gray-300">Ajustes</FocusableLink>
            <FocusableLink index={1} to="/logs" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-gray-300">Logs</FocusableLink>
            <hr className="border-white/10 my-1" />
            <FocusableButton index={2} onClick={() => { logout(); setMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-300">
              Cerrar sesion
            </FocusableButton>
          </FocusScope>
        )}
      </div>
    </FocusScope>
  );
}
