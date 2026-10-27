import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { guardarUltimaBusqueda, leerUltimaBusqueda, ultimaBusquedaEnMemoria } from '../services/estado';
import { apiFetch } from '../services/api';
import { groupSearchResults } from '../utils/search';
import { cleanTitle } from '../utils/text';
import { ISearch } from '../components/Icons';
import type { SearchResult } from '../types';
import { buscarParaPedir, estaPedida, pedir, textoAlPedir, TIPO_PETICION, type ResultadoPeticion } from '../services/peticiones';
import { toast } from '../utils/toast';

function Result({ to, poster, title, meta }: { to: string; poster?: string; title: string; meta: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-2 active:bg-white/5">
      <div className="w-[52px] h-[78px] rounded-md bg-nf-card overflow-hidden shrink-0">{poster && <img src={poster} alt="" className="w-full h-full object-cover" />}</div>
      <div className="min-w-0"><p className="text-[15px] font-medium truncate">{title}</p><p className="text-[12px] text-nf-text3 truncate">{meta}</p></div>
    </Link>
  );
}

/** Un título de TMDB que no tenemos, con su botón de pedirlo. */
function Pedible({ r, onPedida }: { r: ResultadoPeticion; onPedida: (estado: 'en_cola' | 'enviada') => void }) {
  const [enviando, setEnviando] = useState(false);
  const p = r.peticion;
  // Una pedida que fallo se puede volver a pedir; una pedida por otro (en la
  // cola o ya mandada) se puede "esperar" tambien: mismo POST, el servidor la
  // suma sin mandar nada.
  const pedidaPorMi = estaPedida(p?.estado) && !!p?.mia;
  const deOtro = estaPedida(p?.estado) && !p?.mia;
  const accion = async () => {
    setEnviando(true);
    try {
      const d = await pedir(r.tmdb_id, r.media_type);
      onPedida(d.estado);
      toast(await textoAlPedir(d), 'ok', 5000);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se ha podido pedir', 'error', 6000);
    } finally { setEnviando(false); }
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="w-[52px] h-[78px] rounded-md bg-nf-card overflow-hidden shrink-0">{r.poster && <img src={r.poster} alt="" loading="lazy" className="w-full h-full object-cover" />}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium truncate">{r.title}</p>
        <p className="text-[12px] text-nf-text3 truncate">{TIPO_PETICION[r.media_type]}{r.year ? ` · ${r.year}` : ''}</p>
      </div>
      <button onClick={accion} disabled={enviando || pedidaPorMi}
        className={`shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60 ${pedidaPorMi ? 'bg-white/10 text-nf-text2' : 'bg-white text-black'}`}>
        {pedidaPorMi ? 'Pedida' : enviando ? 'Pidiendo…' : deOtro ? 'Avisarme' : 'Pedir'}
      </button>
    </div>
  );
}

/** Búsqueda con el teclado del sistema; resultados según se escribe. */
export default function Search() {
  // Lo último buscado es de la cuenta: se ve igual en el móvil, en la web y en
  // la tele. Si ya se sabe en esta sesión se pinta de entrada; si no, se pide.
  const [q, setQ] = useState(ultimaBusquedaEnMemoria() || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Número de la petición en vuelo: una respuesta lenta de un término viejo
  // no debe pisar los resultados de lo que se está escribiendo ahora.
  const lastRequest = useRef(0);
  // Pedir lo que no esta: TMDB solo se consulta al pulsar, nunca por tecla,
  // y con el termino que habia en ese momento. Al cambiarlo la lista se cierra
  // (seria la respuesta a otra pregunta) y vuelve a salir el boton.
  const [fuera, setFuera] = useState<null | { estado: 'buscando' | 'listo' | 'error'; items: ResultadoPeticion[] }>(null);
  const lastPedibles = useRef(0);

  // Se pide una vez, y solo se aplica si no se ha empezado a escribir ya.
  useEffect(() => {
    if (ultimaBusquedaEnMemoria() !== null) return;
    let vivo = true;
    leerUltimaBusqueda().then(t => { if (vivo && t) setQ(actual => actual || t); }).catch(() => {});
    return () => { vivo = false; };
  }, []);

  // Guardar, pero no antes de saber lo que había guardado: al montar el campo
  // está vacío, y guardar ese vacío borraría el término antes de poder leerlo.
  useEffect(() => {
    if (ultimaBusquedaEnMemoria() === null) return;
    guardarUltimaBusqueda(q);
  }, [q]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); setBusy(false); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      const mine = ++lastRequest.current;
      try {
        const d = await (await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: q.trim(), page_size: 100 }) })).json();
        if (mine !== lastRequest.current) return;
        setResults(d.results || []);
      }
      catch {} finally { if (mine === lastRequest.current) setBusy(false); }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  useEffect(() => { lastPedibles.current++; setFuera(null); }, [q]);

  const buscarEnTmdb = () => {
    const term = q.trim();
    if (term.length < 2) return;
    const mine = ++lastPedibles.current;
    setFuera({ estado: 'buscando', items: [] });
    buscarParaPedir(term)
      .then(rs => { if (mine === lastPedibles.current) setFuera({ estado: 'listo', items: rs.filter(r => !r.en_catalogo) }); })
      .catch(() => { if (mine === lastPedibles.current) setFuera({ estado: 'error', items: [] }); });
  };

  // Tras pedir, el botón pasa a «Pedida» sin volver a buscar.
  const marcarPedida = (r: ResultadoPeticion, estado: 'en_cola' | 'enviada') => setFuera(p => p && { ...p, items: p.items.map(x =>
    x.tmdb_id === r.tmdb_id && x.media_type === r.media_type ? { ...x, peticion: { estado, mia: true } } : x) });

  const g = useMemo(() => groupSearchResults(results), [results]);
  const seriesItems = g.groups.map(s => {
    const f = s.episodes[0];
    const to = s.tmdbId ? `/t/series/${s.tmdbId}` : `/t/series/0?q=${encodeURIComponent(s.seriesName)}`;
    return <Result key={s.groupKey} to={to} poster={f.tmdb_poster} title={s.seriesName} meta={`${s.episodes.length} episodios encontrados${f.tmdb_year ? ` · ${f.tmdb_year}` : ''}`} />;
  });
  const movieItems = [...g.movieGroups.entries()].map(([k, items]) => {
    const f = items[0]; const title = f.tmdb_title || cleanTitle(f.file_name);
    const to = f.tmdb_id ? `/t/movie/${f.tmdb_id}` : `/t/movie/0?q=${encodeURIComponent(title)}`;
    return <Result key={k} to={to} poster={f.tmdb_poster} title={title} meta={`${items.length} ${items.length === 1 ? 'archivo' : 'archivos'}${f.tmdb_year ? ` · ${f.tmdb_year}` : ''}`} />;
  });

  return (
    <div>
      <div className="sticky top-0 z-30 bg-nf-bg/95 backdrop-blur px-4 pb-3" style={{ paddingTop: 'calc(var(--safe-t) + 12px)' }}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-nf-text3"><ISearch /></span>
          <input ref={inputRef} type="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" placeholder="Película o serie"
            value={q} onChange={e => setQ(e.target.value)}
            className="w-full h-12 rounded-xl bg-white/10 pl-11 pr-4 text-[16px] outline-none focus:bg-white/15" />
        </div>
      </div>
      {q.trim().length < 2 && <p className="px-4 pt-6 text-nf-text3 text-[14px]">Escribe al menos dos letras. Los resultados se agrupan en series y películas.</p>}
      {busy && results.length === 0 && <p className="px-4 pt-6 text-nf-text3 text-[14px]">Buscando…</p>}
      {seriesItems.length > 0 && <><h2 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-nf-text2">Series</h2>{seriesItems}</>}
      {movieItems.length > 0 && <><h2 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-nf-text2">Películas</h2>{movieItems}</>}
      {!busy && q.trim().length >= 2 && results.length === 0 && <p className="px-4 pt-6 text-nf-text3 text-[14px]">Nada con "{q.trim()}" en el catálogo.</p>}
      {/* Sin resultados el boton va destacado; con resultados, un enlace
          discreto al final por si lo que se busca es otra cosa. */}
      {!busy && q.trim().length >= 2 && !fuera && (results.length === 0 ? (
        <div className="px-4 pt-4">
          <button onClick={buscarEnTmdb} className="w-full h-12 rounded-xl bg-white text-black text-[15px] font-semibold truncate px-4">
            Pedir «{q.trim()}»
          </button>
          <p className="pt-2 text-[12px] text-nf-text3">Lo buscamos fuera del catálogo y, si lo pides, te avisamos cuando llegue.</p>
        </div>
      ) : (
        <button onClick={buscarEnTmdb} className="block px-4 pt-5 pb-2 text-[13px] text-nf-text3 underline underline-offset-2">
          ¿No está lo que buscas? Pídelo
        </button>
      ))}
      {q.trim().length >= 2 && fuera && (
        <>
          <h2 className="px-4 pt-6 pb-1 text-[13px] font-semibold text-nf-text2">Pedir «{q.trim()}»</h2>
          {fuera.estado === 'buscando' && <p className="px-4 pt-2 text-nf-text3 text-[14px]">Buscando en TMDB…</p>}
          {fuera.estado === 'error' && <p className="px-4 pt-2 text-nf-text3 text-[14px]">No se ha podido buscar en TMDB. <button onClick={buscarEnTmdb} className="underline">Reintentar</button></p>}
          {fuera.estado === 'listo' && fuera.items.length === 0 && <p className="px-4 pt-2 text-nf-text3 text-[14px]">TMDB no conoce nada con ese nombre que no tengamos ya.</p>}
          {fuera.items.map(r => <Pedible key={`${r.media_type}:${r.tmdb_id}`} r={r} onPedida={estado => marcarPedida(r, estado)} />)}
        </>
      )}
    </div>
  );
}
