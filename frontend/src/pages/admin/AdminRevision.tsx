import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../services/api';
import { buscarEnTmdb, type ResultadoTmdb } from '../../services/peticiones';

/*
 * Admin -> Revisión: lo mal indexado y lo que se arregla solo.
 *
 * Es una bandeja de trabajo, no una explicación. Arriba, una tira de estado
 * con lo automático en el orden en que actúa (coincidencia exacta, Claude, y
 * lo que te queda a ti), con el interruptor y el tope de Claude a mano. Debajo,
 * la cola por pestañas: «Sugerencias» primero (las de todos los motivos, que
 * se resuelven de un toque), los cuatro motivos, lo que se ha puesto solo (con
 * deshacer) y el gasto de Claude. Cada grupo es una fila compacta: ficha
 * actual frente a la propuesta y las acciones en la misma línea; el detalle
 * del canal se despliega solo si se pide.
 *
 * Backend: services/revision.py (grupos y corrección a mano),
 * revision_auto.py (coincidencia exacta) y revision_ia.py (Claude).
 */

type ClaveMotivo = 'sin_ficha' | 'tipo_cruzado' | 'dudosa' | 'sin_caratula';
type Pestaña = 'con_sugerencia' | ClaveMotivo | 'corregido' | 'gasto';
type Tipo = 'movie' | 'series';

interface Motivo {
  clave: ClaveMotivo;
  titulo: string;
  descripcion: string;
  grupos: number;
  archivos: number;
  sugeridas: number;
}

/** Claude (revision_ia.py). La clave va en el .env del servidor: aquí solo si está puesta. */
interface EstadoIA {
  modelo: string;
  activa: boolean;
  configurada: boolean;
  error: string | null;
  tope: number;
  gasto_mes: number;
  lote: string | null;
  pendientes: number;
  /** Mientras se prepara un lote (buscar candidatas en TMDB tarda minutos). */
  preparando?: { hechos: number; total: number } | null;
  /** Mientras Claude busca en TMDB lo que no tiene carátula. */
  buscando?: { hechos: number; total: number } | null;
  /** Cuánto lleva Anthropic del lote en marcha (se le pregunta cada minuto). */
  lote_progreso?: { hechos: number; total: number } | null;
  /** Lo que espera, por paso: Haiku (en lote), la búsqueda en TMDB y la verificación de Sonnet (en lote). */
  cola?: { haiku: number; busqueda: number; sonnet: number };
}

/** Lo hecho por cada paso: coincidencia exacta, Claude y lo aceptado a mano. */
interface Pasos {
  exacta: { grupos: number; archivos: number };
  ia: { aplicadas: number; archivos: number; sugeridas: number; ninguna: number };
  mano: { grupos: number; archivos: number };
}

interface EstadoAuto {
  corriendo: boolean;
  termino: number | null;
  mirados: number;
  por_mirar: number;
  cuentas: Record<string, { grupos: number; archivos: number }>;
  pasos?: Pasos;
  ia: EstadoIA | null;
}

interface Resumen {
  motivos: Motivo[];
  canales: { channel_id: number; nombre: string }[];
  auto?: EstadoAuto;
}

interface Ficha {
  tmdb_id: number;
  media_type: Tipo;
  title: string;
  year: number | null;
  poster: string | null;
}

interface Sugerencia extends Ficha {
  porque: string | null;
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
  ejemplos?: string[] | null;
  ficha: string | null;
  pie: string | null;
  actual: Ficha | null;
  sugerencia: Sugerencia | null;
  /** Lo que se pone en el buscador de «Corregir» (vacío en los capítulos sin nombre de serie). */
  busqueda?: string;
}

interface Aplicada {
  id: number;
  titulo: string;
  motivo: ClaveMotivo;
  porque: string | null;
  ficha: Ficha | null;
  archivos: number;
  creado: string;
  por_ia?: boolean;
}

interface LoteIA {
  lote: string; modelo?: string; grupos: number; creado: string; terminado: string | null; propuestas?: number | null;
  aplicadas: number | null; sugeridas: number | null; ninguna: number | null; fallos: number | null;
  dolares: number | null;
}

interface HistorialIA {
  lotes: LoteIA[];
  meses: { mes: string; lotes: number; grupos: number; aplicadas: number; dolares: number }[];
  total: number;
}

const POR_PAGINA = 30;
const BOTON = 'rounded-card bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40';
const PRIMARIO = 'rounded-card bg-nf-red px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-nf-red-dark disabled:opacity-40';
const TEXTO_BOTON = 'text-sm text-nf-dim transition-colors hover:text-white disabled:opacity-40';
const CAMPO = 'rounded-card border border-nf-line bg-nf-deep px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-nf-faint focus:border-white/30';
// Se mantienen para el modal de «Corregir», que no cambia.
const ROJO = PRIMARIO;

// Punto de miles también con cuatro cifras («5.307», no «5307»).
const MILES = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;
const num = (n: number) => n.toLocaleString('es-ES', MILES);
const dolares = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const tipoTexto = (t: Tipo) => (t === 'series' ? 'Serie' : 'Película');
const archivosTexto = (n: number) => `${num(n)} ${n === 1 ? 'archivo' : 'archivos'}`;
const conAño = (t: string, año: number | null) => (año ? `${t} (${año})` : t);
const MOTIVO_CORTO: Record<ClaveMotivo, string> = {
  sin_ficha: 'Sin ficha', tipo_cruzado: 'Tipo cruzado', dudosa: 'Ficha dudosa', sin_caratula: 'Sin carátula',
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
  'noviembre', 'diciembre'];
const nombreMes = (ym: string) => { const [a, m] = ym.split('-'); return `${MESES[Number(m) - 1]} ${a}`; };
const comoUtc = (iso: string) => new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
const fecha = (iso: string) => comoUtc(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const haceMin = (ms: number) => {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
};

/** Qué fue cada fila del historial de gasto. */
function queLote(l: LoteIA): string {
  if (l.lote.startsWith('prueba-')) return 'prueba';
  if (l.lote.startsWith('busqueda-')) return 'búsqueda en TMDB';
  if (l.modelo?.includes('verifica')) return 'Sonnet verifica';
  if (l.modelo?.includes('haiku')) return l.propuestas ? `Haiku, ${num(l.propuestas)} a verificar` : 'Haiku';
  return 'Sonnet';
}

/** La carátula llega entera o como ruta de TMDB a secas: las dos se pintan. */
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

function Caratula({ src, className, titulo }: { src: string | null; className: string; titulo?: string }) {
  const url = imagen(src);
  return (
    <div className={`${className} shrink-0 overflow-hidden rounded-[3px] bg-nf-raised`} title={titulo}>
      {/* Si TMDB no la sirve, queda el hueco gris y no el icono de imagen rota. */}
      {url && <img src={url} alt="" loading="lazy" className="h-full w-full object-cover"
        onError={e => { e.currentTarget.style.display = 'none'; }} />}
    </div>
  );
}

/**
 * El interruptor de Claude. Monocromo: encendido es la pista blanca con la
 * bola oscura, que se lee como «activo» sin competir con el rojo de la marca
 * ni con el verde de las cifras de lo aplicado.
 */
function Interruptor({ encendido, onCambiar, deshabilitado, etiqueta }: {
  encendido: boolean; onCambiar: () => void; deshabilitado?: boolean; etiqueta: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={encendido} aria-label={etiqueta} disabled={deshabilitado}
      onClick={onCambiar}
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-pill p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40 ${encendido ? 'bg-white' : 'bg-white/20'}`}>
      <span className={`h-4 w-4 rounded-full transition-transform duration-150 ${encendido ? 'translate-x-4 bg-nf-bg' : 'translate-x-0 bg-white'}`} />
    </button>
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


/* --- La tira de estado ------------------------------------------------------ */

/** Un tramo de la tira: lo que hace cada parte de lo automático. */
function Tramo({ titulo, extra, children }: { titulo: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{titulo}</h3>
        {extra}
      </div>
      <div className="mt-2 space-y-1.5">{children}</div>
    </section>
  );
}

/**
 * Algo en marcha: qué es, cuántos lleva de cuántos y la barra. Sin total
 * todavía (Anthropic aún no ha contestado), la barra se mueve sola para que
 * se vea que no está parado.
 */
function Progreso({ texto, hechos, total }: { texto: string; hechos?: number; total?: number }) {
  const conTotal = !!total && total > 0;
  const pct = conTotal ? Math.min(100, Math.round((hechos! / total!) * 100)) : 0;
  return (
    <div className="space-y-1" role="progressbar" aria-label={texto} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={conTotal ? pct : undefined}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-nf-dim">{texto}</span>
        {conTotal && <span className="tabular-nums text-nf-faint">{num(hechos!)} de {num(total!)} · {pct} %</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-pill bg-white/10">
        {conTotal
          ? <div className="h-full rounded-pill bg-white/70 transition-[width] duration-700" style={{ width: `${Math.max(pct, 2)}%` }} />
          : <div className="h-full w-1/3 animate-progreso motion-reduce:animate-none rounded-pill bg-white/50" />}
      </div>
    </div>
  );
}

function Dato({ valor, texto, ok }: { valor: number; texto: string; ok?: boolean }) {
  return (
    <span className="whitespace-nowrap text-sm text-nf-dim">
      <span className={`mr-1 text-md font-semibold tabular-nums ${ok ? 'text-nf-ok' : 'text-white'}`}>{num(valor)}</span>
      {texto}
    </span>
  );
}

/**
 * Lo automático, en el orden en que actúa: la coincidencia exacta (siempre,
 * gratis), Claude con lo que la exacta no resuelve (si está encendido y no ha
 * llegado al tope) y lo que queda para ti. El interruptor y el tope de Claude
 * se tocan aquí mismo.
 */
function TiraEstado({ auto, sugeridas, enLista, onCambio, onToast, onRevisar, lanzando, onIr }: {
  auto: EstadoAuto; sugeridas: number; enLista: number;
  onCambio: () => void; onToast: (m: string) => void; onRevisar: () => void; lanzando: boolean;
  onIr: (p: Pestaña) => void;
}) {
  const ia = auto.ia;
  const pasos = auto.pasos;
  const [tope, setTope] = useState(String(ia?.tope ?? 20));
  const [guardando, setGuardando] = useState<'' | 'tope' | 'activa' | 'mandar'>('');
  const [error, setError] = useState('');
  useEffect(() => { if (ia) setTope(String(ia.tope)); }, [ia?.tope]); // eslint-disable-line react-hooks/exhaustive-deps

  const pedir = async (que: 'tope' | 'activa' | 'mandar', ruta: string, cuerpo?: object) => {
    setGuardando(que);
    setError('');
    try {
      const res = await apiFetch(ruta, { method: 'POST', ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
      if (!res.ok) { setError(await motivoDe(res)); return; }
      onCambio();
      if (que === 'tope') onToast('Tope guardado');
      if (que === 'mandar') onToast('Preparando el lote para Claude');
    } catch {
      setError('Error de conexión');
    } finally {
      setGuardando('');
    }
  };

  const encendida = !!ia?.activa && !!ia?.configurada;
  const alTope = !!ia && ia.gasto_mes >= ia.tope;
  const pct = ia && ia.tope > 0 ? Math.min(1, ia.gasto_mes / ia.tope) : 1;
  const topeCambiado = !!ia && Number(tope) !== ia.tope;
  const sinMirar = auto.corriendo ? Math.max(0, auto.por_mirar - auto.mirados) : 0;
  const enColaClaude = encendida && !alTope ? ia!.pendientes : 0;

  return (
    <div className="grid overflow-hidden rounded-panel border border-nf-line bg-nf-surface md:grid-cols-[1fr_1.5fr_1fr] md:divide-x md:divide-nf-line max-md:divide-y max-md:divide-nf-line">
      <Tramo titulo="Coincidencia exacta"
        extra={(
          <button onClick={onRevisar} disabled={lanzando || auto.corriendo} className={TEXTO_BOTON}
            title="Busca en TMDB lo que aún no se ha mirado">
            {auto.corriendo ? 'Revisando…' : lanzando ? 'Lanzando…' : 'Revisar ahora'}
          </button>
        )}>
        <Dato valor={pasos?.exacta.grupos ?? auto.cuentas?.aplicada?.grupos ?? 0} texto="aplicadas solas" ok />
        {auto.corriendo ? (
          <Progreso texto="Buscando coincidencias en TMDB" hechos={auto.mirados} total={auto.por_mirar} />
        ) : (
          <p className="flex items-center gap-2 text-xs text-nf-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-nf-ok" aria-hidden />
            {auto.termino ? `Al día, último repaso ${haceMin(Date.now() - auto.termino * 1000)}` : 'Esperando al primer repaso'}
          </p>
        )}
      </Tramo>

      <Tramo
        titulo={<>Claude <span className="font-normal text-nf-faint">Haiku 5.5, verifica Sonnet 5.5</span></>}
        extra={ia?.configurada ? (
          <label className="flex items-center gap-2 text-xs text-nf-dim">
            {guardando === 'activa' ? 'Comprobando…' : encendida ? 'Encendido' : 'Apagado'}
            <Interruptor encendido={encendida} deshabilitado={guardando === 'activa'} etiqueta="Revisión con Claude"
              onCambiar={() => pedir('activa', '/admin/revision/ia', { activa: !encendida })} />
          </label>
        ) : (
          <span className="text-xs text-nf-faint" title="Pon TMD_ANTHROPIC_API_KEY en las variables del servidor y redespliega">
            Sin clave en el servidor
          </span>
        )}>
        {ia?.configurada ? (<>
          {/* Sin haber trabajado nunca, tres ceros no dicen nada. */}
          {(encendida || (pasos && pasos.ia.aplicadas + pasos.ia.sugeridas + pasos.ia.ninguna > 0)) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Dato valor={pasos?.ia.aplicadas ?? 0} texto="aplicadas solas" ok />
            <Dato valor={pasos?.ia.sugeridas ?? 0} texto="sugeridas" />
            <Dato valor={pasos?.ia.ninguna ?? 0} texto="sin ficha posible" />
          </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-nf-faint">
            <span className="flex items-center gap-1.5">
              <span className="tabular-nums text-white">{dolares(ia.gasto_mes)}</span> de
              <input type="number" min="0" step="1" value={tope} aria-label="Tope de gasto al mes, en dólares"
                onChange={e => setTope(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && topeCambiado) pedir('tope', '/admin/revision/ia', { tope: Number(tope) || 0 }); }}
                className="w-12 rounded-[3px] border border-nf-line bg-nf-deep px-1.5 py-0.5 text-right tabular-nums text-white outline-none focus:border-white/40" />
              $ al mes
              {topeCambiado && (
                <button onClick={() => pedir('tope', '/admin/revision/ia', { tope: Number(tope) || 0 })}
                  disabled={guardando === 'tope'} className="ml-1 font-semibold text-white hover:underline">Guardar</button>
              )}
            </span>
            <span className="h-1 w-24 overflow-hidden rounded-pill bg-white/10" title={`${Math.round(pct * 100)} % del tope`}>
              <span className={`block h-full ${pct >= 1 ? 'bg-nf-red' : pct >= 0.8 ? 'bg-nf-warn' : 'bg-white/60'}`} style={{ width: `${pct * 100}%` }} />
            </span>
            {encendida && !ia.preparando && !ia.lote && !alTope && ia.pendientes > 0 && (
                <button onClick={() => pedir('mandar', '/admin/revision/ia/mandar')} disabled={!!guardando}
                  className="text-nf-dim hover:text-white">
                  {guardando === 'mandar' ? 'Mandando…' : `Mandar los ${num(ia.pendientes)} pendientes`}
                </button>
              )}
          </div>
          {ia.cola && ia.cola.haiku + ia.cola.busqueda + ia.cola.sonnet > 0 && (
            <p className="text-xs text-nf-faint">
              En cola: {[
                ia.cola.haiku > 0 && `${num(ia.cola.haiku)} para Haiku`,
                ia.cola.busqueda > 0 && `${num(ia.cola.busqueda)} para buscar en TMDB`,
                ia.cola.sonnet > 0 && `${num(ia.cola.sonnet)} para que Sonnet verifique`,
              ].filter(Boolean).join(', ')}
            </p>
          )}
          {ia.preparando && (
            <Progreso texto="Preparando el lote: buscando candidatas en TMDB" hechos={ia.preparando.hechos} total={ia.preparando.total} />
          )}
          {ia.lote && !ia.preparando && (
            <Progreso texto="Lote en Claude (suele tardar menos de una hora)"
              hechos={ia.lote_progreso?.hechos} total={ia.lote_progreso?.total} />
          )}
          {ia.buscando && (
            <Progreso texto="Claude buscando en TMDB" hechos={ia.buscando.hechos} total={ia.buscando.total} />
          )}
          {alTope && <p className="text-xs text-nf-red">Tope del mes alcanzado: Claude no recibe nada hasta el mes que viene.</p>}
          {!encendida && ia.pendientes > 0 && (
            <p className="text-xs text-nf-faint">Apagado: {num(ia.pendientes)} grupos que podría mirar pasan directamente a ti.</p>
          )}
          {ia.error && <p className="text-xs text-nf-red">{ia.error}</p>}
          {error && <p className="text-xs text-nf-red">{error}</p>}
        </>) : (
          <p className="text-sm text-nf-faint">
            Para que Claude revise lo que la coincidencia exacta no resuelve, pon <code className="text-nf-dim">TMD_ANTHROPIC_API_KEY</code> en el servidor.
          </p>
        )}
      </Tramo>

      <Tramo titulo="Para ti">
        <button onClick={() => onIr('con_sugerencia')} className="block text-left hover:opacity-80" disabled={!sugeridas}>
          <Dato valor={sugeridas} texto="sugerencias por confirmar" />
        </button>
        <Dato valor={enLista} texto="grupos en la lista" />
        {(sinMirar > 0 || enColaClaude > 0) && (
          <p className="text-xs text-nf-faint">
            {[sinMirar > 0 && `${num(sinMirar)} sin mirar todavía`, enColaClaude > 0 && `${num(enColaClaude)} esperando a Claude`]
              .filter(Boolean).join(' y ')}
          </p>
        )}
      </Tramo>
    </div>
  );
}

/* --- Pestañas --------------------------------------------------------------- */

function Pestañas({ actual, onCambiar, motivos, sugeridas }: {
  actual: Pestaña; onCambiar: (p: Pestaña) => void; motivos: Motivo[]; sugeridas: number;
}) {
  const items: { id: Pestaña; texto: string; n?: number }[] = [
    { id: 'con_sugerencia', texto: 'Sugerencias', n: sugeridas },
    ...motivos.map(m => ({ id: m.clave as Pestaña, texto: MOTIVO_CORTO[m.clave], n: m.grupos })),
    { id: 'corregido', texto: 'Aplicado solo' },
    { id: 'gasto', texto: 'Gasto de Claude' },
  ];
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-nf-line px-1" aria-label="Bandejas de revisión">
      {items.map((it, i) => {
        const activo = it.id === actual;
        return (
          <button key={it.id} onClick={() => onCambiar(it.id)} aria-current={activo ? 'page' : undefined}
            className={`relative shrink-0 whitespace-nowrap px-3 pb-3 pt-2 text-sm transition-colors ${i === 5 ? 'ml-auto' : ''} ${activo ? 'font-semibold text-white' : 'text-nf-dim hover:text-white'}`}>
            {it.texto}
            {it.n !== undefined && <span className={`ml-1.5 tabular-nums ${activo ? 'text-nf-dim' : 'text-nf-faint'}`}>{num(it.n)}</span>}
            {activo && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-pill bg-nf-red" />}
          </button>
        );
      })}
    </nav>
  );
}

/* --- La cola ---------------------------------------------------------------- */

/** Una línea de ficha: «Ahora» o «Propuesta», con su año y tipo. */
function LineaFicha({ etiqueta, f, tono }: { etiqueta: string; f: Ficha; tono?: 'propuesta' }) {
  return (
    <p className="truncate text-xs">
      <span className="text-nf-faint">{etiqueta}: </span>
      <span className={tono ? 'text-white' : 'text-nf-dim'}>{conAño(f.title, f.year)}</span>
      <span className="text-nf-faint">, {tipoTexto(f.media_type).toLowerCase()}</span>
    </p>
  );
}

function FilaGrupo({ g, verMotivo, onQuitar, onCorregir, onToast }: {
  g: Grupo; verMotivo: boolean; onQuitar: () => void; onCorregir: () => void; onToast: (m: string) => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const [haciendo, setHaciendo] = useState<'' | 'aceptar' | 'descartar' | 'ignorar'>('');
  const [confirmarIgnorar, setConfirmarIgnorar] = useState(false);
  const [sinSugerencia, setSinSugerencia] = useState(false);
  const s = sinSugerencia ? null : g.sugerencia;

  const accion = async (que: 'aceptar' | 'descartar' | 'ignorar') => {
    setHaciendo(que);
    const ruta = que === 'ignorar' ? '/admin/revision/ignorar' : `/admin/revision/sugerencia/${que}`;
    try {
      const res = await apiFetch(ruta, { method: 'POST', body: JSON.stringify({ clave: g.clave }) });
      if (!res.ok) { onToast(await motivoDe(res)); return; }
      const r: { archivos?: number } = await res.json();
      if (que === 'descartar') { setSinSugerencia(true); return; }
      onQuitar();
      onToast(que === 'aceptar'
        ? `«${conAño(s!.title, s!.year)}» puesta a ${archivosTexto(r.archivos ?? g.archivos)}`
        : `«${g.titulo}» ignorado (${archivosTexto(r.archivos ?? g.archivos)})`);
    } catch {
      onToast('Error de conexión');
    } finally {
      setHaciendo('');
    }
  };

  const muestras = g.ejemplos?.length ? g.ejemplos : [g.ejemplo];
  return (
    <li className="border-b border-nf-line last:border-0">
      <div className="flex gap-4 px-4 py-3">
        <div className="flex shrink-0 items-start gap-1.5 pt-0.5">
          <Caratula src={g.actual?.poster ?? null} className="h-[60px] w-10" titulo={g.actual ? `Ahora: ${g.actual.title}` : 'Sin ficha'} />
          {s && <Caratula src={s.poster} className="h-[60px] w-10 ring-1 ring-white/40" titulo={`Propuesta: ${s.title}`} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <button onClick={() => setAbierta(a => !a)} aria-expanded={abierta}
              className="min-w-0 truncate text-left text-base font-semibold text-white hover:underline">
              {g.titulo}
            </button>
            {g.año && <span className="text-sm text-nf-dim">{g.año}</span>}
            <span className="text-xs text-nf-faint">
              {tipoTexto(g.tipo)}, {archivosTexto(g.archivos)}{g.canales.length > 0 && `, ${g.canales.join(', ')}`}
              {verMotivo && ` · ${MOTIVO_CORTO[g.motivo]}`}
            </span>
          </div>
          <div className="mt-1 space-y-0.5">
            {g.actual && <LineaFicha etiqueta="Ahora" f={g.actual} />}
            {s && <LineaFicha etiqueta="Propuesta" f={s} tono="propuesta" />}
            {s?.porque && <p className="truncate text-xs text-nf-faint">{s.porque}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-start">
          {confirmarIgnorar ? (<>
            <span className="max-w-[14rem] text-right text-xs text-nf-dim">Deja de salir aquí y no se toca nada más.</span>
            <button onClick={() => accion('ignorar')} disabled={!!haciendo} className={PRIMARIO}>{haciendo === 'ignorar' ? 'Ignorando…' : 'Ignorar'}</button>
            <button onClick={() => setConfirmarIgnorar(false)} disabled={!!haciendo} className={BOTON}>Cancelar</button>
          </>) : (<>
            {s && <button onClick={() => accion('aceptar')} disabled={!!haciendo} className={PRIMARIO}>{haciendo === 'aceptar' ? 'Aplicando…' : 'Aplicar'}</button>}
            {s && <button onClick={() => accion('descartar')} disabled={!!haciendo} className={BOTON}>{haciendo === 'descartar' ? '…' : 'No es esta'}</button>}
            <button onClick={onCorregir} disabled={!!haciendo} className={s ? TEXTO_BOTON + ' px-1 py-1.5' : BOTON}>Corregir</button>
            <button onClick={() => setConfirmarIgnorar(true)} disabled={!!haciendo} className={TEXTO_BOTON + ' px-1 py-1.5'}>Ignorar</button>
          </>)}
        </div>
      </div>

      {abierta && (
        <div className="grid gap-3 px-4 pb-4 pl-[4.5rem] text-xs sm:grid-cols-2">
          {g.ficha && (
            <div>
              <p className="mb-1 text-nf-faint">Ficha del canal</p>
              <p className="whitespace-pre-line break-words text-nf-dim">{g.ficha}</p>
            </div>
          )}
          <div className="space-y-3">
            {g.pie && (
              <div>
                <p className="mb-1 text-nf-faint">Pie del archivo</p>
                <p className="whitespace-pre-line break-words text-nf-dim">{g.pie}</p>
              </div>
            )}
            <div>
              <p className="mb-1 text-nf-faint">{muestras.length > 1 ? 'Archivos de muestra' : 'Archivo'}</p>
              {muestras.map((m, i) => <p key={i} className="break-all font-mono text-[11px] text-nf-dim">{m}</p>)}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function Cola({ bandeja, canales, onCambio, onToast, recarga }: {
  bandeja: 'con_sugerencia' | ClaveMotivo; canales: Resumen['canales'];
  onCambio: () => void; onToast: (m: string) => void; recarga: number;
}) {
  const [canal, setCanal] = useState('');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [corrigiendo, setCorrigiendo] = useState<Grupo | null>(null);
  const peticion = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQ(texto.trim()), 300); return () => clearTimeout(t); }, [texto]);

  const cargados = useRef(0);
  cargados.current = grupos.length;
  const cargar = useCallback(async (offset: number, limit = POR_PAGINA) => {
    const n = ++peticion.current;
    setCargando(true);
    setError('');
    const params = new URLSearchParams({ motivo: bandeja, offset: String(offset), limit: String(limit) });
    if (canal) params.set('channel_id', canal);
    if (q) params.set('q', q);
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
      if (n === peticion.current) setCargando(false);
    }
  }, [bandeja, canal, q]);
  useEffect(() => { cargar(0); }, [cargar]);
  // Lo que se arregla solo mientras se mira (la pasada exacta, Claude) sale
  // de la lista sin perder lo ya cargado más abajo.
  useEffect(() => {
    if (recarga) cargar(0, Math.max(POR_PAGINA, cargados.current));
  }, [recarga]); // eslint-disable-line react-hooks/exhaustive-deps

  const quitar = (clave: string) => {
    setGrupos(prev => prev.filter(g => g.clave !== clave));
    setTotal(t => Math.max(0, t - 1));
    onCambio();
  };
  const cerrarCorregir = useCallback(() => setCorrigiendo(null), []);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 py-3">
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar por título o archivo"
          className={`${CAMPO} min-w-[220px] flex-1`} aria-label="Buscar en la lista" />
        <select value={canal} onChange={e => setCanal(e.target.value)} className={`${CAMPO} pr-8`} aria-label="Canal">
          <option value="" className="bg-nf-surface">Todos los canales</option>
          {canales.map(c => <option key={c.channel_id} value={String(c.channel_id)} className="bg-nf-surface">{c.nombre}</option>)}
        </select>
        <span className="ml-auto text-sm tabular-nums text-nf-faint">
          {cargando && !grupos.length ? 'Cargando…' : `${num(total)} ${total === 1 ? 'grupo' : 'grupos'}`}
        </span>
      </div>
      {error && <p className="pb-3 text-sm text-nf-red">{error}</p>}

      <div className="overflow-hidden rounded-panel border border-nf-line bg-nf-surface">
        {!cargando && !grupos.length && !error ? (
          <p className="px-4 py-10 text-center text-sm text-nf-dim">
            {q || canal ? 'Nada con ese filtro.' : bandeja === 'con_sugerencia' ? 'No hay sugerencias pendientes.' : 'No queda nada aquí.'}
          </p>
        ) : (
          <ul>
            {grupos.map(g => (
              <FilaGrupo key={g.clave} g={g} verMotivo={bandeja === 'con_sugerencia'} onToast={onToast}
                onQuitar={() => quitar(g.clave)} onCorregir={() => setCorrigiendo(g)} />
            ))}
          </ul>
        )}
      </div>

      {!cargando && grupos.length < total && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => cargar(grupos.length)} className={BOTON}>
            Cargar {num(Math.min(POR_PAGINA, total - grupos.length))} más de {num(total - grupos.length)}
          </button>
        </div>
      )}

      {corrigiendo && (
        <Corregir grupo={{ ...corrigiendo }} onCerrar={cerrarCorregir}
          onHecho={(archivos, ficha) => {
            quitar(corrigiendo.clave);
            setCorrigiendo(null);
            onToast(`«${conAño(ficha.title, ficha.year)}» puesta a ${archivosTexto(archivos)}`);
          }} />
      )}
    </div>
  );
}

/* --- Aplicado solo ---------------------------------------------------------- */

function AplicadoSolo({ onToast, onCambio }: { onToast: (m: string) => void; onCambio: () => void }) {
  const [origen, setOrigen] = useState<'' | 'exacta' | 'ia'>('');
  const [items, setItems] = useState<Aplicada[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [deshaciendo, setDeshaciendo] = useState<number | null>(null);

  const cargar = useCallback(async (offset: number) => {
    setCargando(true);
    try {
      const res = await apiFetch(`/admin/revision/auto?offset=${offset}&limit=${POR_PAGINA}&origen=${origen}`);
      if (!res.ok) { onToast(await motivoDe(res)); return; }
      const d: { total: number; items: Aplicada[] } = await res.json();
      setTotal(d.total);
      setItems(prev => (offset === 0 ? d.items : [...prev, ...d.items.filter(x => !prev.some(p => p.id === x.id))]));
    } catch {
      onToast('Error de conexión');
    } finally {
      setCargando(false);
    }
  }, [origen, onToast]);
  useEffect(() => { cargar(0); }, [cargar]);

  const deshacer = async (a: Aplicada) => {
    setDeshaciendo(a.id);
    try {
      const res = await apiFetch('/admin/revision/auto/deshacer', { method: 'POST', body: JSON.stringify({ id: a.id }) });
      if (!res.ok) { onToast(await motivoDe(res)); return; }
      setItems(prev => prev.filter(x => x.id !== a.id));
      setTotal(t => Math.max(0, t - 1));
      onCambio();
      onToast(`«${a.titulo}» vuelve a como estaba`);
    } catch {
      onToast('Error de conexión');
    } finally {
      setDeshaciendo(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 py-3">
        {([['', 'Todo'], ['exacta', 'Coincidencia exacta'], ['ia', 'Claude']] as const).map(([v, t]) => (
          <button key={v} onClick={() => setOrigen(v)} aria-pressed={origen === v}
            className={`rounded-pill px-3 py-1 text-sm transition-colors ${origen === v ? 'bg-white font-semibold text-nf-bg' : 'bg-white/10 text-nf-dim hover:bg-white/20'}`}>
            {t}
          </button>
        ))}
        <span className="ml-auto text-sm tabular-nums text-nf-faint">{num(total)} aplicados</span>
      </div>
      <div className="overflow-hidden rounded-panel border border-nf-line bg-nf-surface">
        {!cargando && !items.length ? (
          <p className="px-4 py-10 text-center text-sm text-nf-dim">Todavía no se ha aplicado nada solo.</p>
        ) : (
          <ul>
            {items.map(a => (
              <li key={a.id} className="flex items-center gap-4 border-b border-nf-line px-4 py-3 last:border-0">
                <Caratula src={a.ficha?.poster ?? null} className="h-[60px] w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-white">
                    {a.ficha ? conAño(a.ficha.title, a.ficha.year) : a.titulo}
                    {a.ficha && <span className="ml-2 text-xs font-normal text-nf-faint">{tipoTexto(a.ficha.media_type)}</span>}
                  </p>
                  <p className="truncate text-xs text-nf-dim">
                    Era «{a.titulo}», {archivosTexto(a.archivos)}, {haceMin(Date.now() - comoUtc(a.creado).getTime())}
                  </p>
                  {a.porque && <p className="truncate text-xs text-nf-faint">{a.por_ia ? '' : 'Coincidencia exacta: '}{a.porque}</p>}
                </div>
                <button onClick={() => deshacer(a)} disabled={deshaciendo !== null} className={BOTON}>
                  {deshaciendo === a.id ? 'Deshaciendo…' : 'Deshacer'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!cargando && items.length < total && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => cargar(items.length)} className={BOTON}>Cargar más</button>
        </div>
      )}
    </div>
  );
}

/* --- Gasto de Claude -------------------------------------------------------- */

function GastoClaude({ ia }: { ia: EstadoIA | null }) {
  const [h, setH] = useState<HistorialIA | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiFetch('/admin/revision/ia/historial')
      .then(async r => (r.ok ? setH(await r.json()) : setError(await motivoDe(r))))
      .catch(() => setError('Error de conexión'));
  }, []);
  if (error) return <p className="py-6 text-sm text-nf-red">{error}</p>;
  if (!h) return <p className="py-6 text-sm text-nf-dim">Cargando…</p>;
  return (
    <div className="grid gap-6 py-4 md:grid-cols-[16rem_1fr]">
      <div className="space-y-4">
        <div className="rounded-panel border border-nf-line bg-nf-surface p-4">
          <p className="text-sm text-nf-dim">Este mes</p>
          <p className="mt-1 text-title font-semibold tabular-nums text-white">{dolares(ia?.gasto_mes ?? 0)}</p>
          <p className="text-xs text-nf-faint">de un tope de {dolares(ia?.tope ?? 0)}</p>
          <p className="mt-3 text-xs leading-relaxed text-nf-faint">Lo que ha costado de verdad cada petición: el servidor y las pruebas.</p>
        </div>
        <table className="w-full text-sm">
          <caption className="pb-2 text-left text-xs text-nf-faint">Por mes</caption>
          <tbody>
            {h.meses.map(m => (
              <tr key={m.mes} className="border-t border-nf-line">
                <td className="py-1.5 text-nf-dim">{nombreMes(m.mes)}</td>
                <td className="py-1.5 text-right tabular-nums text-white">{dolares(m.dolares)}</td>
              </tr>
            ))}
            <tr className="border-t border-nf-line">
              <td className="py-1.5 font-semibold text-white">Total</td>
              <td className="py-1.5 text-right font-semibold tabular-nums text-white">{dolares(h.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="min-w-0 overflow-x-auto">
        {!h.lotes.length ? (
          <p className="rounded-panel border border-nf-line bg-nf-surface px-4 py-10 text-center text-sm text-nf-dim">
            Todavía no se ha mandado ningún lote a Claude.
          </p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <caption className="pb-2 text-left text-xs text-nf-faint">Lotes mandados</caption>
            <thead className="text-xs text-nf-faint">
              <tr className="text-right">
                <th className="py-1.5 text-left font-normal">Mandado</th>
                <th className="font-normal">Grupos</th>
                <th className="font-normal">Aplicadas</th>
                <th className="font-normal">Sugeridas</th>
                <th className="font-normal">Sin ficha</th>
                <th className="font-normal">Fallos</th>
                <th className="font-normal">Coste</th>
              </tr>
            </thead>
            <tbody>
              {h.lotes.map(l => (
                <tr key={l.lote} className="border-t border-nf-line text-right text-nf-dim">
                  <td className="py-2 text-left">
                    {fecha(l.creado)}
                    <span className="ml-2 text-xs text-nf-faint">{queLote(l)}</span>
                  </td>
                  <td className="text-white">{num(l.grupos)}</td>
                  {l.terminado ? (<>
                    <td className="text-nf-ok">{num(l.aplicadas ?? 0)}</td>
                    <td>{num(l.sugeridas ?? 0)}</td>
                    <td>{num(l.ninguna ?? 0)}</td>
                    <td>{l.fallos ? num(l.fallos) : ''}</td>
                    <td className="text-white">{l.dolares != null ? dolares(l.dolares) : ''}</td>
                  </>) : (
                    <td colSpan={5} className="text-nf-faint">en marcha</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* --- La vista --------------------------------------------------------------- */

export default function AdminRevision({ onToast }: { onToast: (m: string) => void }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [errorResumen, setErrorResumen] = useState('');
  const [pestaña, setPestaña] = useState<Pestaña | null>(null);
  const [lanzando, setLanzando] = useState(false);
  // Sube cuando algo cambia la lista desde fuera (acabó una pasada, se deshizo algo).
  const [recarga, setRecarga] = useState(0);

  const cargarResumen = useCallback(async () => {
    try {
      const res = await apiFetch('/admin/revision/resumen');
      if (!res.ok) { setErrorResumen(await motivoDe(res)); return; }
      const r: Resumen = await res.json();
      setResumen(r);
      setErrorResumen('');
      // La bandeja de entrada: las sugerencias si hay, y si no, lo que más pesa.
      setPestaña(p => p ?? (r.motivos.some(m => m.sugeridas > 0) ? 'con_sugerencia' : 'sin_ficha'));
    } catch {
      setErrorResumen('Error de conexión');
    }
  }, []);
  useEffect(() => { cargarResumen(); }, [cargarResumen]);

  // Con una pasada o un lote preparándose se vuelve a mirar el estado cada
  // pocos segundos; con un lote en Claude, cada medio minuto (tarda hasta una
  // hora). Al acabar la pasada, también la lista.
  const corriendo = !!resumen?.auto?.corriendo;
  const preparando = !!resumen?.auto?.ia?.preparando || !!resumen?.auto?.ia?.buscando;
  const enClaude = !!resumen?.auto?.ia?.lote;
  useEffect(() => {
    // Sin nada en marcha, cada minuto: el bucle de fondo va arreglando cosas solo.
    const cada = corriendo || preparando ? 4000 : enClaude ? 30000 : 60000;
    const t = setInterval(cargarResumen, cada);
    return () => clearInterval(t);
  }, [corriendo, preparando, enClaude, cargarResumen]);
  // Cuando cambia lo que queda (algo se ha aplicado solo, o ha llegado una
  // sugerencia), la lista se vuelve a pedir.
  const huella = resumen ? resumen.motivos.map(m => `${m.grupos}/${m.sugeridas}`).join(',') : '';
  const huellaVista = useRef('');
  useEffect(() => {
    if (huellaVista.current && huella !== huellaVista.current) setRecarga(n => n + 1);
    huellaVista.current = huella;
  }, [huella]);

  const revisarAhora = async () => {
    setLanzando(true);
    try {
      const res = await apiFetch('/admin/revision/auto/lanzar', { method: 'POST' });
      if (!res.ok) onToast(await motivoDe(res)); else await cargarResumen();
    } catch {
      onToast('Error de conexión');
    } finally {
      setLanzando(false);
    }
  };

  if (!resumen || !pestaña) {
    return (
      <div className="rounded-panel border border-nf-line bg-nf-surface px-5 py-6">
        {errorResumen ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-nf-red">{errorResumen}</p>
            <button onClick={cargarResumen} className={BOTON}>Reintentar</button>
          </div>
        ) : (
          <p className="flex items-center gap-3 text-sm text-nf-dim">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-nf-red" />
            Calculando lo que hay que revisar…
          </p>
        )}
      </div>
    );
  }

  const sugeridas = resumen.motivos.reduce((n, m) => n + (m.sugeridas ?? 0), 0);
  const enLista = resumen.motivos.reduce((n, m) => n + m.grupos, 0);
  const motivoActual = resumen.motivos.find(m => m.clave === pestaña);

  return (
    <div className="space-y-6">
      {resumen.auto && (
        <TiraEstado auto={resumen.auto} sugeridas={sugeridas} enLista={enLista} onCambio={cargarResumen}
          onToast={onToast} onRevisar={revisarAhora} lanzando={lanzando} onIr={setPestaña} />
      )}

      <div>
        <Pestañas actual={pestaña} onCambiar={setPestaña} motivos={resumen.motivos} sugeridas={sugeridas} />
        {motivoActual && <p className="pt-3 text-sm text-nf-faint">{motivoActual.descripcion}</p>}
        {pestaña === 'corregido' ? (
          <AplicadoSolo onToast={onToast} onCambio={() => { cargarResumen(); setRecarga(n => n + 1); }} />
        ) : pestaña === 'gasto' ? (
          <GastoClaude ia={resumen.auto?.ia ?? null} />
        ) : (
          <Cola key={pestaña} bandeja={pestaña} canales={resumen.canales} onCambio={cargarResumen}
            onToast={onToast} recarga={recarga} />
        )}
      </div>
    </div>
  );
}
