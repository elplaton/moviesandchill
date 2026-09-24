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
      } else if (next.size < 10) {
        next.add(tmdbId);
      }
      return next;
    });
  };

  const handleNext = () => setStep('series');

  const handleSave = async () => {
    if (selectedMovies.size < 3 || selectedSeries.size < 3) return;
    setSaving(true);
    try {
      await apiFetch('/preferences', {
        method: 'POST',
        body: JSON.stringify({
          movies: Array.from(selectedMovies),
          series: Array.from(selectedSeries),
        }),
      });
      await refreshPreferences();
      navigate('/', { replace: true });
    } catch {} finally { setSaving(false); }
  };

  const currentPicks = isMovies ? movies : series;
  const selected = isMovies ? selectedMovies : selectedSeries;
  const canAdvance = (isMovies ? selectedMovies : selectedSeries).size >= 3;

  return (
    <Shell>
      <div className="px-gutter pb-6">
        <h1 className="text-page font-bold">
          {isMovies ? 'Elige películas que te gusten' : 'Elige series que te gusten'}
        </h1>
        <p className="mt-2 max-w-[640px] text-md text-nf-dim">
          {isMovies
            ? 'Marca al menos 3 películas que hayas visto. Con eso se arma tu portada.'
            : 'Marca al menos 3 series que hayas visto. Con eso se arma tu portada.'}
        </p>
        <div className="mt-6 flex items-center justify-between">
          <p className="text-base text-nf-faint">{selected.size} de 10 seleccionadas (mínimo 3)</p>
          {isMovies ? (
            <Button variant="primary" size="lg" onClick={handleNext} disabled={!canAdvance}>Siguiente</Button>
          ) : (
            <Button variant="primary" size="lg" onClick={handleSave} disabled={!canAdvance || saving}>
              {saving ? 'Guardando…' : 'Guardar y empezar'}
            </Button>
          )}
        </div>
      </div>

      {loading && currentPicks.length === 0 ? (
        <p className="px-gutter py-20 text-base text-nf-faint">Cargando…</p>
      ) : (
        <div className="px-gutter pb-8">
          <div className="grid gap-x-[var(--row-gap)] gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(var(--card-w),1fr))]">
            {currentPicks.map(item => {
              const on = selected.has(item.tmdb_id);
              return (
                <div key={item.id} className={`relative rounded-card transition-shadow ${on ? 'ring-2 ring-nf-red ring-offset-2 ring-offset-nf-bg' : ''}`}>
                  <Card title={item.title} poster={item.poster} rating={item.rating}
                    meta={item.year ? String(item.year) : undefined}
                    onOpen={() => toggle(item.tmdb_id)}
                    actions={<span className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-black">{on ? 'Quitar' : 'Seleccionar'}</span>} />
                  {on && (
                    <span className="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-nf-red">
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
