/**
 * «Abre este título», desde donde sea.
 *
 * En la tele la ficha (`TitleDetail`) la abre cada página con su propio
 * estado, no una URL como en la web. La pantalla del final del reproductor
 * necesita abrir la ficha de un relacionado esté donde esté (dentro de la
 * ficha de otro título, en la portada, en Descargas...), así que cada página
 * que sabe abrir fichas se apunta aquí y la última que se montó es la que lo
 * hace.
 */
import { fetchMediaFiles } from '../services/media';
import type { DetailInput } from '../components/TitleDetail';
import type { Relacionado } from '../services/siguiente';

type Oyente = (d: DetailInput) => void;
const oyentes: Oyente[] = [];

/** Se apunta una página; devuelve con qué darse de baja (para un useEffect). */
export function escucharAbrirTitulo(f: Oyente): () => void {
  oyentes.push(f);
  return () => {
    const i = oyentes.lastIndexOf(f);
    if (i >= 0) oyentes.splice(i, 1);
  };
}

/** Abre la ficha de `r` en la página de delante. false si no hay ninguna. */
export async function abrirTitulo(r: Relacionado): Promise<boolean> {
  const abrir = oyentes[oyentes.length - 1];
  if (!abrir) return false;
  const meta = {
    key: r.id, title: r.title, kind: r.media_type,
    poster: r.poster || undefined, backdrop: r.backdrop || undefined,
    year: r.year || undefined, rating: r.rating || undefined,
  };
  let files: DetailInput['files'] = [];
  try {
    files = (await fetchMediaFiles(r.tmdb_id, r.media_type)).results;
  } catch { /* sin archivos se abre igual: la ficha dice que no hay */ }
  abrir({ kind: r.media_type, tmdbId: r.tmdb_id, meta, files });
  return true;
}
