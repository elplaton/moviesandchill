import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../utils/toast';

const GB = 1024 ** 3;
const fmt = (b: number | null | undefined) => b == null ? 'Sin límite' : `${(b / GB).toFixed(b >= GB * 10 ? 0 : 1)} GB`;
const input = 'w-full h-11 rounded-xl bg-white/10 border border-white/10 px-4 text-[16px] outline-none focus:border-white/40';
const TABS = [['usuarios', 'Usuarios'], ['descargas', 'Descargas'], ['canales', 'Canales'], ['servidor', 'Servidor']] as const;

interface U { id: number; username: string; role: string; active: boolean; quota_bytes: number | null; used_bytes: number; downloads: number }

function Users() {
  const { me } = useAuth();
  const [users, setUsers] = useState<U[]>([]);
  const [form, setForm] = useState({ username: '', password: '', role: 'user', quota: '20' });
  const [edit, setEdit] = useState<U | null>(null);
  const [ef, setEf] = useState({ quota: '', unlimited: false, password: '', role: 'user' });
  const load = () => apiFetch('/admin/users').then(r => r.json()).then(d => setUsers(d.users || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  const create = async () => {
    const r = await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify({ username: form.username.trim(), password: form.password, role: form.role, quota_gb: form.quota.trim() === '' ? null : parseFloat(form.quota) }) });
    const d = await r.json(); if (!r.ok) { toast(d.detail || 'No se pudo crear', 'error'); return; }
    toast('Cuenta creada', 'ok'); setForm({ username: '', password: '', role: 'user', quota: '20' }); load();
  };
  const save = async () => {
    if (!edit) return;
    const body: any = { role: ef.role }; if (ef.unlimited) body.unlimited = true; else if (ef.quota.trim()) body.quota_gb = parseFloat(ef.quota); if (ef.password) body.password = ef.password;
    const r = await apiFetch(`/admin/users/${edit.id}`, { method: 'PATCH', body: JSON.stringify(body) }); const d = await r.json();
    if (!r.ok) { toast(d.detail || 'No se pudo guardar', 'error'); return; } toast('Guardado', 'ok'); setEdit(null); load();
  };
  const toggle = async (u: U) => { const r = await apiFetch(`/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) }); const d = await r.json(); if (!r.ok) toast(d.detail, 'error'); load(); };
  const remove = async (u: U) => { if (!confirm(`¿Borrar la cuenta ${u.username}? Sus descargas pasarán a la tuya.`)) return; const r = await apiFetch(`/admin/users/${u.id}`, { method: 'DELETE' }); const d = await r.json(); if (!r.ok) toast(d.detail, 'error'); else toast('Cuenta borrada', 'ok'); load(); };
  return (
    <div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-3">Nueva cuenta</p>
        <div className="space-y-2">
          <input className={input} placeholder="Usuario" autoCapitalize="none" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
          <input className={input} placeholder="Contraseña" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <div className="flex gap-2">
            <select className={input} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="user">Usuario</option><option value="admin">Administrador</option></select>
            <div className="relative w-[140px] shrink-0"><input className={`${input} pr-9`} type="number" inputMode="decimal" placeholder="Cuota" value={form.quota} onChange={e => setForm({ ...form, quota: e.target.value })} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-nf-text3">GB</span></div>
          </div>
          <button onClick={create} disabled={!form.username.trim() || form.password.length < 4} className="w-full h-11 rounded-xl bg-nf-red disabled:opacity-40 text-[15px] font-semibold">Crear cuenta</button>
        </div>
      </section>
      {users.map(u => {
        const pct = u.quota_bytes ? Math.min(100, Math.round((u.used_bytes / u.quota_bytes) * 100)) : 0;
        return (
          <div key={u.id} className={`rounded-2xl bg-white/5 p-4 mb-2 ${u.active ? '' : 'opacity-60'}`}>
            <div className="flex items-center justify-between">
              <div><p className="text-[16px] font-semibold">{u.username}{u.username === me?.username && <span className="text-nf-text3 text-[12px]"> (tú)</span>}</p><p className="text-[12px] text-nf-text3">{u.role === 'admin' ? 'Administrador' : 'Usuario'} · {u.downloads} descargas{!u.active && ' · desactivada'}</p></div>
              <button onClick={() => { setEdit(u); setEf({ quota: u.quota_bytes == null ? '' : String(u.quota_bytes / GB), unlimited: u.quota_bytes == null, password: '', role: u.role }); }} className="tap h-9 px-3 rounded-full bg-white/10 text-[13px]">Editar</button>
            </div>
            <p className="text-[12px] text-nf-text2 mt-2">{fmt(u.used_bytes)} usados · {u.quota_bytes ? `${pct} % de ${fmt(u.quota_bytes)}` : 'sin límite'}</p>
            <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`h-full ${pct >= 90 ? 'bg-nf-red' : 'bg-nf-ok'}`} style={{ width: `${u.quota_bytes ? pct : 5}%` }} /></div>
            {u.username !== me?.username && (
              <div className="flex gap-2 mt-3">
                <button onClick={() => toggle(u)} className="tap h-9 px-3 rounded-full bg-white/10 text-[13px]">{u.active ? 'Desactivar' : 'Activar'}</button>
                <button onClick={() => remove(u)} className="tap h-9 px-3 rounded-full bg-nf-red/20 text-red-300 text-[13px]">Borrar</button>
              </div>
            )}
          </div>
        );
      })}
      {edit && (
        <div className="fixed inset-0 z-[65] bg-black/70 flex items-end" onClick={() => setEdit(null)}>
          <div className="w-full bg-nf-raised rounded-t-2xl p-4 rise space-y-2" style={{ paddingBottom: 'calc(16px + var(--safe-b))' }} onClick={e => e.stopPropagation()}>
            <p className="text-[16px] font-semibold mb-1">Editar {edit.username}</p>
            <select className={input} value={ef.role} onChange={e => setEf({ ...ef, role: e.target.value })}><option value="user">Usuario</option><option value="admin">Administrador</option></select>
            <div className="flex items-center gap-2">
              <input className={input} type="number" inputMode="decimal" placeholder="Cuota GB" disabled={ef.unlimited} value={ef.quota} onChange={e => setEf({ ...ef, quota: e.target.value })} />
              <label className="flex items-center gap-2 text-[13px] shrink-0"><input type="checkbox" checked={ef.unlimited} onChange={e => setEf({ ...ef, unlimited: e.target.checked })} />Sin límite</label>
            </div>
            <input className={input} type="password" placeholder="Nueva contraseña (opcional)" value={ef.password} onChange={e => setEf({ ...ef, password: e.target.value })} />
            <button onClick={save} className="w-full h-11 rounded-xl bg-nf-red text-[15px] font-semibold">Guardar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadsAll() {
  const [rows, setRows] = useState<any[]>([]);
  const [conv, setConv] = useState<any>(null);
  const load = () => { apiFetch('/admin/downloads').then(r => r.json()).then(d => setRows(d.downloads || [])).catch(() => {}); apiFetch('/admin/convert-library').then(r => r.json()).then(setConv).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  const remove = async (r: any) => { if (!confirm(`¿Borrar "${r.folder_name}"?`)) return; const d = await (await apiFetch('/files', { method: 'DELETE', body: JSON.stringify({ path: r.folder_path }) })).json(); toast(d.error || 'Borrado', d.error ? 'error' : 'ok'); load(); };
  const convert = async () => { const d = await (await apiFetch('/admin/convert-library', { method: 'POST' })).json(); toast(d.status === 'already_running' ? 'Ya está en marcha' : 'Convirtiendo a MP4…'); load(); };
  const total = rows.reduce((s, r) => s + (r.size_bytes || 0), 0);
  return (
    <div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[15px] font-semibold">Biblioteca en MP4</p>
        <p className="text-[12px] text-nf-text3 mt-1">Reempaqueta lo que esté en MKV para que se vea en iPhone.{conv?.running && ` En marcha: ${conv.done}/${conv.total}`}</p>
        <button onClick={convert} disabled={!!conv?.running} className="mt-3 w-full h-11 rounded-xl bg-white/10 disabled:opacity-40 text-[15px] font-medium">{conv?.running ? 'Convirtiendo…' : 'Convertir biblioteca'}</button>
      </section>
      <p className="text-[13px] text-nf-text2 mb-2">{rows.length} descargas · {fmt(total)}</p>
      {rows.map(r => (
        <div key={r.id} className="flex items-center gap-3 py-2.5 border-b border-white/5">
          <div className="flex-1 min-w-0"><p className="text-[14px] truncate">{r.folder_name}</p><p className="text-[12px] text-nf-text3">{r.owner || 'admin'} · {fmt(r.size_bytes)} · {r.status === 'done' ? 'en disco' : r.status}</p></div>
          <button onClick={() => remove(r)} disabled={r.status !== 'done'} className="tap h-9 px-3 rounded-full bg-nf-red/20 text-red-300 text-[13px] disabled:opacity-40">Borrar</button>
        </div>
      ))}
    </div>
  );
}

function Channels() {
  const [channels, setChannels] = useState<{ id: number; name: string }[]>([]);
  const [url, setUrl] = useState(''); const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState<any[]>([]);
  const load = () => { apiFetch('/channels').then(r => r.json()).then(d => setChannels(d.channels || [])).catch(() => {}); apiFetch('/index/progress').then(r => r.json()).then(d => setProgress(d.channels || [])).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  const add = async () => { setMsg('Resolviendo…'); const d = await (await apiFetch('/channels/add', { method: 'POST', body: JSON.stringify({ url: url.trim() }) })).json(); setMsg(d.error || `${d.status === 'added' ? 'Añadido' : 'Actualizado'}: ${d.channel?.name}`); if (!d.error) setUrl(''); load(); };
  const rescan = async (id: number) => { await apiFetch(`/index/channel/${id}`, { method: 'POST' }); toast('Reescaneando canal'); };
  const reclass = async () => { const d = await (await apiFetch('/index/reclassify', { method: 'POST' })).json(); toast(d.status === 'already_running' ? 'Ya está en marcha' : 'Reclasificando catálogo…'); };
  return (
    <div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-2">Añadir canal</p>
        <input className={input} placeholder="https://t.me/…" autoCapitalize="none" value={url} onChange={e => setUrl(e.target.value)} />
        <button onClick={add} disabled={!url.trim()} className="mt-2 w-full h-11 rounded-xl bg-nf-red disabled:opacity-40 text-[15px] font-semibold">Añadir</button>
        {msg && <p className="text-[12px] text-nf-text2 mt-2">{msg}</p>}
      </section>
      {channels.map(c => {
        const p = progress.find((x: any) => x.channel_id === c.id);
        const pct = p?.total_estimate ? Math.round((p.total_scanned / p.total_estimate) * 100) : 0;
        return (
          <div key={c.id} className="rounded-2xl bg-white/5 p-4 mb-2">
            <div className="flex items-center justify-between"><p className="text-[15px] font-semibold truncate">{c.name}</p><button onClick={() => rescan(c.id)} className="tap h-9 px-3 rounded-full bg-white/10 text-[13px] shrink-0">Reescanear</button></div>
            {p && <><p className="text-[12px] text-nf-text3 mt-1">{p.total_indexed?.toLocaleString()} archivos · {p.status === 'done' ? 'completado' : `${pct} %`}</p><div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`h-full ${p.status === 'done' ? 'bg-nf-ok' : 'bg-nf-red'}`} style={{ width: `${p.status === 'done' ? 100 : pct}%` }} /></div></>}
          </div>
        );
      })}
      <button onClick={reclass} className="mt-2 w-full h-11 rounded-xl bg-white/10 text-[15px] font-medium">Reclasificar catálogo</button>
    </div>
  );
}

function Server() {
  const [cfg, setCfg] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  useEffect(() => { apiFetch('/config').then(r => r.json()).then(d => setCfg(d.config)).catch(() => {}); apiFetch('/status').then(r => r.json()).then(setStatus).catch(() => {}); }, []);
  const set = async (k: string, v: any) => { setCfg({ ...cfg, [k]: v }); await apiFetch('/config', { method: 'POST', body: JSON.stringify({ [k]: v }) }); toast('Guardado', 'ok'); };
  if (!cfg) return <p className="text-[14px] text-nf-text3">Cargando…</p>;
  const Toggle = ({ k, label, help }: { k: string; label: string; help?: string }) => (
    <button onClick={() => set(k, !cfg[k])} className="w-full flex items-center justify-between py-3 border-b border-white/5 text-left">
      <div><p className="text-[15px]">{label}</p>{help && <p className="text-[12px] text-nf-text3">{help}</p>}</div>
      <span className={`w-12 h-7 rounded-full relative shrink-0 ${cfg[k] ? 'bg-nf-red' : 'bg-white/15'}`}><span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${cfg[k] ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></span>
    </button>
  );
  return (
    <div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-1">Estado</p>
        <p className="text-[14px]">Espacio libre: {status?.disk_free || '—'} · Descargas activas: {status?.active_batches?.length ?? 0}</p>
        <p className="text-[12px] text-nf-text3 mt-1">Telegram: {cfg.phone || '—'} · TMDB: {cfg.tmdb_api_key ? 'configurado' : 'sin clave'}</p>
      </section>
      <section className="rounded-2xl bg-white/5 px-4 py-1 mb-4">
        <Toggle k="tmdb_enabled" label="Metadatos de TMDB" help="Carátulas, sinopsis y clasificación" />
        <Toggle k="convert_dts_to_ac3" label="Convertir a MP4 al descargar" help="Necesario para iPhone y para las teles" />
        <Toggle k="delete_archives_after_extract" label="Borrar comprimidos tras extraer" />
      </section>
      <p className="text-[12px] text-nf-text3">Las rutas, las claves de Telegram y el resto de ajustes se editan desde la web de escritorio o en el archivo .env del servidor.</p>
    </div>
  );
}

export default function Admin() {
  const { tab = 'usuarios' } = useParams();
  const navigate = useNavigate();
  return (
    <div className="px-4 pb-6" style={{ paddingTop: 'calc(var(--safe-t) + 20px)' }}>
      <h1 className="text-[28px] font-bold mb-3">Administración</h1>
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4 -mx-4 px-4">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => navigate(`/admin/${id}`)} className={`shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold ${tab === id ? 'bg-white text-black' : 'bg-white/10 text-nf-text2'}`}>{label}</button>
        ))}
      </div>
      {tab === 'usuarios' && <Users />}
      {tab === 'descargas' && <DownloadsAll />}
      {tab === 'canales' && <Channels />}
      {tab === 'servidor' && <Server />}
    </div>
  );
}
