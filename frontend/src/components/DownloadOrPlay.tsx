import { useState } from 'react';
import DownloadRing, { type RingStatus } from './DownloadRing';
import PlayDetail from './PlayDetail';
import { useLibrary } from '../contexts/LibraryContext';
import { useAuth } from '../contexts/AuthContext';
import { getAccessToken } from '../services/api';
import type { DownloadState, TMDBMetadata } from '../types';

interface Props {
  fileName: string;
  messageId: number;
  channelId?: number;
  season?: number | null;
  episode?: number | null;
  downloadStates?: Map<number, DownloadState>;
  onDownload: (msgId: number, channelId?: number) => void;
  onCancelDownload?: (batchId: string) => void;
  title: string;
  metadata?: TMDBMetadata;
  small?: boolean;
}

const streamUrl = (path: string) => `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAccessToken() || '')}`;

/**
 * Accion de un archivo segun su estado: Descargar, progreso, o (si ya esta en
 * el servidor) Ver y, solo para su dueño o un admin, Borrar. Si lo bajo otra
 * cuenta se indica y no se puede volver a descargar.
 */
export default function DownloadOrPlay({ fileName, messageId, channelId, season, episode, downloadStates, onDownload, onCancelDownload, title, metadata, small }: Props) {
  const { localFor, remove } = useLibrary();
  const { refreshMe } = useAuth();
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const local = localFor(fileName, season, episode);
  const ds = downloadStates?.get(messageId);
  const pad = small ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs';

  if (local) {
    const del = async () => {
      if (!confirm(`¿Borrar "${local.name}" del servidor?`)) return;
      setBusy(true);
      const err = await remove(local.path);
      setBusy(false);
      if (err) alert(err); else refreshMe();
    };
    return (
      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        {!local.canDelete && <span className="text-gray-500 text-[10px]">de {local.owner}</span>}
        <button onClick={() => setPlaying(true)} className={`bg-white text-black ${pad} rounded-lg font-semibold hover:scale-105 transition-all flex items-center gap-1`}>
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>Ver
        </button>
        {local.canDelete && (
          <button onClick={del} disabled={busy} className={`bg-white/10 hover:bg-netflix-red/40 text-gray-300 hover:text-white ${pad} rounded-lg font-medium transition-all disabled:opacity-40`}>Borrar</button>
        )}
        {playing && (
          <PlayDetail name={local.name} size={local.size || ''} path={local.path} metadata={metadata || { title }} streamUrl={streamUrl} onClose={() => setPlaying(false)} />
        )}
      </div>
    );
  }

  if (ds && ds.status !== 'done' && ds.status !== 'error') {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <DownloadRing progress={ds.progress} status={ds.status as RingStatus}
          onCancel={onCancelDownload ? () => onCancelDownload(ds.batchId) : undefined} size={28}
          downloadedStr={ds.downloadedStr} totalStr={ds.totalStr} speed={ds.speed} />
        <span className="text-white/60 text-[10px]">{ds.progress}%</span>
      </div>
    );
  }

  return (
    <button onClick={(e) => { e.stopPropagation(); onDownload(messageId, channelId); }}
      className={`bg-netflix-red hover:bg-netflix-red-hover text-white ${pad} rounded-lg transition-all hover:scale-105 font-medium shrink-0`}>
      Descargar
    </button>
  );
}
