import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Shell from '../components/Shell';
import { useAuth } from '../contexts/AuthContext';
import AdminUsers from './admin/AdminUsers';
import AdminDownloads from './admin/AdminDownloads';
import AdminTelegram from './admin/AdminTelegram';
import AdminNovedades from './admin/AdminNovedades';
import AdminPeticiones from './admin/AdminPeticiones';
import AdminRevision from './admin/AdminRevision';
import AdminCreditos from './admin/AdminCreditos';
import AdminResumen from './admin/AdminResumen';
import Channels from './Channels';
import Settings from './Settings';
import Logs from './Logs';

/**
 * Las secciones, agrupadas por de qué tratan. Eran diez pestañas en fila, en
 * letra pequeña y al mismo nivel, y para saber si algo iba mal había que
 * entrar en todas: ahora se entra por el Resumen y el menú dice dónde está
 * cada cosa. El móvil tiene los mismos grupos en el mismo orden.
 */
const GRUPOS: { titulo: string | null; secciones: { id: string; label: string }[] }[] = [
  { titulo: null, secciones: [{ id: 'resumen', label: 'Resumen' }] },
  { titulo: 'Catálogo', secciones: [
    { id: 'canales', label: 'Canales' }, { id: 'revision', label: 'Revisión' }, { id: 'novedades', label: 'Novedades' }] },
  { titulo: 'Reproducción', secciones: [{ id: 'creditos', label: 'Créditos' }] },
  { titulo: 'Personas', secciones: [
    { id: 'usuarios', label: 'Usuarios' }, { id: 'descargas', label: 'Descargas' }, { id: 'peticiones', label: 'Peticiones' }] },
  { titulo: 'Sistema', secciones: [
    { id: 'telegram', label: 'Telegram' }, { id: 'ajustes', label: 'Ajustes' }, { id: 'registros', label: 'Registros' }] },
];
const TODAS = GRUPOS.flatMap(g => g.secciones.map(sec => ({ ...sec, grupo: g.titulo })));

/**
 * Panel de administración. Solo para administradores y solo en la web (de
 * escritorio o móvil): la tele no lo enseña. Reúne cuentas y cuotas,
 * descargas de todo el mundo, canales de Telegram, ajustes y registros.
 */
export default function Admin() {
  const { isAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  const { tab = 'resumen' } = useParams();
  const actual = TODAS.find(t => t.id === tab) || TODAS[0];
  const [toast, setToast] = useState('');

  useEffect(() => { if (!isLoading && !isAdmin) navigate('/'); }, [isAdmin, isLoading, navigate]);
  if (!isAdmin) return null;

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  return (
    <Shell>
      <div className="px-6 md:px-10 pt-24 pb-20 max-w-[1400px] mx-auto">
        {toast && (
          <div className="fixed top-24 right-6 z-50 bg-green-600/90 backdrop-blur-xl border border-green-400/20 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium animate-slide-up">{toast}</div>
        )}
        <div className="flex gap-10">
          {/* El menu: fijo al bajar, para cambiar de seccion sin volver arriba. */}
          <nav className="hidden md:block w-52 shrink-0">
            <div className="sticky top-24">
              <h1 className="text-white text-2xl font-bold tracking-tight mb-6">Administración</h1>
              {GRUPOS.map(g => (
                <div key={g.titulo || 'inicio'} className="mb-5">
                  {g.titulo && <p className="px-3 mb-1.5 text-nf-faint text-micro font-bold uppercase tracking-[0.14em]">{g.titulo}</p>}
                  {g.secciones.map(sec => (
                    <button key={sec.id} onClick={() => navigate(`/admin/${sec.id}`)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-[15px] transition-colors border-l-2
                        ${tab === sec.id ? 'bg-white/10 text-white font-semibold border-nf-red' : 'text-nf-dim border-transparent hover:text-white hover:bg-white/5'}`}>
                      {sec.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </nav>

          <main className="flex-1 min-w-0">
            {/* En una ventana estrecha no cabe el menu al lado: las secciones van en fila. */}
            <div className="md:hidden flex gap-2 overflow-x-auto pb-3 mb-4 -mx-1 px-1">
              {TODAS.map(sec => (
                <button key={sec.id} onClick={() => navigate(`/admin/${sec.id}`)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-sm ${tab === sec.id ? 'bg-white text-black font-semibold' : 'bg-white/10 text-nf-dim'}`}>
                  {sec.label}
                </button>
              ))}
            </div>
            <p className="text-nf-faint text-xs font-semibold uppercase tracking-[0.14em]">{actual.grupo || 'Administración'}</p>
            <h2 className="text-white text-3xl font-bold tracking-tight mt-1 mb-6">{actual.label}</h2>

            {tab === 'resumen' && <AdminResumen />}
            {tab === 'usuarios' && <AdminUsers onToast={show} />}
            {tab === 'descargas' && <AdminDownloads onToast={show} />}
            {tab === 'canales' && <Channels embedded />}
            {tab === 'revision' && <AdminRevision onToast={show} />}
            {tab === 'novedades' && <AdminNovedades />}
            {tab === 'peticiones' && <AdminPeticiones onToast={show} />}
            {tab === 'telegram' && <AdminTelegram onToast={show} />}
            {tab === 'creditos' && <AdminCreditos onToast={show} />}
            {tab === 'ajustes' && <Settings embedded />}
            {tab === 'registros' && <Logs embedded />}
          </main>
        </div>
      </div>
    </Shell>
  );
}
