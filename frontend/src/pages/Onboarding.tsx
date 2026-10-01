import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Shell from '../components/Shell';
import Card from '../components/Card';
import Button from '../components/ui/Button';
import { IconCheck } from '../components/ui/Icon';

interface Pick {
  id: string;
  tmdb_id: number;
  title: string;
  poster?: string;
  year?: number;
  rating?: number;
  genres?: string[];
  media_type: string;
}

const PAGE_SIZE = 30;

export default function Onboarding() {
  const { refreshPreferences } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'movies' | 'series'>('movies');
  const [movies, setMovies] = useState<Pick[]>([]);
  const [series, setSeries] = useState<Pick[]>([]);
  const [selectedMovies, setSelectedMovies] = useState<Set<number>>(new Set());
  const [selectedSeries, setSelectedSeries] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadMore, setLoadMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [topeAvisado, setTopeAvisado] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const isMovies = step === 'movies';

  const loadPicks = useCallback(async (offset: number) => {
    try {
      const res = await apiFetch(`/onboarding/picks?offset=${offset}&limit=${PAGE_SIZE}`);
      const data = await res.json();
      const newItems = (isMovies ? data.movies : data.series) as Pick[];
      if (newItems.length < PAGE_SIZE) setHasMore(false);
      if (isMovies) {
        setMovies(prev => offset === 0 ? newItems : [...prev, ...newItems]);
      } else {
        setSeries(prev => offset === 0 ? newItems : [...prev, ...newItems]);
      }
    } catch {} finally { setLoading(false); setLoadMore(false); }
  }, [isMovies]);

  useEffect(() => {
    setLoading(true);
    setHasMore(true);
    loadPicks(0);
  }, [step]);

  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadMore) {
          setLoadMore(true);
          const current = isMovies ? movies : series;
          loadPicks(current.length);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore, movies.length, series.length, isMovies, loadPicks]);

  const toggle = (tmdbId: number) => {
    const setter = isMovies ? setSelectedMovies : setSelectedSeries;
    const current = isMovies ? selectedMovies : selectedSeries;
    setter(prev => {
      const next = new Set(prev);
      if (next.has(tmdbId)) {
        next.delete(tmdbId);
        setTopeAvisado(false);
      } else if (next.size < 10) {
        next.add(tmdbId);
      } else {
        // Antes el clic no hacía nada y no se explicaba por qué.
        setTopeAvisado(true);
      }
      return next;
    });
  };

  const handleNext = () => setStep('series');

  const guardar = async (movies: number[], series: number[]) => {
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/preferences', {
        method: 'POST',
        body: JSON.stringify({ movies, series }),
      });
      if (!res.ok) {
        // Antes esto se tragaba en un catch vacío: el botón volvía a su sitio
        // y no pasaba nada, sin decir una palabra.
        setError('No se han podido guardar tus preferencias. Inténtalo otra vez.');
        return;
      }
      await refreshPreferences();
      navigate('/', { replace: true });
    } catch {
      setError('No se ha podido contactar con el servidor.');
    } finally { setSaving(false); }
  };

  const handleSave = () => {
    if (!canAdvance) return;
    guardar(Array.from(selectedMovies), Array.from(selectedSeries));
  };

  // Sin catálogo no hay nada que elegir, y la portada devuelve aquí una y otra
  // vez: hacía falta una salida. Se guardan las preferencias vacías, que es lo
  // que marca el onboarding como hecho.
  const saltar = () => guardar(Array.from(selectedMovies), Array.from(selectedSeries));

  const currentPicks = isMovies ? movies : series;
  const selected = isMovies ? selectedMovies : selectedSeries;
  // El mínimo se adapta a lo que hay. Si el catálogo solo ofrece una o dos
  // series, exigir tres dejaba el botón apagado para siempre: no se podía
  // terminar el onboarding y al volver a entrar lo pedía otra vez.
  const minimo = Math.min(3, currentPicks.length);
  const canAdvance = selected.size >= minimo && selected.size > 0;

  return (
    <Shell>
      <div className="px-gutter pb-6">
        <h1 className="text-page font-bold">
          {isMovies ? 'Elige películas que te gusten' : 'Elige series que te gusten'}
        </h1>
        <p className="mt-2 max-w-[640px] text-md text-nf-dim">
          {`Marca al menos ${minimo || 3} ${isMovies ? 'películas' : 'series'} que hayas visto. Con eso se arma tu portada.`}
        </p>
        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-base text-nf-faint">
            {selected.size} de 10 seleccionadas{minimo > 0 && ` (mínimo ${minimo})`}
            {topeAvisado && <span className="ml-2 text-nf-text">Ya has llegado a 10; quita alguna para cambiarla.</span>}
          </p>
          <div className="flex items-center gap-3">
            {!isMovies && (
              <Button variant="light" size="lg" onClick={() => setStep('movies')} disabled={saving}>Atrás</Button>
            )}
            {isMovies ? (
              <Button variant="primary" size="lg" onClick={handleNext} disabled={!canAdvance}>Siguiente</Button>
            ) : (
              <Button variant="primary" size="lg" onClick={handleSave} disabled={!canAdvance || saving}>
                {saving ? 'Guardando…' : 'Guardar y empezar'}
              </Button>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded border border-nf-red/30 bg-nf-red/10 px-4 py-3 text-base">{error}</p>
        )}
      </div>

      {loading && currentPicks.length === 0 ? (
        <p className="px-gutter py-20 text-base text-nf-faint">Cargando…</p>
      ) : currentPicks.length === 0 ? (
        <div className="px-gutter py-20">
          <p className="text-lg text-nf-dim">Todavía no hay nada que elegir.</p>
          <p className="mt-1 max-w-[560px] text-base text-nf-faint">
            El catálogo está vacío o aún se está indexando. Puedes entrar ya y configurar
            tus gustos más adelante desde tu cuenta.
          </p>
          <Button variant="primary" size="lg" className="mt-6" onClick={saltar} disabled={saving}>
            {saving ? 'Entrando…' : 'Entrar de todas formas'}
          </Button>
        </div>
      ) : (
        <div className="px-gutter pb-8">
          <div className="grid gap-x-[var(--row-gap)] gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(var(--card-w),1fr))]">
            {currentPicks.map(item => {
              const on = selected.has(item.tmdb_id);
              return (
                // El aro va sobre la carátula, no sobre el contenedor: este
                // incluye el título y el año, así que el recuadro rojo
                // rodeaba también el texto y dejaba un hueco muerto debajo.
                <div key={item.id} className={`relative ${on
                  ? '[&_.card-media]:outline [&_.card-media]:outline-2 [&_.card-media]:outline-nf-red [&_.card-media]:outline-offset-2'
                  : ''}`}>
                  <Card title={item.title} poster={item.poster} rating={item.rating}
                    meta={item.year ? String(item.year) : undefined}
                    onOpen={() => toggle(item.tmdb_id)}
                    actions={<span className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-black">{on ? 'Quitar' : 'Seleccionar'}</span>} />
                  {on && (
                    <span className="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-nf-red ring-2 ring-black/45">
                      <span className="w-4 h-4"><IconCheck /></span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div ref={sentinelRef} className="py-10 text-center text-base text-nf-faint">
              {loadMore ? 'Cargando más…' : 'Baja para ver más'}
            </div>
          )}
          {!hasMore && currentPicks.length > 0 && (
            <p className="py-10 text-center text-base text-nf-faint">No hay más contenido.</p>
          )}
        </div>
      )}
    </Shell>
  );
}
