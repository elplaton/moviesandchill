import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../utils/toast';

const GB = 1024 ** 3;
const fmt = (b: number | null | undefined) => b == null ? 'Sin límite' : `${(b / GB).toFixed(b >= GB * 10 ? 0 : 1)} GB`;
const input = 'w-full h-11 rounded-xl bg-white/10 border border-white/10 px-4 text-[16px] outline-none focus:border-white/40';
// Mismo orden y mismas secciones que el panel de escritorio.
const TABS = [
  ['usuarios', 'Usuarios'], ['descargas', 'Descargas'], ['canales', 'Canales'],
  ['novedades', 'Novedades'], ['telegram', 'Telegram'], ['servidor', 'Ajustes'],
  ['registros', 'Registros'],
] as const;

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
  const [stats, setStats] = useState<any>(null);
  const load = () => { apiFetch('/channels').then(r => r.json()).then(d => setChannels(d.channels || [])).catch(() => {}); apiFetch('/index/progress').then(r => r.json()).then(d => setProgress(d.channels || [])).catch(() => {}); apiFetch('/index/stats').then(r => r.json()).then(setStats).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  const add = async () => { setMsg('Resolviendo…'); const d = await (await apiFetch('/channels/add', { method: 'POST', body: JSON.stringify({ url: url.trim() }) })).json(); setMsg(d.error || `${d.status === 'added' ? 'Añadido' : 'Actualizado'}: ${d.channel?.name}`); if (!d.error) setUrl(''); load(); };
  const rescan = async (id: number) => { await apiFetch(`/index/channel/${id}`, { method: 'POST' }); toast('Reescaneando canal'); };
  const reclass = async () => { const d = await (await apiFetch('/index/reclassify', { method: 'POST' })).json(); toast(d.status === 'already_running' ? 'Ya está en marcha' : 'Reclasificando catálogo…'); };
  // Mismo orden que en escritorio: primero lo indexado, luego los canales y
  // el añadir al final. En el movil estaba justo al reves.
  const Cifra = ({ n, label }: { n?: number; label: string }) => (
    <div className="flex-1 rounded-xl bg-black/25 py-3 text-center">
      <p className="text-[19px] font-bold leading-none">{(n ?? 0).toLocaleString('es-ES')}</p>
      <p className="text-[11px] text-nf-text3 mt-1">{label}</p>
    </div>
  );

  return (
    <div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-3">Contenido indexado</p>
        <div className="flex gap-2">
          <Cifra n={stats?.total} label="Total" />
          <Cifra n={stats?.movies} label="Películas" />
          <Cifra n={stats?.series} label="Series" />
          <Cifra n={stats?.with_tmdb} label="Con ficha" />
        </div>
        <button onClick={reclass} className="mt-3 w-full h-11 rounded-xl bg-white/10 text-[15px] font-medium">Reclasificar catálogo</button>
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
      <section className="rounded-2xl bg-white/5 p-4 mt-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-2">Añadir canal</p>
        <input className={input} placeholder="https://t.me/…" autoCapitalize="none" value={url} onChange={e => setUrl(e.target.value)} />
        <button onClick={add} disabled={!url.trim()} className="mt-2 w-full h-11 rounded-xl bg-nf-red disabled:opacity-40 text-[15px] font-semibold">Añadir</button>
        {msg && <p className="text-[12px] text-nf-text2 mt-2">{msg}</p>}
      </section>
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

/** Lo que va llegando en vivo a los canales, con el motivo del descarte. */
function Novedades() {
  const [items, setItems] = useState<any[]>([]);
  const [estado, setEstado] = useState<any>(null);
  const [soloIndexadas, setSoloIndexadas] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const load = () => {
      const q = soloIndexadas ? '&only_indexed=true' : '';
      apiFetch(`/admin/novedades?limit=120${q}`).then(r => r.json())
        .then(d => setItems(d.items || [])).catch(() => {}).finally(() => setCargando(false));
      apiFetch('/admin/novedades/estado').then(r => r.json()).then(setEstado).catch(() => {});
    };
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [soloIndexadas]);

  const cuando = (at: string) => {
    const t = new Date(String(at).replace(' ', 'T'));
    if (Number.isNaN(t.getTime())) return at;
    const m = Math.floor((Date.now() - t.getTime()) / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `hace ${h} h` : t.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  };
  const tipo = (n: any) => n.media_type === 'series'
    ? `Serie · ${n.season ?? 0}x${String(n.episode ?? 0).padStart(2, '0')}`
    : n.media_type === 'movie' ? 'Película' : 'Sin clasificar';

  return (
    <div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${estado?.listening ? 'bg-nf-ok' : 'bg-nf-red'}`} />
          <p className="text-[15px] font-semibold">
            {estado?.listening ? 'Escuchando mensajes nuevos' : 'Escucha parada'}
          </p>
        </div>
        <p className="text-[13px] text-nf-text3 mt-1">
          {estado?.listening
            ? `${estado.channels} ${estado.channels === 1 ? 'canal' : 'canales'} vigilados, ${estado.resolved} resueltos.`
            : 'Hace falta una sesión de Telegram activa.'}
        </p>
        {estado?.unresolved?.length > 0 && (
          <p className="text-[13px] text-amber-400/90 mt-2">
            Sin resolver: {estado.unresolved.join(', ')}.
          </p>
        )}
      </section>

      <label className="flex items-center gap-2 text-[13px] text-nf-text2 mb-3">
        <input type="checkbox" checked={soloIndexadas} onChange={e => setSoloIndexadas(e.target.checked)} className="accent-nf-red" />
        Solo las indexadas
      </label>

      {cargando ? <p className="text-[14px] text-nf-text3">Cargando…</p>
        : items.length === 0 ? (
          <p className="text-[14px] text-nf-text3 leading-relaxed">
            Todavía no ha llegado nada. Aquí aparece cada archivo publicado en los canales
            desde que el servidor escucha, indexado o descartado.
          </p>
        ) : (
          <div className="rounded-2xl bg-white/5 divide-y divide-white/5">
            {items.map(n => (
              <div key={n.id} className="flex items-center gap-3 p-3">
                <div className="w-9 h-[54px] shrink-0 rounded-md overflow-hidden bg-white/5">
                  {n.poster && <img src={`https://image.tmdb.org/t/p/w92${n.poster}`} alt="" loading="lazy" className="w-full h-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] truncate">{n.title || n.file_name}</p>
                  <p className="text-[12px] text-nf-text3 truncate">{n.channel} · {tipo(n)} · {cuando(n.at)}</p>
                </div>
                <span className={`shrink-0 text-[11px] px-2 py-1 rounded-lg ${n.indexed ? 'bg-nf-ok/15 text-green-300' : 'bg-white/10 text-nf-text3'}`}>
                  {n.indexed ? 'Indexado' : n.reason || 'Descartado'}
                </span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

/** Sesión de Telegram y sus credenciales, igual que en el escritorio. */
function Telegram() {
  const [st, setSt] = useState<any>(null);
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [pidePass, setPidePass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ api_id: 0, api_hash: '', phone: '' });

  const load = () => apiFetch('/admin/telegram/status').then(r => r.json()).then(d => {
    setSt(d);
    setForm(d.credentials || { api_id: 0, api_hash: '', phone: '' });
    if (!d.configured) setEditando(true);
  }).catch(() => setError('No se ha podido consultar la sesión.'));

  useEffect(() => { load(); }, []);

  const detalle = async (r: Response, fb: string) => { try { return (await r.json()).detail || fb; } catch { return fb; } };

  const enviar = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/admin/telegram/send-code', { method: 'POST' });
      if (!r.ok) setError(await detalle(r, 'Telegram no ha querido mandar el código.'));
      else { toast('Código enviado', 'ok'); setPidePass(false); setCode(''); load(); }
    } finally { setBusy(false); }
  };

  const entrar = async () => {
    if (!code.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/admin/telegram/sign-in', { method: 'POST', body: JSON.stringify({ code, password: pass || null }) });
      if (r.status === 428) { setPidePass(true); setError(await detalle(r, 'Hace falta tu contraseña de dos pasos.')); }
      else if (!r.ok) setError(await detalle(r, 'No se ha podido iniciar sesión.'));
      else { toast('Sesión iniciada', 'ok'); setCode(''); setPass(''); setPidePass(false); load(); }
    } finally { setBusy(false); }
  };

  const guardarCreds = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/admin/telegram/credentials', {
        method: 'POST',
        body: JSON.stringify({ api_id: Number(form.api_id) || 0, api_hash: form.api_hash, phone: form.phone }),
      });
      if (!r.ok) setError(await detalle(r, 'No se han podido guardar.'));
      else { toast('Credenciales guardadas', 'ok'); setEditando(false); load(); }
    } finally { setBusy(false); }
  };

  if (!st) return <p className="text-[14px] text-nf-text3">Cargando…</p>;
  const creds = st.credentials || { api_id: 0, api_hash: '', phone: '' };
  const boton = 'w-full h-11 rounded-xl text-[15px] font-semibold disabled:opacity-40';

  return (
    <div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2.5 h-2.5 rounded-full ${st.authorized ? 'bg-nf-ok' : st.configured ? 'bg-nf-red' : 'bg-amber-400'}`} />
          <p className="text-[15px] font-semibold">
            {st.authorized ? 'Sesión activa' : st.configured ? 'Sin sesión de Telegram' : 'Falta configurar Telegram'}
          </p>
        </div>

        {st.authorized ? (
          <p className="text-[13px] text-nf-text3">
            Conectado como {st.phone} · {st.channels_resolved === 1 ? '1 canal resuelto' : `${st.channels_resolved} canales resueltos`}
          </p>
        ) : st.configured ? (
          <>
            <p className="text-[13px] text-nf-text3 leading-relaxed">
              El código llega como mensaje del propio Telegram dentro de la app, no por SMS,
              si tienes sesión abierta en otro dispositivo.
            </p>
            {error && <p className="mt-3 text-[13px] text-red-300">{error}</p>}
            {!st.code_sent ? (
              <button onClick={enviar} disabled={busy} className={`${boton} mt-3 bg-nf-red`}>
                {busy ? 'Enviando…' : 'Enviar código'}
              </button>
            ) : (
              <div className="mt-3 space-y-2">
                <input className={input} value={code} onChange={e => setCode(e.target.value)}
                  inputMode="numeric" placeholder="Código de verificación" />
                {pidePass && (
                  <input className={input} type="password" value={pass} onChange={e => setPass(e.target.value)}
                    placeholder="Contraseña de dos pasos" />
                )}
                <button onClick={entrar} disabled={busy || !code.trim()} className={`${boton} bg-nf-red`}>
                  {busy ? 'Comprobando…' : 'Iniciar sesión'}
                </button>
                <button onClick={enviar} disabled={busy} className="w-full h-10 text-[13px] text-nf-text3">
                  Mandar otro código
                </button>
                <p className="text-[12px] text-nf-text3 leading-relaxed">
                  Si no llega, espera unos minutos antes de pedir otro: Telegram limita los envíos.
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-[13px] text-nf-text3">{st.detail || 'Escribe abajo las credenciales.'}</p>
        )}
      </section>

      <section className="rounded-2xl bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-nf-text2">Credenciales de Telegram</p>
          {!editando && <button onClick={() => setEditando(true)} className="text-[13px] text-nf-text3">Editar</button>}
        </div>

        {!editando ? (
          <p className="text-[13px] text-nf-text3 mt-2">
            API ID {creds.api_id || '—'} · Hash {creds.api_hash || '—'} · {creds.phone || '—'}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-[12px] text-nf-text3 leading-relaxed">
              Se sacan de my.telegram.org/apps. Se guardan en la base de datos, no en el .env,
              así que sobreviven a los redespliegues.
            </p>
            <input className={input} value={form.api_id || ''} inputMode="numeric" placeholder="API ID"
              onChange={e => setForm({ ...form, api_id: Number(e.target.value.replace(/\D/g, '')) })} />
            <input className={input} value={form.api_hash} placeholder="API Hash" autoCapitalize="none"
              onChange={e => setForm({ ...form, api_hash: e.target.value })} />
            <input className={input} value={form.phone} placeholder="+34600112233"
              onChange={e => setForm({ ...form, phone: e.target.value })} />
            <p className="text-[12px] text-nf-text3 leading-relaxed">
              Cambiar el API ID o el Hash invalida la sesión actual: habría que volver a entrar.
            </p>
            <button onClick={guardarCreds} disabled={busy} className={`${boton} bg-nf-red`}>
              {busy ? 'Guardando…' : 'Guardar credenciales'}
            </button>
            {st.configured && (
              <button onClick={() => { setEditando(false); setForm(creds); }} className="w-full h-10 text-[13px] text-nf-text3">
                Cancelar
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Registros del servidor. En Docker el backend explica que use docker logs. */
function Registros() {
  const [lineas, setLineas] = useState<string[]>([]);
  const [aviso, setAviso] = useState('');
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    const load = () => apiFetch('/logs?lines=200').then(r => r.json()).then(d => {
      if (d.logs) { setLineas(d.logs); setAviso(''); }
      else setAviso(d.error || d.detail || 'Sin registros disponibles.');
    }).catch(() => setAviso('No se han podido leer los registros.'));
    load();
    const t = setInterval(() => { if (!pausado) load(); }, 4000);
    return () => clearInterval(t);
  }, [pausado]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] text-nf-text3">{lineas.length} líneas</p>
        <button onClick={() => setPausado(p => !p)} className="h-9 px-4 rounded-full bg-white/10 text-[13px]">
          {pausado ? 'Reanudar' : 'Pausar'}
        </button>
      </div>
      {aviso ? (
        <p className="rounded-2xl bg-white/5 p-4 text-[13px] text-nf-text2 leading-relaxed">{aviso}</p>
      ) : (
        <pre className="rounded-2xl bg-black/50 p-3 text-[11px] leading-[1.5] overflow-x-auto whitespace-pre text-nf-text2">
{lineas.join('\n')}
        </pre>
      )}
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
      {tab === 'novedades' && <Novedades />}
      {tab === 'telegram' && <Telegram />}
      {tab === 'servidor' && <Server />}
      {tab === 'registros' && <Registros />}
    </div>
  );
}
