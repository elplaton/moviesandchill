import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../services/api';
import { buscarEnTmdb, type ResultadoTmdb } from '../../services/peticiones';

type ClaveMotivo = 'sin_ficha' | 'tipo_cruzado' | 'dudosa' | 'sin_caratula';
type Tipo = 'movie' | 'series';

interface Motivo {
  clave: ClaveMotivo;
  titulo: string;
  descripcion: string;
  grupos: number;
  archivos: number;
  sugeridas: number;
}

/** Cómo va la revisión automática (backend/app/services/revision_auto.py). */
interface EstadoAuto {
  corriendo: boolean;
  empezo: number | null;
  termino: number | null;
  mirados: number;
  por_mirar: number;
  cuentas: Record<string, { grupos: number; archivos: number }>;
}

interface Resumen {
  motivos: Motivo[];
  canales: { channel_id: number; nombre: string }[];
  auto: EstadoAuto;
}

/** La candidata que encontró la revisión automática y no era segura. */
interface Sugerencia {
  tmdb_id: number;
  media_type: Tipo;
  title: string;
  year: number | null;
  poster: string | null;
  original_title?: string | null;
  porque: string | null;
}

/** Algo que se corrigió solo (o una sugerencia aceptada), con su deshacer. */
interface Aplicada {
  id: number;
  titulo: string;
  motivo: ClaveMotivo;
  porque: string | null;
  ficha: Sugerencia | null;
  archivos: number;
  creado: string;
}

interface FichaActual {
  tmdb_id: number;
  media_type: Tipo;
  title: string;
  year: number | null;
  poster: string | null;
}

interface Grupo {
  clave: string;
  motivo: ClaveMotivo;
  titulo: string;
  tipo: Tipo;
  año: number | null;
  archivos: number;
  canales: string[];
  ejemplo: string;
  ficha: string | null;
  pie: string | null;
  actual: FichaActual | null;
  sugerencia: Sugerencia | null;
  /** Lo que se pone en el buscador de «Corregir» (vacío en los capítulos sin nombre de serie). */
  busqueda?: string;
  /** Capítulos sin nombre de serie: unos cuantos archivos del grupo, para ver que son de lo mismo. */
  ejemplos?: string[] | null;
}

const CARD = 'bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl';
const BOTON = 'bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white px-4 py-2 rounded-xl font-medium text-sm transition-all';
const ROJO = 'bg-nf-red hover:bg-nf-red-dark disabled:opacity-40 text-white px-4 py-2 rounded-xl font-medium text-sm transition-all';
const CAMPO = 'bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-white/25 transition-all placeholder-gray-500';
const POR_PAGINA = 30;
// Lo que tiene ficha de TMDB y por eso merece enseñarla: en «Sin ficha» no hay.
const CON_FICHA: ClaveMotivo[] = ['tipo_cruzado', 'dudosa', 'sin_caratula'];

const tipoTexto = (t: Tipo) => (t === 'series' ? 'Serie' : 'Película');
const archivosTexto = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'archivo' : 'archivos'}`;
const conAño = (t: string, año: number | null) => (año ? `${t} (${año})` : t);

/** La carátula llega entera de /peticiones/buscar y a veces como ruta de
 *  TMDB a secas desde la caché: las dos tienen que pintarse. */
function imagen(p: string | null): string | null {
  if (!p) return null;
  return p.startsWith('http') ? p : `https://image.tmdb.org/t/p/w92${p}`;
}

/** Lo que no es 2xx no lanza en apiFetch: el motivo viene en `detail`. */
async function motivoDe(res: Response): Promise<string> {
  try {
    const d = await res.json();
    if (typeof d?.detail === 'string') return d.detail;
    if (typeof d?.error === 'string') return d.error;
  } catch { /* sin cuerpo */ }
  return `Error ${res.status}`;
}

function Caratula({ src, className }: { src: string | null; className: string }) {
  const url = imagen(src);
  return (
    <div className={`${className} shrink-0 overflow-hidden rounded bg-white/5`}>
      {url && <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />}
    </div>
  );
}

/** La ficha o el pie que puso el canal. Hay fichas de veinte líneas
 *  (sinopsis, reparto, enlaces), así que se recortan y se despliegan a mano:
 *  lo que hace falta casi siempre es la primera línea, que es el título. */
function TextoCanal({ etiqueta, texto }: { etiqueta: string; texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const largo = texto.length > 200 || texto.split('\n').length > 3;
  const visible = abierto || !largo ? texto : `${texto.split('\n').slice(0, 3).join('\n').slice(0, 200).trimEnd()}…`;
  return (
    <div className="rounded-xl bg-black/20 px-3 py-2">
      <p className="text-nf-faint text-[10px] uppercase tracking-wide mb-0.5">{etiqueta}</p>
      <p className="text-nf-dim text-xs whitespace-pre-line break-words">{visible}</p>
      {largo && (
        <button onClick={() => setAbierto(a => !a)} className="mt-1 text-[11px] text-nf-dim hover:text-white">
          {abierto ? 'Ver menos' : 'Ver todo'}
        </button>
      )}
    </div>
  );
}

/**
 * La sugerencia de la revisión automática para un grupo: lo que encontró en
 * TMDB y por qué no se atrevió a ponerlo solo. «Sí, es esta» la pone (y queda
 * en «Corregido solo», con su deshacer); «No es esta» la quita y no vuelve a
 * sugerirse, y el grupo se queda para corregirlo a mano.
 */
function CajaSugerencia({ g, onAceptada, onDescartada }: {
  g: Grupo & { sugerencia: Sugerencia };
  onAceptada: (archivos: number) => void;
  onDescartada: () => void;
}) {
  const [haciendo, setHaciendo] = useState<'' | 'si' | 'no'>('');
  const [error, setError] = useState('');
  const s = g.sugerencia;

  const mandar = async (que: 'aceptar' | 'descartar') => {
    setHaciendo(que === 'aceptar' ? 'si' : 'no');
    setError('');
    try {
      const res = await apiFetch(`/admin/revision/sugerencia/${que}`, { method: 'POST', body: JSON.stringify({ clave: g.clave }) });
      if (!res.ok) { setError(await motivoDe(res)); setHaciendo(''); return; }
      const r: { archivos?: number } = await res.json();
      if (que === 'aceptar') onAceptada(r.archivos ?? g.archivos); else onDescartada();
    } catch {
      setError('Error de conexión');
      setHaciendo('');
    }
  };

  return (
    <div className="mt-3 flex gap-3 items-center rounded-xl border border-nf-ok/25 bg-nf-ok/[0.07] px-3 py-3">
      <Caratula src={s.poster} className="h-16 w-11" />
      <div className="min-w-0 flex-1">
        <p className="text-nf-faint text-[10px] uppercase tracking-wide">Sugerencia</p>
        <p className="text-white text-sm truncate">
          {conAño(s.title, s.year)} <span className="text-nf-dim text-xs">· {tipoTexto(s.media_type)}</span>
        </p>
        {s.porque && <p className="text-nf-dim text-[11px] truncate">{s.porque}</p>}
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => mandar('aceptar')} disabled={!!haciendo} className={ROJO}>
          {haciendo === 'si' ? 'Poniendo…' : 'Sí, es esta'}
        </button>
        <button onClick={() => mandar('descartar')} disabled={!!haciendo} className={BOTON}>
          {haciendo === 'no' ? '…' : 'No es esta'}
        </button>
      </div>
    </div>
  );
}

const hace = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
};

/**
 * «Corregido solo»: lo que puso la revisión automática (y las sugerencias
 * aceptadas), lo más nuevo primero. Deshacer devuelve cada archivo a como
 * estaba y el grupo no se vuelve a tocar ni a sugerir.
 */
function Corregidas({ onToast, onCambio }: { onToast: (m: string) => void; onCambio: () => void }) {
  const [items, setItems] = useState<Aplicada[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [deshaciendo, setDeshaciendo] = useState<number | null>(null);

  const cargar = useCallback(async (offset: number) => {
    setCargando(true);
    setError('');
    try {
      const res = await apiFetch(`/admin/revision/auto?offset=${offset}&limit=${POR_PAGINA}`);
      if (!res.ok) { setError(await motivoDe(res)); return; }
      const d: { total: number; items: Aplicada[] } = await res.json();
      setTotal(d.total);
      setItems(prev => (offset === 0 ? d.items : [...prev, ...d.items.filter(x => !prev.some(p => p.id === x.id))]));
    } catch {
      setError('Error de conexión');
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { cargar(0); }, [cargar]);

  const deshacer = async (a: Aplicada) => {
    setDeshaciendo(a.id);
    try {
      const res = await apiFetch('/admin/revision/auto/deshacer', { method: 'POST', body: JSON.stringify({ id: a.id }) });
      if (!res.ok) { onToast(await motivoDe(res)); return; }
      setItems(prev => prev.filter(x => x.id !== a.id));
      setTotal(t => Math.max(0, t - 1));
      onCambio();
      onToast(`«${a.titulo}» vuelve a como estaba (${archivosTexto(a.archivos)})`);
    } catch {
      onToast('Error de conexión');
    } finally {
      setDeshaciendo(null);
    }
  };

  return (
    <div className={CARD}>
      <h2 className="text-white text-lg font-semibold mb-1">
        {cargando && !items.length ? 'Cargando…' : `${total.toLocaleString()} corregidos solos`}
      </h2>
      <p className="text-nf-dim text-sm mb-4">
        Lo que la revisión automática puso sin preguntar, porque el título era exactamente el de TMDB y el año o los
        capítulos cuadraban. Si alguno está mal, «Deshacer» lo deja como estaba y no se vuelve a tocar.
      </p>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {!cargando && !items.length && !error && <p className="text-nf-dim text-sm">Todavía no se ha corregido nada solo.</p>}
      <ul className="divide-y divide-white/5">
        {items.map(a => (
          <li key={a.id} className="flex items-center gap-3 py-3">
            <Caratula src={a.ficha?.poster ?? null} className="h-14 w-10" />
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm truncate">
                {a.ficha ? conAño(a.ficha.title, a.ficha.year) : a.titulo}
                {a.ficha && <span className="text-nf-dim text-xs"> · {tipoTexto(a.ficha.media_type)}</span>}
              </p>
              <p className="text-nf-dim text-xs truncate">
                Era «{a.titulo}» · {archivosTexto(a.archivos)} · {hace(a.creado)}
              </p>
              {a.porque && <p className="text-nf-faint text-[11px] truncate">{a.porque}</p>}
            </div>
            <button onClick={() => deshacer(a)} disabled={deshaciendo !== null} className={BOTON}>
              {deshaciendo === a.id ? 'Deshaciendo…' : 'Deshacer'}
            </button>
          </li>
        ))}
      </ul>
      {!cargando && items.length < total && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => cargar(items.length)} className={BOTON}>
            Cargar más ({(total - items.length).toLocaleString()} más)
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * El panel de «Corregir»: buscar en TMDB la ficha buena y ponérsela a todo el
 * grupo. Se busca al pulsar y no por tecla, porque cada búsqueda es una
 * consulta a TMDB; el campo llega relleno con el título que dice el canal,
 * que es lo que casi siempre hay que buscar.
 */
function Corregir({ grupo, onCerrar, onHecho }: {
  grupo: Grupo;
  onCerrar: () => void;
  onHecho: (archivos: number, ficha: ResultadoTmdb) => void;
}) {
  const [q, setQ] = useState(grupo.busqueda ?? grupo.titulo);
  const [resultados, setResultados] = useState<ResultadoTmdb[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<ResultadoTmdb | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !guardando) onCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar, guardando]);

  const buscar = async () => {
    if (!q.trim()) return;
    setBuscando(true);
    setError('');
    setElegido(null);
    try { setResultados(await buscarEnTmdb(q.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido buscar en TMDB'); }
    setBuscando(false);
  };

  const asignar = async () => {
    if (!elegido) return;
    setGuardando(true);
    setError('');
    try {
      const res = await apiFetch('/admin/revision/asignar', {
        method: 'POST',
        body: JSON.stringify({ clave: grupo.clave, tmdb_id: elegido.tmdb_id, media_type: elegido.media_type }),
      });
      if (!res.ok) { setError(await motivoDe(res)); setGuardando(false); return; }
      const r: { ok: boolean; archivos: number } = await res.json();
      onHecho(r.archivos, elegido);
    } catch {
      setError('Error de conexión');
      setGuardando(false);
    }
  };

  return (
    // El fondo cierra; el panel corta el clic para que elegir un resultado no
    // lo cierre también.
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm px-4 pt-20 pb-10 animate-fade-in"
      onClick={() => { if (!guardando) onCerrar(); }}>
      <div className="w-full max-w-2xl max-h-full flex flex-col rounded-2xl border border-white/10 bg-nf-surface shadow-panel animate-scale-in"
        onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 border-b border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-white text-lg font-semibold truncate">Corregir «{conAño(grupo.titulo, grupo.año)}»</h2>
              <p className="text-nf-dim text-xs mt-0.5">
                {tipoTexto(grupo.tipo)} · {archivosTexto(grupo.archivos)}
              </p>
              <p className="text-nf-faint text-[11px] font-mono truncate mt-1">{grupo.ejemplo}</p>
            </div>
            <button onClick={onCerrar} disabled={guardando} aria-label="Cerrar"
              className="text-nf-dim hover:text-white text-xl leading-none disabled:opacity-40">×</button>
          </div>
          <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); buscar(); }}>
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Título a buscar"
              className={`${CAMPO} flex-1 min-w-0`} />
            <button type="submit" disabled={buscando || !q.trim()} className={ROJO}>
              {buscando ? 'Buscando…' : 'Buscar en TMDB'}
            </button>
          </form>
          {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
        </div>

        {elegido ? (
          <div className="px-6 py-5">
            <div className="flex gap-4 items-center rounded-xl border border-nf-red/30 bg-nf-red/10 px-4 py-4">
              <Caratula src={elegido.poster} className="h-20 w-14" />
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm">
                  Poner «{conAño(elegido.title, elegido.year)}» a {archivosTexto(grupo.archivos)}
                </p>
                <p className="text-nf-dim text-xs mt-1">
                  {tipoTexto(elegido.media_type)}. Quedan marcados como corregidos a mano: ni la relectura ni
                  «Reclasificar catálogo» los volverán a cambiar.
                </p>
                <div className="flex gap-2 mt-3">
                  <button onClick={asignar} disabled={guardando} className={ROJO}>
                    {guardando ? 'Poniendo…' : 'Sí, poner esta ficha'}
                  </button>
                  <button onClick={() => setElegido(null)} disabled={guardando} className={BOTON}>Elegir otra</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-y-auto px-3 py-3">
            {resultados === null && !buscando && (
              <p className="px-3 py-2 text-nf-faint text-sm">Busca en TMDB y elige la ficha que le corresponde.</p>
            )}
            {resultados?.length === 0 && (
              <p className="px-3 py-2 text-nf-faint text-sm">TMDB no encuentra nada con eso. Prueba con el título original o sin el año.</p>
            )}
            <ul className="divide-y divide-white/5">
              {resultados?.map(r => (
                <li key={`${r.media_type}:${r.tmdb_id}`}>
                  <button onClick={() => setElegido(r)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5 transition-colors">
                    <Caratula src={r.poster} className="h-16 w-11" />
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm truncate">{conAño(r.title, r.year)}</p>
                      {r.original_title && r.original_title !== r.title && (
                        <p className="text-nf-dim text-xs truncate">{r.original_title}</p>
                      )}
                      {r.overview && <p className="text-nf-faint text-[11px] truncate mt-0.5">{r.overview}</p>}
                    </div>
                    <div className="shrink-0 text-right space-y-1">
                      <span className="block text-xs text-nf-dim">{tipoTexto(r.media_type)}</span>
                      {/* En «Tipo cruzado» el tipo es justo lo que se discute:
                          que se vea cuándo la ficha elegida le lleva la contraria. */}
                      {r.media_type !== grupo.tipo && (
                        <span className="block text-[10px] text-nf-warn">el archivo parece {tipoTexto(grupo.tipo).toLowerCase()}</span>
                      )}
                      {r.en_catalogo && <span className="block text-[10px] text-nf-ok">ya en el catálogo</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Revisión: lo mal indexado, agrupado por título, para corregirlo a mano
 * (ver backend/app/services/revision.py).
 *
 * Existe porque lo que falla al indexar no se ve desde la portada: lo que no
 * tiene ficha no sale, y lo que tiene la de otra película sale con una
 * carátula que parece buena. Se trabaja por grupos y no por archivo porque
 * una serie sin ficha son doscientos capítulos y un solo arreglo.
 */
export default function AdminRevision({ onToast }: { onToast: (m: string) => void }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [errorResumen, setErrorResumen] = useState('');
  const [motivo, setMotivo] = useState<ClaveMotivo>('sin_ficha');
  // «Corregido solo» en vez de la lista de un motivo.
  const [verCorregidas, setVerCorregidas] = useState(false);
  const [soloSugeridas, setSoloSugeridas] = useState(false);
  const [lanzando, setLanzando] = useState(false);
  const [canal, setCanal] = useState('');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState('');
  const [corrigiendo, setCorrigiendo] = useState<Grupo | null>(null);
  // El grupo que está pidiendo confirmación para ignorarse, y si ya va.
  const [ignorar, setIgnorar] = useState<string | null>(null);
  const [ignorando, setIgnorando] = useState(false);
  // Cada lista pedida lleva su número: una respuesta atrasada (de otro motivo
  // u otra búsqueda) no pisa a la que se está esperando.
  const peticion = useRef(0);

  const cargarResumen = useCallback(async () => {
    try {
      const res = await apiFetch('/admin/revision/resumen');
      if (!res.ok) { setErrorResumen(await motivoDe(res)); return; }
      setResumen(await res.json());
      setErrorResumen('');
    } catch {
      setErrorResumen('Error de conexión');
    }
  }, []);
  useEffect(() => { cargarResumen(); }, [cargarResumen]);

  // Buscar es local al servidor (no TMDB), así que basta con no pedir una
  // lista por tecla.
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const cargar = useCallback(async (offset: number) => {
    const n = ++peticion.current;
    if (offset === 0) { setCargando(true); setIgnorar(null); } else setCargandoMas(true);
    setError('');
    const params = new URLSearchParams({ motivo, offset: String(offset), limit: String(POR_PAGINA) });
    if (canal) params.set('channel_id', canal);
    if (q) params.set('q', q);
    if (soloSugeridas) params.set('sugeridas', 'true');
    try {
      const res = await apiFetch(`/admin/revision?${params}`);
      if (n !== peticion.current) return;
      if (!res.ok) { setError(await motivoDe(res)); return; }
      const d: { total: number; grupos: Grupo[] } = await res.json();
      if (n !== peticion.current) return;
      setTotal(d.total);
      setGrupos(prev => (offset === 0 ? d.grupos : [...prev, ...d.grupos.filter(g => !prev.some(p => p.clave === g.clave))]));
    } catch {
      if (n === peticion.current) setError('Error de conexión');
    } finally {
      if (n === peticion.current) { setCargando(false); setCargandoMas(false); }
    }
  }, [motivo, canal, q, soloSugeridas]);

  // Mientras la revisión automática está en marcha, el resumen se vuelve a
  // pedir cada pocos segundos (cuántos lleva) y, al acabar, la lista.
  const corriendo = !!resumen?.auto?.corriendo;
  useEffect(() => {
    if (!corriendo) return;
    const t = setInterval(cargarResumen, 4000);
    return () => clearInterval(t);
  }, [corriendo, cargarResumen]);
  const estabaCorriendo = useRef(false);
  useEffect(() => {
    if (estabaCorriendo.current && !corriendo) cargar(0);
    estabaCorriendo.current = corriendo;
  }, [corriendo]); // eslint-disable-line react-hooks/exhaustive-deps

  const revisarAhora = async () => {
    setLanzando(true);
    try {
      const res = await apiFetch('/admin/revision/auto/lanzar', { method: 'POST' });
      if (!res.ok) onToast(await motivoDe(res));
      else await cargarResumen();
    } catch {
      onToast('Error de conexión');
    } finally {
      setLanzando(false);
    }
  };

  // La lista espera al resumen: los dos salen del mismo cálculo, que la
  // primera vez tarda unos segundos, y pedirlos a la vez lo haría dos veces.
  const listo = resumen !== null;
  useEffect(() => { if (listo) cargar(0); }, [listo, cargar]);

  /** Tras corregir o ignorar: fuera de la lista y contadores al día. */
  const quitar = (clave: string) => {
    setGrupos(prev => prev.filter(g => g.clave !== clave));
    setTotal(t => Math.max(0, t - 1));
    cargarResumen();
  };

  const confirmarIgnorar = async (g: Grupo) => {
    setIgnorando(true);
    setError('');
    try {
      const res = await apiFetch('/admin/revision/ignorar', { method: 'POST', body: JSON.stringify({ clave: g.clave }) });
      if (!res.ok) { setError(await motivoDe(res)); return; }
      const r: { ok: boolean; archivos: number } = await res.json();
      quitar(g.clave);
      setIgnorar(null);
      onToast(`«${g.titulo}» ignorado (${archivosTexto(r.archivos)})`);
    } catch {
      setError('Error de conexión');
    } finally {
      setIgnorando(false);
    }
  };

  const cerrarCorregir = useCallback(() => setCorrigiendo(null), []);

  if (!resumen) {
    return (
      <div className={CARD}>
        {errorResumen ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-red-400 text-sm">{errorResumen}</p>
            <button onClick={cargarResumen} className={BOTON}>Reintentar</button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 rounded-full border-2 border-white/20 border-t-nf-red animate-spin" />
            <p className="text-nf-dim text-sm">Revisando el catálogo… la primera vez tarda unos segundos.</p>
          </div>
        )}
      </div>
    );
  }

  const elegido = resumen.motivos.find(m => m.clave === motivo);
  const conFicha = CON_FICHA.includes(motivo);

  const auto = resumen.auto;
  const aplicadas = auto?.cuentas?.aplicada;
  const sugeridas = auto?.cuentas?.sugerida;

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-white text-base font-semibold">Revisión automática</h2>
            <p className="text-nf-dim text-sm mt-0.5">
              {auto?.corriendo
                ? `Revisando… ${auto.mirados.toLocaleString()} de ${auto.por_mirar.toLocaleString()} grupos`
                : `${(aplicadas?.grupos ?? 0).toLocaleString()} grupos corregidos solos (${archivosTexto(aplicadas?.archivos ?? 0)})`
                  + ` · ${(sugeridas?.grupos ?? 0).toLocaleString()} con sugerencia`}
            </p>
            <p className="text-nf-faint text-[11px] mt-1">
              Lo que coincide exactamente con TMDB (título, y año o capítulos) se pone solo; lo dudoso queda
              aquí con su sugerencia. Mira lo nuevo al arrancar y cada 6 h.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setVerCorregidas(v => !v)} className={BOTON}>
              {verCorregidas ? 'Volver a la revisión' : 'Ver lo corregido solo'}
            </button>
            <button onClick={revisarAhora} disabled={lanzando || !!auto?.corriendo} className={ROJO}>
              {auto?.corriendo ? 'Revisando…' : lanzando ? 'Lanzando…' : 'Revisar ahora'}
            </button>
          </div>
        </div>
      </div>

      {verCorregidas ? (
        <Corregidas onToast={onToast} onCambio={() => { cargarResumen(); cargar(0); }} />
      ) : (<>
      <div className={CARD}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {resumen.motivos.map(m => {
            const activo = m.clave === motivo;
            return (
              <button key={m.clave} onClick={() => setMotivo(m.clave)}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${activo
                  ? 'border-nf-red/50 bg-nf-red/10'
                  : 'border-white/10 bg-black/20 hover:bg-white/5'}`}>
                <p className={`text-sm font-medium ${activo ? 'text-white' : 'text-nf-dim'}`}>{m.titulo}</p>
                <p className="text-white text-xl font-bold mt-1 tabular-nums">{m.grupos.toLocaleString()}</p>
                <p className="text-nf-faint text-[11px]">
                  {m.grupos === 1 ? 'grupo' : 'grupos'} · {archivosTexto(m.archivos)}
                </p>
                {m.sugeridas > 0 && (
                  <p className="text-nf-ok/80 text-[11px]">{m.sugeridas.toLocaleString()} con sugerencia</p>
                )}
              </button>
            );
          })}
        </div>
        {elegido && <p className="text-nf-dim text-sm mt-4">{elegido.descripcion}</p>}

        <div className="flex flex-wrap gap-3 mt-4">
          <select value={canal} onChange={e => setCanal(e.target.value)} className={`${CAMPO} pr-8`}>
            <option value="" className="bg-nf-surface">Todos los canales</option>
            {resumen.canales.map(c => (
              <option key={c.channel_id} value={String(c.channel_id)} className="bg-nf-surface">{c.nombre}</option>
            ))}
          </select>
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar por título o archivo"
            className={`${CAMPO} flex-1 min-w-[220px]`} />
          <label className="flex items-center gap-2 text-sm text-nf-dim cursor-pointer select-none">
            <input type="checkbox" checked={soloSugeridas} onChange={e => setSoloSugeridas(e.target.checked)}
              className="accent-nf-red" />
            Solo con sugerencia
          </label>
        </div>
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-white text-lg font-semibold">
            {cargando ? 'Cargando…' : `${total.toLocaleString()} ${total === 1 ? 'grupo' : 'grupos'}`}
          </h2>
          <button onClick={() => { cargarResumen(); cargar(0); }} disabled={cargando}
            className="text-nf-dim hover:text-nf-text text-sm transition-colors disabled:opacity-40">
            Actualizar
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

        {!cargando && grupos.length === 0 && !error && (
          <p className="text-nf-dim text-sm">
            {q || canal ? 'Nada con ese filtro.' : 'No queda nada aquí.'}
          </p>
        )}

        <ul className="space-y-3">
          {grupos.map(g => (
            <li key={g.clave} className="rounded-xl border border-white/10 bg-black/20 px-4 py-4">
              <div className="flex gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="text-white text-sm font-medium">
                      {g.titulo}
                      {g.año ? <span className="text-nf-dim font-normal"> ({g.año})</span> : null}
                      <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-normal text-nf-dim align-middle">
                        {tipoTexto(g.tipo)}
                      </span>
                    </p>
                    <p className="text-nf-dim text-xs mt-0.5">
                      {archivosTexto(g.archivos)}{g.canales.length > 0 && ` · ${g.canales.join(', ')}`}
                    </p>
                    {(g.ejemplos?.length ? g.ejemplos : [g.ejemplo]).map((e, i) => (
                      <p key={i} className="text-nf-faint text-[11px] font-mono break-all mt-1">{e}</p>
                    ))}
                  </div>
                  {g.ficha && <TextoCanal etiqueta="Ficha del canal" texto={g.ficha} />}
                  {g.pie && <TextoCanal etiqueta="Pie del archivo" texto={g.pie} />}
                </div>

                {conFicha && g.actual && (
                  <div className="w-44 shrink-0">
                    <p className="text-nf-faint text-[10px] uppercase tracking-wide mb-1">Ficha actual</p>
                    <div className="flex gap-2">
                      <Caratula src={g.actual.poster} className="h-16 w-11" />
                      <div className="min-w-0">
                        <p className="text-nf-text text-xs line-clamp-3">{g.actual.title}</p>
                        <p className="text-nf-faint text-[11px]">
                          {g.actual.year ? `${g.actual.year} · ` : ''}{tipoTexto(g.actual.media_type)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {g.sugerencia && ignorar !== g.clave && (
                <CajaSugerencia g={g as Grupo & { sugerencia: Sugerencia }}
                  onAceptada={n => {
                    quitar(g.clave);
                    onToast(`«${conAño(g.sugerencia!.title, g.sugerencia!.year)}» puesta a ${archivosTexto(n)}`);
                  }}
                  onDescartada={() => setGrupos(prev => prev.map(x => (x.clave === g.clave ? { ...x, sugerencia: null } : x)))} />
              )}

              {ignorar === g.clave ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-white text-xs mb-3">
                    Ignorar «{g.titulo}»: sus {archivosTexto(g.archivos)} dejan de salir en esta lista y no se toca
                    nada más (se quedan como están, con o sin ficha).
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => confirmarIgnorar(g)} disabled={ignorando} className={ROJO}>
                      {ignorando ? 'Ignorando…' : 'Sí, ignorar'}
                    </button>
                    <button onClick={() => setIgnorar(null)} disabled={ignorando} className={BOTON}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setCorrigiendo(g)} className={ROJO}>Corregir</button>
                  <button onClick={() => setIgnorar(g.clave)} disabled={ignorando} className={BOTON}>Ignorar</button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {!cargando && grupos.length < total && (
          <div className="mt-4 flex justify-center">
            <button onClick={() => cargar(grupos.length)} disabled={cargandoMas} className={BOTON}>
              {cargandoMas ? 'Cargando…' : `Cargar más (${(total - grupos.length).toLocaleString()} más)`}
            </button>
          </div>
        )}
      </div>
      </>)}

      {corrigiendo && (
        <Corregir grupo={corrigiendo} onCerrar={cerrarCorregir}
          onHecho={(archivos, ficha) => {
            quitar(corrigiendo.clave);
            setCorrigiendo(null);
            onToast(`«${conAño(ficha.title, ficha.year)}» puesta a ${archivosTexto(archivos)}`);
          }} />
      )}
    </div>
  );
}
