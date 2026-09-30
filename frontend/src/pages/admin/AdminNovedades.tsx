import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';

interface Novedad {
  id: number;
  channel: string;
  message_id: number;
  file_name: string;
  media_type: string | null;
  season: number | null;
  episode: number | null;
  title: string;
  poster: string | null;
  year: number | null;
  indexed: boolean;
  reason: string;
  at: string;
}

interface Estado {
  listening: boolean;
  channels: number;
  resolved: number;
  unresolved: string[];
}

const CARD = 'bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl';
const GHOST = 'text-nf-dim hover:text-nf-text text-sm transition-colors disabled:opacity-40';

function cuando(at: string) {
  const t = new Date(at.replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return at;
  const mins = Math.floor((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const horas = Math.floor(mins / 60);
  if (horas < 24) return `hace ${horas} h`;
  return t.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function etiqueta(n: Novedad) {
  if (n.media_type === 'series') {
    const s = n.season ?? 0;
    const e = n.episode ?? 0;
    return `Serie · ${s}x${String(e).padStart(2, '0')}`;
  }
  if (n.media_type === 'movie') return 'Película';
  return 'Sin clasificar';
}

/**
 * Registro de lo que va llegando en vivo a los canales.
 *
 * Antes esto solo se veía en los logs del contenedor, que en Docker hay que ir
 * a buscar. Y un mensaje descartado no dejaba ni rastro, así que no había forma
 * de saber por qué una película no acababa apareciendo en la portada.
 */
export default function AdminNovedades() {
  const [items, setItems] = useState<Novedad[]>([]);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [soloIndexadas, setSoloIndexadas] = useState(false);
  const [cargando, setCargando] = useState(true);

  const load = useCallback(async () => {
    try {
      const [novRes, estRes] = await Promise.all([
        apiFetch(`/admin/novedades?limit=200${soloIndexadas ? '&only_indexed=true' : ''}`),
        apiFetch('/admin/novedades/estado'),
      ]);
      const nov = await novRes.json();
      setItems(nov.items || []);
      setEstado(await estRes.json());
    } catch {
      /* el aviso de abajo ya cubre el caso de lista vacía */
    } finally {
      setCargando(false);
    }
  }, [soloIndexadas]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${estado?.listening
                ? 'bg-green-500 shadow-lg shadow-green-500/40'
                : 'bg-nf-red shadow-lg shadow-nf-red/40'}`} />
              <h2 className="text-white text-lg font-semibold">
                {estado?.listening ? 'Escuchando mensajes nuevos' : 'Escucha parada'}
              </h2>
            </div>
            <p className="text-nf-dim text-sm">
              {estado?.listening
                ? `${estado.channels} ${estado.channels === 1 ? 'canal' : 'canales'} vigilados, ${estado.resolved} resueltos.`
                : 'Hace falta una sesión de Telegram activa. Ve a la pestaña Telegram.'}
            </p>
            {estado && estado.unresolved.length > 0 && (
              <p className="text-amber-400/90 text-sm mt-3">
                Sin resolver: {estado.unresolved.join(', ')}. Se siguen escuchando sus mensajes
                nuevos, pero no se pueden escanear hacia atrás.
              </p>
            )}
          </div>
          <button onClick={load} className={GHOST}>Actualizar</button>
        </div>
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="text-white text-lg font-semibold">Novedades</h2>
          <label className="flex items-center gap-2 text-nf-dim text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={soloIndexadas}
              onChange={e => setSoloIndexadas(e.target.checked)}
              className="accent-nf-red"
            />
            Solo las indexadas
          </label>
        </div>

        {cargando ? (
          <p className="text-nf-dim text-sm">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="text-nf-dim text-sm leading-relaxed">
            Todavía no ha llegado nada. Aquí aparece cada archivo que se publica en los canales
            desde que el servidor está escuchando, esté indexado o descartado.
          </p>
        ) : (
          <div className="divide-y divide-white/5">
            {items.map(n => (
              <div key={n.id} className="flex items-center gap-4 py-3">
                <div className="w-10 h-14 shrink-0 rounded-md overflow-hidden bg-white/5">
                  {n.poster && (
                    <img
                      src={`https://image.tmdb.org/t/p/w92${n.poster}`}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-nf-text text-sm truncate">
                    {n.title || n.file_name}
                    {n.year ? <span className="text-nf-dim"> ({n.year})</span> : null}
                  </p>
                  <p className="text-nf-dim text-xs truncate mt-0.5">
                    {n.channel} · {etiqueta(n)} · {cuando(n.at)}
                  </p>
                  {n.title && n.file_name && n.title !== n.file_name && (
                    <p className="text-nf-dim/70 text-xs truncate mt-0.5">{n.file_name}</p>
                  )}
                </div>
                <span className={`shrink-0 text-xs px-2.5 py-1 rounded-lg border ${n.indexed
                  ? 'text-green-400 border-green-500/30 bg-green-500/10'
                  : 'text-nf-dim border-white/10 bg-white/5'}`}>
                  {n.indexed ? 'Indexado' : n.reason || 'Descartado'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
