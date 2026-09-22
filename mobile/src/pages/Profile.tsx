import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../services/api';
import { toast } from '../utils/toast';

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

export default function Profile() {
  const { me, logout } = useAuth();
  const [cur, setCur] = useState(''); const [nxt, setNxt] = useState(''); const [busy, setBusy] = useState(false);
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
        <p className="text-[13px] font-semibold text-nf-text2 mb-3">Cambiar contraseña</p>
        <div className="space-y-2">
          <input className={input} type="password" placeholder="Contraseña actual" value={cur} onChange={e => setCur(e.target.value)} />
          <input className={input} type="password" placeholder="Nueva (mínimo 4 caracteres)" value={nxt} onChange={e => setNxt(e.target.value)} />
        </div>
        <button onClick={change} disabled={busy || !cur || nxt.length < 4} className="mt-3 w-full h-11 rounded-xl bg-white/10 disabled:opacity-40 text-[15px] font-medium">Guardar</button>
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
