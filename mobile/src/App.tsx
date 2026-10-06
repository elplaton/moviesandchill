import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import TabBar from './components/TabBar';
import Toasts from './components/Toasts';
import Login from './pages/Login';
import Home from './pages/Home';
import Search from './pages/Search';
import Title from './pages/Title';
import Downloads from './pages/Downloads';
import Favorites from './pages/Favorites';
import Profile from './pages/Profile';
import Admin from './pages/Admin';
import Onboarding from './pages/Onboarding';

function Splash() {
  return <div className="min-h-screen flex items-center justify-center"><span className="text-nf-red font-bold text-3xl tracking-tighter">MOVIES&amp;CHILL</span></div>;
}

/** Donde se quedo cada pantalla. Vive fuera de React: si se guardara en el
 *  componente se iria justo cuando hace falta, al cambiar de ruta. */
const alturas = new Map<string, number>();

/**
 * El contenedor que se desplaza, con memoria.
 *
 * Antes llevaba `key={location.pathname}`, asi que **cada navegacion lo
 * desmontaba**: entrar en una pelicula y volver atras dejaba la portada recien
 * montada y arriba del todo, y habia que bajar otra vez hasta donde estabas.
 * Ahora el armazon es el mismo siempre y el scroll lo decide el tipo de
 * navegacion: hacia delante se empieza arriba, y al volver atras se recupera
 * lo que tenia esa entrada del historial (`location.key` identifica la entrada,
 * no la ruta: dos visitas a la portada son dos sitios distintos).
 */
function Desplazable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  const tipo = useNavigationType();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clave = location.key;
    const anotar = () => alturas.set(clave, el.scrollTop);
    el.addEventListener('scroll', anotar, { passive: true });
    // Tambien al salir: el ultimo scroll puede no haber disparado evento.
    return () => { anotar(); el.removeEventListener('scroll', anotar); };
  }, [location.key]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const y = tipo === 'POP' ? (alturas.get(location.key) ?? 0) : 0;
    el.scrollTop = y;
    if (y <= 0) return;
    // Las filas de la portada salen de la cache y estan ya en el primer
    // pintado, pero las caratulas colocan su alto un poco despues: se insiste
    // un par de fotogramas para no quedarse corto.
    let intentos = 0;
    const insistir = () => {
      if (!ref.current) return;
      if (Math.abs(ref.current.scrollTop - y) > 2) ref.current.scrollTop = y;
      if (++intentos < 3) requestAnimationFrame(insistir);
    };
    requestAnimationFrame(insistir);
  }, [location.key, tipo]);

  return <main className="app-main" ref={ref}>{children}</main>;
}

export default function App() {
  const { me, loading, hasPrefs } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!me) return location.pathname === '/login' ? <Login /> : <Navigate to="/login" replace />;
  if (location.pathname === '/login') return <Navigate to="/" replace />;
  // Sin preferencias se pasa por el onboarding, igual que en la web.
  const enOnboarding = location.pathname === '/onboarding';
  if (hasPrefs === false && !enOnboarding) return <Navigate to="/onboarding" replace />;
  if (hasPrefs !== false && enOnboarding) return <Navigate to="/" replace />;
  const fullscreen = location.pathname.startsWith('/t/') || enOnboarding;
  // Armazon fijo: la pagina no se desplaza (se desplaza <main>), asi la barra
  // de Safari no se pliega ni mueve la barra de pestañas.
  return (
    <div className="app-shell">
      <Desplazable>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buscar" element={<Search />} />
        <Route path="/t/:kind/:id" element={<Title />} />
        <Route path="/favoritos" element={<Favorites />} />
        <Route path="/descargas" element={<Downloads />} />
        <Route path="/perfil" element={<Profile />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/admin" element={me.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="/admin/:tab" element={me.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Desplazable>
      {!fullscreen && <TabBar />}
      <Toasts />
    </div>
  );
}
