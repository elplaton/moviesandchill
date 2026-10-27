import { Link } from 'react-router-dom';
import Poster from '../components/Poster';
import Row from '../components/Row';
import Secciones from '../components/Secciones';
import { useCarriles } from '../hooks/useCarriles';

/**
 * Lo mas nuevo de Netflix, HBO Max, Disney+, Prime Video, Movistar Plus+ y Crunchyroll que
 * tenemos en el catalogo: una fila por plataforma, montadas en el servidor y
 * paginadas con el mismo motor que la portada.
 */
export default function Plataformas() {
  const { carriles: rows, loading, cargarMas, scrollXDe, recordarScrollX } = useCarriles(undefined, 'plataformas');
  const link = (i: { tmdb_id: number; media_type: string }) => `/t/${i.media_type}/${i.tmdb_id}`;

  return (
    <div className="pb-4">
      <div className="px-4 pb-4" style={{ paddingTop: 'calc(var(--safe-t) + 16px)' }}>
        <Secciones />
        <h1 className="mt-4 text-[26px] font-bold leading-tight">Plataformas</h1>
        <p className="mt-1 text-[13px] text-nf-text3">Lo más nuevo de cada una que tenemos</p>
      </div>
      {rows.map(r => (
        <Row key={r.genre} title={r.genre}
          onNearEnd={r.key ? () => cargarMas(r.genre, 1) : undefined}
          onNearStart={r.key ? () => cargarMas(r.genre, -1) : undefined}
          shift={r.shift}
          scrollX={scrollXDe(r.genre)}
          onScrollX={x => recordarScrollX(r.genre, x)}>
          {r.items.map(i => <Poster key={`${r.genre}-${i.id}`} to={link(i)} title={i.title} poster={i.poster} subtitle={i.media_type === 'series' && i.episode_count ? `${i.episode_count} ep.` : i.year ? String(i.year) : undefined} />)}
        </Row>
      ))}
      {loading && <p className="px-4 text-nf-text3 text-[14px]">Cargando…</p>}
      {!loading && rows.length === 0 && (
        <p className="px-4 text-nf-text3 text-[14px]">
          Todavía no hay nada aquí: el servidor está mirando en qué plataforma está cada título. <Link to="/" className="underline">Volver al inicio</Link>
        </p>
      )}
    </div>
  );
}
