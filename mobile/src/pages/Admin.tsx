import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Hoja from '../components/Hoja';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { botonPasada, cuantoQueda, estadoPasada, leerPasada, mandarPasada, resultadosPasada, type Pasada } from '../services/pasadaCreditos';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../utils/toast';
import { IBack, IClose, IMenu } from '../components/Icons';
import { buscarParaPedir, chatsDestino, enCuanto, enviarYa, ESTADO_TEXTO, guardarAjustes, moverEnCola, peticionesAdmin, probarPeticion,
         quitarDeCola, ritmo, segundosHastaPuesto, temasDe, TIPO_PETICION, vistaPrevia, volverALaCola,
         type AjustesPeticiones, type ChatDestino, type ResultadoPeticion, type TipoPeticion, type EstadoCola, type TemaForo, type PeticionAdmin } from '../services/peticiones';

// Punto de miles también con cuatro cifras («6.429», no «6429»): el español
// no lo pone por debajo de 10.000 y en las cifras del panel, unas con punto y
// otras sin él, parecía un error.
const MILES = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;

const GB = 1024 ** 3;
const fmt = (b: number | null | undefined) => b == null ? 'Sin límite' : `${(b / GB).toFixed(b >= GB * 10 ? 0 : 1)} GB`;
const input = 'w-full h-11 rounded-xl bg-white/10 border border-white/10 px-4 text-[16px] outline-none focus:border-white/40';
/*
 * Las secciones del panel, agrupadas por lo que tocan. Mismos grupos, mismo
 * orden y mismos ids que el panel de escritorio: se pidio que los dos se
 * recorran igual. En diez pestañas sueltas no se veia por donde empezar; en
 * cuatro grupos se sabe donde buscar sin abrirlas todas. El Resumen no esta
 * aqui porque no es una seccion mas: es la portada, y el menu va debajo.
 */
const GRUPOS = [
  { titulo: 'Catálogo', secciones: [['canales', 'Canales'], ['revision', 'Revisión'], ['novedades', 'Novedades']] },
  { titulo: 'Reproducción', secciones: [['creditos', 'Créditos']] },
  { titulo: 'Personas', secciones: [['usuarios', 'Usuarios'], ['descargas', 'Descargas'], ['peticiones', 'Peticiones']] },
  { titulo: 'Sistema', secciones: [['telegram', 'Telegram'], ['servidor', 'Ajustes'], ['registros', 'Registros']] },
] as const;

/** id de sección → su grupo y su nombre, para la cabecera. */
const SECCION: Record<string, { grupo: string; nombre: string }> = Object.fromEntries(
  GRUPOS.flatMap(g => g.secciones.map(([id, nombre]) => [id, { grupo: g.titulo, nombre }])),
);

interface U { id: number; username: string; role: string; active: boolean; quota_bytes: number | null; used_bytes: number; downloads: number; must_change_password?: boolean; last_seen_at?: string | null; online?: boolean }

/** «hace 5 min», «hace 3 h», «ayer», «hace 4 días» o la fecha. */
function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso);
  const min = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  return t.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}


function Users() {
  const { me } = useAuth();
  const [users, setUsers] = useState<U[]>([]);
  const [form, setForm] = useState({ username: '', password: '', role: 'user', quota: '20' });
  const [edit, setEdit] = useState<U | null>(null);
  const [ef, setEf] = useState({ quota: '', unlimited: false, password: '', role: 'user' });
  const load = () => apiFetch('/admin/users').then(r => r.json()).then(d => setUsers(d.users || [])).catch(() => {});
  // «En línea» cambia solo: se vuelve a preguntar cada medio minuto.
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
        <p className="text-[13px] font-semibold text-nf-text2 mb-1">Nueva cuenta</p>
        <p className="text-[12px] text-nf-text3 mb-3">La contraseña es provisional: al entrar por primera vez se le pedirá que ponga una suya.</p>
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
              <div><p className="text-[16px] font-semibold">{u.username}{u.username === me?.username && <span className="text-nf-text3 text-[12px]"> (tú)</span>}</p><p className="text-[12px] text-nf-text3">{u.role === 'admin' ? 'Administrador' : 'Usuario'} · {u.downloads} descargas{!u.active && ' · desactivada'}{u.must_change_password && ' · contraseña provisional'}</p>
                <p className={`text-[12px] flex items-center gap-1.5 ${u.online ? 'text-green-400' : 'text-nf-text3'}`}>
                  {u.online && <span className="w-2 h-2 rounded-full bg-green-500" />}
                  {u.online ? 'En línea' : u.last_seen_at ? `Última conexión ${haceCuanto(u.last_seen_at)}` : 'Sin conexiones registradas'}
                </p></div>
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
        <Hoja onClose={() => setEdit(null)} className="space-y-2">
            <p className="text-[16px] font-semibold mb-1">Editar {edit.username}</p>
            <select className={input} value={ef.role} onChange={e => setEf({ ...ef, role: e.target.value })}><option value="user">Usuario</option><option value="admin">Administrador</option></select>
            <div className="flex items-center gap-2">
              <input className={input} type="number" inputMode="decimal" placeholder="Cuota GB" disabled={ef.unlimited} value={ef.quota} onChange={e => setEf({ ...ef, quota: e.target.value })} />
              <label className="flex items-center gap-2 text-[13px] shrink-0"><input type="checkbox" checked={ef.unlimited} onChange={e => setEf({ ...ef, unlimited: e.target.checked })} />Sin límite</label>
            </div>
            <input className={input} type="password" placeholder="Nueva contraseña (opcional)" value={ef.password} onChange={e => setEf({ ...ef, password: e.target.value })} />
            <button onClick={save} className="w-full h-11 rounded-xl bg-nf-red text-[15px] font-semibold">Guardar</button>
        </Hoja>
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

interface TemaCanal { id: number; titulo: string; cerrado: boolean; general: boolean; ignorado: boolean; indexados: number }
interface TemasDeCanal { foro: boolean; sin_leer: number; temas: TemaCanal[] }

/**
 * Qué temas de un grupo con foro se indexan.
 *
 * Existe porque en los grupos con temas («Películas», «Series», «Deportes»,
 * «Libros», «APKs»…) todo se indexaba como si fueran películas. Se edita un
 * borrador y se guarda la lista entera de ignorados de una vez: el servidor la
 * recibe completa, y así lo que se ve en pantalla es exactamente lo que queda.
 */
function TemasCanal({ channelId }: { channelId: number }) {
  const [datos, setDatos] = useState<TemasDeCanal | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  // Ids que el borrador da por ignorados (no se indexan).
  const [ignorados, setIgnorados] = useState<Set<number>>(new Set());
  // Nombres de los temas que van a pasar a ignorarse: mientras no sea null se
  // está pidiendo confirmación, porque guardar borra del catálogo lo suyo.
  const [aviso, setAviso] = useState<string[] | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    setCargando(true); setError('');
    try {
      const r = await apiFetch(`/channels/${channelId}/temas`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || 'No se han podido leer los temas');
      setDatos(d);
      setIgnorados(new Set((d.temas || []).filter((t: TemaCanal) => t.ignorado).map((t: TemaCanal) => t.id)));
      setAviso(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se han podido leer los temas'); }
    finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const temas = datos?.temas || [];
  const nuevosIgnorados = temas.filter(t => !t.ignorado && ignorados.has(t.id));
  const cambiado = temas.some(t => t.ignorado !== ignorados.has(t.id));

  const alternar = (id: number) => {
    const s = new Set(ignorados);
    if (s.has(id)) s.delete(id); else s.add(id);
    setIgnorados(s); setAviso(null);
  };

  const enviar = async () => {
    setGuardando(true);
    try {
      const r = await apiFetch(`/channels/${channelId}/temas-ignorados`, { method: 'POST', body: JSON.stringify({ temas: [...ignorados] }) });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.detail || d.error || 'No se ha podido guardar');
      const partes = ['Temas guardados'];
      if (d.quitados) partes.push(`${Number(d.quitados).toLocaleString('es-ES', MILES)} archivos quitados del catálogo`);
      if (d.reindexando?.length) partes.push(`${d.reindexando.length === 1 ? 'se vuelve a indexar 1 tema' : `se vuelven a indexar ${d.reindexando.length} temas`}`);
      toast(partes.join(' · '), 'ok', 5000);
      await cargar();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido guardar', 'error', 6000); }
    finally { setGuardando(false); setAviso(null); }
  };

  // Si algo pasa a ignorarse se pregunta antes; si solo se reactivan temas no
  // se pierde nada y se guarda directamente.
  const guardar = () => {
    if (nuevosIgnorados.length && !aviso) { setAviso(nuevosIgnorados.map(t => t.titulo)); return; }
    enviar();
  };

  if (cargando && !datos) return <p className="text-[13px] text-nf-text3 mt-3">Leyendo los temas del canal…</p>;
  if (error) return (
    <div className="mt-3">
      <p className="text-[13px] text-nf-red">{error}</p>
      <button onClick={cargar} className="tap mt-2 h-9 px-3 rounded-full bg-white/10 text-[13px]">Reintentar</button>
    </div>
  );
  if (!datos) return null;
  if (!datos.foro) return <p className="text-[13px] text-nf-text3 mt-3">Este canal no tiene temas</p>;

  return (
    <div className="mt-3 border-t border-white/5 pt-1">
      {datos.sin_leer > 0 && (
        <p className="text-[12px] text-nf-text3 py-2">Hay {datos.sin_leer.toLocaleString('es-ES', MILES)} archivos de los que aún no se sabe el tema; se irán leyendo solos.</p>
      )}
      {temas.length === 0 && <p className="text-[13px] text-nf-text3 py-2">No hay temas.</p>}
      {temas.map(t => {
        const indexar = !ignorados.has(t.id);
        return (
          <button key={t.id} onClick={() => alternar(t.id)} role="switch" aria-checked={indexar}
            className="w-full flex items-center justify-between py-3 border-b border-white/5 text-left">
            <div className="min-w-0 pr-3">
              <p className={`text-[15px] truncate ${indexar ? '' : 'text-nf-text3'}`}>{t.titulo}</p>
              <p className="text-[12px] text-nf-text3">
                {t.indexados.toLocaleString('es-ES', MILES)} indexados{t.general ? ' · General' : ''}{t.cerrado ? ' · cerrado' : ''} · {indexar ? 'Indexar' : 'No se indexa'}
              </p>
            </div>
            <span className={`w-12 h-7 rounded-full relative shrink-0 ${indexar ? 'bg-nf-red' : 'bg-white/15'}`}><span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${indexar ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></span>
          </button>
        );
      })}
      {aviso ? (
        <div className="mt-3 rounded-xl bg-nf-red/15 p-3">
          <p className="text-[13px]">Se quitarán del catálogo los archivos ya indexados de: {aviso.join(', ')}</p>
          <div className="flex mt-3 space-x-2">
            <button onClick={() => setAviso(null)} disabled={guardando} className="flex-1 h-11 rounded-xl bg-white/10 text-[15px] font-medium disabled:opacity-40">Cancelar</button>
            <button onClick={guardar} disabled={guardando} className="flex-1 h-11 rounded-xl bg-nf-red text-[15px] font-semibold disabled:opacity-40">{guardando ? 'Guardando…' : 'Quitar y guardar'}</button>
          </div>
        </div>
      ) : (
        temas.length > 0 && (
          <button onClick={guardar} disabled={!cambiado || guardando || cargando} className="mt-3 w-full h-11 rounded-xl bg-nf-red disabled:opacity-40 text-[15px] font-semibold">
            {guardando ? 'Guardando…' : cargando ? 'Actualizando…' : 'Guardar'}
          </button>
        )
      )}
    </div>
  );
}

interface RelecturaCanal { channel_id: number; nombre: string; estado: string; total: number; leidos: number; con_ficha: number; mensaje: number | null; desde: number | null; hasta: number | null; error: string | null }
interface RelecturaEstado { corriendo: boolean; siguiente: string | null; canales: RelecturaCanal[] }

const ESTADO_RELECTURA: Record<string, string> = {
  releyendo: 'Releyendo…', en_cola: 'En cola', terminado: 'Terminado', al_dia: 'Al día',
  pendiente: 'Pendiente', sin_resolver: 'Sin conexión al canal', fallo: 'Falló',
};
const horaCorta = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function Channels() {
  // Canal con los temas desplegados (uno a la vez: la lista puede ser larga).
  const [temasDe, setTemasDe] = useState<number | null>(null);
  const [channels, setChannels] = useState<{ id: number; name: string }[]>([]);
  const [url, setUrl] = useState(''); const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const load = () => { apiFetch('/channels').then(r => r.json()).then(d => setChannels(d.channels || [])).catch(() => {}); apiFetch('/index/progress').then(r => r.json()).then(d => setProgress(d.channels || [])).catch(() => {}); apiFetch('/index/stats').then(r => r.json()).then(setStats).catch(() => {}); };
  // Se sigue preguntando aunque el escaneo haya acabado: los mensajes nuevos
  // se indexan en vivo y los contadores tienen que moverse con ellos. Deprisa
  // mientras algo escanea, despacio el resto del tiempo.
  const escaneando = progress.some((p: any) => p.status === 'running' || p.status === 'scanning' || p.phase === 'enriching');
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, escaneando ? 5000 : 20000);
    return () => clearInterval(t);
  }, [escaneando]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => { setMsg('Resolviendo…'); const d = await (await apiFetch('/channels/add', { method: 'POST', body: JSON.stringify({ url: url.trim() }) })).json(); setMsg(d.error || `${d.status === 'added' ? 'Añadido' : 'Actualizado'}: ${d.channel?.name}`); if (!d.error) setUrl(''); load(); };
  const rescan = async (id: number) => { await apiFetch(`/index/channel/${id}`, { method: 'POST' }); toast('Reescaneando canal'); };
  const reclass = async () => { const d = await (await apiFetch('/index/reclassify', { method: 'POST' })).json(); toast(d.status === 'already_running' ? 'Ya está en marcha' : 'Reclasificando catálogo…'); };
  const rescanAll = async () => { await apiFetch('/index/rescan', { method: 'POST' }); toast('Escaneo completo reiniciado'); };

  // La relectura del contexto (services/relectura.py) va en este mismo bloque y
  // no en uno aparte: para quien mira es lo mismo que el escaneo, leer los
  // canales, solo que vuelve sobre lo ya indexado para ponerle su ficha y su
  // pie. Por eso cada canal lleva su línea debajo de la de escaneo. Su sondeo
  // va por separado porque su ritmo depende de si ella corre, no el escaneo.
  const [rel, setRel] = useState<RelecturaEstado | null>(null);
  const cargarRel = () => { apiFetch('/index/relectura').then(r => r.ok ? r.json() : null).then(d => d && setRel(d)).catch(() => {}); };
  useEffect(() => { cargarRel(); }, []);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) cargarRel(); }, rel?.corriendo ? 5000 : 20000);
    return () => clearInterval(t);
  }, [rel?.corriendo]);
  const releer = async () => {
    try {
      const r = await apiFetch('/index/relectura', { method: 'POST' });
      const d = await r.json();
      if (!r.ok || !d.ok) toast(d.error || d.detail || 'No se ha podido empezar', 'error');
      else toast(d.ya_en_marcha ? 'Ya estaba en marcha' : 'Empezando la relectura…', 'ok');
    } catch { toast('No se ha podido empezar', 'error'); }
    setTimeout(cargarRel, 1500);
  };
  // Mismo orden que en escritorio: primero lo indexado, luego los canales y
  // el añadir al final. En el movil estaba justo al reves.
  //
  // Las cuatro cifras van en dos filas y no en una: en una fila de telefono le
  // tocaban ~70 px a cada una y "160.684" no cabia, asi que los numeros salian
  // enormes y pegados al borde. En rejilla de dos cabe el numero entero.
  const Cifra = ({ n, label }: { n?: number; label: string }) => (
    <div className="rounded-xl bg-black/25 px-2 py-3 text-center">
      <p className="text-[20px] font-bold leading-none tabular-nums">{(n ?? 0).toLocaleString('es-ES', MILES)}</p>
      <p className="text-[11px] text-nf-text3 mt-1.5">{label}</p>
    </div>
  );
  const buscados = stats?.tmdb_searched ?? 0;
  const pctTmdb = Math.round((buscados / Math.max(stats?.total || 1, 1)) * 100);

  return (
    <div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-3">Contenido indexado</p>
        <div className="grid grid-cols-2 gap-2">
          <Cifra n={stats?.total} label="Total" />
          <Cifra n={stats?.movies} label="Películas" />
          <Cifra n={stats?.series} label="Series" />
          <Cifra n={stats?.with_tmdb} label="Con ficha" />
        </div>
        {stats && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-[11px] text-nf-text3 mb-1.5">
              <span>Progreso TMDB</span>
              <span className="tabular-nums">{buscados.toLocaleString('es-ES', MILES)} / {(stats.total || 0).toLocaleString('es-ES', MILES)} · {pctTmdb} %</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className={`h-full ${pctTmdb >= 100 ? 'bg-nf-ok' : 'bg-nf-red'}`} style={{ width: `${Math.min(pctTmdb, 100)}%` }} />
            </div>
          </div>
        )}
        <button onClick={reclass} className="mt-4 w-full h-11 rounded-xl bg-white/10 text-[15px] font-medium">Reclasificar catálogo</button>
        <button onClick={releer} disabled={!!rel?.corriendo} className="mt-2 w-full h-11 rounded-xl bg-white/10 disabled:opacity-40 text-[15px] font-medium">{rel?.corriendo ? 'Releyendo el contexto…' : 'Releer ahora'}</button>
        <button onClick={rescanAll} className="mt-2 w-full h-11 rounded-xl bg-nf-red text-[15px] font-semibold">Reescanear todo</button>
        {rel && !rel.corriendo && rel.siguiente && (
          <p className="text-[11px] text-nf-text3 mt-2 text-center">La siguiente relectura empieza sola a las {horaCorta(rel.siguiente)}</p>
        )}
      </section>
      {channels.map(c => {
        const p = progress.find((x: any) => x.channel_id === c.id);
        const pct = p?.total_estimate ? Math.round((p.total_scanned / p.total_estimate) * 100) : 0;
        const r = rel?.canales.find(x => x.channel_id === c.id);
        const pctR = r?.total ? Math.round((r.leidos / r.total) * 100) : 100;
        const releyendo = r?.estado === 'releyendo';
        const fallo = r?.estado === 'fallo' || r?.estado === 'sin_resolver';
        return (
          <div key={c.id} className="rounded-2xl bg-white/5 p-4 mb-2">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-semibold truncate">{c.name}</p>
              <div className="flex shrink-0 space-x-2 ml-2">
                <button onClick={() => setTemasDe(temasDe === c.id ? null : c.id)} aria-expanded={temasDe === c.id} className={`tap h-9 px-3 rounded-full text-[13px] ${temasDe === c.id ? 'bg-white text-black' : 'bg-white/10'}`}>Temas</button>
                <button onClick={() => rescan(c.id)} className="tap h-9 px-3 rounded-full bg-white/10 text-[13px]">Reescanear</button>
              </div>
            </div>
            {p && <><p className="text-[12px] text-nf-text3 mt-1">{p.total_indexed?.toLocaleString()} archivos · {p.status === 'done' ? 'completado' : `${pct} %`}</p><div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`h-full ${p.status === 'done' ? 'bg-nf-ok' : 'bg-nf-red'}`} style={{ width: `${p.status === 'done' ? 100 : pct}%` }} /></div></>}
            {r && (
              <>
                <div className="flex items-baseline justify-between mt-2 text-[11px] text-nf-text3">
                  <span className="tabular-nums truncate">Contexto leído: {r.leidos.toLocaleString('es-ES', MILES)} / {r.total.toLocaleString('es-ES', MILES)} · {r.con_ficha.toLocaleString('es-ES', MILES)} con ficha</span>
                  {(releyendo || r.estado === 'en_cola' || fallo) && (
                    <span className={`shrink-0 ml-2 ${releyendo ? 'text-yellow-400' : fallo ? 'text-nf-red' : ''}`}>{ESTADO_RELECTURA[r.estado]}</span>
                  )}
                </div>
                <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className={`h-full ${releyendo ? 'bg-yellow-500' : fallo ? 'bg-nf-red' : pctR >= 100 ? 'bg-nf-ok' : 'bg-white/30'}`} style={{ width: `${Math.min(pctR, 100)}%` }} />
                </div>
                {fallo && r.error && <p className="text-[11px] text-nf-red mt-1">{r.error}</p>}
              </>
            )}
            {temasDe === c.id && <TemasCanal channelId={c.id} />}
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

interface MotivoRevision { clave: string; titulo: string; descripcion: string; grupos: number; archivos: number; sugeridas: number }
// Cómo va la revisión automática (services/revision_auto.py).
// La revisión con IA (services/revision_ia.py). La clave va en el .env del servidor
// (TMD_ANTHROPIC_API_KEY): aquí solo llega si está puesta.
interface EstadoIA {
  preparando?: { hechos: number; total: number } | null;
  buscando?: { hechos: number; total: number } | null;
  lotes?: { id: string; tipo: 'elige' | 'verifica'; progreso: { hechos: number; total: number } | null }[];
  cola?: { haiku: number; busqueda: number; sonnet: number };
  activa: boolean; configurada: boolean; error: string | null; tope: number; gasto_mes: number;
  lote: string | null; pendientes: number;
  ultimo: { aplicadas: number; sugeridas: number; ninguna: number; fallos: number; dolares: number } | null;
}
// Lo hecho, separado por paso: coincidencia exacta, Claude y lo aceptado a mano.
interface Pasos {
  exacta: { grupos: number; archivos: number };
  ia: { aplicadas: number; archivos: number; sugeridas: number; ninguna: number };
  mano: { grupos: number; archivos: number };
}
interface EstadoAuto {
  corriendo: boolean; termino: number | null; mirados: number; por_mirar: number;
  cuentas: Record<string, { grupos: number; archivos: number }>; pasos?: Pasos; ia: EstadoIA | null;
}
interface ResumenRevision { motivos: MotivoRevision[]; canales: { channel_id: number; nombre: string }[]; auto: EstadoAuto }
interface FichaActual { tmdb_id: number; media_type: TipoPeticion; title: string; year: number | null; poster: string | null }
interface Sugerencia extends FichaActual { porque: string | null }
interface GrupoRevision {
  clave: string; motivo: string; titulo: string; tipo: TipoPeticion; año: number | null; archivos: number;
  canales: string[]; ejemplo: string; ficha: string | null; pie: string | null; actual: FichaActual | null;
  sugerencia: Sugerencia | null;
  busqueda?: string;
  ejemplos?: string[] | null;
}
interface Aplicada { id: number; titulo: string; porque: string | null; ficha: Sugerencia | null; archivos: number; creado: string; por_ia?: boolean }
interface LoteIA { lote: string; modelo?: string; grupos: number; creado: string; terminado: string | null; aplicadas: number | null; sugeridas: number | null; ninguna: number | null; fallos: number | null; dolares: number | null }
interface HistorialIA { lotes: LoteIA[]; meses: { mes: string; dolares: number }[]; total: number }

const POR_PAGINA = 30;
const num = (n: number) => n.toLocaleString('es-ES', MILES);
const conAño = (t: string, y: number | null | undefined) => y ? `${t} (${y})` : t;
// Una respuesta que no es JSON (un 502 del proxy) no puede tumbar la pantalla:
// se trata como un error sin detalle y sale el texto por defecto.
const leer = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

/** Carátula pequeña; si TMDB no la sirve queda el hueco y no el icono de imagen rota. */
function CaratulaMovil({ src, ring }: { src: string | null | undefined; ring?: boolean }) {
  return (
    <div className={`w-10 h-[60px] shrink-0 overflow-hidden rounded-[3px] bg-white/10 ${ring ? 'ring-1 ring-white/40' : ''}`}>
      {src && <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
    </div>
  );
}

const MOTIVO_CORTO: Record<string, string> = { sin_ficha: 'Sin ficha', tipo_cruzado: 'Tipo cruzado', dudosa: 'Ficha dudosa', sin_caratula: 'Sin carátula' };

/**
 * Un grupo de la cola, en el teléfono: lo mismo que la fila de la web (ficha
 * actual frente a la propuesta, y las acciones) en una tarjeta. El detalle del
 * canal se despliega tocando el título.
 */
function TarjetaGrupo({ g, verMotivo, onQuitar, onCorregir }: {
  g: GrupoRevision; verMotivo: boolean; onQuitar: () => void; onCorregir: () => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const [haciendo, setHaciendo] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [sinSugerencia, setSinSugerencia] = useState(false);
  const s = sinSugerencia ? null : g.sugerencia;
  const accion = async (que: 'aceptar' | 'descartar' | 'ignorar') => {
    setHaciendo(que);
    try {
      const r = await apiFetch(que === 'ignorar' ? '/admin/revision/ignorar' : `/admin/revision/sugerencia/${que}`,
        { method: 'POST', body: JSON.stringify({ clave: g.clave }) });
      const d = await leer(r);
      if (!r.ok || !d.ok) throw new Error(d.detail || 'No se ha podido');
      if (que === 'descartar') { setSinSugerencia(true); return; }
      onQuitar();
      toast(que === 'aceptar' ? `«${conAño(s!.title, s!.year)}» aplicada` : `«${g.titulo}» ignorado`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido', 'error', 6000); }
    finally { setHaciendo(''); }
  };
  const muestras = g.ejemplos?.length ? g.ejemplos : [g.ejemplo];
  const tipo = (t: string) => (TIPO_PETICION[t as TipoPeticion] || t).toLowerCase();
  return (
    <div className="border-b border-white/10 py-3 last:border-0">
      <div className="flex space-x-3">
        <div className="flex shrink-0 space-x-1">
          <CaratulaMovil src={g.actual?.poster} />
          {s && <CaratulaMovil src={s.poster} ring />}
        </div>
        <div className="min-w-0 flex-1">
          <button onClick={() => setAbierta(a => !a)} aria-expanded={abierta} className="block w-full text-left">
            <p className="text-[15px] font-semibold leading-tight break-words">{g.titulo}{g.año ? <span className="font-normal text-nf-text2"> {g.año}</span> : null}</p>
          </button>
          <p className="text-[11px] text-nf-text3 mt-0.5">
            {TIPO_PETICION[g.tipo] || g.tipo}, {num(g.archivos)} {g.archivos === 1 ? 'archivo' : 'archivos'}{verMotivo ? `, ${MOTIVO_CORTO[g.motivo] || g.motivo}` : ''}
          </p>
          {g.actual && <p className="text-[12px] truncate mt-1"><span className="text-nf-text3">Ahora: </span><span className="text-nf-text2">{conAño(g.actual.title, g.actual.year)}</span><span className="text-nf-text3">, {tipo(g.actual.media_type)}</span></p>}
          {s && <p className="text-[12px] truncate"><span className="text-nf-text3">Propuesta: </span>{conAño(s.title, s.year)}<span className="text-nf-text3">, {tipo(s.media_type)}</span></p>}
          {s?.porque && <p className="text-[11px] text-nf-text3 line-clamp-2">{s.porque}</p>}
        </div>
      </div>
      {abierta && (
        <div className="mt-2 ml-[52px] space-y-2">
          {g.ficha && <div><p className="text-[11px] text-nf-text3">Ficha del canal</p><p className="text-[12px] text-nf-text2 whitespace-pre-line break-words">{g.ficha}</p></div>}
          {g.pie && <div><p className="text-[11px] text-nf-text3">Pie del archivo</p><p className="text-[12px] text-nf-text2 whitespace-pre-line break-words">{g.pie}</p></div>}
          <div>
            <p className="text-[11px] text-nf-text3">{muestras.length > 1 ? 'Archivos de muestra' : 'Archivo'}</p>
            {muestras.map((m, i) => <p key={i} className="text-[11px] font-mono text-nf-text2 break-all">{m}</p>)}
          </div>
        </div>
      )}
      {confirmar ? (
        <div className="mt-3 flex items-center space-x-2">
          <p className="flex-1 text-[12px] text-nf-text2">Deja de salir aquí y no se toca nada más.</p>
          <button onClick={() => setConfirmar(false)} disabled={!!haciendo} className="h-9 px-3 rounded-lg bg-white/10 text-[13px]">Cancelar</button>
          <button onClick={() => accion('ignorar')} disabled={!!haciendo} className="h-9 px-3 rounded-lg bg-nf-red text-[13px] font-semibold">{haciendo === 'ignorar' ? '…' : 'Ignorar'}</button>
        </div>
      ) : (
        <div className="mt-3 flex items-center space-x-2">
          {s && <button onClick={() => accion('aceptar')} disabled={!!haciendo} className="tap h-9 px-4 rounded-lg bg-nf-red text-[14px] font-semibold disabled:opacity-40">{haciendo === 'aceptar' ? 'Aplicando…' : 'Aplicar'}</button>}
          {s && <button onClick={() => accion('descartar')} disabled={!!haciendo} className="tap h-9 px-3 rounded-lg bg-white/10 text-[14px] disabled:opacity-40">No es esta</button>}
          <button onClick={onCorregir} disabled={!!haciendo} className={`tap h-9 rounded-lg text-[14px] disabled:opacity-40 ${s ? 'px-2 text-nf-text2' : 'px-4 bg-white/10'}`}>Corregir</button>
          <button onClick={() => setConfirmar(true)} disabled={!!haciendo} className="tap h-9 px-2 rounded-lg text-[14px] text-nf-text2 disabled:opacity-40">Ignorar</button>
        </div>
      )}
    </div>
  );
}

/**
 * Buscar en TMDB la ficha buena y ponérsela al grupo entero.
 *
 * Por portal en el <body> y con el armazón de `.hoja-shell`: dentro de
 * `.app-main` un `position: fixed` no queda por encima de la barra de
 * pestañas en iOS (ver `.player-shell` en index.css). Va por debajo de los
 * avisos (z-60), que son los que dicen si ha salido bien o no.
 *
 * TMDB solo se consulta al pulsar «Buscar»: por tecla serían una docena de
 * consultas por título, y el campo ya llega relleno con lo que hay que buscar.
 */
function HojaCorregir({ g, onCerrar, onHecho }: { g: GrupoRevision; onCerrar: () => void; onHecho: (archivos: number, ficha: string) => void }) {
  const [texto, setTexto] = useState(g.busqueda ?? g.titulo);
  const [resultados, setResultados] = useState<ResultadoPeticion[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<ResultadoPeticion | null>(null);
  const [poniendo, setPoniendo] = useState(false);

  const buscar = async () => {
    const q = texto.trim();
    if (!q) return;
    setBuscando(true); setElegido(null);
    try { setResultados(await buscarParaPedir(q)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido buscar', 'error', 6000); }
    finally { setBuscando(false); }
  };

  const asignar = async () => {
    if (!elegido) return;
    setPoniendo(true);
    try {
      const r = await apiFetch('/admin/revision/asignar', { method: 'POST', body: JSON.stringify({ clave: g.clave, tmdb_id: elegido.tmdb_id, media_type: elegido.media_type }) });
      const d = await leer(r);
      if (!r.ok || !d.ok) throw new Error(d.detail || 'No se ha podido corregir');
      onHecho(d.archivos ?? g.archivos, conAño(elegido.title, elegido.year));
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido corregir', 'error', 6000); setPoniendo(false); }
  };

  return createPortal(
    <div className="hoja-shell">
      <div role="dialog" aria-label={`Corregir ${g.titulo}`} className="subir relative flex-1 min-h-0 flex flex-col bg-nf-bg">
        <div className="shrink-0 px-4 pb-3 border-b border-white/10" style={{ paddingTop: 'calc(var(--safe-t) + 14px)' }}>
          <div className="flex items-center justify-between">
            <div className="min-w-0 pr-3">
              <p className="text-[17px] font-semibold truncate">Corregir la ficha</p>
              <p className="text-[12px] text-nf-text3 truncate">{conAño(g.titulo, g.año)} · {num(g.archivos)} {g.archivos === 1 ? 'archivo' : 'archivos'}</p>
            </div>
            <button onClick={onCerrar} aria-label="Cerrar" className="w-9 h-9 shrink-0 rounded-full bg-white/10 flex items-center justify-center">
              <span className="w-4 h-4"><IClose /></span>
            </button>
          </div>
          <form className="flex mt-3 space-x-2" onSubmit={e => { e.preventDefault(); buscar(); }}>
            <input className={input} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Título" enterKeyHint="search" />
            <button type="submit" disabled={buscando || !texto.trim()} className="shrink-0 h-11 px-4 rounded-xl bg-white text-black text-[14px] font-semibold disabled:opacity-40">
              {buscando ? 'Buscando…' : 'Buscar en TMDB'}
            </button>
          </form>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2" style={{ overscrollBehavior: 'contain' }}>
          {resultados === null && !buscando && <p className="text-[13px] text-nf-text3 py-4">Corrige el título si hace falta y busca: al tocar un resultado se pide confirmación antes de ponerlo.</p>}
          {resultados?.length === 0 && <p className="text-[13px] text-nf-text3 py-4">TMDB no ha encontrado nada. Prueba con el título original o sin el año.</p>}
          {resultados?.map(x => {
            const sel = elegido?.tmdb_id === x.tmdb_id && elegido.media_type === x.media_type;
            return (
              <button key={`${x.media_type}-${x.tmdb_id}`} onClick={() => setElegido(sel ? null : x)}
                className={`w-full flex items-start text-left py-2.5 px-2 -mx-2 rounded-xl space-x-3 ${sel ? 'bg-white/10' : ''}`}>
                {x.poster
                  ? <img src={x.poster} alt="" loading="lazy" className="w-12 h-[72px] rounded object-cover shrink-0 bg-white/10" />
                  : <div className="w-12 h-[72px] rounded shrink-0 bg-white/10" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium leading-tight line-clamp-2">{x.title}</p>
                  {x.original_title && x.original_title !== x.title && <p className="text-[12px] text-nf-text3 truncate mt-0.5">{x.original_title}</p>}
                  <p className="text-[12px] text-nf-text3 mt-0.5">{TIPO_PETICION[x.media_type] || x.media_type}{x.year ? ` · ${x.year}` : ''}</p>
                </div>
              </button>
            );
          })}
        </div>
        {elegido && (
          <div className="shrink-0 px-4 pt-3 border-t border-white/10 bg-nf-raised" style={{ paddingBottom: 'calc(var(--safe-b) + 14px)' }}>
            <p className="text-[13px] text-nf-text2">
              Poner «{conAño(elegido.title, elegido.year)}» a {num(g.archivos)} {g.archivos === 1 ? 'archivo' : 'archivos'}
            </p>
            <div className="flex mt-3 space-x-2">
              <button onClick={() => setElegido(null)} disabled={poniendo} className="flex-1 h-11 rounded-xl bg-white/10 text-[15px] font-medium disabled:opacity-40">Cancelar</button>
              <button onClick={asignar} disabled={poniendo} className="flex-1 h-11 rounded-xl bg-nf-red text-[15px] font-semibold disabled:opacity-40">{poniendo ? 'Poniendo…' : 'Poner esta ficha'}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const dolar = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

const MESES_IA = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesIA = (ym: string) => { const [a, m] = ym.split('-'); return `${MESES_IA[Number(m) - 1]} ${a}`; };
const fechaIA = (iso: string) => new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Los lotes mandados a Claude y el gasto de cada mes, en lista (en el teléfono no cabe una tabla). */
function HistorialIAMovil() {
  const [h, setH] = useState<HistorialIA | null>(null);
  useEffect(() => {
    apiFetch('/admin/revision/ia/historial').then(async r => { if (r.ok) setH(await r.json()); }).catch(() => {});
  }, []);
  if (!h) return <p className="text-[12px] text-nf-text3 mt-2">Cargando…</p>;
  if (!h.lotes.length) return <p className="text-[12px] text-nf-text3 mt-2">Todavía no se ha mandado ningún lote.</p>;
  return (
    <div className="mt-3">
      <p className="text-[10px] uppercase tracking-wide text-nf-text3">Gasto por mes</p>
      {h.meses.map(m => (
        <div key={m.mes} className="flex justify-between text-[13px] py-1 border-b border-white/5">
          <span className="text-nf-text2">{mesIA(m.mes)}</span><span className="tabular-nums">{dolar(m.dolares)}</span>
        </div>
      ))}
      <div className="flex justify-between text-[13px] py-1 font-semibold"><span>Total</span><span className="tabular-nums">{dolar(h.total)}</span></div>
      <p className="text-[10px] uppercase tracking-wide text-nf-text3 mt-3">Últimos lotes</p>
      {h.lotes.map(l => (
        <div key={l.lote} className="py-1.5 border-b border-white/5">
          <div className="flex justify-between text-[13px]">
            <span className="text-nf-text2">{fechaIA(l.creado)} · {num(l.grupos)} grupos · {l.lote.startsWith('busqueda-') ? 'búsqueda en TMDB' : l.lote.startsWith('prueba-') ? 'prueba' : l.modelo?.includes('verifica') ? 'Sonnet verifica' : l.modelo?.includes('haiku') ? 'Haiku' : 'Sonnet'}</span>
            <span className="tabular-nums">{l.dolares != null ? dolar(l.dolares) : 'en marcha…'}</span>
          </div>
          {l.terminado && (
            <p className="text-[11px] text-nf-text3">{l.aplicadas} solos · {l.sugeridas} sugeridos · {l.ninguna} ninguna{l.fallos ? ` · ${l.fallos} fallos` : ''}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** «Corregido solo»: lo que puso la revisión automática, con su deshacer. */
function CorregidasMovil({ onCambio }: { onCambio: () => void }) {
  const [origen, setOrigen] = useState<'' | 'ia' | 'exacta'>('');
  const [items, setItems] = useState<Aplicada[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [deshaciendo, setDeshaciendo] = useState<number | null>(null);
  const cargar = async (offset: number) => {
    setCargando(true);
    try {
      const r = await apiFetch(`/admin/revision/auto?offset=${offset}&limit=${POR_PAGINA}&origen=${origen}`);
      const d = await leer(r);
      if (!r.ok) throw new Error(d.detail || 'No se ha podido leer la lista');
      setTotal(d.total ?? 0);
      setItems(prev => offset ? [...prev, ...(d.items || [])] : (d.items || []));
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido leer la lista', 'error', 6000); }
    finally { setCargando(false); }
  };
  useEffect(() => { setItems([]); setTotal(null); cargar(0); }, [origen]); // eslint-disable-line react-hooks/exhaustive-deps
  const deshacer = async (a: Aplicada) => {
    setDeshaciendo(a.id);
    try {
      const r = await apiFetch('/admin/revision/auto/deshacer', { method: 'POST', body: JSON.stringify({ id: a.id }) });
      const d = await leer(r);
      if (!r.ok || !d.ok) throw new Error(d.detail || 'No se ha podido deshacer');
      setItems(xs => xs.filter(x => x.id !== a.id));
      setTotal(t => t == null ? t : Math.max(t - 1, 0));
      onCambio();
      toast(`«${a.titulo}» vuelve a como estaba`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido deshacer', 'error', 6000); }
    finally { setDeshaciendo(null); }
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {([['', 'Todo'], ['ia', 'Claude'], ['exacta', 'Exacta']] as const).map(([v, t]) => (
          <button key={v} onClick={() => setOrigen(v)}
            className={`h-8 px-3 rounded-full text-[13px] font-semibold ${origen === v ? 'bg-white text-black' : 'bg-white/10 text-nf-text2'}`}>{t}</button>
        ))}
      </div>
      {total != null && <p className="text-[12px] text-nf-text3 mb-2">{num(total)} corregidos solos</p>}
      {total === 0 && <p className="rounded-2xl bg-white/5 p-4 text-[13px] text-nf-text2">Todavía no se ha corregido nada solo.</p>}
      {items.map(a => (
        <div key={a.id} className="rounded-2xl bg-white/5 p-3 mb-2 flex items-center space-x-3">
          {a.ficha?.poster
            ? <img src={a.ficha.poster} alt="" loading="lazy" className="w-9 h-[54px] rounded object-cover shrink-0 bg-white/10" />
            : <div className="w-9 h-[54px] rounded shrink-0 bg-white/10" />}
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium truncate">{a.ficha ? conAño(a.ficha.title, a.ficha.year) : a.titulo}{a.por_ia ? <span className="ml-1.5 text-[10px] font-normal text-nf-text3 bg-white/10 rounded px-1 py-0.5 align-middle">Claude</span> : null}</p>
            <p className="text-[11px] text-nf-text3 truncate">Era «{a.titulo}» · {num(a.archivos)} {a.archivos === 1 ? 'archivo' : 'archivos'}</p>
            {a.porque && <p className="text-[11px] text-nf-text3 truncate">{a.porque}</p>}
          </div>
          <button onClick={() => deshacer(a)} disabled={deshaciendo !== null} className="tap shrink-0 h-9 px-3 rounded-full bg-white/10 text-[13px] disabled:opacity-40">
            {deshaciendo === a.id ? '…' : 'Deshacer'}
          </button>
        </div>
      ))}
      {total != null && items.length < total && (
        <button onClick={() => cargar(items.length)} disabled={cargando} className="mt-2 w-full h-11 rounded-xl bg-white/10 disabled:opacity-40 text-[15px] font-medium">
          {cargando ? 'Cargando…' : `Cargar más (${num(total - items.length)})`}
        </button>
      )}
    </div>
  );
}


const haceMov = (t: number | null) => {
  if (!t) return null;
  const min = Math.round((Date.now() / 1000 - t) / 60);
  return min < 1 ? 'ahora mismo' : min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`;
};

/** El interruptor de Claude: monocromo, como el de la web (encendido, pista blanca y bola oscura). */
function InterruptorMovil({ encendido, onCambiar, deshabilitado }: { encendido: boolean; onCambiar: () => void; deshabilitado?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={encendido} aria-label="Revisión con Claude" disabled={deshabilitado} onClick={onCambiar}
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-40 ${encendido ? 'bg-white' : 'bg-white/20'}`}>
      <span className={`h-5 w-5 rounded-full transition-transform duration-150 ${encendido ? 'translate-x-5 bg-nf-bg' : 'translate-x-0 bg-white'}`} />
    </button>
  );
}

const DatoMovil = ({ valor, texto, ok }: { valor: number; texto: string; ok?: boolean }) => (
  <span className="text-[13px] text-nf-text2 mr-4 whitespace-nowrap">
    <span className={`text-[16px] font-semibold tabular-nums mr-1 ${ok ? 'text-nf-ok' : 'text-white'}`}>{num(valor)}</span>{texto}
  </span>
);

/** Algo en marcha, con su barra: cuántos lleva de cuántos (o moviéndose, si aún no se sabe). */
function ProgresoMovil({ texto, hechos, total }: { texto: string; hechos?: number; total?: number }) {
  const conTotal = !!total && total > 0;
  const pct = conTotal ? Math.min(100, Math.round((hechos! / total!) * 100)) : 0;
  return (
    <div className="mt-2" role="progressbar" aria-label={texto} aria-valuemin={0} aria-valuemax={100} aria-valuenow={conTotal ? pct : undefined}>
      <div className="flex justify-between text-[11px]">
        <span className="text-nf-text2">{texto}</span>
        {conTotal && <span className="tabular-nums text-nf-text3">{num(hechos!)}/{num(total!)} · {pct} %</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        {conTotal
          ? <div className="h-full rounded-full bg-white/70 transition-[width] duration-700" style={{ width: `${Math.max(pct, 2)}%` }} />
          : <div className="h-full w-1/3 animate-progreso motion-reduce:animate-none rounded-full bg-white/50" />}
      </div>
    </div>
  );
}

/**
 * Lo automático, como en la web pero apilado: coincidencia exacta, Claude (con
 * su interruptor y su tope) y lo que te queda. Mismo orden y mismas cifras.
 */
function TiraMovil({ auto, sugeridas, enLista, onCambio, onRevisar, lanzando, onIr }: {
  auto: EstadoAuto; sugeridas: number; enLista: number; onCambio: () => void; onRevisar: () => void; lanzando: boolean; onIr: (p: string) => void;
}) {
  const ia = auto.ia;
  const pasos = auto.pasos;
  const [tope, setTope] = useState(String(ia?.tope ?? 20));
  const [haciendo, setHaciendo] = useState('');
  useEffect(() => { if (ia) setTope(String(ia.tope)); }, [ia?.tope]); // eslint-disable-line react-hooks/exhaustive-deps
  const pedir = async (que: string, ruta: string, cuerpo?: object, ok?: string) => {
    setHaciendo(que);
    try {
      const r = await apiFetch(ruta, { method: 'POST', ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
      const d = await leer(r);
      if (!r.ok) throw new Error(d.detail || 'No se ha podido');
      if (ok) toast(ok, 'ok');
      onCambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido', 'error', 6000); }
    finally { setHaciendo(''); }
  };
  const encendida = !!ia?.activa && !!ia?.configurada;
  const alTope = !!ia && ia.gasto_mes >= ia.tope;
  const pct = ia && ia.tope > 0 ? Math.min(1, ia.gasto_mes / ia.tope) : 1;
  const topeCambiado = !!ia && Number(tope) !== ia.tope;
  const sinMirar = auto.corriendo ? Math.max(0, auto.por_mirar - auto.mirados) : 0;
  const enCola = encendida && !alTope ? ia!.pendientes : 0;
  const trabajado = !!pasos && pasos.ia.aplicadas + pasos.ia.sugeridas + pasos.ia.ninguna > 0;

  return (
    <div className="mb-4 rounded-2xl bg-white/5 divide-y divide-white/10">
      <section className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-semibold">Coincidencia exacta</p>
          <button onClick={onRevisar} disabled={lanzando || auto.corriendo} className="text-[13px] text-nf-text2 disabled:opacity-40">
            {auto.corriendo ? 'Revisando…' : lanzando ? 'Lanzando…' : 'Revisar ahora'}
          </button>
        </div>
        <div className="mt-1.5"><DatoMovil valor={pasos?.exacta.grupos ?? auto.cuentas?.aplicada?.grupos ?? 0} texto="aplicadas solas" ok /></div>
        {auto.corriendo ? (
          <ProgresoMovil texto="Buscando coincidencias en TMDB" hechos={auto.mirados} total={auto.por_mirar} />
        ) : (
          <p className="mt-1 flex items-center text-[11px] text-nf-text3">
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-nf-ok" />
            {auto.termino ? `Al día, último repaso ${haceMov(auto.termino)}` : 'Esperando al primer repaso'}
          </p>
        )}
      </section>

      <section className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-semibold">Claude <span className="font-normal text-nf-text3">Haiku, verifica Sonnet</span></p>
          {ia?.configurada ? (
            <span className="flex items-center text-[12px] text-nf-text2">
              <span className="mr-2">{haciendo === 'activa' ? 'Comprobando…' : encendida ? 'Encendido' : 'Apagado'}</span>
              <InterruptorMovil encendido={encendida} deshabilitado={haciendo === 'activa'} onCambiar={() => pedir('activa', '/admin/revision/ia', { activa: !encendida })} />
            </span>
          ) : <span className="text-[12px] text-nf-text3">Sin clave en el servidor</span>}
        </div>
        {ia?.configurada ? (<>
          {(encendida || trabajado) && (
            <div className="mt-1.5 flex flex-wrap">
              <DatoMovil valor={pasos?.ia.aplicadas ?? 0} texto="aplicadas" ok />
              <DatoMovil valor={pasos?.ia.sugeridas ?? 0} texto="sugeridas" />
              <DatoMovil valor={pasos?.ia.ninguna ?? 0} texto="sin ficha" />
            </div>
          )}
          <div className="mt-2 flex items-center space-x-2 text-[12px] text-nf-text3">
            <span className="tabular-nums text-white">{dolar(ia.gasto_mes)}</span><span>de</span>
            <input className="h-7 w-14 rounded-md bg-black/40 px-2 text-right tabular-nums text-white" type="number" min="0" inputMode="decimal"
              aria-label="Tope de gasto al mes, en dólares" value={tope} onChange={e => setTope(e.target.value)} />
            <span>$ al mes</span>
            {topeCambiado && <button onClick={() => pedir('tope', '/admin/revision/ia', { tope: Number(tope) || 0 }, 'Tope guardado')} disabled={haciendo === 'tope'} className="font-semibold text-white">Guardar</button>}
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full ${pct >= 1 ? 'bg-nf-red' : pct >= 0.8 ? 'bg-nf-warn' : 'bg-white/60'}`} style={{ width: `${pct * 100}%` }} />
          </div>
          {ia.cola && ia.cola.haiku + ia.cola.busqueda + ia.cola.sonnet > 0 && (
            <p className="mt-1.5 text-[11px] text-nf-text3">En cola: {[
              ia.cola.haiku > 0 && `${num(ia.cola.haiku)} para Haiku`,
              ia.cola.busqueda > 0 && `${num(ia.cola.busqueda)} para buscar`,
              ia.cola.sonnet > 0 && `${num(ia.cola.sonnet)} para Sonnet`,
            ].filter(Boolean).join(', ')}</p>
          )}
          {ia.preparando && <ProgresoMovil texto="Preparando el lote" hechos={ia.preparando.hechos} total={ia.preparando.total} />}
          {(ia.lotes ?? []).map(l => <ProgresoMovil key={l.id} texto={l.tipo === 'verifica' ? 'Sonnet verificando propuestas de Haiku' : 'Haiku eligiendo entre candidatas'} hechos={l.progreso?.hechos} total={l.progreso?.total} />)}
          {ia.buscando && <ProgresoMovil texto="Claude buscando en TMDB" hechos={ia.buscando.hechos} total={ia.buscando.total} />}
          {alTope && <p className="mt-1.5 text-[11px] text-nf-red">Tope del mes alcanzado: Claude no recibe nada hasta el mes que viene.</p>}
          {!encendida && ia.pendientes > 0 && <p className="mt-1.5 text-[11px] text-nf-text3">Apagado: {num(ia.pendientes)} grupos que podría mirar pasan directamente a ti.</p>}
          {encendida && !ia.preparando && !ia.lote && !alTope && ia.pendientes > 0 && (
              <button onClick={() => pedir('mandar', '/admin/revision/ia/mandar', undefined, 'Preparando el lote para Claude')} disabled={!!haciendo}
                className="mt-1.5 text-[12px] text-nf-text2">{haciendo === 'mandar' ? 'Mandando…' : `Mandar los ${num(ia.pendientes)} pendientes`}</button>
            )}
          {ia.error && <p className="mt-1.5 text-[11px] text-nf-red">{ia.error}</p>}
        </>) : (
          <p className="mt-1.5 text-[12px] text-nf-text3">Para que Claude revise lo que la coincidencia exacta no resuelve, pon TMD_ANTHROPIC_API_KEY en el servidor.</p>
        )}
      </section>

      <section className="p-4">
        <p className="text-[14px] font-semibold">Para ti</p>
        <div className="mt-1.5 flex flex-wrap">
          <button onClick={() => onIr('con_sugerencia')} disabled={!sugeridas} className="text-left"><DatoMovil valor={sugeridas} texto="sugerencias" /></button>
          <DatoMovil valor={enLista} texto="en la lista" />
        </div>
        {(sinMirar > 0 || enCola > 0) && (
          <p className="mt-1 text-[11px] text-nf-text3">
            {[sinMirar > 0 && `${num(sinMirar)} sin mirar todavía`, enCola > 0 && `${num(enCola)} esperando a Claude`].filter(Boolean).join(' y ')}
          </p>
        )}
      </section>
    </div>
  );
}

/** La cola de una bandeja (las sugerencias o un motivo), con su búsqueda y su canal. */
function ColaMovil({ bandeja, canales, onCambio, recarga }: {
  bandeja: string; canales: ResumenRevision['canales']; onCambio: () => void; recarga: number;
}) {
  const [canal, setCanal] = useState('');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [grupos, setGrupos] = useState<GrupoRevision[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [corrigiendo, setCorrigiendo] = useState<GrupoRevision | null>(null);
  const peticion = useRef(0);
  useEffect(() => { const t = setTimeout(() => setQ(texto.trim()), 300); return () => clearTimeout(t); }, [texto]);
  const cargar = async (offset: number, limit = POR_PAGINA) => {
    const n = ++peticion.current;
    setCargando(true);
    if (!offset) setError('');
    try {
      const params = new URLSearchParams({ motivo: bandeja, offset: String(offset), limit: String(limit) });
      if (canal) params.set('channel_id', canal);
      if (q) params.set('q', q);
      const r = await apiFetch(`/admin/revision?${params}`);
      const d = await leer(r);
      if (n !== peticion.current) return;
      if (!r.ok) throw new Error(d.detail || 'No se ha podido leer la lista');
      setTotal(d.total ?? 0);
      setGrupos(prev => offset ? [...prev, ...(d.grupos || [])] : (d.grupos || []));
    } catch (e) {
      if (n === peticion.current) setError(e instanceof Error ? e.message : 'No se ha podido leer la lista');
    } finally {
      if (n === peticion.current) setCargando(false);
    }
  };
  useEffect(() => { setGrupos([]); setTotal(null); cargar(0); }, [bandeja, canal, q]); // eslint-disable-line react-hooks/exhaustive-deps
  // Lo que se arregla solo mientras se mira sale de la lista sin perder lo ya cargado.
  useEffect(() => { if (recarga) cargar(0, Math.max(POR_PAGINA, grupos.length)); }, [recarga]); // eslint-disable-line react-hooks/exhaustive-deps
  const quitar = (clave: string) => {
    setGrupos(gs => gs.filter(x => x.clave !== clave));
    setTotal(t => t == null ? t : Math.max(t - 1, 0));
    onCambio();
  };
  return (
    <div>
      <div className="space-y-2 my-3">
        <input className={input} type="search" placeholder="Buscar por título o archivo" value={texto} onChange={e => setTexto(e.target.value)} />
        <select className={input} value={canal} onChange={e => setCanal(e.target.value)}>
          <option value="">Todos los canales</option>
          {canales.map(c => <option key={c.channel_id} value={String(c.channel_id)}>{c.nombre}</option>)}
        </select>
      </div>
      {total != null && <p className="text-[12px] text-nf-text3 mb-1">{num(total)} {total === 1 ? 'grupo' : 'grupos'}</p>}
      {error && <p className="text-[13px] text-nf-red my-2">{error}</p>}
      {cargando && !grupos.length && !error && <p className="text-[13px] text-nf-text3 py-4">Cargando…</p>}
      {!cargando && !error && total === 0 && (
        <p className="rounded-2xl bg-white/5 p-4 text-[13px] text-nf-text2">
          {q || canal ? 'Nada con ese filtro.' : bandeja === 'con_sugerencia' ? 'No hay sugerencias pendientes.' : 'No queda nada aquí.'}
        </p>
      )}
      {grupos.length > 0 && (
        <div className="rounded-2xl bg-white/5 px-4">
          {grupos.map(g => (
            <TarjetaGrupo key={g.clave} g={g} verMotivo={bandeja === 'con_sugerencia'} onQuitar={() => quitar(g.clave)} onCorregir={() => setCorrigiendo(g)} />
          ))}
        </div>
      )}
      {total != null && grupos.length < total && !error && (
        <button onClick={() => cargar(grupos.length)} disabled={cargando} className="mt-3 w-full h-11 rounded-xl bg-white/10 disabled:opacity-40 text-[15px] font-medium">
          {cargando ? 'Cargando…' : `Cargar más (${num(total - grupos.length)})`}
        </button>
      )}
      {corrigiendo && (
        <HojaCorregir g={corrigiendo} onCerrar={() => setCorrigiendo(null)}
          onHecho={(n, ficha) => { quitar(corrigiendo.clave); setCorrigiendo(null); toast(`«${ficha}» puesta a ${num(n)} ${n === 1 ? 'archivo' : 'archivos'}`, 'ok', 5000); }} />
      )}
    </div>
  );
}

/**
 * Revisión en el teléfono: la misma vista que en la web y en el mismo orden.
 * La tira de estado (coincidencia exacta, Claude y lo que te queda), las
 * bandejas (sugerencias, los cuatro motivos, lo aplicado solo y el gasto de
 * Claude) y la cola de la bandeja elegida.
 */
// Lo último que se leyó de Revisión, para pintarlo al momento al volver (y
// pedirlo de nuevo por detrás). En memoria del módulo: se va al recargar.
let resumenRevisionVisto: ResumenRevision | null = null;
let bandejaVista: string | null = null;

function Revision() {
  const [resumen, setResumen] = useState<ResumenRevision | null>(resumenRevisionVisto);
  const [errorResumen, setErrorResumen] = useState('');
  const [bandeja, setBandeja] = useState<string | null>(bandejaVista);
  useEffect(() => { bandejaVista = bandeja; }, [bandeja]);
  const [lanzando, setLanzando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const cargarResumen = async () => {
    try {
      const r = await apiFetch('/admin/revision/resumen');
      const d = await leer(r);
      if (!r.ok) throw new Error(d.detail || 'No se ha podido leer el resumen');
      resumenRevisionVisto = d;
      setResumen(d); setErrorResumen('');
      setBandeja(b => b ?? ((d.motivos || []).some((m: MotivoRevision) => m.sugeridas > 0) ? 'con_sugerencia' : 'sin_ficha'));
    } catch (e) { setErrorResumen(e instanceof Error ? e.message : 'No se ha podido leer el resumen'); }
  };
  useEffect(() => { cargarResumen(); }, []);

  const corriendo = !!resumen?.auto?.corriendo;
  const preparando = !!resumen?.auto?.ia?.preparando || !!resumen?.auto?.ia?.buscando;
  const enClaude = !!resumen?.auto?.ia?.lote;
  useEffect(() => {
    const cada = corriendo || preparando ? 4000 : enClaude ? 30000 : 60000;
    const t = setInterval(cargarResumen, cada);
    return () => clearInterval(t);
  }, [corriendo, preparando, enClaude]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cuando cambia lo que queda (algo se ha aplicado solo), la lista se vuelve a pedir.
  const huella = resumen ? (resumen.motivos || []).map((m: MotivoRevision) => `${m.grupos}/${m.sugeridas}`).join(',') : '';
  const huellaVista = useRef('');
  useEffect(() => {
    if (huellaVista.current && huella !== huellaVista.current) setRecarga(n => n + 1);
    huellaVista.current = huella;
  }, [huella]);

  const revisarAhora = async () => {
    setLanzando(true);
    try {
      const r = await apiFetch('/admin/revision/auto/lanzar', { method: 'POST' });
      const d = await leer(r);
      if (!r.ok) throw new Error(d.detail || 'No se ha podido lanzar');
      await cargarResumen();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido lanzar', 'error', 6000); }
    finally { setLanzando(false); }
  };

  if (!resumen || !bandeja) {
    return errorResumen ? (
      <div>
        <p className="text-[13px] text-nf-red">{errorResumen}</p>
        <button onClick={cargarResumen} className="tap mt-2 h-9 px-3 rounded-full bg-white/10 text-[13px]">Reintentar</button>
      </div>
    ) : <p className="text-[13px] text-nf-text3">Calculando lo que hay que revisar…</p>;
  }

  const sugeridas = resumen.motivos.reduce((n, m) => n + (m.sugeridas ?? 0), 0);
  const enLista = resumen.motivos.reduce((n, m) => n + m.grupos, 0);
  const bandejas: { id: string; texto: string; n?: number }[] = [
    { id: 'con_sugerencia', texto: 'Sugerencias', n: sugeridas },
    ...resumen.motivos.map(m => ({ id: m.clave, texto: MOTIVO_CORTO[m.clave] || m.titulo, n: m.grupos })),
    { id: 'corregido', texto: 'Aplicado solo' },
    { id: 'gasto', texto: 'Gasto de Claude' },
  ];
  const motivo = resumen.motivos.find(m => m.clave === bandeja);

  return (
    <div>
      {resumen.auto && (
        <TiraMovil auto={resumen.auto} sugeridas={sugeridas} enLista={enLista} onCambio={cargarResumen}
          onRevisar={revisarAhora} lanzando={lanzando} onIr={setBandeja} />
      )}
      {/* Las bandejas deslizan: en el teléfono no caben siete en fila. */}
      <div className="-mx-4 flex overflow-x-auto border-b border-white/10 px-4" role="tablist" aria-label="Bandejas de revisión">
        {bandejas.map(b => {
          const activa = b.id === bandeja;
          return (
            <button key={b.id} role="tab" aria-selected={activa} onClick={() => setBandeja(b.id)}
              className={`relative shrink-0 whitespace-nowrap px-3 pb-2.5 pt-1 text-[14px] ${activa ? 'font-semibold text-white' : 'text-nf-text2'}`}>
              {b.texto}{b.n !== undefined && <span className="ml-1 tabular-nums text-nf-text3">{num(b.n)}</span>}
              {activa && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-nf-red" />}
            </button>
          );
        })}
      </div>
      {motivo && <p className="mt-2 text-[12px] text-nf-text3">{motivo.descripcion}</p>}
      {bandeja === 'corregido' ? (
        <div className="mt-3"><CorregidasMovil onCambio={() => { cargarResumen(); setRecarga(n => n + 1); }} /></div>
      ) : bandeja === 'gasto' ? (
        <div className="mt-3">
          {resumen.auto?.ia && (
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="text-[12px] text-nf-text2">Este mes</p>
              <p className="text-[24px] font-semibold tabular-nums">{dolar(resumen.auto.ia.gasto_mes)}</p>
              <p className="text-[11px] text-nf-text3">de un tope de {dolar(resumen.auto.ia.tope)}</p>
              <p className="mt-2 text-[11px] text-nf-text3">Lo que ha costado de verdad cada petición: el servidor y las pruebas.</p>
            </div>
          )}
          <HistorialIAMovil />
        </div>
      ) : (
        <ColaMovil key={bandeja} bandeja={bandeja} canales={resumen.canales} onCambio={cargarResumen} recarga={recarga} />
      )}
    </div>
  );
}


/**
 * Medidas de la pantalla, para cuando algo no cuadra con los bordes.
 *
 * Existe porque el hueco bajo la barra de pestañas costo tres intentos de
 * diagnosticar a ciegas: resulto ser la barra de direcciones de Safari, que
 * al encogerse sigue ocupando sitio aunque apenas se vea. Con estos numeros
 * delante se ve en dos segundos si la app va instalada o dentro del navegador.
 */
function Pantalla() {
  const [v, setV] = useState<Record<string, string>>({});

  useEffect(() => {
    const medir = () => {
      const vv = window.visualViewport;
      const raiz = getComputedStyle(document.documentElement);
      setV({
        'Modo': window.matchMedia?.('(display-mode: standalone)').matches ? 'instalada (standalone)' : 'dentro del navegador',
        'navigator.standalone': String((navigator as any).standalone ?? '—'),
        'Pantalla': `${screen.width} × ${screen.height}`,
        'window.innerHeight': String(window.innerHeight),
        'visualViewport alto': vv ? String(Math.round(vv.height)) : '—',
        'visualViewport offsetTop': vv ? String(Math.round(vv.offsetTop)) : '—',
        'Alto de maquetación': String(document.documentElement.clientHeight),
        '--app-h': raiz.getPropertyValue('--app-h').trim() || '(sin definir)',
        '--app-top': raiz.getPropertyValue('--app-top').trim() || '(sin definir)',
        'Zona segura abajo': raiz.getPropertyValue('--safe-b').trim() || '0px',
      });
    };
    medir();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', medir);
    vv?.addEventListener('scroll', medir);
    window.addEventListener('resize', medir);
    return () => {
      vv?.removeEventListener('resize', medir);
      vv?.removeEventListener('scroll', medir);
      window.removeEventListener('resize', medir);
    };
  }, []);

  const instalada = v['Modo']?.startsWith('instalada');
  const sobra = Number(v['Alto de maquetación']) - Number(v['visualViewport alto']);

  return (
    <section className="rounded-2xl bg-white/5 p-4 mb-4">
      <p className="text-[13px] font-semibold text-nf-text2 mb-2">Pantalla</p>
      {!instalada && (
        <p className="text-[13px] text-amber-400/90 mb-3 leading-relaxed">
          Estás dentro de Safari, no en la app instalada. La franja de abajo es su barra de
          direcciones: aunque se encoja, sigue ocupando sitio y la página no puede pintar ahí.
          Añade la app a la pantalla de inicio (Compartir → «Añadir a pantalla de inicio») y
          esa franja desaparece.
        </p>
      )}
      {Number.isFinite(sobra) && sobra > 2 && (
        <p className="text-[13px] text-nf-text2 mb-3">
          Hay {sobra} px de la pantalla que no son de la página.
        </p>
      )}
      <div className="text-[12px] leading-[1.9] font-mono">
        {Object.entries(v).map(([k, val]) => (
          <div key={k} className="flex justify-between gap-3">
            <span className="text-nf-text3">{k}</span>
            <span className="text-right">{val}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Server() {
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => { apiFetch('/config').then(r => r.json()).then(d => setCfg(d.config)).catch(() => {}); }, []);
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
      {/* Aqui habia un recuadro «Estado» con el disco libre, las descargas
          activas y el telefono de Telegram: lo primero ya esta en el Resumen
          y lo segundo en Telegram. De el solo queda lo que no sale en otro
          sitio, que es si falta la clave de TMDB, y va donde se nota: en el
          interruptor que sin ella no hace nada. */}
      <section className="rounded-2xl bg-white/5 px-4 py-1 mb-4">
        <Toggle k="tmdb_enabled" label="Metadatos de TMDB"
          help={cfg.tmdb_api_key ? 'Carátulas, sinopsis y clasificación' : 'Sin clave de TMDB (TMD_TMBD_API_KEY): no se buscan fichas'} />
        <Toggle k="convert_dts_to_ac3" label="Convertir a MP4 al descargar" help="Necesario para iPhone y para las teles" />
        <Toggle k="delete_archives_after_extract" label="Borrar comprimidos tras extraer" />
      </section>
      <Cache />
      <Pantalla />
      <p className="text-[12px] text-nf-text3">Las rutas y el resto de ajustes se editan desde la web de escritorio o en el archivo .env del servidor.</p>
    </div>
  );
}

/**
 * Estado de la cache (Redis).
 *
 * Existe por lo mismo que en la web: una cache es invisible cuando va bien y
 * tambien cuando no va, asi que sin un sitio donde mirarlo la unica forma de
 * saber si esta conectada era cronometrar la portada. Y el boton de vaciar es
 * la salida de emergencia si algo se queda pegado.
 */
function Cache() {
  const [c, setC] = useState<any>(null);
  const leer = () => { apiFetch('/admin/cache').then(r => r.json()).then(setC).catch(() => setC(null)); };
  useEffect(leer, []);
  const vaciar = async () => { await apiFetch('/admin/cache', { method: 'DELETE' }); toast('Caché vaciada', 'ok'); leer(); };
  return (
    <section className="rounded-2xl bg-white/5 p-4 mb-4">
      <p className="text-[13px] font-semibold text-nf-text2 mb-1">Caché</p>
      {!c ? (
        <p className="text-[14px] text-nf-text3">Consultando…</p>
      ) : !c.activa ? (
        <p className="text-[13px] text-nf-text3">
          Desactivada. Se enciende con TMD_REDIS_URL; sin ella todo funciona igual, solo más lento.
        </p>
      ) : (
        <>
          {/* En rejilla de dos, como las cifras de Canales: en una sola fila
              cada número se queda con ~70 px y no cabe. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-1">
            {[['Acierto', `${c.tasa} %`], ['Consultas', String(c.aciertos + c.fallos)],
              ['Entradas', c.claves != null ? String(c.claves) : '—'], ['Memoria', c.memoria || '—']].map(([k, v]) => (
              <div key={k}>
                <p className="text-[11px] uppercase tracking-wide text-nf-text3">{k}</p>
                <p className="text-[17px] font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-nf-text3 mt-2">{c.url}</p>
        </>
      )}
      <div className="flex gap-2 mt-3">
        <button onClick={leer} className="h-10 px-4 rounded-xl bg-white/10 text-[14px] font-semibold active:bg-white/20">Actualizar</button>
        {c?.activa && (
          <button onClick={vaciar} className="h-10 px-4 rounded-xl bg-white/10 text-[14px] font-semibold active:bg-white/20">Vaciar</button>
        )}
      </div>
    </section>
  );
}

/** Pestaña Créditos: usarlos o no, averiguarlos al ver, la pasada completa y cuánto se sabe. */
function Creditos() {
  const [conf, setConf] = useState<{ activos: boolean; alVer: boolean } | null>(null);
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    apiFetch('/config').then(x => x.json())
      .then(d => setConf({ activos: d.config?.creditos_activos !== false, alVer: !!d.config?.creditos_analizar }))
      .catch(() => {});
    apiFetch('/admin/creditos/resumen').then(x => x.json()).then(setR).catch(() => {});
  }, []);
  const cambiar = async (clave: 'creditos_activos' | 'creditos_analizar', nuevo: boolean) => {
    const campo = clave === 'creditos_activos' ? 'activos' : 'alVer';
    setConf(c => c && { ...c, [campo]: nuevo });
    const res = await apiFetch('/config', { method: 'POST', body: JSON.stringify({ [clave]: nuevo }) }).catch(() => null);
    if (!res || !res.ok) { setConf(c => c && { ...c, [campo]: !nuevo }); toast('No se ha podido guardar', 'error'); return; }
    toast('Guardado', 'ok');
  };
  const cuenta = (tipo: string) => (r?.titulos || []).filter((t: any) => t.tmdb_type === tipo).reduce((a: number, t: any) => a + t.n, 0);
  const medidos = (r?.enlaces || []).reduce((a: number, e: any) => a + e.n, 0);
  const activos = !!conf?.activos;
  const fila = (titulo: string, texto: string, on: boolean, disabled: boolean, onClick: () => void) => (
    <button onClick={onClick} disabled={disabled} role="switch" aria-checked={on}
      className="w-full flex items-center justify-between gap-3 py-3 text-left disabled:opacity-40">
      <div>
        <p className="text-[15px]">{titulo}</p>
        <p className="text-[12px] text-nf-text3">{texto}</p>
      </div>
      <span className={`w-12 h-7 rounded-full relative shrink-0 ${on ? 'bg-nf-red' : 'bg-white/15'}`}><span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></span>
    </button>
  );
  return (
    <div>
      <section className="rounded-2xl bg-white/5 px-4 py-1 mb-4 divide-y divide-white/10">
        {fila('Usar los créditos',
          'La tarjeta del siguiente sale al empezar los créditos. Apagado, siempre 45 s antes del final',
          activos, !conf, () => cambiar('creditos_activos', !activos))}
        {fila('Averiguar los créditos al ver',
          'Si no se sabe dónde empiezan, se miden en Telegram mientras se ve',
          !!conf?.alVer, !conf || !activos, () => cambiar('creditos_analizar', !conf?.alVer))}
      </section>
      <PasadaCreditos />
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-2">Lo que ya se sabe</p>
        <div className="grid grid-cols-3 gap-2">
          {[['Películas', cuenta('movie')], ['Series', cuenta('tv')], ['Enlaces', medidos]].map(([k, v]) => (
            <div key={k as string}>
              <p className="text-[11px] uppercase tracking-wide text-nf-text3">{k}</p>
              <p className="text-[17px] font-semibold tabular-nums">{r ? (v as number).toLocaleString('es-ES', MILES) : '—'}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** La pasada completa de créditos: lanzarla, pausarla y ver cómo va. */
function PasadaCreditos() {
  const [p, setP] = useState<Pasada | null>(null);
  const [mandando, setMandando] = useState(false);
  useEffect(() => {
    let vivo = true;
    const leer = () => { if (!document.hidden) leerPasada().then(r => { if (vivo && r) setP(r); }); };
    leer();
    const t = setInterval(leer, 10_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  const mandar = async (accion: 'lanzar' | 'pausar') => {
    setMandando(true);
    const r = await mandarPasada(accion);
    if (r) setP(r);
    setMandando(false);
  };
  const total = p?.total || 0;
  const hechos = p?.hechos || 0;
  const pct = total ? Math.min(100, Math.round((hechos / total) * 100)) : 0;
  return (
    <section className="rounded-2xl bg-white/5 p-4 mb-4">
      <p className="text-[13px] font-semibold text-nf-text2 mb-1">Pasada completa de créditos</p>
      <p className="text-[12px] text-nf-text3 mb-2">
        Todo el catálogo de una vez (uno o dos días). De tres en tres; se para si hay una descarga. Sigue sola tras un reinicio.
      </p>
      {!p ? <p className="text-[14px] text-nf-text3">Consultando…</p> : (
        <>
          <p className="text-[14px] font-semibold">{estadoPasada(p)}</p>
          {total > 0 && (
            <>
              <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-nf-red" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[12px] text-nf-text2 mt-1.5 tabular-nums">
                {hechos.toLocaleString('es-ES', MILES)} de {total.toLocaleString('es-ES', MILES)} ({pct} %)
                {p.lanzada && p.segundos_restantes ? ` · ${cuantoQueda(p.segundos_restantes)}` : ''}
              </p>
            </>
          )}
          {!!p.actuales?.length && <p className="text-[12px] text-nf-text3 mt-1.5">Midiendo: {p.actuales.join(' · ')}</p>}
          {resultadosPasada(p) && <p className="text-[12px] text-nf-text3 mt-1">Esta tanda: {resultadosPasada(p)}</p>}
        </>
      )}
      <button disabled={!p || mandando} onClick={() => mandar(p?.lanzada ? 'pausar' : 'lanzar')}
        className="mt-3 h-10 px-4 rounded-xl bg-white/10 text-[14px] font-semibold active:bg-white/20 disabled:opacity-50">
        {botonPasada(p)}
      </button>
    </section>
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
              // La etiqueta va debajo y no al lado: al lado se comia el ancho y
              // de cada fila solo se leia «YoSoyFran · Sin clasifi…».
              <div key={n.id} className="flex items-start gap-3 p-3">
                {n.poster && (
                  <div className="w-9 h-[54px] shrink-0 rounded-md overflow-hidden bg-white/5">
                    <img src={`https://image.tmdb.org/t/p/w92${n.poster}`} alt="" loading="lazy" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] truncate">{n.title || n.file_name || 'Mensaje sin archivo'}</p>
                  <p className="text-[12px] text-nf-text3 truncate">{n.channel} · {tipo(n)}</p>
                  <p className="mt-1 flex items-center gap-2 text-[12px] text-nf-text3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-md ${n.indexed ? 'bg-nf-ok/15 text-green-300' : 'bg-white/10 text-nf-text2'}`}>
                      {n.indexed ? 'Indexado' : n.reason || 'Descartado'}
                    </span>
                    <span>{cuando(n.at)}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

const TIPO_CHAT: Record<ChatDestino['tipo'], string> = { canal: 'Canal', grupo: 'Grupo', bot: 'Bot', persona: 'Persona' };
const CLASE_ESTADO: Record<PeticionAdmin['estado'], string> = {
  en_cola: 'bg-amber-400/15 text-amber-300',
  enviada: 'bg-white/10 text-nf-text3',
  conseguida: 'bg-nf-ok/15 text-green-300',
  fallida: 'bg-nf-red/15 text-red-300',
  descartada: 'bg-white/10 text-nf-text3',
};

/** A qué chat de Telegram van las peticiones, con qué texto, y todo lo pedido. */
function Peticiones() {
  const [ajustes, setAjustes] = useState<AjustesPeticiones | null>(null);
  const [lista, setLista] = useState<PeticionAdmin[]>([]);
  const [cola, setCola] = useState<EstadoCola | null>(null);
  // Una accion de la cola en vuelo: mientras tanto se apagan **todos** los
  // botones de la cola, no solo los de esa fila, porque mover una cambia el
  // puesto de las demas y dos movimientos cruzados darian un orden que nadie
  // ha pedido.
  const [enCurso, setEnCurso] = useState<number | null>(null);
  const [error, setError] = useState('');
  // Chats: se cargan solo al pulsar, porque el servidor recorre todos los
  // dialogos de la cuenta de Telegram y tarda unos segundos.
  const [chats, setChats] = useState<ChatDestino[] | null>(null);
  const [cargandoChats, setCargandoChats] = useState(false);
  const [filtro, setFiltro] = useState('');
  // Por defecto solo los canales del catálogo y sus grupos: es ahí donde se
  // pide, y la cuenta puede estar en cientos de chats.
  const [soloCatalogo, setSoloCatalogo] = useState(true);
  // El grupo elegido es un foro: falta decir en qué tema se escribe.
  const [foro, setForo] = useState<{ chat: ChatDestino; temas: TemaForo[] | null } | null>(null);
  const [probando, setProbando] = useState(false);
  const [plantilla, setPlantilla] = useState('');
  const [previa, setPrevia] = useState('');
  const [guardando, setGuardando] = useState(false);
  const previaReq = useRef(0);

  useEffect(() => {
    peticionesAdmin().then(d => {
      setLista(d.peticiones || []); setCola(d.cola);
      setAjustes(d.ajustes); setPlantilla(d.ajustes.plantilla);
    }).catch(e => setError(e instanceof Error ? e.message : 'No se han podido cargar las peticiones'));
  }, []);

  // Tras tocar la cola se vuelve a pedir la lista entera: el orden y los
  // puestos los decide el servidor. Los ajustes no se tocan, o se perderia una
  // plantilla a medio escribir.
  const recargar = async () => {
    const d = await peticionesAdmin();
    setLista(d.peticiones || []); setCola(d.cola);
  };
  const [pausando, setPausando] = useState(false);
  const alternarPausa = async () => {
    if (!cola) return;
    setPausando(true);
    try {
      await guardarAjustes({ pausadas: !cola.pausadas });
      await recargar();
      toast(cola.pausadas ? 'Publicación reanudada' : 'Publicación en pausa', 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido cambiar', 'error', 6000); }
    finally { setPausando(false); }
  };
  const enCola = async (p: PeticionAdmin, hacer: () => Promise<string | null>) => {
    setEnCurso(p.id);
    try {
      const ok = await hacer();
      if (ok) toast(ok, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido', 'error', 6000); }
    finally {
      try { await recargar(); } catch {}
      setEnCurso(null);
    }
  };
  const mover = (p: PeticionAdmin, como: 'arriba' | 'abajo' | 'primera') =>
    enCola(p, async () => { await moverEnCola(p.id, como); return null; });
  const enviarAhora = (p: PeticionAdmin) => enCola(p, async () => {
    const r = await enviarYa(p.id);
    // Que Telegram no la deje salir no es un fallo de la peticion HTTP: viene
    // como `fallida` con su motivo, y eso es lo que hay que enseñar.
    if (r.estado === 'fallida') { toast(r.error || 'Telegram no la ha dejado salir', 'error', 8000); return null; }
    return `«${p.titulo}» enviada`;
  });
  const quitar = (p: PeticionAdmin) => enCola(p, async () => { await quitarDeCola(p.id); return 'Quitada de la cola'; });
  const reencolar = (p: PeticionAdmin) => enCola(p, async () => { await volverALaCola(p.id); return 'De vuelta en la cola'; });

  // Vista previa con retardo, y solo la última respuesta cuenta.
  useEffect(() => {
    if (!ajustes) return;
    const mine = ++previaReq.current;
    const t = setTimeout(() => {
      vistaPrevia(plantilla).then(texto => { if (mine === previaReq.current) setPrevia(texto); })
        .catch(() => { if (mine === previaReq.current) setPrevia(''); });
    }, 400);
    return () => clearTimeout(t);
  }, [plantilla, !!ajustes]);

  const abrirChats = async () => {
    setCargandoChats(true); setError('');
    try { setChats(await chatsDestino()); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se han podido cargar los chats'); }
    finally { setCargandoChats(false); }
  };
  const guardarDestino = async (c: ChatDestino, tema?: TemaForo) => {
    const conTema = tema && !tema.general ? tema : null;
    try {
      setAjustes(await guardarAjustes({ chat_id: c.id, chat_nombre: c.nombre,
                                        tema_id: conTema ? conTema.id : null, tema_nombre: conTema ? conTema.titulo : '' }));
      setChats(null); setFiltro(''); setForo(null);
      toast(`Las peticiones irán a ${c.nombre}${conTema ? ` › ${conTema.titulo}` : ''}`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido guardar', 'error', 6000); }
  };
  const elegir = async (c: ChatDestino) => {
    if (!c.puede_escribir) return;
    if (!c.foro) { await guardarDestino(c); return; }
    // Un grupo con temas: se elige el tema antes de guardar nada.
    setForo({ chat: c, temas: null });
    try { setForo({ chat: c, temas: await temasDe(c.id) }); }
    catch (e) { setForo(null); toast(e instanceof Error ? e.message : 'No se han podido leer los temas', 'error', 6000); }
  };
  const probar = async () => {
    setProbando(true);
    try { await probarPeticion(plantilla); toast('Enviada a tus Mensajes guardados de Telegram', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido mandar la prueba', 'error', 6000); }
    finally { setProbando(false); }
  };
  const guardarPlantilla = async () => {
    setGuardando(true);
    try { const a = await guardarAjustes({ plantilla }); setAjustes(a); setPlantilla(a.plantilla); toast('Plantilla guardada', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se ha podido guardar', 'error', 6000); }
    finally { setGuardando(false); }
  };

  const cuando = (at: string | null) => {
    if (!at) return '';
    const t = new Date(at);
    return Number.isNaN(t.getTime()) ? at : t.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const visibles = (chats || []).filter(c => (!soloCatalogo || c.del_catalogo)
    && c.nombre.toLowerCase().includes(filtro.trim().toLowerCase()));
  const boton = 'w-full h-11 rounded-xl text-[15px] font-semibold disabled:opacity-40';

  // El servidor ya las manda en orden, pero se ordena por puesto por si acaso:
  // el orden de esta lista es justo lo que se esta editando.
  const enLaCola = lista.filter(p => p.estado === 'en_cola').sort((a, b) => (a.puesto ?? 1e9) - (b.puesto ?? 1e9));
  const resto = lista.filter(p => p.estado !== 'en_cola');
  const minutos = cola?.minutos_entre_envios || 60;
  const salePuesto = (n: number) => enCuanto(segundosHastaPuesto(n, cola?.segundos_para_siguiente ?? 0, minutos));
  const muchas = !!cola && enLaCola.length >= cola.aviso_a_partir_de;
  const botonCola = 'h-11 rounded-xl bg-white/10 text-[13px] font-semibold active:bg-white/20 disabled:opacity-30';

  if (!ajustes) return <p className="text-[14px] text-nf-text3">{error || 'Cargando…'}</p>;
  return (
    <div>
      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-1">Cola</p>
        {/* Una a la hora en total, no por cuenta: escribir mas seguido en el
            grupo con la cuenta del servidor es lo que hace que la echen. */}
        {cola?.pausadas ? (
          <p className="rounded-xl bg-amber-400/15 p-3 text-[13px] text-amber-200 leading-relaxed">
            Publicación en pausa: lo que se pide entra en la cola, pero no sale nada a Telegram hasta que la
            reanudes. «Enviar ya» sigue funcionando.
          </p>
        ) : (
          <p className="text-[15px]">
            {enLaCola.length === 0 ? `Sale ${ritmo(minutos)} · no hay nada esperando`
              : `Sale ${ritmo(minutos)} · la siguiente ${salePuesto(1)}`}
          </p>
        )}
        {/* Pausar no cierra las peticiones: se sigue pidiendo y la cola se
            llena, pero no sale nada a Telegram hasta reanudar. */}
        <button onClick={alternarPausa} disabled={pausando || !cola}
          className={`w-full h-11 mt-3 rounded-xl text-[15px] font-semibold disabled:opacity-40 ${
            cola?.pausadas ? 'bg-nf-ok/20 text-nf-ok' : 'bg-white/10'}`}>
          {pausando ? 'Guardando…' : cola?.pausadas ? 'Reanudar publicación' : 'Pausar publicación'}
        </button>
        {muchas && (
          <p className="mt-3 rounded-xl bg-amber-400/15 p-3 text-[13px] text-amber-200 leading-relaxed">
            Hay {enLaCola.length} esperando: la última saldría {salePuesto(enLaCola.length)}. Sube las importantes,
            manda alguna ya o quita las que sobren.
          </p>
        )}
        {enLaCola.length > 0 && (
          <ul className="mt-3 divide-y divide-white/5">
            {enLaCola.map((p, n) => {
              const puesto = p.puesto ?? n + 1;
              const primera = n === 0;
              const ultima = n === enLaCola.length - 1;
              const ocupado = enCurso !== null;
              return (
                <li key={p.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className="w-6 shrink-0 pt-0.5 text-center text-[17px] font-bold text-nf-text2">{puesto}</span>
                    <div className="w-9 h-[54px] shrink-0 rounded-md overflow-hidden bg-white/5">
                      {p.poster && <img src={p.poster} alt="" loading="lazy" className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] truncate">{p.titulo}</p>
                      <p className="text-[12px] text-nf-text3 truncate">
                        {TIPO_PETICION[p.media_type]}{p.year ? ` · ${p.year}` : ''} · sale {salePuesto(puesto)}
                      </p>
                      <p className="text-[12px] text-nf-text3 truncate">
                        {p.usuarios?.length ? `La esperan: ${p.usuarios.join(', ')}` : 'Ya no la espera nadie'}
                      </p>
                    </div>
                  </div>
                  {/* Botones grandes: se usan con el pulgar, y un «Enviar ya»
                      pulsado sin querer escribe en el grupo. */}
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => mover(p, 'arriba')} disabled={ocupado || primera}
                      aria-label={`Subir ${p.titulo}`} className={`${botonCola} w-11 shrink-0 text-[17px]`}>↑</button>
                    <button onClick={() => mover(p, 'abajo')} disabled={ocupado || ultima}
                      aria-label={`Bajar ${p.titulo}`} className={`${botonCola} w-11 shrink-0 text-[17px]`}>↓</button>
                    <button onClick={() => mover(p, 'primera')} disabled={ocupado || primera}
                      className={`${botonCola} flex-1 px-1`}>Primera</button>
                    <button onClick={() => enviarAhora(p)} disabled={ocupado}
                      className={`${botonCola} flex-1 px-1 !bg-nf-red`}>{enCurso === p.id ? '…' : 'Enviar ya'}</button>
                    <button onClick={() => quitar(p)} disabled={ocupado}
                      className={`${botonCola} flex-1 px-1 text-red-300`}>Quitar</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-1">Chat de destino</p>
        <p className="text-[15px]">
          {ajustes.chat_id ? ajustes.chat_nombre || `Chat ${ajustes.chat_id}` : 'Sin elegir'}
          {ajustes.chat_id && ajustes.tema_nombre ? ` › ${ajustes.tema_nombre}` : ''}
        </p>
        <p className="text-[12px] text-nf-text3 mt-1 leading-relaxed">
          {ajustes.chat_id ? 'Cada petición se escribe ahí con la cuenta de Telegram del servidor.'
            : 'Hasta que se elija uno, nadie puede pedir nada.'}
          {` Cada cuenta puede pedir ${ajustes.limite_dia} al día.`}
        </p>
        {error && <p className="mt-3 text-[13px] text-red-300">{error}</p>}
        {foro ? (
          <div className="mt-3">
            <p className="text-[13px] text-nf-text2">«{foro.chat.nombre}» tiene temas: elige en cuál se escribe.</p>
            {foro.temas === null && <p className="mt-2 text-[13px] text-nf-text3">Leyendo los temas…</p>}
            <div className="mt-2 max-h-[50vh] overflow-y-auto rounded-xl bg-black/20 divide-y divide-white/5">
              {foro.temas?.map(t => (
                <button key={t.id} onClick={() => guardarDestino(foro.chat, t)}
                  className={`w-full text-left p-3 active:bg-white/10 ${t.id === ajustes.tema_id ? 'bg-white/10' : ''}`}>
                  <span className="block text-[14px] truncate">{t.titulo}</span>
                  {(t.general || t.cerrado) && (
                    <span className="block text-[12px] text-nf-text3">
                      {t.general ? 'el general' : 'cerrado: solo escriben los admins'}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button onClick={() => setForo(null)} className="w-full h-10 mt-1 text-[13px] text-nf-text3">Volver a los chats</button>
          </div>
        ) : chats === null ? (
          <button onClick={abrirChats} disabled={cargandoChats} className={`${boton} mt-3 bg-white/10`}>
            {cargandoChats ? 'Cargando chats… (tarda unos segundos)' : ajustes.chat_id ? 'Cambiar chat' : 'Elegir chat'}
          </button>
        ) : (
          <div className="mt-3">
            <input className={input} value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar por nombre" autoCapitalize="none" />
            <label className="mt-2 flex items-center gap-2 text-[13px] text-nf-text2">
              <input type="checkbox" checked={soloCatalogo} onChange={e => setSoloCatalogo(e.target.checked)} />
              Solo los del catálogo
            </label>
            <div className="mt-2 max-h-[50vh] overflow-y-auto rounded-xl bg-black/20 divide-y divide-white/5">
              {visibles.length === 0 && <p className="p-3 text-[13px] text-nf-text3">
                {soloCatalogo ? 'Ningún chat del catálogo con ese nombre. Quita «Solo los del catálogo» para ver todos.' : 'Ningún chat con ese nombre.'}
              </p>}
              {visibles.map(c => (
                <button key={c.id} onClick={() => elegir(c)} disabled={!c.puede_escribir}
                  className={`w-full text-left flex items-center gap-2 p-3 ${c.puede_escribir ? 'active:bg-white/10' : 'opacity-40'} ${c.id === ajustes.chat_id ? 'bg-white/10' : ''}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] truncate">{c.nombre}</span>
                    <span className="block text-[12px] text-nf-text3 truncate">
                      {TIPO_CHAT[c.tipo] || c.tipo}{c.foro ? ' con temas' : ''}{c.usuario ? ` · @${c.usuario}` : ''}{!c.puede_escribir ? ' · no se puede escribir' : ''}
                    </span>
                  </span>
                  {c.del_catalogo && <span className="shrink-0 text-[11px] px-2 py-1 rounded-lg bg-amber-400/15 text-amber-300">
                    {c.grupo_de ? `grupo de ${c.grupo_de}` : 'canal del catálogo'}
                  </span>}
                </button>
              ))}
            </div>
            <button onClick={() => { setChats(null); setFiltro(''); }} className="w-full h-10 mt-1 text-[13px] text-nf-text3">Cancelar</button>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white/5 p-4 mb-4">
        <p className="text-[13px] font-semibold text-nf-text2 mb-2">Plantilla del mensaje</p>
        <textarea value={plantilla} onChange={e => setPlantilla(e.target.value)} rows={4}
          className="w-full rounded-xl bg-white/10 border border-white/10 p-3 text-[16px] outline-none focus:border-white/40" />
        {/* Tocar un hueco lo añade al final: en el teclado del movil las llaves
            estan escondidas en la tercera pantalla de simbolos. */}
        <ul className="mt-2 space-y-1 text-[12px] text-nf-text3">
          {Object.entries(ajustes.huecos || {}).map(([h, explica]) => (
            <li key={h}>
              <button onClick={() => setPlantilla(t => t + `{${h}}`)} className="text-left">
                <span className="font-mono text-nf-text2 px-1.5 py-0.5 rounded bg-white/10">{`{${h}}`}</span> {explica}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[11px] text-nf-text3">Toca un hueco para añadirlo.</p>
        <p className="mt-3 text-[12px] font-semibold text-nf-text2">Vista previa</p>
        <p className="mt-1 rounded-xl bg-black/30 p-3 text-[13px] whitespace-pre-wrap break-words">{previa || '—'}</p>
        <button onClick={guardarPlantilla} disabled={guardando || !plantilla.trim() || plantilla === ajustes.plantilla}
          className={`${boton} mt-3 bg-nf-red`}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={() => setPlantilla(ajustes.plantilla_por_defecto)} disabled={plantilla === ajustes.plantilla_por_defecto}
          className="w-full h-10 mt-1 text-[13px] text-nf-text3 disabled:opacity-40">
          Restaurar la de por defecto
        </button>
        {/* Lo mismo que saldría en el grupo, carátula incluida, pero a los
            Mensajes guardados: se ve cómo queda sin escribir a nadie. */}
        <button onClick={probar} disabled={probando} className="w-full h-10 text-[13px] text-nf-text2 disabled:opacity-40">
          {probando ? 'Enviando…' : 'Enviarme una prueba a Telegram'}
        </button>
      </section>

      {/* Lo que ya no esta en la cola: lo de la cola ya sale arriba, en orden. */}
      <p className="text-[13px] font-semibold text-nf-text2 mb-2">
        {resto.length} {resto.length === 1 ? 'petición' : 'peticiones'}{enLaCola.length ? ' fuera de la cola' : ''}
      </p>
      {resto.length === 0 ? (
        <p className="text-[14px] text-nf-text3 leading-relaxed">
          {enLaCola.length ? 'Todo lo pedido está esperando en la cola.' : 'Nadie ha pedido nada todavía.'}
        </p>
      ) : (
        <div className="rounded-2xl bg-white/5 divide-y divide-white/5">
          {resto.map(p => {
            const etiqueta = ESTADO_TEXTO[p.estado] || p.estado;
            const clase = CLASE_ESTADO[p.estado] || 'bg-white/10 text-nf-text3';
            const reencolable = p.estado === 'fallida' || p.estado === 'descartada';
            return (
              <div key={p.id} className="flex items-start gap-3 p-3">
                <div className="w-9 h-[54px] shrink-0 rounded-md overflow-hidden bg-white/5">
                  {p.poster && <img src={p.poster} alt="" loading="lazy" className="w-full h-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] truncate">{p.titulo}</p>
                  <p className="text-[12px] text-nf-text3 truncate">
                    {TIPO_PETICION[p.media_type]}{p.year ? ` · ${p.year}` : ''} · {cuando(p.creada_en)}
                  </p>
                  <p className="text-[12px] text-nf-text3 truncate">
                    {p.usuarios?.length ? `La esperan: ${p.usuarios.join(', ')}` : 'Ya no la espera nadie'}
                  </p>
                  {p.estado === 'conseguida' && p.mensaje_borrado === 'si' && (
                    <p className="text-[12px] text-nf-text3">Su mensaje se ha borrado del grupo</p>
                  )}
                  {p.estado === 'conseguida' && p.mensaje_borrado?.startsWith('no') && (
                    <p className="text-[12px] text-nf-text3 break-words">No se pudo borrar su mensaje: {p.mensaje_borrado.slice(4)}</p>
                  )}
                  {p.estado === 'fallida' && p.error && (
                    <p className="text-[12px] text-red-300 mt-0.5 break-words">
                      {p.error}{p.intento_en ? ` (${cuando(p.intento_en)})` : ''}
                    </p>
                  )}
                  {reencolable && (
                    <button onClick={() => reencolar(p)} disabled={enCurso !== null}
                      className="mt-2 h-10 px-4 rounded-xl bg-white/10 text-[13px] font-semibold active:bg-white/20 disabled:opacity-40">
                      {enCurso === p.id ? 'Volviendo…' : 'Volver a la cola'}
                    </button>
                  )}
                </div>
                <span className={`shrink-0 text-[11px] px-2 py-1 rounded-lg ${clase}`}>{etiqueta}</span>
              </div>
            );
          })}
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

  // Cerrar la sesion para volver a entrar con el codigo (ver AdminTelegram de la web).
  const [confirmaSalida, setConfirmaSalida] = useState(false);
  const salir = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/admin/telegram/logout', { method: 'POST' });
      if (!r.ok) setError(await detalle(r, 'No se ha podido cerrar la sesión.'));
      else { toast('Sesión cerrada', 'ok'); setCode(''); setPass(''); setPidePass(false); load(); }
    } finally { setBusy(false); setConfirmaSalida(false); }
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
            {st.premium != null && (
              <span className={`block mt-1 ${st.premium === false || st.cifrado === 'python' ? 'text-amber-300' : ''}`}>
                {st.premium ? 'Premium' : 'Sin Premium (Telegram limita la velocidad)'}
                {st.cifrado === 'python' ? ' · cifrado en Python, muy lento' : st.cifrado ? ` · cifrado con ${st.cifrado}` : ''}
                {st.conexiones ? ` · ${st.conexiones} conexiones por archivo` : ''}
              </span>
            )}
          </p>
        ) : null}
        {st.authorized && (
          <>
            {error && <p className="mt-3 text-[13px] text-red-300">{error}</p>}
            {!confirmaSalida ? (
              <button onClick={() => setConfirmaSalida(true)} disabled={busy} className={`${boton} mt-3 bg-white/10`}>
                Cerrar sesión de Telegram
              </button>
            ) : (
              <>
                <p className="mt-3 text-[13px] text-nf-text3 leading-relaxed">
                  Se cerrará también en Telegram y habrá que volver a entrar con un código.
                  Mientras tanto no se descarga ni se indexa nada.
                </p>
                <button onClick={salir} disabled={busy} className={`${boton} mt-3 bg-nf-red`}>
                  {busy ? 'Cerrando…' : 'Sí, cerrar sesión'}
                </button>
                <button onClick={() => setConfirmaSalida(false)} disabled={busy} className={`${boton} mt-2 bg-white/10`}>
                  Cancelar
                </button>
              </>
            )}
          </>
        )}
        {st.authorized ? null : st.configured ? (
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
      // Una lista vacia tambien es «verdadera»: antes un error con `logs: []`
      // pintaba «0 líneas» y un recuadro negro sin decir por que.
      if (d.logs?.length) { setLineas(d.logs); setAviso(''); }
      else setAviso(d.error || d.detail || 'Todavía no hay nada en el registro.');
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
        <pre className="rounded-2xl bg-black/50 p-3 text-[11px] leading-[1.5] whitespace-pre-wrap break-all text-nf-text2">
{lineas.join('\n')}
        </pre>
      )}
    </div>
  );
}

/** Lo que devuelve `GET /api/admin/resumen`. Cada parte puede venir a null:
 *  fallo al calcularla o (la revision) todavia se esta calculando. */
interface ResumenAdmin {
  avisos: { nivel: 'error' | 'aviso'; texto: string; seccion: string }[];
  telegram: { conectado: boolean; autorizado: boolean; premium: boolean | null; canales: number; canales_activos: number } | null;
  catalogo: { total: number; con_ficha: number; peliculas: number; series: number; escaneando: number; releyendo: boolean } | null;
  revision: { archivos: number; grupos: number; por_motivo: Record<string, number> } | null;
  descargas: { activas: number; disco_libre: number } | null;
  peticiones: { en_cola: number; pausadas: boolean; chat: string | null } | null;
  creditos: { activos?: boolean; al_ver: boolean; pasada: { estado: string; lanzada: boolean; hechos: number | null; total: number | null; cediendo: string | null } } | null;
  comprimidos: { revisados: number; ver: number } | null;
  usuarios: { total: number; activos: number; en_linea?: number } | null;
}

/** Disco libre: en TB a partir de uno, que «3.412 GB» se lee peor que «3,3 TB». */
const disco = (b: number) => b >= 1024 ** 4
  ? `${(b / 1024 ** 4).toLocaleString('es-ES', { maximumFractionDigits: 1 })} TB`
  : `${Math.round(b / GB).toLocaleString('es-ES', MILES)} GB`;

const plural = (n: number, uno: string, varios: string) => n === 1 ? uno : varios;

/** La pasada de créditos en dos palabras: en la tarjeta no cabe la frase entera
 *  de `estadoPasada()`, que está en la sección. */
function pasadaCorta(p: { estado: string; lanzada: boolean; cediendo: string | null }): string {
  if (p.estado === 'en_marcha') return p.cediendo ? 'Esperando' : 'En marcha';
  if (p.estado === 'pausada') return p.lanzada ? 'En marcha' : 'En pausa';
  if (p.estado === 'al_dia') return 'Al día';
  if (p.estado === 'terminada') return 'Terminada';
  if (p.estado === 'error') return 'Parada por un error';
  return 'Sin lanzar';
}

function IAdelante() {
  return <span className="block w-4 h-4 shrink-0 rotate-180 text-nf-text3"><IBack /></span>;
}

/** Una tarjeta del Resumen. Sin `onClick` no lleva a ninguna parte, y entonces
 *  no se pinta como si se pudiera tocar. */
function Tarjeta({ titulo, valor, unidad, lineas, tono, onClick }: {
  titulo: string; valor: string; unidad?: string; lineas: (string | false | null | undefined)[];
  tono?: 'ok' | 'aviso' | 'mal'; onClick?: () => void;
}) {
  const punto = tono === 'ok' ? 'bg-nf-ok' : tono === 'aviso' ? 'bg-amber-400' : tono === 'mal' ? 'bg-nf-red' : '';
  const dentro = (
    <>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-nf-text3 font-semibold">
        {punto && <span className={`w-2 h-2 rounded-full ${punto}`} />}{titulo}
      </p>
      <p className="mt-1 text-[20px] leading-tight font-semibold tabular-nums truncate">
        {valor}{unidad && <span className="text-[12px] font-normal text-nf-text3"> {unidad}</span>}
      </p>
      {lineas.filter(Boolean).map((l, i) => (
        <p key={i} className="text-[12px] leading-snug text-nf-text2 mt-0.5 line-clamp-2 break-words">{l}</p>
      ))}
    </>
  );
  const clase = 'min-w-0 rounded-2xl bg-white/5 p-3.5 text-left';
  return onClick
    ? <button onClick={onClick} className={`${clase} tap active:bg-white/10`}>{dentro}</button>
    : <div className={clase}>{dentro}</div>;
}

/**
 * La portada del panel: el estado de todo de un vistazo.
 *
 * Existe porque para saber si algo iba mal habia que abrir las pestañas una
 * por una (Telegram para ver si estaba conectado, Peticiones para ver si
 * estaban en pausa, Ajustes para el disco). Arriba van los avisos, que son lo
 * que pide hacer algo, y cada tarjeta lleva a la sección que la explica. Lo
 * que no se pudo calcular sale como «—»: esta pantalla tiene que abrir
 * aunque una parte este rota, que es justo cuando mas se mira.
 */
function Resumen({ ir }: { ir: (id: string) => void }) {
  const [r, setR] = useState<ResumenAdmin | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vivo = true;
    const leer = () => {
      if (document.hidden) return;
      apiFetch('/admin/resumen')
        .then(x => x.ok ? x.json() : Promise.reject(x.status))
        .then(d => { if (vivo) { setR(d); setFallo(false); } })
        .catch(() => { if (vivo) setFallo(true); });
    };
    leer();
    // Cada 20 s y al volver a la app: con la pantalla apagada no se pregunta,
    // y al encenderla se quiere lo de ahora, no lo de hace 20 s.
    const t = setInterval(leer, 20_000);
    const alVolver = () => { if (!document.hidden) leer(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, []);

  if (!r) {
    return (
      <p className="rounded-2xl bg-white/5 p-4 text-[14px] text-nf-text3 mb-2">
        {fallo ? 'No se ha podido cargar el resumen. Las secciones de abajo siguen funcionando.' : 'Cargando…'}
      </p>
    );
  }

  const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('es-ES', MILES);
  const { telegram: tg, catalogo: cat, revision: rev, descargas: des, peticiones: pet,
          creditos: cre, comprimidos: com, usuarios: usu } = r;
  const conFicha = cat && cat.total ? Math.round((cat.con_ficha / cat.total) * 100) : null;
  const pas = cre?.pasada;
  const pctPasada = pas?.total ? Math.min(100, Math.round(((pas.hechos || 0) / pas.total) * 100)) : null;

  return (
    <div>
      {!!r.avisos?.length && (
        <div className="space-y-2 mb-3">
          {r.avisos.map((a, i) => (
            <button key={i} onClick={() => ir(a.seccion)}
              className={`tap w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-[14px] leading-snug ${
                a.nivel === 'error' ? 'bg-nf-red/15 border-nf-red/40 text-red-100' : 'bg-amber-400/10 border-amber-400/30 text-amber-100'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${a.nivel === 'error' ? 'bg-nf-red' : 'bg-amber-400'}`} />
              <span className="flex-1 min-w-0">{a.texto}</span>
              <IAdelante />
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Tarjeta titulo="Telegram" onClick={() => ir('telegram')}
          valor={!tg ? '—' : !tg.conectado ? 'Desconectado' : !tg.autorizado ? 'Sin sesión' : 'Conectado'}
          tono={!tg ? undefined : tg.conectado && tg.autorizado ? 'ok' : 'mal'}
          lineas={tg ? [tg.premium != null && (tg.premium ? 'Premium' : 'Sin Premium'),
                        `${n(tg.canales)} de ${n(tg.canales_activos)} canales`] : ['No disponible']} />

        <Tarjeta titulo="Catálogo" onClick={() => ir('canales')}
          valor={n(cat?.total)} unidad={cat ? 'archivos' : undefined}
          tono={cat ? (cat.escaneando || cat.releyendo ? 'aviso' : 'ok') : undefined}
          lineas={cat ? [conFicha != null && `${conFicha} % con ficha`,
                         cat.escaneando ? `Escaneando ${cat.escaneando} ${plural(cat.escaneando, 'canal', 'canales')}`
                           : cat.releyendo ? 'Releyendo' : 'Al día'] : ['No disponible']} />

        <Tarjeta titulo="Revisión" onClick={() => ir('revision')}
          valor={rev ? n(rev.archivos) : 'Calculando…'} unidad={rev ? plural(rev.archivos, 'archivo', 'archivos') : undefined}
          lineas={rev ? [rev.archivos ? `${n(rev.grupos)} ${plural(rev.grupos, 'grupo', 'grupos')} por revisar` : 'Nada por revisar']
                      : ['Se mira en segundo plano']} />

        <Tarjeta titulo="Descargas" onClick={() => ir('descargas')}
          valor={n(des?.activas)} unidad={des ? plural(des.activas, 'activa', 'activas') : undefined}
          lineas={des ? [`${disco(des.disco_libre)} libres`] : ['No disponible']} />

        <Tarjeta titulo="Peticiones" onClick={() => ir('peticiones')}
          valor={n(pet?.en_cola)} unidad={pet ? 'en cola' : undefined}
          tono={pet?.pausadas ? 'aviso' : undefined}
          lineas={pet ? [pet.pausadas ? 'En pausa' : pet.chat ? `Publicando en ${pet.chat}` : 'Sin chat elegido'] : ['No disponible']} />

        <Tarjeta titulo="Créditos" onClick={() => ir('creditos')}
          valor={pctPasada != null ? `${pctPasada} %` : '—'}
          tono={pas?.estado === 'error' ? 'aviso' : undefined}
          lineas={cre ? [!!pas?.total && `${n(pas.hechos ?? 0)} de ${n(pas.total)}`, pas && pasadaCorta(pas),
                         cre.activos === false ? 'Desactivados' : `Al ver: ${cre.al_ver ? 'encendido' : 'apagado'}`] : ['No disponible']} />

        {/* Como en la web: lo que importa es cuántos se pueden ver, y lleva a
            Canales, que es donde vive lo indexado (no tiene sección propia). */}
        <Tarjeta titulo="Comprimidos" onClick={() => ir('canales')}
          valor={n(com?.ver)} unidad={com ? 'con «Ver»' : undefined}
          lineas={com ? [`de ${n(com.revisados)} revisados`] : ['No disponible']} />

        <Tarjeta titulo="Usuarios" onClick={() => ir('usuarios')}
          valor={n(usu?.activos)} unidad={usu ? plural(usu.activos, 'activo', 'activos') : undefined}
          lineas={usu ? [`de ${n(usu.total)} ${plural(usu.total, 'cuenta', 'cuentas')}`, ...(usu.en_linea ? [`${n(usu.en_linea)} en línea`] : [])] : ['No disponible']} />
      </div>
    </div>
  );
}

/**
 * La barra lateral: el menú de secciones, agrupado igual que en la web, que
 * sale desde la izquierda con el botón ☰ de la cabecera, en la portada y en
 * cualquier sección. Va por portal en el `<body>`: dentro de `.app-main` un
 * `position: fixed` no se coloca respecto a la ventana en iOS (es lo mismo
 * que obligó a sacar así el reproductor).
 */
function BarraLateral({ abierta, actual, cerrar, ir }: {
  abierta: boolean; actual: string | undefined; cerrar: () => void; ir: (id: string | null) => void;
}) {
  // Montada siempre para poder animar la entrada y la salida (solo
  // transform y opacidad).
  return createPortal(
    <div className={`fixed inset-0 z-[70] ${abierta ? '' : 'pointer-events-none'}`} aria-hidden={!abierta}>
      <div onClick={cerrar}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${abierta ? 'opacity-100' : 'opacity-0'}`} />
      <nav className={`absolute left-0 top-0 bottom-0 w-[82%] max-w-[320px] bg-[#141414] border-r border-white/10 overflow-y-auto
                       transition-transform duration-200 ${abierta ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'calc(var(--safe-t) + 16px)', paddingBottom: 'calc(var(--safe-b) + 16px)' }}>
        <div className="flex items-center justify-between px-4 mb-4">
          <p className="text-[22px] font-bold">Administración</p>
          <button onClick={cerrar} aria-label="Cerrar el menú" className="tap w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
            <span className="w-5 h-5"><IClose /></span>
          </button>
        </div>
        <div className="px-2">
          <Entrada texto="Resumen" activa={!actual} onClick={() => ir(null)} />
          {GRUPOS.map(g => (
            <div key={g.titulo} className="mt-4">
              <p className="px-3 mb-1 text-[11px] uppercase tracking-wider font-semibold text-nf-text3">{g.titulo}</p>
              {g.secciones.map(([id, nombre]) => (
                <Entrada key={id} texto={nombre} activa={actual === id} onClick={() => ir(id)} />
              ))}
            </div>
          ))}
        </div>
      </nav>
    </div>,
    document.body,
  );
}

function Entrada({ texto, activa, onClick }: { texto: string; activa: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full h-11 px-3 rounded-xl text-left text-[16px] border-l-2 active:bg-white/10
        ${activa ? 'bg-white/10 font-semibold border-nf-red' : 'text-nf-text2 border-transparent'}`}>
      {texto}
    </button>
  );
}

/**
 * El panel en el teléfono: sin sección, el Resumen; con sección
 * (`/admin/:tab`), esa sección a todo el ancho. Se navega con la barra
 * lateral (☰), igual en la portada que dentro de una sección, y desde las
 * tarjetas y avisos del Resumen.
 *
 * La sección sigue en la ruta, así que los enlaces directos siguen valiendo
 * (el aviso de peticiones abre `/m/admin/peticiones`). Del Resumen a una
 * sección se apila (atrás vuelve al Resumen, con su scroll); de una sección a
 * otra se sustituye, para que atrás no recorra todas las que se han mirado.
 */
export default function Admin() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const sec = tab ? SECCION[tab] : undefined;

  const ir = (id: string | null) => {
    setMenu(false);
    if (id === (sec ? tab : null)) return;
    if (id === null) {
      if ((location.state as any)?.desdePortada) navigate(-1);
      else navigate('/admin', { replace: true });
      return;
    }
    if (sec) navigate(`/admin/${id}`, { replace: true, state: location.state });
    else navigate(`/admin/${id}`, { state: { desdePortada: true } });
  };

  const cabecera = (
    <div className="flex items-center gap-3 mb-4">
      <button onClick={() => setMenu(true)} aria-label="Abrir el menú del panel"
        className="tap w-10 h-10 -ml-1 shrink-0 rounded-full bg-white/10 flex items-center justify-center">
        <span className="w-5 h-5"><IMenu /></span>
      </button>
      <h1 className="min-w-0 truncate text-[22px] font-bold">
        {sec ? <><span className="text-nf-text3 font-semibold">{sec.grupo} › </span>{sec.nombre}</> : 'Administración'}
      </h1>
    </div>
  );

  return (
    <div className="px-4 pb-6" style={{ paddingTop: 'calc(var(--safe-t) + 12px)' }}>
      {cabecera}
      <BarraLateral abierta={menu} actual={sec ? tab : undefined} cerrar={() => setMenu(false)} ir={ir} />
      {!sec && <Resumen ir={(id) => ir(id)} />}
      {tab === 'usuarios' && <Users />}
      {tab === 'descargas' && <DownloadsAll />}
      {tab === 'canales' && <Channels />}
      {tab === 'revision' && <Revision />}
      {tab === 'novedades' && <Novedades />}
      {tab === 'peticiones' && <Peticiones />}
      {tab === 'telegram' && <Telegram />}
      {tab === 'creditos' && <Creditos />}
      {tab === 'servidor' && <Server />}
      {tab === 'registros' && <Registros />}
    </div>
  );
}
