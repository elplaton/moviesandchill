import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import AdminUsers from './admin/AdminUsers';
import AdminDownloads from './admin/AdminDownloads';
import Channels from './Channels';
import Settings from './Settings';
import Logs from './Logs';

const TABS = [
  { id: 'usuarios', label: 'Usuarios' },
  { id: 'descargas', label: 'Descargas' },
  { id: 'canales', label: 'Canales' },
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'registros', label: 'Registros' },
];

/**
 * Panel de administración. Solo para administradores y solo en la web (de
 * escritorio o móvil): la tele no lo enseña. Reúne cuentas y cuotas,
 * descargas de todo el mundo, canales de Telegram, ajustes y registros.
 */
export default function Admin() {
  const { isAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  const { tab = 'usuarios' } = useParams();
  const [toast, setToast] = useState('');

  useEffect(() => { if (!isLoading && !isAdmin) navigate('/'); }, [isAdmin, isLoading, navigate]);
  if (!isAdmin) return null;

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  return (
    <Layout>
      <div className="px-6 md:px-14 pt-24 pb-20 max-w-5xl mx-auto">
        {toast && (
          <div className="fixed top-24 right-6 z-50 bg-green-600/90 backdrop-blur-xl border border-green-400/20 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium animate-slide-up">{toast}</div>
        )}
        <h1 className="text-white text-4xl font-bold mb-2 tracking-tight animate-fade-in">Administración</h1>
        <p className="text-gray-400 text-sm mb-8 animate-fade-in">Cuentas, cuotas, canales y configuración del servidor</p>

        <div className="flex gap-1 mb-8 border-b border-white/10">
          {TABS.map(t => (
            <button key={t.id} onClick={() => navigate(`/admin/${t.id}`)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id ? 'text-white border-netflix-red' : 'text-gray-400 border-transparent hover:text-gray-200'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'usuarios' && <AdminUsers onToast={show} />}
        {tab === 'descargas' && <AdminDownloads onToast={show} />}
        {tab === 'canales' && <Channels embedded />}
        {tab === 'ajustes' && <Settings embedded />}
        {tab === 'registros' && <Logs embedded />}
      </div>
    </Layout>
  );
}
