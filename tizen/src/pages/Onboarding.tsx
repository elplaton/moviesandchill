import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { applyFocus, setFocus } from '../focus/engine';
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

// Con el teclado abierto caben cinco columnas en vez de ocho.
const COLUMNAS = 8;
const COLUMNAS_BUSCANDO = 5;
// Alto de una fila: carátula (276) + título y año (62) + separación (24).
const ALTO_FILA = 276 + 62 + 24;
// Se piden tres filas cada vez, y la siguiente tanda cuando al foco le quedan
// dos filas por debajo: con el mando se baja de fila en fila, así que da
// tiempo a que llegue antes de alcanzar el final.
const FILAS_POR_TANDA = 3;
const MARGEN_FILAS = 2;
const MINIMO = 3;
const TOPE = 10;

function Tarjeta({ item, index, marcada, onToggle, enfocar }: {
  item: Pick; index: number; marcada: boolean; onToggle: () => void;
  /** Quedarse el foco al aparecer (ver `inicial` en Onboarding). */
  enfocar?: () => void;
}) {
  const { ref, focusKey: id } = useFocusItem<HTMLDivElement>({ index, onEnter: onToggle });
  useEffect(() => {
    if (enfocar) { applyFocus(id); enfocar(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} onMouseEnter={() => applyFocus(id)} onClick={onToggle} className="tv-card w-[184px]">
      <div className={`relative w-[184px] h-[276px] rounded-lg overflow-hidden bg-tv-card ${
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
      <p className="mt-2 text-body truncate">{item.title}</p>
      {item.year && <p className="text-caption text-tv-text3">{item.year}</p>}
    </div>
  );
}

/**
 * Eleccion de gustos la primera vez, con el mando.
 *
 * La rejilla carga sola según se baja, sin botones de página: pasar de página
 * con el mando era ir hasta un botón, pulsarlo y volver a subir. Como en la
 * tele no hay barra de desplazamiento, la rejilla se mueve por `transform`
 * siguiendo a la fila enfocada, y los botones van arriba, junto al título,
 * porque debajo de una lista sin fin no se llegaría nunca a ellos.
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
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [texto, setTexto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  // Fila enfocada: decide cuánto se desplaza la rejilla.
  const [fila, setFila] = useState(0);
  // Cuantos hay en el catalogo sin filtrar: el minimo exigible se mide sobre
  // esto y no sobre lo que devuelva la busqueda.
  const [disponibles, setDisponibles] = useState(0);
  // Una respuesta atrasada no puede pisar a la ultima: al pasar de peliculas
  // a series podia llegar tarde la de peliculas y marcarse peliculas como series.
  const peticion = useRef(0);
  const pidiendo = useRef(false);
  // El foco tiene que empezar en la primera carátula, que es lo que se viene a
  // hacer aqui. Los botones se pintan antes que las carátulas (llegan por red),
  // asi que el motor de foco se queda con «Buscar» y `autoFocus` ya no actua
  // porque hay algo enfocado. Se hace una sola vez.
  const [inicial, setInicial] = useState(true);

  const columnas = buscando ? COLUMNAS_BUSCANDO : COLUMNAS;
  const porTanda = columnas * FILAS_POR_TANDA;

  const esPelis = paso === 'peliculas';
  const elegidas = esPelis ? pelis : series;

  /** `desde` = 0 empieza la lista de nuevo; si no, añade al final. */
  const cargar = useCallback(async (desde: number) => {
    const mia = ++peticion.current;
    pidiendo.current = true;
    setCargando(true);
    if (desde === 0) { setItems([]); setFila(0); setHayMas(true); }
    try {
      const q = busqueda ? `&q=${encodeURIComponent(busqueda)}` : '';
      const res = await apiFetch(`/onboarding/picks?offset=${desde}&limit=${porTanda}${q}`);
      const d = await res.json();
      if (mia !== peticion.current) return;
      const nuevos: Pick[] = (esPelis ? d.movies : d.series) || [];
      if (!busqueda && desde === 0) setDisponibles(nuevos.length);
      setItems(prev => {
        if (desde === 0) return nuevos;
        const ya = new Set(prev.map(p => p.id));
        return [...prev, ...nuevos.filter(n => !ya.has(n.id))];
      });
      setHayMas(nuevos.length === porTanda);
    } catch {
      if (mia !== peticion.current) return;
      setError('No se ha podido cargar el catalogo.');
      setHayMas(false);
    } finally {
      if (mia === peticion.current) { pidiendo.current = false; setCargando(false); }
    }
  }, [esPelis, busqueda, porTanda]);

  // Cambiar de paso, de búsqueda o de columnas empieza la lista de nuevo.
  useEffect(() => { cargar(0); }, [cargar]);

  // Con el mando se teclea despacio: medio segundo de margen va bien.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(texto.trim()), 500);
    return () => clearTimeout(t);
  }, [texto]);

  // Al abrir la búsqueda el foco va al teclado, que es a lo que se iba.
  useEffect(() => {
    if (!buscando) return;
    const raf = requestAnimationFrame(() => setFocus('onboarding-teclado'));
    return () => cancelAnimationFrame(raf);
  }, [buscando]);

  const alEnfocar = (i: number) => {
    const f = Math.floor(i / columnas);
    setFila(f);
    const filas = Math.ceil(items.length / columnas);
    if (hayMas && !pidiendo.current && f >= filas - 1 - MARGEN_FILAS) cargar(items.length);
  };

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

  // «Cerrar busqueda» la quita; «Listo» en el teclado solo lo esconde y deja
  // los resultados, con el foco en ellos (el teclado desaparece con el foco
  // dentro y, si no, el mando se quedaria sin nada enfocado).
  const cerrarBusqueda = () => { setBuscando(false); setTexto(''); };
  const terminarDeEscribir = () => {
    setBuscando(false);
    requestAnimationFrame(() => setFocus('onboarding-rejilla'));
  };

  // El minimo se adapta a lo que hay: con menos de tres en el catalogo,
  // exigir tres dejaba el boton apagado y no se podia terminar nunca.
  const minimo = Math.min(MINIMO, disponibles || MINIMO);
  const puedeSeguir = elegidas.size >= minimo && elegidas.size > 0;
  const vacio = !cargando && items.length === 0 && !busqueda;
  const sinResultados = !cargando && items.length === 0 && !!busqueda;
  // La fila enfocada queda la segunda: se ve la de antes y asoma la siguiente.
  const desplazamiento = Math.max(0, fila - 1) * ALTO_FILA;

  return (
    <div className="absolute inset-0 bg-tv-bg">
      <FocusScope id="onboarding" orientation="vertical" trap as="none">
        <div className="absolute left-[96px] right-[96px] top-[56px] flex items-end justify-between">
          <div>
            <h1 className="text-h1 font-bold">
              {esPelis ? 'Elige peliculas que te gusten' : 'Elige series que te gusten'}
            </h1>
            <p className="mt-2 text-lead text-tv-text2">
              Marca al menos {minimo || MINIMO} con OK. Con eso se arma tu portada.
            </p>
            <p className="mt-1 text-body text-tv-text3">
              {elegidas.size} de {TOPE} seleccionadas
              {error && <span className="ml-6 text-white">{error}</span>}
            </p>
          </div>

          {vacio ? (
            <FocusScope index={0} orientation="horizontal" className="flex space-x-5">
              <TvButton index={0} primary autoFocus onClick={guardar} disabled={guardando}>
                {guardando ? 'Entrando...' : 'Entrar de todas formas'}
              </TvButton>
            </FocusScope>
          ) : (
            <FocusScope index={0} orientation="horizontal" className="flex space-x-5">
              <TvButton index={0} onClick={() => (buscando ? cerrarBusqueda() : setBuscando(true))}>
                {buscando ? 'Cerrar busqueda' : 'Buscar'}
              </TvButton>
              {!esPelis && (
                <TvButton index={1} onClick={() => setPaso('peliculas')} disabled={guardando}>
                  Atras
                </TvButton>
              )}
              {esPelis ? (
                <TvButton index={2} primary onClick={() => setPaso('series')} disabled={!puedeSeguir}>
                  Siguiente
                </TvButton>
              ) : (
                <TvButton index={2} primary onClick={guardar} disabled={!puedeSeguir || guardando}>
                  {guardando ? 'Guardando...' : 'Guardar y empezar'}
                </TvButton>
              )}
            </FocusScope>
          )}
        </div>

        {vacio ? (
          <div className="absolute left-[96px] top-[260px]">
            <p className="text-lead text-tv-text2">Todavia no hay nada que elegir.</p>
            <p className="mt-2 text-body text-tv-text3 max-w-[900px]">
              El catalogo esta vacio o aun se esta indexando. Puedes entrar ya y configurar
              tus gustos mas adelante.
            </p>
          </div>
        ) : (
          <FocusScope index={1} orientation="horizontal"
            className="absolute left-[72px] right-[72px] top-[182px] bottom-0 flex items-start space-x-10">
            {/* Ventana de la rejilla: recorta lo que se ha ido hacia arriba.
                El relleno deja sitio a la carátula enfocada, que crece un 12 %. */}
            <div className="relative h-full overflow-hidden px-[24px] pt-[24px]"
              style={{ width: (buscando ? 1120 : 1728) + 48 }}>
              {sinResultados ? (
                <div className="h-[338px] flex flex-col justify-center">
                  <p className="text-lead text-tv-text2">Nada con «{busqueda}».</p>
                  <p className="mt-2 text-body text-tv-text3">
                    Prueba con menos palabras, o con el titulo original.
                  </p>
                </div>
              ) : (
                <div style={{
                  transform: `translate3d(0, ${-desplazamiento}px, 0)`,
                  transition: 'transform 220ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                }}>
                  <FocusScope id="onboarding-rejilla" index={0} orientation="grid" columns={columnas}
                    onChildFocus={alEnfocar}
                    className={`grid ${buscando ? 'grid-cols-5' : 'grid-cols-8'} gap-x-6 gap-y-6`}>
                    {items.map((item, i) => (
                      <Tarjeta key={item.id} item={item} index={i}
                        marcada={elegidas.has(item.tmdb_id)}
                        onToggle={() => marcar(item.tmdb_id)}
                        enfocar={inicial && i === 0 ? () => setInicial(false) : undefined} />
                    ))}
                  </FocusScope>
                  {cargando && items.length > 0 && (
                    <p className="mt-6 text-body text-tv-text3">Cargando mas...</p>
                  )}
                </div>
              )}
            </div>

            {buscando && (
              <div className="pt-[24px]">
                <FocusScope id="onboarding-teclado" index={1} orientation="vertical" as="none">
                  <Keyboard index={0} value={texto} onChange={setTexto}
                    placeholder={esPelis ? 'Titulo de la pelicula' : 'Titulo de la serie'}
                    onDone={terminarDeEscribir} />
                </FocusScope>
              </div>
            )}
          </FocusScope>
        )}
      </FocusScope>
    </div>
  );
}
