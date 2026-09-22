import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { DownloadsProvider, useDownloadsCtx } from './contexts/DownloadsContext';
import { FocusScope } from './focus/react';
import Rail from './components/Rail';
import Toasts from './components/Toasts';
import Login from './pages/Login';
import Home from './pages/Home';
import Movies from './pages/Movies';
import Series from './pages/Series';
import Search from './pages/Search';
import Library from './pages/Library';
import Settings from './pages/Settings';

function Splash() {
  return (
    <div className="absolute inset-0 bg-tv-bg flex items-center justify-center">
      <span className="text-tv-red font-bold text-[72px] tracking-tighter">MOVIES&amp;CHILL</span>
    </div>
  );
}

function Shell() {
  const { batches } = useDownloadsCtx();
  const active = batches.filter((b) => ['downloading', 'extracting', 'converting'].includes(b.status));
  const badge = active.length === 1 ? `${active[0].progress}%` : active.length > 1 ? String(active.length) : undefined;

  // El rail vive fuera de las rutas: no se desmonta al cambiar de pantalla y
  // el foco puede ir y volver entre el y el contenido.
  return (
    <FocusScope id="shell" orientation="horizontal" as="none">
      <Rail downloadBadge={badge} />
      <div className="absolute inset-0" style={{ paddingLeft: 0 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/peliculas" element={<Movies />} />
          <Route path="/series" element={<Series />} />
          <Route path="/buscar" element={<Search />} />
          <Route path="/descargas" element={<Library />} />
          <Route path="/ajustes" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <Toasts />
    </FocusScope>
  );
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <Splash />;
  if (!isAuthenticated) {
    return location.pathname === '/login' ? <Login /> : <Navigate to="/login" replace />;
  }
  if (location.pathname === '/login') return <Navigate to="/" replace />;

  return (
    <DownloadsProvider>
      <Shell />
    </DownloadsProvider>
  );
}
