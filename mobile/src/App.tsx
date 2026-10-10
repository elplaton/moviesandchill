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
import Vincular from './pages/Vincular';

function Splash() {
  return <div className="min-h-screen flex items-center justify-center"><span className="text-nf-red font-bold text-3xl tracking-tighter">MOVIES&amp;CHILL</span></div>;
}

/**
 * Donde se quedo cada pantalla, por entrada del historial.
 *
 * Vive fuera de React: si se guardara en el componente se iria justo cuando
 * hace falta, al cambiar de ruta. Se poda para que no crezca sin fin en una
 * sesion larga.
 */
const alturas = new Map<string, number>();
const MAX_RECORDADAS = 30;

function recordar(clave: string, y: number) {
  alturas.delete(clave);           // y vuelve a entrar al final: el orden del
  alturas.set(clave, y);           // Map es el de insercion, asi se poda lo viejo
  if (alturas.size > MAX_RECORDADAS) {
    const primera = alturas.keys().next();
    if (!primera.done) alturas.delete(primera.value);
  }
}

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
 *
 * **La posicion se anota en cada scroll y en ningun otro sitio.** Parece mas
 * seguro anotarla tambien al salir, en la limpieza del efecto, y es justo lo
 * que rompia esto: React corre los `useLayoutEffect` (donde se pone el scroll
 * a 0 al entrar en la ficha) **antes** que las limpiezas de los `useEffect`,
 * asi que ese "ultimo guardado" escribia el 0 que acababa de poner el otro
 * efecto y al volver siempre se restauraba el principio. Los eventos de scroll
 * llegan continuamente mientras se desplaza, asi que no hace falta nada mas.
 */
function Desplazable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  const tipo = useNavigationType();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clave = location.key;
    const anotar = () => recordar(clave, el.scrollTop);
    el.addEventListener('scroll', anotar, { passive: true });
    return () => el.removeEventListener('scroll', anotar);
  }, [location.key]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const y = tipo === 'POP' ? (alturas.get(location.key) ?? 0) : 0;
    el.scrollTop = y;
    if (y <= 0) return;

    // Insistir, y no una sola vez.
    //
    // Normalmente las filas vienen de la cache y ya estan en el primer
    // pintado, pero no siempre: si se vuelve pasados diez minutos la cache ha
    // caducado y la portada llega por red. Hasta que llega, la pagina es mas
    // corta que la posicion que se quiere recuperar y el navegador recorta el
    // scroll a lo que hay. Asi que se reintenta hasta que la posicion se
    // sostiene, con un plazo: mas vale quedarse arriba que estar peleando con
    // el dedo del usuario.
    let intentos = 0;
    const reloj = setInterval(() => {
      const actual = ref.current;
      if (!actual || ++intentos > 20) { clearInterval(reloj); return; }
      if (Math.abs(actual.scrollTop - y) <= 2) { clearInterval(reloj); return; }
      actual.scrollTop = y;
    }, 50);
    // Y en cuanto el usuario toca la pantalla, se deja en paz: pelearle el
    // scroll al dedo es peor que no recuperar la posicion.
    const rendirse = () => clearInterval(reloj);
    el.addEventListener('touchstart', rendirse, { passive: true, once: true });
    el.addEventListener('wheel', rendirse, { passive: true, once: true });
    return () => {
      clearInterval(reloj);
      el.removeEventListener('touchstart', rendirse);
      el.removeEventListener('wheel', rendirse);
    };
  }, [location.key, tipo]);

  return <main className="app-main" ref={ref}>{children}</main>;
}

export default function App() {
  const { me, loading, hasPrefs } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  // Sin sesion se pasa por el login, pero recordando a donde se iba: el QR de
  // la tele abre /vincular, y en Safari (que no comparte sesion con la app
  // instalada) lo normal es llegar sin haber entrado.
  if (!me) return location.pathname === '/login' ? <Login /> : <Navigate to="/login" replace state={{ despues: location.pathname + location.search }} />;
  if (location.pathname === '/login') return <Navigate to={(location.state as { despues?: string } | null)?.despues || '/'} replace />;
  // Sin preferencias se pasa por el onboarding, igual que en la web. Menos
  // para vincular una tele, que es un momento y no debe perderse por el camino.
  const enOnboarding = location.pathname === '/onboarding';
  if (hasPrefs === false && !enOnboarding && location.pathname !== '/vincular') return <Navigate to="/onboarding" replace />;
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
        <Route path="/vincular" element={<Vincular />} />
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
