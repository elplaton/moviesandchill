import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { applyFocus } from '../focus/engine';
import { FocusScope, useFocusItem } from '../focus/react';
import TvButton from '../components/TvButton';
import Keyboard from '../components/Keyboard';

interface Pick {
  id: string;
  tmdb_id: number;
  title: string;
  poster?: string;
  year?: number;
}

// Dos filas es lo que entra sin tener que desplazar. Con el teclado abierto
// caben cuatro columnas en vez de seis.
const COLUMNAS = 6;
const COLUMNAS_BUSCANDO = 4;
const MINIMO = 3;
const TOPE = 10;

function Tarjeta({ item, index, marcada, onToggle }: {
  item: Pick; index: number; marcada: boolean; onToggle: () => void;
}) {
  const { ref, focusKey: id } = useFocusItem<HTMLDivElement>({ index, onEnter: onToggle });
  return (
    <div ref={ref} onMouseEnter={() => applyFocus(id)} onClick={onToggle} className="tv-card w-[248px]">
      <div className={`relative w-[248px] h-[372px] rounded-lg overflow-hidden bg-tv-card ${
        marcada ? 'outline outline-4 outline-tv-red' : ''}`}>
        {item.poster
          ? <img src={item.poster} alt="" className="absolute inset-0 w-full h-full object-cover" />
          : <div className="absolute inset-0 p-4 flex items-end text-body font-semibold text-tv-text2">{item.title}</div>}
        {marcada && (
          <span className="absolute top-3 right-3 w-12 h-12 rounded-full bg-tv-red flex items-center justify-center text-[26px] font-bold">
            ✓
          </span>
        )}
      </div>
      <p className="mt-3 text-body truncate">{item.title}</p>
      {item.year && <p className="text-caption text-tv-text3">{item.year}</p>}
    </div>
  );
}

/**
 * Eleccion de gustos la primera vez, con el mando.
 *
 * Va por paginas de dos filas en vez de una lista larga: en la tele no hay
 * barra de desplazamiento y bajar fila a fila por un catalogo entero con el
 * mando es insufrible. OK marca, y los botones de abajo pasan de pagina y de
 * paso.
 */
export default function Onboarding() {
  const { refreshPrefs } = useAuth();
  const navigate = useNavigate();
  const [paso, setPaso] = useState<'peliculas' | 'series'>('peliculas');
  const [pagina, setPagina] = useState(0);
  const [items, setItems] = useState<Pick[]>([]);
  const [pelis, setPelis] = useState<Set<number>>(new Set());
  const [series, setSeries] = useState<Set<number>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [hayMas, setHayMas] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [texto, setTexto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  // Cuantos hay en el catalogo sin filtrar: el minimo exigible se mide sobre
  // esto y no sobre lo que devuelva la busqueda.
  const [disponibles, setDisponibles] = useState(0);

  const columnas = buscando ? COLUMNAS_BUSCANDO : COLUMNAS;
  const porPagina = columnas * 2;

  const esPelis = paso === 'peliculas';
  const elegidas = esPelis ? pelis : series;

  const cargar = useCallback(async (p: number) => {
    setCargando(true);
    try {
      const q = busqueda ? `&q=${encodeURIComponent(busqueda)}` : '';
      const res = await apiFetch(`/onboarding/picks?offset=${p * porPagina}&limit=${porPagina}${q}`);
      const d = await res.json();
      const nuevos: Pick[] = (esPelis ? d.movies : d.series) || [];
      if (!busqueda && p === 0) setDisponibles(nuevos.length);
      setItems(nuevos);
      setHayMas(nuevos.length === porPagina);
    } catch {
      setError('No se ha podido cargar el catalogo.');
      setItems([]);
    } finally {
      setCargando(false);
    }
  }, [esPelis, busqueda, porPagina]);

  // Con el mando se teclea despacio: medio segundo de margen va bien.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(texto.trim()), 500);
    return () => clearTimeout(t);
  }, [texto]);

  useEffect(() => { cargar(pagina); }, [cargar, pagina]);
  useEffect(() => { setPagina(0); }, [paso, busqueda]);

  const marcar = (tmdbId: number) => {
    const set = esPelis ? setPelis : setSeries;
    set(prev => {
      const sig = new Set(prev);
      if (sig.has(tmdbId)) sig.delete(tmdbId);
      else if (sig.size < TOPE) sig.add(tmdbId);
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
      if (!res.ok) { setError('No se han podido guardar. Intentalo otra vez.'); return; }
      await refreshPrefs();
      navigate('/', { replace: true });
    } catch {
      setError('Sin conexion con el servidor.');
    } finally {
      setGuardando(false);
    }
  };

  // El minimo se adapta a lo que hay: con menos de tres en el catalogo,
  // exigir tres dejaba el boton apagado y no se podia terminar nunca.
  const minimo = Math.min(MINIMO, disponibles || MINIMO);
  const puedeSeguir = elegidas.size >= minimo && elegidas.size > 0;
  const vacio = !cargando && items.length === 0 && pagina === 0 && !busqueda;
  const sinResultados = !cargando && items.length === 0 && !!busqueda;

  return (
    <div className="absolute inset-0 bg-tv-bg px-[96px] py-[64px]">
      <h1 className="text-h1 font-bold">
        {esPelis ? 'Elige peliculas que te gusten' : 'Elige series que te gusten'}
      </h1>
      <p className="mt-2 text-lead text-tv-text2">
        Marca al menos {minimo || MINIMO} con OK. Con eso se arma tu portada.
      </p>
      <p className="mt-2 text-body text-tv-text3">
        {elegidas.size} de {TOPE} seleccionadas
        {error && <span className="ml-6 text-white">{error}</span>}
      </p>

      <FocusScope id="onboarding" orientation="vertical" trap as="none">
        {vacio ? (
          <div className="mt-16">
            <p className="text-lead text-tv-text2">Todavia no hay nada que elegir.</p>
            <p className="mt-2 text-body text-tv-text3 max-w-[900px]">
              El catalogo esta vacio o aun se esta indexando. Puedes entrar ya y configurar
              tus gustos mas adelante.
            </p>
            <div className="mt-8">
              <TvButton index={0} primary autoFocus onClick={guardar} disabled={guardando}>
                {guardando ? 'Entrando...' : 'Entrar de todas formas'}
              </TvButton>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-8 flex items-start space-x-10">
              <div style={{ width: buscando ? 1120 : 1728 }}>
                {sinResultados ? (
                  <div className="h-[372px] flex flex-col justify-center">
                    <p className="text-lead text-tv-text2">Nada con «{busqueda}».</p>
                    <p className="mt-2 text-body text-tv-text3">
                      Prueba con menos palabras, o con el titulo original.
                    </p>
                  </div>
                ) : (
                  <FocusScope index={0} orientation="grid" columns={columnas}
                    className={`grid ${buscando ? 'grid-cols-4' : 'grid-cols-6'} gap-x-6 gap-y-8`}>
                    {items.map((item, i) => (
                      <Tarjeta key={item.id} item={item} index={i}
                        marcada={elegidas.has(item.tmdb_id)}
                        onToggle={() => marcar(item.tmdb_id)} />
                    ))}
                  </FocusScope>
                )}
              </div>

              {buscando && (
                <FocusScope index={1} orientation="vertical" as="none">
                  <Keyboard index={0} value={texto} onChange={setTexto} autoFocus
                    placeholder={esPelis ? 'Titulo de la pelicula' : 'Titulo de la serie'}
                    onDone={() => setBuscando(false)} />
                </FocusScope>
              )}
            </div>

            <FocusScope index={buscando ? 2 : 1} orientation="horizontal" className="mt-10 flex space-x-5">
              <TvButton index={0} onClick={() => { setBuscando(b => !b); if (buscando) { setTexto(''); } }}>
                {buscando ? 'Cerrar busqueda' : 'Buscar'}
              </TvButton>
              {pagina > 0 && !buscando && (
                <TvButton index={1} onClick={() => setPagina(p => p - 1)} disabled={cargando}>
                  Anteriores
                </TvButton>
              )}
              {hayMas && (
                <TvButton index={2} onClick={() => setPagina(p => p + 1)} disabled={cargando}>
                  Ver mas
                </TvButton>
              )}
              {!esPelis && (
                <TvButton index={2} onClick={() => setPaso('peliculas')} disabled={guardando}>
                  Atras
                </TvButton>
              )}
              {esPelis ? (
                <TvButton index={3} primary onClick={() => setPaso('series')} disabled={!puedeSeguir}>
                  Siguiente
                </TvButton>
              ) : (
                <TvButton index={3} primary onClick={guardar} disabled={!puedeSeguir || guardando}>
                  {guardando ? 'Guardando...' : 'Guardar y empezar'}
                </TvButton>
              )}
            </FocusScope>
          </>
        )}
      </FocusScope>
    </div>
  );
}
