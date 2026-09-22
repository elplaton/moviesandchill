import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, streamUrl } from '../services/api';
import { fetchMediaFiles } from '../services/media';
import { continueWatching, type Watched } from '../tv/progress';
import { toast } from '../tv/toast';
import Screen from '../components/Screen';
import Row from '../components/Row';
import PosterCard from '../components/PosterCard';
import TitleDetail, { type DetailInput } from '../components/TitleDetail';
import Player from '../components/Player';
import type { BrowseItem, BrowseRow, Featured } from '../types';

interface Props {
  filter?: 'movie' | 'series';
  heading: string;
}

const ROWS_AROUND = 2;

function toFeatured(item: BrowseItem, rowKey: string): Featured {
  return {
    key: `${rowKey}-${item.id}`,
    title: item.title,
    kind: item.media_type,
    poster: item.poster,
    backdrop: item.backdrop,
    year: item.year,
    rating: item.rating,
    overview: item.overview,
    genres: item.genres,
    subtitle: item.media_type === 'series' && item.episode_count ? `${item.episode_count} episodios` : undefined,
  };
}

function watchedToFeatured(w: Watched): Featured {
  return {
    key: `cw-${w.path}`,
    title: w.title,
    kind: 'file',
    poster: w.poster,
    backdrop: w.backdrop,
    subtitle: w.subtitle ? `${w.subtitle} · ${Math.round((w.position / w.duration) * 100)} %` : `${Math.round((w.position / w.duration) * 100)} % visto`,
    progress: w.position / w.duration,
  };
}

/**
 * Portada, Peliculas y Series: carriles por genero sobre /browse/home. Solo
 * montan tarjetas las filas cercanas a la enfocada; el resto deja su hueco.
 */
export default function Catalog({ filter, heading }: Props) {
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusRow, setFocusRow] = useState(0);
  const [detail, setDetail] = useState<DetailInput | null>(null);
  const [playing, setPlaying] = useState<Watched | null>(null);
  const [resume, setResume] = useState<Watched[]>(() => (filter ? [] : continueWatching()));

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/browse/home');
        const data = await res.json();
        let list: BrowseRow[] = data.rows || [];
        if (filter) {
          list = list.map((r) => ({ ...r, items: r.items.filter((i) => i.media_type === filter) })).filter((r) => r.items.length > 0);
        }
        setRows(list);
      } catch {
        toast('No se ha podido cargar el catálogo', 'error', 5000);
      } finally {
        setLoading(false);
      }
    })();
  }, [filter]);

  const featuredRows = useMemo(() => rows.map((r) => ({
    genre: r.genre,
    items: r.items.map((it) => ({ item: it, f: toFeatured(it, r.genre) })),
  })), [rows]);

  const openItem = useCallback(async (item: BrowseItem, f: Featured) => {
    try {
      const { results } = await fetchMediaFiles(item.tmdb_id, item.media_type);
      setDetail({ kind: item.media_type, tmdbId: item.tmdb_id, meta: f, files: results });
    } catch {
      setDetail({ kind: item.media_type, tmdbId: item.tmdb_id, meta: f, files: [] });
    }
  }, []);

  const onPlayerClose = useCallback(() => {
    setPlaying(null);
    setResume(continueWatching());
  }, []);

  const hasResume = resume.length > 0;
  const rowOffset = hasResume ? 1 : 0;
  const isMounted = (i: number) => Math.abs(i - focusRow) <= ROWS_AROUND;
  const fallback = featuredRows[0]?.items[0]?.f || null;

  return (
    <Screen hero heading={heading} heroFallback={fallback} ready={!loading && (rows.length > 0 || hasResume)} onRowFocus={setFocusRow}>
      {hasResume && (
        <Row index={0} title="Continuar viendo">
          {resume.map((w, i) => (
            <PosterCard key={w.path} index={i} item={watchedToFeatured(w)} autoFocus={i === 0} onSelect={() => setPlaying(w)} />
          ))}
        </Row>
      )}

      {featuredRows.map((row, ri) => (
        <Row key={row.genre} index={ri + rowOffset} title={row.genre}>
          {isMounted(ri + rowOffset)
            ? row.items.map(({ item, f }, i) => (
                <PosterCard key={f.key} index={i} item={f} autoFocus={ri === 0 && i === 0 && !hasResume}
                  onSelect={() => openItem(item, f)} />
              ))
            : null}
        </Row>
      ))}

      {loading && (
        <p className="text-body text-tv-text3" style={{ paddingLeft: 'var(--content-x)' }}>Cargando catálogo…</p>
      )}
      {!loading && rows.length === 0 && (
        <div style={{ paddingLeft: 'var(--content-x)' }}>
          <p className="text-lead text-tv-text2">Todavía no hay nada indexado.</p>
          <p className="text-body text-tv-text3 mt-2">Añade canales desde la versión web y espera a que termine el escaneo.</p>
        </div>
      )}

      {detail && <TitleDetail input={detail} onClose={() => setDetail(null)} />}
      {playing && (
        <Player src={streamUrl(playing.path)} path={playing.path} title={playing.title} subtitle={playing.subtitle}
          poster={playing.poster} backdrop={playing.backdrop} onClose={onPlayerClose} />
      )}
    </Screen>
  );
}
