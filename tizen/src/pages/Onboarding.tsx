import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FocusScope, focusById as setFocus } from '../focus/react';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MovieCard from '../components/MovieCard';
import FocusableButton from '../components/FocusableButton';

/** A 1920 px se aplica `xl:grid-cols-6`, que es el maximo que define la rejilla. */
const GRID_COLUMNS = 6;

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
  const currentPicks = isMovies ? movies : series;
  const selected = isMovies ? selectedMovies : selectedSeries;

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
    if (!loading && currentPicks.length > 0) {
      const target = `ob-card-${currentPicks[0].id}`;
      let attempts = 0;
      const tryFocus = () => {
        setFocus(target);
        attempts++;
        if (attempts < 5) setTimeout(tryFocus, 200);
      };
      setTimeout(tryFocus, 300);
    }
  }, [loading, currentPicks.length, step]);

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

  const canAdvance = (isMovies ? selectedMovies : selectedSeries).size >= 3;

  return (
    <Layout>
      <div className="pt-20 pb-2 px-6 md:px-14">
        <h1 className="text-white text-3xl md:text-4xl font-bold mb-2 tracking-tight animate-fade-in">
          {isMovies ? 'Elige películas que te gusten (máx. 10)' : 'Elige series que te gusten (máx. 10)'}
        </h1>
        <p className="text-gray-400 text-base md:text-lg mb-4 animate-fade-in">
          {isMovies
            ? 'Selecciona al menos 3 películas que hayas visto. Con esto personalizaremos tu inicio.'
            : 'Selecciona al menos 3 series que hayas visto. Con esto personalizaremos tu inicio.'}
        </p>
        <div className="flex items-center justify-between">
          <p className="text-gray-500 text-sm">{selected.size}/10 seleccionadas (mín. 3)</p>
          {isMovies ? (
            <FocusableButton focusKey="ob-next" onClick={handleNext}
              className={`px-8 py-3 rounded-xl font-semibold transition-all ${
                canAdvance ? 'bg-netflix-red hover:bg-netflix-red-hover text-white shadow-lg' : 'bg-white/10 text-gray-500'
              }`}>
              Siguiente
            </FocusableButton>
          ) : (
            <FocusableButton focusKey="ob-save" onClick={handleSave}
              className={`px-8 py-3 rounded-xl font-semibold transition-all ${
                canAdvance && !saving ? 'bg-netflix-red hover:bg-netflix-red-hover text-white shadow-lg' : 'bg-white/10 text-gray-500'
              }`}>
              {saving ? 'Guardando...' : 'Guardar y empezar'}
            </FocusableButton>
          )}
        </div>
      </div>

      {loading && currentPicks.length === 0 ? (
        <div className="px-6 md:px-14 py-20 text-center text-gray-500">Cargando...</div>
      ) : (
        <div className="px-6 md:px-14 mb-8">
          <FocusScope orientation="grid" columns={GRID_COLUMNS} index={1} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
            {currentPicks.map((item, i) => (
              <div key={item.id} className="relative cursor-pointer [&>div]:!w-full" onClick={() => toggle(item.tmdb_id)}>
                <MovieCard
                  index={i}
                  name={item.title}
                  posterUrl={item.poster}
                  year={item.year}
                  rating={item.rating}
                  hoverLabel={selected.has(item.tmdb_id) ? 'Quitar' : 'Seleccionar'}
                  actions="click"
                  onClick={() => toggle(item.tmdb_id)}
                  focusKey={`ob-card-${item.id}`}
                  forceFocus={item.id === currentPicks[0]?.id}
                />
                {selected.has(item.tmdb_id) && (
                  <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div className="w-12 h-12 rounded-full bg-netflix-red/90 flex items-center justify-center shadow-2xl">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </FocusScope>

          {hasMore && (
            <div ref={sentinelRef} className="py-8 text-center text-gray-600 text-sm">
              {loadMore ? 'Cargando más...' : 'Baja para ver más'}
            </div>
          )}

          {!hasMore && currentPicks.length > 0 && (
            <div className="py-4 text-center text-gray-600 text-sm">No hay más contenido</div>
          )}
        </div>
      )}

      <div className="px-6 md:px-14 py-4 text-center text-gray-600 text-sm">
        {hasMore ? (loadMore ? 'Cargando más...' : 'Baja para ver más') : 'No hay más contenido'}
      </div>
    </Layout>
  );
}
