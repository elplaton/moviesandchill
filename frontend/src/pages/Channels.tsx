import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Shell from '../components/Shell';
import { Embedded } from '../components/Shell';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { Channel } from '../types';

interface IndexStats {
  total: number;
  movies: number;
  series: number;
  with_tmdb: number;
  tmdb_searched: number;
  by_channel: { channel_id: number; channel_name: string; count: number }[];
}

interface ChannelProgress {
  channel_id: number;
  channel_name: string;
  last_message_id: number;
  total_indexed: number;
  total_scanned?: number;
  total_estimate?: number;
  status: string;
  phase?: string;
}

interface Tema {
  id: number;
  titulo: string;
  cerrado: boolean;
  general: boolean;
  ignorado: boolean;
  indexados: number;
}

interface TemasRespuesta {
  foro: boolean;
  sin_leer: number;
  temas: Tema[];
}

// Lo que no es 2xx no lanza en apiFetch: hay que sacar el motivo a mano.
// FastAPI lo pone en `detail` y el resto de la API en `error`.
async function motivoDe(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (typeof data?.error === 'string') return data.error;
  } catch {}
  return `Error ${res.status}`;
}

interface RelecturaCanal {
  channel_id: number;
  nombre: string;
  estado: 'en_cola' | 'releyendo' | 'terminado' | 'al_dia' | 'pendiente' | 'sin_resolver' | 'fallo';
  total: number;
  leidos: number;
  con_ficha: number;
  mensaje: number | null;
  desde: number | null;
  hasta: number | null;
  error: string | null;
}

interface RelecturaEstado {
  corriendo: boolean;
  siguiente: string | null;
  canales: RelecturaCanal[];
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// La línea «Contexto leído» de un canal: cuánto de lo ya indexado se ha
// vuelto a leer en Telegram para ponerle su ficha y su pie
// (services/relectura.py). Va dentro de la tarjeta del canal y no en un
// bloque aparte porque es el mismo canal y el mismo catálogo: verlo como dos
// procesos obligaba a buscar el canal dos veces para saber cómo iba.
function LineaContexto({ c }: { c: RelecturaCanal }) {
  const pct = c.total ? Math.round((c.leidos / c.total) * 100) : 100;
  const releyendo = c.estado === 'releyendo';
  const mal = c.estado === 'fallo' || c.estado === 'sin_resolver';
  const listo = c.estado === 'terminado' || c.estado === 'al_dia';
  const estado = releyendo ? <span className="text-yellow-400">Releyendo…</span>
    : c.estado === 'en_cola' ? <span className="text-nf-dim">En cola</span>
    : c.estado === 'pendiente' ? <span className="text-nf-dim">Pendiente</span>
    : c.estado === 'sin_resolver' ? <span className="text-red-400">Sin conexión al canal</span>
    : c.estado === 'fallo' ? <span className="text-red-400">Falló</span>
    : null;
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-nf-faint text-[10px] truncate">
          Contexto leído · {c.leidos.toLocaleString()} / {c.total.toLocaleString()} archivos · {c.con_ficha.toLocaleString()} con ficha
          {releyendo && c.mensaje != null && c.hasta ? ` · mensaje ${c.mensaje.toLocaleString()} de ${c.hasta.toLocaleString()}` : ''}
        </span>
        <span className="text-[10px] shrink-0">
          {estado}{estado && ' · '}<span className="text-nf-dim">{pct}%</span>
        </span>
      </div>
      <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${
          releyendo ? 'bg-yellow-500' : mal ? 'bg-red-500/70' : listo || pct === 100 ? 'bg-green-500' : 'bg-gray-600'}`}
          style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {mal && c.error && <p className="text-red-400 text-[11px] mt-1">{c.error}</p>}
    </div>
  );
}

// Temas de un grupo con foro: elegir cuáles NO se indexan. Existe porque en
// un mismo grupo conviven «Películas» y «Series» con «Deportes», «Libros» o
// «APKs», y lo de esos otros temas entraba en el catálogo como si fueran
// películas. La lista se pide al abrir y no antes: pregunta a Telegram y
// tarda unos segundos, así que pedirla por cada canal de la lista sería
// esperar por lo que nadie ha abierto.
function TemasCanal({ channelId }: { channelId: number }) {
  const [datos, setDatos] = useState<TemasRespuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  // Ids ignorados tal y como los va dejando la persona, sin guardar todavía.
  const [ignorados, setIgnorados] = useState<Set<number>>(new Set());
  // Títulos que van a dejar de indexarse: mientras no sea null se está
  // pidiendo confirmación, porque guardar borra del catálogo lo ya indexado.
  const [confirmar, setConfirmar] = useState<string[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState('');

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      const res = await apiFetch(`/channels/${channelId}/temas`);
      if (!res.ok) { setError(await motivoDe(res)); return; }
      const data: TemasRespuesta = await res.json();
      setDatos(data);
      setIgnorados(new Set((data.temas || []).filter(t => t.ignorado).map(t => t.id)));
    } catch {
      setError('Error de conexión');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const temas = datos?.temas || [];
  const nuevosIgnorados = temas.filter(t => ignorados.has(t.id) && !t.ignorado);
  const hayCambios = temas.some(t => ignorados.has(t.id) !== t.ignorado);

  const alternar = (id: number) => {
    setResultado('');
    setConfirmar(null);
    setIgnorados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const guardar = async () => {
    setGuardando(true);
    setError('');
    try {
      const res = await apiFetch(`/channels/${channelId}/temas-ignorados`, {
        method: 'POST',
        body: JSON.stringify({ temas: [...ignorados] }),
      });
      if (!res.ok) { setError(await motivoDe(res)); return; }
      const data: { ok: boolean; quitados: number; reindexando: number[] } = await res.json();
      // Los ids se traducen con la lista de antes de recargar: es la que
      // tiene los títulos de lo que se acaba de cambiar.
      const titulos = (data.reindexando || []).map(id => temas.find(t => t.id === id)?.titulo || `#${id}`);
      const partes = [`Quitados ${(data.quitados || 0).toLocaleString()} archivos.`];
      if (titulos.length > 0) partes.push(`Volviendo a indexar: ${titulos.join(', ')}.`);
      setResultado(partes.join(' '));
      setConfirmar(null);
      await cargar();
    } catch {
      setError('Error de conexión');
    } finally {
      setGuardando(false);
    }
  };

  const pulsarGuardar = () => {
    if (nuevosIgnorados.length > 0) setConfirmar(nuevosIgnorados.map(t => t.titulo));
    else guardar();
  };

  if (cargando && !datos) {
    return <p className="text-nf-dim text-xs px-1 py-2">Cargando temas… (pregunta a Telegram, tarda unos segundos)</p>;
  }

  return (
    <div className="bg-black/20 rounded-xl px-4 py-3 space-y-3">
      {error && <p className="text-red-400 text-xs">{error}</p>}

      {datos && !datos.foro && (
        <p className="text-nf-dim text-xs">Este canal no tiene temas</p>
      )}

      {datos?.foro && (
        <>
          {datos.sin_leer > 0 && (
            <p className="text-yellow-400/90 text-[11px]">
              Hay {datos.sin_leer.toLocaleString()} archivos de los que aún no se sabe el tema; se irán leyendo solos
            </p>
          )}

          <div className="space-y-1">
            {temas.map(t => {
              const indexar = !ignorados.has(t.id);
              return (
                <label key={t.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5 cursor-pointer">
                  <input type="checkbox" checked={indexar} onChange={() => alternar(t.id)}
                    className="accent-nf-red w-4 h-4 shrink-0" />
                  <span className="text-nf-faint text-[10px] w-11 shrink-0">Indexar</span>
                  <span className={`text-sm truncate ${indexar ? 'text-white' : 'text-nf-dim line-through'}`}>{t.titulo}</span>
                  {t.general && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-nf-dim shrink-0">General</span>}
                  {t.cerrado && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-500/20 text-nf-dim shrink-0">Cerrado</span>}
                  <span className="text-nf-faint text-[11px] shrink-0 ml-auto">{t.indexados.toLocaleString()} indexados</span>
                </label>
              );
            })}
          </div>

          {confirmar && (
            <div className="bg-nf-red/10 border border-nf-red/30 rounded-xl px-4 py-3">
              <p className="text-white text-xs mb-3">
                Se quitarán del catálogo los archivos ya indexados de: {confirmar.join(', ')}
              </p>
              <div className="flex gap-2">
                <button onClick={guardar} disabled={guardando}
                  className="text-xs bg-nf-red hover:bg-nf-red-dark disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-all font-medium">
                  {guardando ? 'Guardando…' : 'Sí, quitar y guardar'}
                </button>
                <button onClick={() => setConfirmar(null)} disabled={guardando}
                  className="text-xs bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-all font-medium">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {!confirmar && (
            <div className="flex items-center gap-3">
              <button onClick={pulsarGuardar} disabled={!hayCambios || guardando}
                className="text-xs bg-nf-red hover:bg-nf-red-dark disabled:opacity-40 disabled:hover:bg-nf-red text-white px-4 py-2 rounded-lg transition-all font-medium">
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
              {cargando && <span className="text-nf-dim text-[11px]">Recargando temas…</span>}
            </div>
          )}

          {resultado && <p className="text-green-400 text-xs">{resultado}</p>}
        </>
      )}
    </div>
  );
}

export default function Channels({ embedded = false }: { embedded?: boolean } = {}) {
  const Wrap = embedded ? Embedded : Shell;
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [url, setUrl] = useState('');
  const [urlFeedback, setUrlFeedback] = useState('');
  const [toast, setToast] = useState('');

  const [stats, setStats] = useState<IndexStats | null>(null);
  const [progress, setProgress] = useState<ChannelProgress[]>([]);
  const [polling, setPolling] = useState(true);
  const [tmdbEnabled, setTmdbEnabled] = useState(false);
  const [tmdbRunning, setTmdbRunning] = useState(false);
  const [relectura, setRelectura] = useState<RelecturaEstado | null>(null);
  const [errorRelectura, setErrorRelectura] = useState('');
  // Canales con la lista de temas desplegada.
  const [temasAbiertos, setTemasAbiertos] = useState<Set<number>>(new Set());

  const alternarTemas = (id: number) => {
    setTemasAbiertos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const loadChannels = async () => {
    try {
      const res = await apiFetch('/channels');
      const data = await res.json();
      const list: Channel[] = data.channels || [];
      setChannels(list);
      setActiveIds(new Set(list.map(c => c.id)));
    } catch {}
  };

  const loadIndexInfo = async () => {
    try {
      const [statsRes, progRes, statusRes] = await Promise.all([
        apiFetch('/index/stats'),
        apiFetch('/index/progress'),
        apiFetch('/index/status'),
      ]);
      const s = await statsRes.json();
      const p = await progRes.json();
      const st = await statusRes.json();
      setStats(s);
      setProgress(p.channels || []);
      const running = (p.channels || []).some((c: ChannelProgress) =>
        c.status === 'running' || c.status === 'scanning' || c.phase === 'enriching'
      );
      setPolling(running);   // solo decide cada cuanto se pregunta, no si se pregunta
      setTmdbRunning(st.phase === 'enriching' && st.running);
    } catch {}
  };

  const loadRelectura = async () => {
    try {
      const res = await apiFetch('/index/relectura');
      if (res.ok) setRelectura(await res.json());
    } catch {}
  };

  useEffect(() => { loadChannels(); loadIndexInfo(); loadRelectura(); fetchConfig(); }, []);

  // La relectura lleva su propio ritmo: puede estar en marcha con el escaneo
  // parado (y al revés), así que no se cuelga del `polling` de arriba.
  useEffect(() => {
    const cada = relectura?.corriendo ? 5000 : 20000;
    const t = setInterval(() => { if (!document.hidden) loadRelectura(); }, cada);
    return () => clearInterval(t);
  }, [relectura?.corriendo]); // eslint-disable-line react-hooks/exhaustive-deps

  const releerAhora = async () => {
    setErrorRelectura('');
    try {
      const res = await apiFetch('/index/relectura', { method: 'POST' });
      if (!res.ok) { setErrorRelectura(await motivoDe(res)); return; }
      const r: { ok: boolean; ya_en_marcha?: boolean; error?: string } = await res.json();
      if (!r.ok) { setErrorRelectura(r.error || 'No se ha podido empezar la relectura'); return; }
      setToast(r.ya_en_marcha ? 'La relectura ya estaba en marcha' : 'Releyendo el contexto…');
      setTimeout(() => { setToast(''); loadRelectura(); }, 1500);
    } catch {
      setErrorRelectura('Error de conexión');
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await apiFetch('/config');
      const data = await res.json();
      setTmdbEnabled(data.config?.tmdb_enabled || false);
    } catch {}
  };

  const toggleTmdb = async () => {
    const newVal = !tmdbEnabled;
    setTmdbEnabled(newVal);
    await apiFetch('/config', {
      method: 'POST',
      body: JSON.stringify({ tmdb_enabled: newVal }),
    });
    setToast(newVal ? 'TMDB activado' : 'TMDB desactivado');
    if (newVal && stats && stats.total > 0 && stats.with_tmdb < stats.total) {
      await apiFetch('/index/enrich', { method: 'POST' });
    }
    setTimeout(() => setToast(''), 2000);
  };

  // Los contadores siguen moviendose cuando el escaneo ya ha terminado: los
  // mensajes nuevos se indexan en vivo y antes la cuenta se congelaba en el
  // numero que hubiera al acabar, hasta recargar la pagina. Mientras algo
  // escanea se pregunta a menudo; el resto del tiempo, de vez en cuando.
  useEffect(() => {
    const cada = polling ? 5000 : 20000;
    const interval = setInterval(() => { if (!document.hidden) loadIndexInfo(); }, cada);
    return () => clearInterval(interval);
  }, [polling]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: number) => {
    setActiveIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const saveChannels = async () => {
    const selected = channels.filter(c => activeIds.has(c.id)).map(c => ({ id: c.id, name: c.name }));
    await apiFetch('/config', { method: 'POST', body: JSON.stringify({ channels: selected }) });
    setToast('Guardado');
    setTimeout(() => setToast(''), 2000);
  };

  const addByUrl = async () => {
    if (!url.trim()) return;
    setUrlFeedback('Resolviendo...');
    try {
      const res = await apiFetch('/channels/add', { method: 'POST', body: JSON.stringify({ url: url.trim() }) });
      const data = await res.json();
      if (data.error) {
        setUrlFeedback(data.error);
      } else {
        setUrlFeedback(`${data.status === 'added' ? 'Anadido' : 'Actualizado'}: ${data.channel.name}`);
        setUrl('');
        setActiveIds(prev => new Set([...prev, data.channel.id]));
        await loadChannels();
        setTimeout(loadIndexInfo, 2000);
      }
    } catch {
      setUrlFeedback('Error de conexion');
    }
  };

  const scanAll = async () => {
    await apiFetch('/index/rescan', { method: 'POST' });
    setToast('Escaneo completo reiniciado');
    setPolling(true);
    setTimeout(() => { setToast(''); loadIndexInfo(); }, 2000);
  };

  const reclassify = async () => {
    const res = await apiFetch('/index/reclassify', { method: 'POST' });
    const data = await res.json();
    setToast(data.status === 'already_running' ? 'Ya hay una reclasificación en marcha' : 'Reclasificando catálogo...');
    setPolling(true);
    setTimeout(() => { setToast(''); loadIndexInfo(); }, 2000);
  };

  const scanChannel = async (channelId: number) => {
    await apiFetch(`/index/channel/${channelId}`, { method: 'POST' });
    setToast('Reescanear canal...');
    setPolling(true);
    setTimeout(() => { setToast(''); loadIndexInfo(); }, 2000);
  };

  const progressFor = (channelId: number) => progress.find(p => p.channel_id === channelId);
  const runningCount = progress.filter(p => p.status === 'running' || p.status === 'scanning').length;
  const releyendo = !!relectura?.corriendo;
  const contextoDe = (channelId: number) => relectura?.canales.find(c => c.channel_id === channelId);
  // Normalmente los dos listados traen los mismos canales; si la relectura
  // conoce uno que el escaneo no, se le hace tarjeta igual para no perderlo.
  const soloContexto = (relectura?.canales || []).filter(c => !progress.some(p => p.channel_id === c.channel_id));

  const active = channels.filter(c => activeIds.has(c.id));
  const inactive = channels.filter(c => !activeIds.has(c.id));

  useEffect(() => { if (!isAdmin) navigate('/'); }, [isAdmin, navigate]);
  if (!isAdmin) return null;

  return (
    <Wrap>
      <div className={embedded ? "" : "px-6 md:px-14 pt-24 pb-20 max-w-4xl mx-auto"}>
        {toast && (
          <div className="fixed top-24 right-6 z-50 bg-green-600/90 backdrop-blur-xl border border-green-400/20 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium animate-slide-up">
            {toast}
          </div>
        )}

        {/* Index Stats */}
        {stats && (
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white text-lg font-medium">
                Contenido indexado
                {(runningCount > 0 || releyendo) && (
                  <span className="ml-2 inline-flex items-center gap-1 text-yellow-400 text-xs font-normal">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-yellow-400" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
                    </span>
                    {runningCount > 0 ? 'Indexando...' : 'Releyendo contexto…'}
                  </span>
                )}
              </h2>
              <div className="flex gap-2">
                <button onClick={releerAhora} disabled={releyendo}
                  title="Vuelve a leer en Telegram lo ya indexado para ponerle la ficha y el pie de cada archivo, y busca otra vez en TMDB lo que no tenía ficha"
                  className="text-xs bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10 text-white px-4 py-2 rounded-lg transition-all font-medium">
                  {releyendo ? 'Releyendo…' : 'Releer ahora'}
                </button>
                <button onClick={reclassify} title="Vuelve a decidir qué es película y qué es serie con las reglas actuales y corrige los emparejamientos con TMDB"
                  className="text-xs bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-all font-medium">
                  Reclasificar catálogo
                </button>
                <button onClick={scanAll} className="text-xs bg-nf-red hover:bg-nf-red-dark text-white px-4 py-2 rounded-lg transition-all font-medium">
                  Reescanear todo
                </button>
              </div>
            </div>
            {errorRelectura && <p className="text-red-400 text-xs mb-3">{errorRelectura}</p>}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="bg-black/20 rounded-xl p-3 text-center">
                <p className="text-white text-xl font-bold">{stats.total.toLocaleString()}</p>
                <p className="text-nf-dim text-[11px]">Total</p>
              </div>
              <div className="bg-black/20 rounded-xl p-3 text-center">
                <p className="text-white text-xl font-bold">{stats.movies.toLocaleString()}</p>
                <p className="text-nf-dim text-[11px]">Películas</p>
              </div>
              <div className="bg-black/20 rounded-xl p-3 text-center">
                <p className="text-white text-xl font-bold">{stats.series.toLocaleString()}</p>
                <p className="text-nf-dim text-[11px]">Series</p>
              </div>
              <div className="bg-black/20 rounded-xl p-3 text-center">
                <p className="text-white text-xl font-bold">{stats.with_tmdb.toLocaleString()}</p>
                <p className="text-nf-dim text-[11px]">Con TMDB</p>
              </div>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-nf-dim text-xs flex items-center gap-2">
                  Progreso TMDB
                  {tmdbRunning && (
                    <span className="inline-flex items-center gap-1 text-yellow-400">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-yellow-400" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-yellow-500" />
                      </span>
                      <span className="text-[10px]">Enriqueciendo...</span>
                    </span>
                  )}
                </span>
                <span className="text-nf-dim text-xs">
                  {stats.with_tmdb.toLocaleString()} encontrados · {(stats.tmdb_searched || 0).toLocaleString()} / {stats.total.toLocaleString()} procesados ({Math.round(((stats.tmdb_searched || 0) / Math.max(stats.total, 1)) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-nf-red rounded-full transition-all duration-1000" style={{
                  width: `${((stats.tmdb_searched || 0) / Math.max(stats.total, 1)) * 100}%`,
                  background: (stats.tmdb_searched || 0) === stats.total ? '#2ECC40' : tmdbRunning ? '#F5A623' : '#E50914',
                }} />
              </div>
            </div>

            {relectura && !relectura.corriendo && relectura.siguiente && (
              <p className="text-nf-faint text-[11px] mb-3">
                La siguiente relectura empieza sola a las {hora(relectura.siguiente)}
              </p>
            )}

            {(progress.length > 0 || soloContexto.length > 0) && (
              <div className="space-y-2">
                {progress.map(prog => {
                  const chCount = (stats?.by_channel || []).find(c => c.channel_id === prog.channel_id)?.count || 0;
                  const isScanning = prog.status === 'running' || prog.status === 'scanning';
                  const pct = (prog.total_estimate || 0) > 0
                    ? Math.round(((prog.total_scanned || 0) / (prog.total_estimate || 1)) * 100)
                    : 0;
                  const contexto = contextoDe(prog.channel_id);
                  return (
                    <div key={prog.channel_id} className="bg-black/20 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-white text-sm truncate">{prog.channel_name}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ml-2 ${
                          isScanning ? 'bg-yellow-500/20 text-yellow-400'
                          : prog.status === 'done' ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-500/20 text-nf-dim'
                        }`}>
                          {isScanning ? 'Escaneando...' : prog.status === 'done' ? 'Completado' : prog.status === 'pending' ? 'Pendiente' : prog.status}
                        </span>
                      </div>

                      {(prog.total_estimate || 0) > 0 && (
                        <div className="mb-1.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-nf-faint text-[10px]">
                              {(prog.total_scanned || 0).toLocaleString()} / {(prog.total_estimate || 0).toLocaleString()} msgs
                            </span>
                            <span className="text-nf-dim text-[10px]">{pct}%</span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-700 ${isScanning ? 'bg-yellow-500' : prog.status === 'done' ? 'bg-green-500' : 'bg-gray-600'}`} style={{
                              width: `${Math.min(pct, 100)}%`,
                            }} />
                          </div>
                        </div>
                      )}

                      {contexto && <LineaContexto c={contexto} />}

                      <div className="flex items-center gap-4 text-[11px]">
                        <span className="text-green-400">{chCount.toLocaleString()} con media</span>
                        {prog.total_indexed != null && prog.total_indexed > 0 && (
                          <span className="text-nf-faint">{((prog.total_indexed || 0) - chCount).toLocaleString()} sin media</span>
                        )}
                        {prog.total_scanned != null && prog.total_scanned > 0 && (
                          <span className="text-nf-faint">{prog.total_scanned?.toLocaleString()} total escaneados</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {soloContexto.map(c => (
                  <div key={`ctx-${c.channel_id}`} className="bg-black/20 rounded-xl px-4 py-3">
                    <p className="text-white text-sm truncate mb-2">{c.nombre}</p>
                    <LineaContexto c={c} />
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between py-3 border-t border-white/5 mt-4">
              <div className="flex items-center gap-3">
                <span className="text-nf-dim text-sm">TMDB</span>
                <button onClick={toggleTmdb}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 flex items-center px-0.5 ${tmdbEnabled ? 'bg-green-500 justify-end' : 'bg-white/20 justify-start'}`}>
                  <span className="w-5 h-5 rounded-full bg-white shadow transition-all duration-200" />
                </button>
                <span className={`text-xs ${tmdbEnabled ? 'text-green-400' : 'text-nf-faint'}`}>
                  {tmdbEnabled ? 'Activado' : 'Desactivado'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
          <h2 className="text-white text-lg font-medium mb-4">Anadir canal por URL</h2>
          <div className="flex gap-3">
            <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addByUrl()}
              placeholder="https://t.me/c/123456789 o https://t.me/NombreCanal"
              className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-white/25 transition-all placeholder-gray-500" />
            <button onClick={addByUrl}
              className="bg-nf-red hover:bg-nf-red-dark text-white px-6 py-3 rounded-xl font-medium text-sm transition-all hover:scale-105 shadow-lg shadow-nf-red/20">
              Anadir
            </button>
          </div>
          {urlFeedback && (
            <p className={`mt-3 text-xs ${urlFeedback.includes('Error') || urlFeedback.includes('URL') ? 'text-red-400' : 'text-green-400'}`}>
              {urlFeedback}
            </p>
          )}
        </div>

        {active.length > 0 && (
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
            <h2 className="text-white text-lg font-medium mb-4">Activos ({active.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* La tarjeta ya no es un botón entero: dentro va «Temas», y un
                  botón no puede ir dentro de otro. Con los temas abiertos ocupa
                  las dos columnas, que en media no caben títulos y contadores. */}
              {active.map(c => {
                const abierto = temasAbiertos.has(c.id);
                return (
                  <div key={c.id} className={abierto ? 'md:col-span-2 space-y-2' : ''}>
                    <div className="flex items-center gap-2 bg-nf-red/10 border border-nf-red/20 rounded-xl pl-4 pr-2 py-2 hover:bg-nf-red/15 transition-all">
                      <button onClick={() => toggle(c.id)} title="Desactivar canal"
                        className="flex items-center gap-3 flex-1 min-w-0 py-1 text-left">
                        <span className="text-white text-sm truncate font-medium">{c.name}</span>
                        <span className="text-nf-dim text-[10px] shrink-0 ml-auto">{c.id}</span>
                      </button>
                      <button onClick={() => alternarTemas(c.id)}
                        className={`text-[11px] px-3 py-1.5 rounded-lg transition-all font-medium shrink-0 ${abierto ? 'bg-white/20 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
                        Temas
                      </button>
                    </div>
                    {abierto && <TemasCanal channelId={c.id} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {inactive.length > 0 && (
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
            <h2 className="text-white text-lg font-medium mb-4">Inactivos ({inactive.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {inactive.map(c => (
                <button key={c.id} onClick={() => toggle(c.id)}
                  className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all text-left">
                  <span className="text-nf-dim text-sm truncate">{c.name}</span>
                  <span className="text-nf-faint text-[10px] shrink-0 ml-auto">{c.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={saveChannels}
          className="bg-nf-red hover:bg-nf-red-dark text-white px-8 py-3.5 rounded-xl font-semibold transition-all hover:scale-105 shadow-lg shadow-nf-red/20">
          Guardar
        </button>
      </div>
    </Wrap>
  );
}
