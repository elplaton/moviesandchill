import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import Poster from '../components/Poster';
import Row from '../components/Row';
import Secciones from '../components/Secciones';
import TopRow from '../components/TopRow';
import { useCarriles } from '../hooks/useCarriles';
import type { SeccionFila } from '../types';

/** Cabecera de cada plataforma: su logo y su nombre (solo el nombre si TMDB
 *  no tiene logo). */
function Cabecera({ s, primera }: { s: SeccionFila; primera: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 mb-3 ${primera ? '' : 'mt-10'}`}>
      {s.logo && <img src={s.logo} alt="" className="w-9 h-9 rounded-lg object-cover bg-nf-card shrink-0" />}
      <h2 className="text-[20px] font-bold leading-tight">{s.nombre}</h2>
    </div>
  );
}

/**
 * Una seccion por plataforma (Netflix, HBO Max, Disney+...): sus tops de
 * peliculas y series, con lo que no tenemos para pedirlo, y lo mas nuevo de
 * cada una que hay en el catalogo, que se pagina con el mismo motor que la
 * portada. Las filas llegan del servidor ya en orden y agrupadas, asi que la
 * cabecera sale cada vez que cambia la plataforma.
 */
export default function Plataformas() {
  const { carriles: rows, loading, cargarMas, scrollXDe, recordarScrollX, marcarPedida } = useCarriles(undefined, 'plataformas');
  const link = (i: { tmdb_id: number; media_type: string }) => `/t/${i.media_type}/${i.tmdb_id}`;

  return (
    <div className="pb-4">
      <div className="px-4 pb-4" style={{ paddingTop: 'calc(var(--safe-t) + 16px)' }}>
        <Secciones />
        <h1 className="mt-4 text-[26px] font-bold leading-tight">Plataformas</h1>
        <p className="mt-1 text-[13px] text-nf-text3">Lo más visto de cada una y lo más nuevo que tenemos</p>
      </div>
      {rows.map((r, n) => {
        const nueva = r.seccion && r.seccion.clave !== rows[n - 1]?.seccion?.clave;
        return (
          <Fragment key={r.genre}>
            {nueva && r.seccion && <Cabecera s={r.seccion} primera={n === 0} />}
            {r.top
              ? <TopRow carril={r} scrollX={scrollXDe(r.genre)} onScrollX={x => recordarScrollX(r.genre, x)} onPedida={marcarPedida} />
              : (
                <Row title={r.titulo ?? r.genre}
                  onNearEnd={r.key ? () => cargarMas(r.genre, 1) : undefined}
                  onNearStart={r.key ? () => cargarMas(r.genre, -1) : undefined}
                  shift={r.shift}
                  scrollX={scrollXDe(r.genre)}
                  onScrollX={x => recordarScrollX(r.genre, x)}>
                  {r.items.map(i => <Poster key={`${r.genre}-${i.id}`} to={link(i)} title={i.title} poster={i.poster} subtitle={i.media_type === 'series' && i.episode_count ? `${i.episode_count} ep.` : i.year ? String(i.year) : undefined} />)}
                </Row>
              )}
          </Fragment>
        );
      })}
      {loading && <p className="px-4 text-nf-text3 text-[14px]">Cargando…</p>}
      {!loading && rows.length === 0 && (
        <p className="px-4 text-nf-text3 text-[14px]">
          Todavía no hay nada aquí: el servidor está mirando en qué plataforma está cada título. <Link to="/" className="underline">Volver al inicio</Link>
        </p>
      )}
    </div>
  );
}
