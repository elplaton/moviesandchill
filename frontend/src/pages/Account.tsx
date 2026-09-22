import { useState } from 'react';
import Layout from '../components/Layout';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

/** Mi cuenta: cuánto ocupo y cambiar la contraseña. */
export default function Account() {
  const { username, isAdmin, usedBytes, quotaBytes } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pct = quotaBytes ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;
  const input = 'w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-white/25 transition-all';

  const change = async () => {
    setMsg(null);
    const r = await apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ current_password: current, new_password: next }) });
    const d = await r.json();
    if (!r.ok) { setMsg({ ok: false, text: d.detail || 'No se pudo cambiar' }); return; }
    setMsg({ ok: true, text: 'Contraseña cambiada' }); setCurrent(''); setNext('');
  };

  return (
    <Layout>
      <div className="px-6 md:px-14 pt-24 pb-20 max-w-2xl mx-auto">
        <h1 className="text-white text-4xl font-bold mb-2 tracking-tight">Mi cuenta</h1>
        <p className="text-gray-400 text-sm mb-10">{username}{isAdmin ? ' · administrador' : ''}</p>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
          <h2 className="text-white font-semibold mb-3">Espacio en disco</h2>
          <p className="text-gray-400 text-sm mb-3">
            {quotaBytes != null ? `${gb(usedBytes)} usados de ${gb(quotaBytes)} (${pct} %)` : `${gb(usedBytes)} usados · sin límite`}
          </p>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full ${pct >= 90 ? 'bg-netflix-red' : 'bg-green-500'}`} style={{ width: `${quotaBytes ? pct : 5}%` }} />
          </div>
          <p className="text-gray-500 text-xs mt-3">Cuenta lo que has descargado y sigue en el servidor. Bórralo desde su ficha para liberar espacio.</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl">
          <h2 className="text-white font-semibold mb-4">Cambiar contraseña</h2>
          <div className="space-y-3">
            <input className={input} type="password" placeholder="Contraseña actual" value={current} onChange={e => setCurrent(e.target.value)} />
            <input className={input} type="password" placeholder="Contraseña nueva (mínimo 4 caracteres)" value={next} onChange={e => setNext(e.target.value)} />
          </div>
          {msg && <p className={`mt-3 text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
          <button onClick={change} disabled={!current || next.length < 4}
            className="mt-5 bg-netflix-red hover:bg-netflix-red-hover disabled:opacity-40 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-all">
            Guardar
          </button>
        </div>
      </div>
    </Layout>
  );
}
