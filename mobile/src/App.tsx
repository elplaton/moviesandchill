import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
      <main className="app-main" key={location.pathname}>
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
      </main>
      {!fullscreen && <TabBar />}
      <Toasts />
    </div>
  );
}
