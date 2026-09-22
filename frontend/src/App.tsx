import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Home from './pages/Home';
import Movies from './pages/Movies';
import Series from './pages/Series';
import Onboarding from './pages/Onboarding';
import Admin from './pages/Admin';
import Account from './pages/Account';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-netflix-dark flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-3 border-netflix-red border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, isLoading, hasPreferences } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-netflix-dark flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-3 border-netflix-red border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
      <Route path="/" element={<ProtectedRoute>
        {hasPreferences === false ? <Navigate to="/onboarding" replace /> : <Home />}
      </ProtectedRoute>} />
      <Route path="/movies" element={<ProtectedRoute><Movies /></ProtectedRoute>} />
      <Route path="/series" element={<ProtectedRoute><Series /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
      <Route path="/admin/:tab" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
      <Route path="/cuenta" element={<ProtectedRoute><Account /></ProtectedRoute>} />
      <Route path="/channels" element={<Navigate to="/admin/canales" replace />} />
      <Route path="/settings" element={<Navigate to="/admin/ajustes" replace />} />
      <Route path="/logs" element={<Navigate to="/admin/registros" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
