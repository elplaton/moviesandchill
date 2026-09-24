import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Home from './pages/Home';
import Movies from './pages/Movies';
import Series from './pages/Series';
import Search from './pages/Search';
import Onboarding from './pages/Onboarding';
import Downloads from './pages/Downloads';
import Admin from './pages/Admin';
import Account from './pages/Account';

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-nf-bg">
      <span className="animate-fade-in text-title font-bold tracking-tighter text-nf-red">
        MOVIES<span className="text-white">&amp;</span>CHILL
      </span>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <Splash />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, isLoading, hasPreferences } = useAuth();
  if (isLoading) return <Splash />;

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />
      <Route path="/" element={<Protected>{hasPreferences === false ? <Navigate to="/onboarding" replace /> : <Home />}</Protected>} />
      <Route path="/peliculas" element={<Protected><Movies /></Protected>} />
      <Route path="/series" element={<Protected><Series /></Protected>} />
      <Route path="/buscar" element={<Protected><Search /></Protected>} />
      <Route path="/descargas" element={<Protected><Downloads /></Protected>} />
      <Route path="/admin" element={<Protected><Admin /></Protected>} />
      <Route path="/admin/:tab" element={<Protected><Admin /></Protected>} />
      <Route path="/cuenta" element={<Protected><Account /></Protected>} />
      {/* Rutas antiguas, para no romper enlaces guardados. */}
      <Route path="/movies" element={<Navigate to="/peliculas" replace />} />
      <Route path="/channels" element={<Navigate to="/admin/canales" replace />} />
      <Route path="/settings" element={<Navigate to="/admin/ajustes" replace />} />
      <Route path="/logs" element={<Navigate to="/admin/registros" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
