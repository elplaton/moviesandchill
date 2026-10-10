import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useFollows } from '../contexts/FollowsContext';
import { apiFetch } from '../services/api';
import { clearAllWatched } from '../utils/progress';
import { activarAvisos, desactivarAvisos, estadoAvisos, probarAvisos,
         type EstadoAvisos } from '../services/push';
import { IBell } from '../components/Icons';
import { toast } from '../utils/toast';

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

export default function Profile() {
  const { me, logout } = useAuth();
  const { keys: seguidas, items: series, alternar, recargar } = useFollows();
  const [avisos, setAvisos] = useState<EstadoAvisos | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [cur, setCur] = useState(''); const [nxt, setNxt] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => { estadoAvisos().then(setAvisos); recargar(); }, [recargar]);

  const alternarAvisos = useCallback(async () => {
    if (!avisos) return;
    setCambiando(true);
    if (avisos.suscrito) {
      await desactivarAvisos();
      toast('Avisos desactivados en este teléfono');
    } else {
      const error = await activarAvisos('m');
      if (error) toast(error, 'error', 6000);
      else toast('Listo: te avisaremos de los episodios nuevos', 'ok');
    }
    setAvisos(await estadoAvisos());
    setCambiando(false);
  }, [avisos]);
  const pct = me?.quota_bytes ? Math.min(100, Math.round((me.used_bytes / me.quota_bytes) * 100)) : 0;
  const input = 'w-full h-12 rounded-xl bg-white/10 border border-white/10 px-4 text-[16px] outline-none focus:border-white/40';
  const change = async () => {
    setBusy(true);
    const r = await apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ current_password: cur, new_password: nxt }) });
    const d = await r.json(); setBusy(false);
    if (!r.ok) { toast(d.detail || 'No se pudo cambiar', 'error'); return; }
    toast('Contraseña cambiada', 'ok'); setCur(''); setNxt('');
  };
  return (
    <div className="px-4 pb-6" style={{ paddingTop: 'calc(var(--safe-t) + 20px)' }}>
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-nf-red to-red-900 flex items-center justify-center text-[24px] font-bold">{(me?.username || '?')[0].toUpperCase()}</div>
        <div><h1 className="text-[24px] font-bold leading-tight">{me?.username}</h1><p className="text-[13px] text-nf-text2">{me?.role === 'admin' ? 'Administrador' : 'Usuario'}</p></div>
      </div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-2">Espacio en disco</p>
        <p className="text-[15px]">{me?.quota_bytes ? `${gb(me.used_bytes)} de ${gb(me.quota_bytes)} · ${pct} %` : `${gb(me?.used_bytes || 0)} · sin límite`}</p>
        <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden"><div className={`h-full ${pct >= 90 ? 'bg-nf-red' : 'bg-nf-ok'}`} style={{ width: `${me?.quota_bytes ? pct : 5}%` }} /></div>
        <p className="text-[12px] text-nf-text3 mt-2">Cuenta lo que has descargado y sigue en el servidor. Borra desde una ficha o desde Descargas para liberar espacio.</p>
      </section>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-1">Avisos de episodios nuevos</p>
        <p className="text-[13px] text-nf-text2 leading-relaxed">
          Sigues {seguidas.size} {seguidas.size === 1 ? 'serie' : 'series'}. Se sigue sola
          cualquier serie de la que veas un episodio, y la campana de su ficha lo cambia.
        </p>
        {avisos && !avisos.soportado ? (
          <p className="mt-3 text-[12px] text-nf-text3 leading-relaxed">{avisos.motivo}</p>
        ) : (
          <>
            <button onClick={alternarAvisos} disabled={cambiando || !avisos}
              className={`mt-3 w-full h-12 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-40 ${
                avisos?.suscrito ? 'bg-white/10 text-nf-ok' : 'bg-white text-black'}`}>
              <span className="w-5 h-5"><IBell filled={!!avisos?.suscrito} /></span>
              {avisos?.suscrito ? 'Avisos activados en este teléfono' : 'Activar avisos en este teléfono'}
            </button>
            {avisos?.suscrito && (
              <button onClick={async () => {
                const n = await probarAvisos();
                toast(n ? 'Aviso de prueba enviado' : 'No se ha podido enviar el aviso', n ? 'ok' : 'error');
              }} className="mt-2 w-full h-11 rounded-xl bg-white/5 text-[14px] text-nf-text2">
                Enviar uno de prueba
              </button>
            )}
          </>
        )}
        {series.length > 0 && (
          <ul className="mt-3 divide-y divide-white/5">
            {series.map(serie => (
              <li key={serie.tmdb_id} className="flex items-center gap-3 py-2">
                <Link to={`/t/series/${serie.tmdb_id}`} className="flex-1 min-w-0 text-[14px] truncate">
                  {serie.title}
                </Link>
                <button onClick={() => alternar(serie.tmdb_id)}
                  aria-label={`Dejar de seguir ${serie.title}`}
                  className="w-9 h-9 rounded-full bg-white/10 text-nf-text3 flex items-center justify-center active:bg-nf-red/40">
                  <span className="w-4 h-4"><IBell /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link to="/vincular" className="flex items-center rounded-2xl bg-white/5 p-4 mb-4 active:bg-white/10">
        <span className="flex-1">
          <span className="block text-[15px] font-semibold">Vincular una tele</span>
          <span className="block text-[13px] text-nf-text2 mt-0.5">Entra en la tele sin teclear: escribe el código que sale en su pantalla.</span>
        </span>
        <span className="text-nf-text3 text-[22px] ml-3">›</span>
      </Link>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-3">Cambiar contraseña</p>
        <div className="space-y-2">
          <input className={input} type="password" placeholder="Contraseña actual" value={cur} onChange={e => setCur(e.target.value)} />
          <input className={input} type="password" placeholder="Nueva (mínimo 4 caracteres)" value={nxt} onChange={e => setNxt(e.target.value)} />
        </div>
        <button onClick={change} disabled={busy || !cur || nxt.length < 4} className="mt-3 w-full h-11 rounded-xl bg-white/10 disabled:opacity-40 text-[15px] font-medium">Guardar</button>
      </section>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-1">Continuar viendo</p>
        <p className="text-[13px] text-nf-text2 leading-relaxed">
          Tu fila es solo tuya: cada cuenta tiene la suya. Si te aparece algo que
          no has visto tú, es de cuando el historial se guardaba en el aparato y
          se compartía sin querer; vacíala y no volverá.
        </p>
        <button onClick={async () => {
          if (!confirm('¿Vaciar tu «Continuar viendo»? No se borra nada del servidor, solo por dónde ibas.')) return;
          try { await clearAllWatched(); toast('Historial vaciado', 'ok'); }
          catch { toast('No se ha podido vaciar', 'error'); }
        }} className="mt-3 w-full h-11 rounded-xl bg-white/10 text-[15px] font-medium text-nf-text2">
          Vaciar mi «Continuar viendo»
        </button>
      </section>
      <section className="rounded-2xl bg-white/5 p-4 mb-4 text-[13px] text-nf-text2 leading-relaxed">
        <p className="font-semibold text-white mb-1">Instalar como app</p>
        <p>iPhone: en Safari, Compartir → "Añadir a pantalla de inicio". Android: menú de Chrome → "Instalar aplicación".</p>
        <a href="/?desktop=1" className="block mt-3 text-white underline">Abrir la versión de escritorio</a>
      </section>
      <button onClick={logout} className="w-full h-12 rounded-xl bg-nf-red/20 text-red-300 text-[15px] font-semibold">Cerrar sesión</button>
    </div>
  );
}
