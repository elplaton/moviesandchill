import { useCallback, useEffect, useState } from 'react';
import Shell from '../components/Shell';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useFollows } from '../contexts/FollowsContext';
import { clearAllWatched } from '../utils/progress';
import { activarAvisos, desactivarAvisos, estadoAvisos, probarAvisos,
         type EstadoAvisos } from '../services/push';

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

/** Mi cuenta: cuánto ocupo y cambiar la contraseña. */
export default function Account() {
  const { username, isAdmin, usedBytes, quotaBytes } = useAuth();
  const { keys: seguidas, items: series, recargar } = useFollows();
  const [avisos, setAvisos] = useState<EstadoAvisos | null>(null);
  const [avisoMsg, setAvisoMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pct = quotaBytes ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;
  const input = 'w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-white/25 transition-all';

  useEffect(() => { estadoAvisos().then(setAvisos); recargar(); }, [recargar]);

  const alternarAvisos = useCallback(async () => {
    if (!avisos) return;
    setOcupado(true);
    setAvisoMsg('');
    if (avisos.suscrito) {
      await desactivarAvisos();
      setAvisoMsg('Avisos desactivados en este navegador.');
    } else {
      const error = await activarAvisos('web');
      setAvisoMsg(error || 'Listo: te avisaremos de los episodios nuevos.');
    }
    setAvisos(await estadoAvisos());
    setOcupado(false);
  }, [avisos]);

  const change = async () => {
    setMsg(null);
    const r = await apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ current_password: current, new_password: next }) });
    const d = await r.json();
    if (!r.ok) { setMsg({ ok: false, text: d.detail || 'No se pudo cambiar' }); return; }
    setMsg({ ok: true, text: 'Contraseña cambiada' }); setCurrent(''); setNext('');
  };

  return (
    <Shell>
      <div className="px-6 md:px-14 pt-24 pb-20 max-w-2xl mx-auto">
        <h1 className="text-white text-4xl font-bold mb-2 tracking-tight">Mi cuenta</h1>
        <p className="text-nf-dim text-sm mb-10">{username}{isAdmin ? ' · administrador' : ''}</p>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
          <h2 className="text-white font-semibold mb-3">Espacio en disco</h2>
          <p className="text-nf-dim text-sm mb-3">
            {quotaBytes != null ? `${gb(usedBytes)} usados de ${gb(quotaBytes)} (${pct} %)` : `${gb(usedBytes)} usados · sin límite`}
          </p>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full ${pct >= 90 ? 'bg-nf-red' : 'bg-green-500'}`} style={{ width: `${quotaBytes ? pct : 5}%` }} />
          </div>
          <p className="text-nf-faint text-xs mt-3">Cuenta lo que has descargado y sigue en el servidor. Bórralo desde su ficha para liberar espacio.</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
          <h2 className="text-white font-semibold mb-3">Continuar viendo</h2>
          <p className="text-nf-dim text-sm mb-4">
            Tu fila es solo tuya: cada cuenta tiene la suya. Si te aparece algo que no has
            visto tú, es de cuando el historial se guardaba en el aparato y se compartía sin
            querer; vacíala y no volverá. No se borra nada del servidor, solo por dónde ibas.
          </p>
          <button onClick={async () => {
            if (!confirm('¿Vaciar tu «Continuar viendo»?')) return;
            setMsg(null);
            try { await clearAllWatched(); setMsg({ ok: true, text: 'Historial vaciado' }); }
            catch { setMsg({ ok: false, text: 'No se ha podido vaciar' }); }
          }}
            className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all">
            Vaciar mi «Continuar viendo»
          </button>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
          <h2 className="text-white font-semibold mb-3">Avisos de episodios nuevos</h2>
          <p className="text-nf-dim text-sm mb-4">
            Sigues {seguidas.size} {seguidas.size === 1 ? 'serie' : 'series'}. Se sigue sola
            cualquier serie de la que veas un episodio, y la campana de su ficha lo cambia.
          </p>
          {avisos && !avisos.soportado ? (
            <p className="text-nf-faint text-xs">{avisos.motivo}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={alternarAvisos} disabled={ocupado || !avisos}
                className="bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all">
                {avisos?.suscrito ? 'Desactivar en este navegador' : 'Activar avisos aquí'}
              </button>
              {avisos?.suscrito && (
                <button onClick={async () => {
                  const r = await probarAvisos('web');
                  setAvisoMsg(r.enviados ? 'Aviso de prueba enviado.'
                    : `No se ha podido enviar el aviso${r.error ? `: ${r.error}` : '.'}`);
                }}
                  className="text-nf-dim hover:text-white px-3 py-2.5 text-sm transition-all">
                  Enviar uno de prueba
                </button>
              )}
            </div>
          )}
          {avisoMsg && <p className="mt-3 text-xs text-nf-dim">{avisoMsg}</p>}
          {series.length > 0 && (
            <ul className="mt-4 space-y-1">
              {series.slice(0, 8).map(serie => (
                <li key={serie.tmdb_id} className="text-nf-dim text-sm">· {serie.title}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl">
          <h2 className="text-white font-semibold mb-4">Cambiar contraseña</h2>
          <div className="space-y-3">
            <input className={input} type="password" placeholder="Contraseña actual" value={current} onChange={e => setCurrent(e.target.value)} />
            <input className={input} type="password" placeholder="Contraseña nueva (mínimo 4 caracteres)" value={next} onChange={e => setNext(e.target.value)} />
          </div>
          {msg && <p className={`mt-3 text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
          <button onClick={change} disabled={!current || next.length < 4}
            className="mt-5 bg-nf-red hover:bg-nf-red-dark disabled:opacity-40 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-all">
            Guardar
          </button>
        </div>
      </div>
    </Shell>
  );
}
