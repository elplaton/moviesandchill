import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface Pick {
  id: string;
  tmdb_id: number;
  title: string;
  poster?: string;
  year?: number;
}

const PAGINA = 30;
const MINIMO = 3;
const TOPE = 10;

/**
 * Elección de gustos al entrar por primera vez.
 *
 * Antes solo existía en la web de escritorio: quien entrara desde el móvil no
 * tenía forma de guardar sus preferencias, así que la portada se quedaba sin
 * personalizar y al abrir la web le seguía pidiendo lo mismo una y otra vez.
 */
export default function Onboarding() {
  const { refreshPrefs } = useAuth();
  const navigate = useNavigate();
  const [paso, setPaso] = useState<'peliculas' | 'series'>('peliculas');
  const [items, setItems] = useState<Pick[]>([]);
  const [pelis, setPelis] = useState<Set<number>>(new Set());
  const [series, setSeries] = useState<Set<number>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [hayMas, setHayMas] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [tope, setTope] = useState(false);
  const centinela = useRef<HTMLDivElement>(null);

  const esPelis = paso === 'peliculas';
  const elegidas = esPelis ? pelis : series;

  const cargar = useCallback(async (desde: number) => {
    try {
      const res = await apiFetch(`/onboarding/picks?offset=${desde}&limit=${PAGINA}`);
      const d = await res.json();
      const nuevos: Pick[] = (esPelis ? d.movies : d.series) || [];
      if (nuevos.length < PAGINA) setHayMas(false);
      setItems(prev => (desde === 0 ? nuevos : [...prev, ...nuevos]));
    } catch {
      setError('No se ha podido cargar el catálogo.');
    } finally {
      setCargando(false);
      setCargandoMas(false);
    }
  }, [esPelis]);

  useEffect(() => {
    setCargando(true);
    setHayMas(true);
    setItems([]);
    cargar(0);
  }, [paso]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hayMas || cargando) return;
    const el = centinela.current;
    if (!el) return;
    const obs = new IntersectionObserver(e => {
      if (e[0].isIntersecting && !cargandoMas) {
        setCargandoMas(true);
        cargar(items.length);
      }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hayMas, cargando, cargandoMas, items.length, cargar]);

  const marcar = (tmdbId: number) => {
    const set = esPelis ? setPelis : setSeries;
    set(prev => {
      const sig = new Set(prev);
      if (sig.has(tmdbId)) { sig.delete(tmdbId); setTope(false); }
      else if (sig.size < TOPE) sig.add(tmdbId);
      else setTope(true);
      return sig;
    });
  };

  const guardar = async () => {
    setGuardando(true);
    setError('');
    try {
      const res = await apiFetch('/preferences', {
        method: 'POST',
        body: JSON.stringify({ movies: [...pelis], series: [...series] }),
      });
      if (!res.ok) { setError('No se han podido guardar. Inténtalo otra vez.'); return; }
      await refreshPrefs();
      navigate('/', { replace: true });
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setGuardando(false);
    }
  };

  // El minimo se adapta a lo que hay: con menos de tres en el catalogo,
  // exigir tres dejaba el boton apagado y no se podia terminar nunca.
  const minimo = Math.min(MINIMO, items.length);
  const puedeSeguir = elegidas.size >= minimo && elegidas.size > 0;
  const boton = 'w-full h-12 rounded-xl text-[15px] font-semibold disabled:opacity-40';

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-[24px] font-bold leading-tight">
        {esPelis ? 'Elige películas que te gusten' : 'Elige series que te gusten'}
      </h1>
      <p className="mt-1.5 text-[14px] text-nf-text2">
        Marca al menos {minimo || MINIMO}. Con eso se arma tu portada.
      </p>
      <p className="mt-3 text-[13px] text-nf-text3">
        {elegidas.size} de {TOPE} seleccionadas
        {tope && <span className="text-nf-text2"> · quita alguna para cambiarla</span>}
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-nf-red/40 bg-nf-red/10 px-4 py-3 text-[14px]">{error}</p>
      )}

      {cargando ? (
        <p className="mt-10 text-[14px] text-nf-text3">Cargando…</p>
      ) : items.length === 0 ? (
        <div className="mt-10">
          <p className="text-[15px] text-nf-text2">Todavía no hay nada que elegir.</p>
          <p className="mt-1 text-[13px] text-nf-text3">
            El catálogo está vacío o aún se está indexando. Puedes entrar ya y configurar
            tus gustos más adelante.
          </p>
          <button onClick={guardar} disabled={guardando} className={`${boton} mt-5 bg-nf-red`}>
            {guardando ? 'Entrando…' : 'Entrar de todas formas'}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-3 gap-x-3 gap-y-4">
            {items.map(item => {
              const on = elegidas.has(item.tmdb_id);
              return (
                <button key={item.id} onClick={() => marcar(item.tmdb_id)} className="text-left active:opacity-70">
                  <div className={`relative rounded-lg overflow-hidden bg-nf-card aspect-[2/3] ${
                    on ? 'outline outline-2 outline-nf-red outline-offset-2' : ''}`}>
                    {item.poster
                      ? <img src={item.poster} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      : <div className="absolute inset-0 p-2 flex items-end text-[12px] font-semibold leading-tight text-nf-text2">{item.title}</div>}
                    {on && (
                      <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-nf-red flex items-center justify-center text-[14px] font-bold">✓</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[12px] font-medium leading-tight line-clamp-2">{item.title}</p>
                  {item.year && <p className="text-[11px] text-nf-text3">{item.year}</p>}
                </button>
              );
            })}
          </div>

          {hayMas && (
            <div ref={centinela} className="py-8 text-center text-[13px] text-nf-text3">
              {cargandoMas ? 'Cargando más…' : 'Baja para ver más'}
            </div>
          )}
        </>
      )}

      {/* Barra fija: en el móvil el botón no puede quedarse al final de una
          lista infinita, no se encontraría nunca. */}
      {items.length > 0 && (
        <div className="fixed left-0 right-0 bottom-0 px-4 pt-3 bg-gradient-to-t from-black via-black/95 to-transparent"
          style={{ paddingBottom: 'calc(12px + var(--safe-b))' }}>
          <div className="flex gap-3">
            {!esPelis && (
              <button onClick={() => setPaso('peliculas')} disabled={guardando}
                className={`${boton} bg-white/10`}>Atrás</button>
            )}
            {esPelis ? (
              <button onClick={() => setPaso('series')} disabled={!puedeSeguir} className={`${boton} bg-nf-red`}>
                Siguiente
              </button>
            ) : (
              <button onClick={guardar} disabled={!puedeSeguir || guardando} className={`${boton} bg-nf-red`}>
                {guardando ? 'Guardando…' : 'Guardar y empezar'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
