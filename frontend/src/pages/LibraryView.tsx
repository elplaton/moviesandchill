import { useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import { fetchMetadataBatch } from '../services/tmdb';
import MovieRow from '../components/MovieRow';
import MovieCard from '../components/MovieCard';
import { cleanTitle } from '../utils/text';
import type { FileItem, TMDBMetadata, Batch, DownloadState } from '../types';

interface Props {
  batches: Batch[];
  downloadStates: Map<number, DownloadState>;
  onCancelBatch: (batchId: string) => void;
  onSeriesClick: (series: FileItem, meta: TMDBMetadata) => void;
  onMovieClick: (name: string, size: string, path: string, cleanName: string, meta: TMDBMetadata) => void;
  lastResultsRef: React.MutableRefObject<{ groups: any[]; singles: any[]; movieGroups: Map<string, any[]> }>;
}

export default function LibraryView({ batches, downloadStates, onCancelBatch, onSeriesClick, onMovieClick, lastResultsRef }: Props) {
  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  const [series, setSeries] = useState<FileItem[]>([]);
  const [movies, setMovies] = useState<FileItem[]>([]);
  const [filesMeta, setFilesMeta] = useState<Map<string, TMDBMetadata>>(new Map());
  const [downloadingMeta, setDownloadingMeta] = useState<Map<string, TMDBMetadata>>(new Map());

  const loadFiles = async () => {
    try {
      const res = await apiFetch('/files');
      const data = await res.json();
      const items: FileItem[] = data.files || [];
      setAllFiles(items);
      setSeries(items.filter((f: FileItem) => f.is_series));
      setMovies(items.filter((f: FileItem) => !f.is_series && !f.is_dir));
      const names = items.map((f: FileItem) => f.clean_name || '').filter(Boolean);
      if (names.length > 0) {
        const meta = await fetchMetadataBatch(names);
        setFilesMeta(meta);
      }
    } catch {}
  };

  useEffect(() => { loadFiles(); }, []);
  useEffect(() => {
    const names = batches.map(b => cleanTitle(b.folder_name)).filter(Boolean);
    const uncached = names.filter(n => !downloadingMeta.has(n));
    if (uncached.length > 0) {
      fetchMetadataBatch(uncached).then(meta => {
        setDownloadingMeta(prev => {
          const next = new Map(prev);
          for (const [k, v] of meta) { if (v.poster) next.set(k, v); }
          return next;
        });
      });
    }
  }, [batches]);

  const metaFor = (meta: Map<string, TMDBMetadata>, key: string): TMDBMetadata => {
    return meta.get(key) || { title: key, poster: undefined, year: undefined, rating: undefined };
  };

  const activeBatches = batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status));

  return (
    <>
      {activeBatches.length > 0 && (
        <MovieRow title="Descargando">
          {activeBatches.map(b => {
            const name = cleanTitle(b.folder_name);
            const meta = downloadingMeta.get(name) || { title: name };
            const ds: DownloadState = {
              messageId: 0, batchId: b.batch_id, progress: b.progress,
              status: b.status === 'extracting' ? 'extracting' : b.status === 'converting' ? 'converting' : 'downloading',
            };
            return (
              <MovieCard key={b.batch_id} name={name}
                subtitle={b.status === 'extracting' ? 'Extrayendo...' : b.status === 'converting' ? 'Convirtiendo...' : `${b.progress}%`}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                downloadState={ds} onCancelDownload={() => onCancelBatch(b.batch_id)} actions="click" />
            );
          })}
        </MovieRow>
      )}

      {series.length > 0 && (
        <MovieRow title="Series">
          {series.map(s => {
            const meta = metaFor(filesMeta, s.clean_name || s.name);
            return (
              <MovieCard key={s.path} name={s.name} size={s.size}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => onSeriesClick(s, meta)}
                hoverLabel="Ver episodios" actions="click" />
            );
          })}
        </MovieRow>
      )}

      {movies.length > 0 && (
        <MovieRow title="Peliculas">
          {movies.map(f => {
            const meta = metaFor(filesMeta, f.clean_name || f.name);
            return (
              <MovieCard key={f.path} name={f.name} size={f.size}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => onMovieClick(f.name, f.size, f.path, f.clean_name || '', meta)}
                downloaded actions="click" />
            );
          })}
        </MovieRow>
      )}

      {allFiles.length === 0 && (
        <div className="px-6 md:px-14 py-16 text-center">
          <p className="text-gray-500 text-lg mb-2">Tu biblioteca esta vacia</p>
          <p className="text-gray-600 text-sm">Descarga peliculas y series para verlas aqui</p>
        </div>
      )}
    </>
  );
}
