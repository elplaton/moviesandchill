import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

export interface AdminUser {
  id: number; username: string; role: 'user' | 'admin'; active: boolean;
  quota_bytes: number | null; used_bytes: number; downloads: number; created_at: string;
}

const GB = 1024 ** 3;
export const fmtGB = (b: number | null | undefined) => b == null ? 'Sin límite' : `${(b / GB).toFixed(b >= GB * 10 ? 0 : 1)} GB`;

function UsageBar({ used, quota }: { used: number; quota: number | null }) {
  const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  return (
    <div className="min-w-[180px]">
      <div className="flex justify-between text-[11px] text-nf-dim mb-1">
        <span>{fmtGB(used)} usados</span><span>{quota ? `${pct} % de ${fmtGB(quota)}` : 'Sin límite'}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full ${pct >= 90 ? 'bg-nf-red' : 'bg-green-500'}`} style={{ width: `${quota ? pct : 8}%`, opacity: quota ? 1 : 0.35 }} />
      </div>
    </div>
  );
}

/**
 * Cuentas: alta, rol, cuota de disco, activar/desactivar, contraseña y baja.
 * La cuota mide el disco que ocupa lo que esa cuenta ha descargado y sigue en
 * el servidor; al borrar se libera.
 */
export default function AdminUsers({ onToast }: { onToast: (m: string) => void }) {
  const { username: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState({ username: '', password: '', role: 'user', quota_gb: '20' });
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [edit, setEdit] = useState({ quota_gb: '', unlimited: false, password: '', role: 'user' });
  const [error, setError] = useState('');

  const load = async () => {
    try { const r = await apiFetch('/admin/users'); const d = await r.json(); setUsers(d.users || []); } catch {}
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    setError('');
    const r = await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify({
      username: form.username.trim(), password: form.password, role: form.role,
      quota_gb: form.quota_gb.trim() === '' ? null : parseFloat(form.quota_gb),
    }) });
    const d = await r.json();
    if (!r.ok) { setError(d.detail || 'No se pudo crear'); return; }
    onToast(`Cuenta ${form.username.trim()} creada`);
    setForm({ username: '', password: '', role: 'user', quota_gb: '20' });
    load();
  };

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    setEdit({ quota_gb: u.quota_bytes == null ? '' : String(u.quota_bytes / GB), unlimited: u.quota_bytes == null, password: '', role: u.role });
    setError('');
  };

  const save = async () => {
    if (!editing) return;
    const body: any = { role: edit.role };
    if (edit.unlimited) body.unlimited = true; else if (edit.quota_gb.trim() !== '') body.quota_gb = parseFloat(edit.quota_gb);
    if (edit.password) body.password = edit.password;
    const r = await apiFetch(`/admin/users/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { setError(d.detail || 'No se pudo guardar'); return; }
    onToast(`Cuenta ${editing.username} actualizada`);
    setEditing(null); load();
  };

  const toggleActive = async (u: AdminUser) => {
    const r = await apiFetch(`/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) });
    const d = await r.json();
    if (!r.ok) { onToast(d.detail || 'No se pudo cambiar'); return; }
    onToast(u.active ? `${u.username} desactivada` : `${u.username} activada`); load();
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`¿Borrar la cuenta ${u.username}? Sus descargas pasarán a tu cuenta.`)) return;
    const r = await apiFetch(`/admin/users/${u.id}`, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) { onToast(d.detail || 'No se pudo borrar'); return; }
    onToast(`Cuenta ${u.username} borrada`); load();
  };

  const input = 'bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-white/25 transition-all placeholder-gray-500';

  return (
    <div>
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
        <h2 className="text-white text-lg font-medium mb-1">Nueva cuenta</h2>
        <p className="text-nf-faint text-xs mb-4">La cuota es el espacio en disco que puede ocupar con sus descargas. Vacío = sin límite.</p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input className={input} placeholder="Usuario" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
          <input className={input} placeholder="Contraseña" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <select className={input} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            <option value="user">Usuario</option><option value="admin">Administrador</option>
          </select>
          <div className="relative">
            <input className={`${input} w-full pr-10`} placeholder="Cuota" type="number" min="0" step="1" value={form.quota_gb} onChange={e => setForm({ ...form, quota_gb: e.target.value })} />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-nf-faint text-xs">GB</span>
          </div>
          <button onClick={create} disabled={!form.username.trim() || form.password.length < 4}
            className="bg-nf-red hover:bg-nf-red-dark disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all">
            Crear cuenta
          </button>
        </div>
        {error && !editing && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl">
        <h2 className="text-white text-lg font-medium mb-4">Cuentas ({users.length})</h2>
        <div className="space-y-2.5">
          {users.map(u => (
            <div key={u.id} className={`flex flex-wrap items-center gap-4 rounded-xl px-4 py-3 border ${u.active ? 'bg-black/20 border-white/5' : 'bg-black/10 border-white/5 opacity-60'}`}>
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-nf-red to-red-800 flex items-center justify-center text-white font-semibold text-sm shrink-0">
                {u.username[0].toUpperCase()}
              </div>
              <div className="min-w-[160px]">
                <p className="text-white text-sm font-medium">
                  {u.username}{u.username === me && <span className="text-nf-faint text-xs"> (tú)</span>}
                </p>
                <p className="text-nf-faint text-[11px]">
                  {u.role === 'admin' ? 'Administrador' : 'Usuario'} · {u.downloads} descargas{!u.active && ' · desactivada'}
                </p>
              </div>
              <div className="flex-1"><UsageBar used={u.used_bytes} quota={u.quota_bytes} /></div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openEdit(u)} className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-all">Editar</button>
                {u.username !== me && (
                  <>
                    <button onClick={() => toggleActive(u)} className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-all">{u.active ? 'Desactivar' : 'Activar'}</button>
                    <button onClick={() => remove(u)} className="text-xs bg-nf-red/20 hover:bg-nf-red/40 text-red-300 px-3 py-1.5 rounded-lg transition-all">Borrar</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
          <div className="relative bg-nf-surface border border-white/10 rounded-3xl w-full max-w-md p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-white text-xl font-semibold mb-5">Editar {editing.username}</h2>
            <label className="block text-nf-dim text-xs mb-1">Rol</label>
            <select className={`${input} w-full mb-4`} value={edit.role} onChange={e => setEdit({ ...edit, role: e.target.value })}>
              <option value="user">Usuario</option><option value="admin">Administrador</option>
            </select>
            <label className="block text-nf-dim text-xs mb-1">Cuota de disco</label>
            <div className="flex items-center gap-3 mb-4">
              <input className={`${input} flex-1`} type="number" min="0" step="1" disabled={edit.unlimited} value={edit.quota_gb} onChange={e => setEdit({ ...edit, quota_gb: e.target.value })} />
              <span className="text-nf-faint text-xs">GB</span>
              <label className="flex items-center gap-2 text-nf-dim text-xs">
                <input type="checkbox" checked={edit.unlimited} onChange={e => setEdit({ ...edit, unlimited: e.target.checked })} /> Sin límite
              </label>
            </div>
            <label className="block text-nf-dim text-xs mb-1">Nueva contraseña (opcional)</label>
            <input className={`${input} w-full mb-2`} type="password" value={edit.password} onChange={e => setEdit({ ...edit, password: e.target.value })} placeholder="Dejar vacío para no cambiarla" />
            <p className="text-nf-faint text-[11px] mb-5">Ocupa ahora {fmtGB(editing.used_bytes)}.</p>
            {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="text-nf-dim hover:text-white text-sm px-4 py-2 rounded-xl hover:bg-white/5 transition-all">Cancelar</button>
              <button onClick={save} className="bg-nf-red hover:bg-nf-red-dark text-white text-sm px-5 py-2 rounded-xl font-medium transition-all">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
