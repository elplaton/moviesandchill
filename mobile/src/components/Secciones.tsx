import { NavLink } from 'react-router-dom';

/**
 * Las dos portadas: la de siempre y la de Plataformas (lo mas nuevo de
 * Netflix, HBO Max...). Van como pildoras arriba y no como pestaña de la
 * barra de abajo porque ahi ya hay seis para un admin, y una septima dejaba
 * los nombres en diez pixeles. Es lo que hace la app de Netflix con Series y
 * Peliculas.
 */
export default function Secciones({ sobreImagen = false }: { sobreImagen?: boolean }) {
  const pildora = ({ isActive }: { isActive: boolean }) =>
    `px-3.5 h-8 inline-flex items-center rounded-full text-[13px] font-semibold border ${
      isActive ? 'bg-white text-black border-white'
        : sobreImagen ? 'bg-black/40 text-white border-white/40' : 'text-nf-text2 border-white/25'}`;
  return (
    <nav className="flex gap-2">
      <NavLink to="/" end className={pildora}>Inicio</NavLink>
      <NavLink to="/plataformas" className={pildora}>Plataformas</NavLink>
    </nav>
  );
}
