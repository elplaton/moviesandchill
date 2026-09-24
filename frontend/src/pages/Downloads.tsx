import { useCallback, useEffect, useMemo, useState } from 'react';
import Shell from '../components/Shell';
import Card from '../components/Card';
import Player from '../components/Player';
import Button from '../components/ui/Button';
import { apiFetch } from '../services/api';
import { fetchMetadataBatch } from '../services/tmdb';
import { useAuth } from '../contexts/AuthContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useDownloads } from '../hooks/useDownloads';
import { cleanTitle } from '../utils/text';
import { IconChevronD, IconPlay, IconTrash } from '../components/ui/Icon';
import type { TMDBMetadata } from '../types';

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

interface Ep { name: string; path: string; size: string; season?: number; episode?: number; owner?: string; can_delete?: boolean }
interface Title {
  name: string; path: string; size: string; cleanName: string; isSeries: boolean;
  owner: string; canDelete: boolean; episodes: Ep[];
}

const epLabel = (e: Ep) => e.episode != null ? `${e.season ?? 1}x${String(e.episode).padStart(2, '0')}` : '';

/** Una serie con sus temporadas plegables. */
function SeriesPanel({ t, meta, onPlay, onDelete }: {
  t: Title; meta?: TMDBMetadata; onPlay: (e: Ep, title: string) => void; onDelete: (e: Ep, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const seasons = useMemo(() => {
    const m = new Map<number, Ep[]>();
    for (const e of t.episodes) { const s = e.season ?? 1; if (!m.has(s)) m.set(s, []); m.get(s)!.push(e); }
    for (const l of m.values()) l.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [t.episodes]);
  const owners = [...new Set(t.episodes.map(e => e.owner || t.owner))];

  return (
    <div className="overflow-hidden rounded-panel border border-nf-line bg-nf-surface">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-4 p-4 text-left hover:bg-white/[0.04]">
        <div className="h-[84px] w-[56px] shrink-0 overflow-hidden rounded bg-nf-raised">
          {meta?.poster && <img src={meta.poster} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-semibold">{meta?.title || t.cleanName}</p>
          <p className="mt-0.5 text-base text-nf-faint">
            {t.episodes.length} {t.episodes.length === 1 ? 'episodio' : 'episodios'}
            {seasons.length > 1 ? ` · ${seasons.length} temporadas` : ''} · {owners.length === 1 ? owners[0] : `${owners.length} cuentas`}
          </p>
        </div>
        <span className={`w-5 h-5 shrink-0 text-nf-faint transition-transform ${open ? 'rotate-180' : ''}`}><IconChevronD /></span>
      </button>

      {open && (
        <div className="border-t border-nf-line">
          {seasons.map(([n, eps]) => (
            <div key={n}>
              <p className="bg-white/[0.03] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-nf-faint">Temporada {n}</p>
              {eps.map(e => (
                <div key={e.path} className="group flex items-center gap-4 px-4 py-2.5 hover:bg-white/[0.05]">
                  <span className="w-14 shrink-0 text-base font-semibold tabular-nums text-nf-faint">{epLabel(e)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base">{e.size}</p>
                    <p className="truncate text-xs text-nf-faint">{e.owner || t.owner}</p>
                  </div>
                  <Button variant="light" size="sm" icon={<IconPlay />} onClick={() => onPlay(e, meta?.title || t.cleanName)}>Ver</Button>
                  {(e.can_delete ?? t.canDelete) && (
                    <button onClick={() => onDelete(e, `${epLabel(e)} · ${meta?.title || t.cleanName}`)} title="Borrar del servidor"
                      className="grid h-8 w-8 place-items-center rounded text-nf-faint opacity-0 hover:bg-nf-red/25 hover:text-white group-hover:opacity-100">
                      <span className="w-4 h-4"><IconTrash /></span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Descargas: lo que está bajando, lo pausado y lo que hay en el servidor.
 *
 * Las series se pliegan por temporada en vez de listar todos los episodios
 * sueltos; las películas van en rejilla, que es lo que mejor aprovecha una
 * pantalla ancha.
 */
export default function Downloads() {
  const { username, isAdmin, usedBytes, quotaBytes, refreshMe } = useAuth();
  const { reload: reloadIndex, version } = useLibrary();
  const { batches, pausedBatches, downloadStates, loadPaused, loadStatus, cancelBatch, pauseBatch, resumeBatch } = useDownloads();
  const [titles, setTitles] = useState<Title[]>([]);
  const [metas, setMetas] = useState<Map<string, TMDBMetadata>>(new Map());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState<{ path: string; title: string; subtitle?: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');

  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice(''), 4000); };

  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch('/files')).json();
      const list: Title[] = (d.files || []).map((f: any) => ({
        name: f.name, path: f.path, size: f.size || '', cleanName: f.clean_name || cleanTitle(f.name),
        isSeries: !!f.is_series, owner: f.owner || 'admin', canDelete: !!f.can_delete, episodes: f.episodes || [],
      }));
      setTitles(list);
      const names = [...new Set(list.map(t => t.cleanName).filter(Boolean))];
      if (names.length) setMetas(await fetchMetadataBatch(names));
    } catch { /* sin conexión */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); loadStatus(); loadPaused(); }, [load, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const del = async (path: string, label: string) => {
    if (!confirm(`¿Borrar "${label}" del servidor?`)) return;
    const d = await (await apiFetch('/files', { method: 'DELETE', body: JSON.stringify({ path }) })).json();
    if (d.error) { say(d.error); return; }
    setPlaying(null);
    await load(); reloadIndex(); refreshMe();
  };

  const mine = (t: Title) => t.isSeries ? t.episodes.some(e => (e.owner || t.owner) === username) : t.owner === username;
  const visible = titles.filter(t => filter === 'all' || mine(t));
  const series = visible.filter(t => t.isSeries).sort((a, b) => a.cleanName.localeCompare(b.cleanName));
  const movies = visible.filter(t => !t.isSeries).sort((a, b) => a.cleanName.localeCompare(b.cleanName));
  const active = batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status));
  const metaFor = (t: Title) => metas.get(t.cleanName);
  const pct = quotaBytes ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;

  return (
    <Shell>
      <div className="px-gutter">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-page font-bold">Descargas</h1>
            <p className="mt-1 text-base text-nf-dim">
              {loading ? 'Cargando…' : `${titles.length} ${titles.length === 1 ? 'título' : 'títulos'} en el servidor`}
            </p>
          </div>
          <div className="w-[320px]">
            <div className="mb-1.5 flex justify-between text-xs text-nf-dim">
              <span>{quotaBytes != null ? `${gb(usedBytes)} de ${gb(quotaBytes)}` : `${gb(usedBytes)} · sin límite`}</span>
              {quotaBytes != null && <span>{pct} %</span>}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
              <div className={`h-full ${pct >= 90 ? 'bg-nf-red' : 'bg-nf-ok'}`} style={{ width: `${quotaBytes ? pct : 5}%` }} />
            </div>
            <div className="mt-3 flex w-max rounded-pill bg-white/10 p-0.5 text-xs">
              <button onClick={() => setFilter('all')} className={`rounded-pill px-3.5 py-1.5 ${filter === 'all' ? 'bg-white text-black' : 'text-nf-dim'}`}>Todo</button>
              <button onClick={() => setFilter('mine')} className={`rounded-pill px-3.5 py-1.5 ${filter === 'mine' ? 'bg-white text-black' : 'text-nf-dim'}`}>Lo mío</button>
            </div>
          </div>
        </div>

        {active.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">Descargando</h2>
            <div className="space-y-2">
              {active.map(b => {
                const ds = [...downloadStates.values()].find(s => s.batchId === b.batch_id);
                const label = b.status === 'extracting' ? 'Extrayendo' : b.status === 'converting' ? 'Convirtiendo' : `${b.downloaded_parts}/${b.total_parts} partes`;
                const canManage = isAdmin || !b.owner || b.owner === username;
                return (
                  <div key={b.batch_id} className="rounded-panel border border-nf-line bg-nf-surface px-5 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium">{cleanTitle(b.folder_name)}</p>
                        <p className="text-xs text-nf-faint">{label}{ds?.speed ? ` · ${ds.speed}` : ''}{b.owner && b.owner !== username ? ` · ${b.owner}` : ''}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-base tabular-nums text-nf-dim">{b.progress} %</span>
                        {canManage && b.status === 'downloading' && (
                          <>
                            <Button size="sm" onClick={() => pauseBatch(b.batch_id)}>Pausar</Button>
                            <Button size="sm" variant="danger" onClick={() => cancelBatch(b.batch_id)}>Cancelar</Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/12">
                      <div className="h-full bg-nf-red transition-[width] duration-500" style={{ width: `${b.progress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {pausedBatches.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">Pausadas</h2>
            <div className="flex flex-wrap gap-3">
              {pausedBatches.map((b: any) => (
                <div key={b.batch_id} className="rounded-panel border border-nf-line bg-nf-surface px-5 py-4">
                  <p className="text-base font-medium">{cleanTitle(b.folder_name)}</p>
                  <p className="mb-3 mt-0.5 text-xs text-nf-faint">{b.total_parts} partes · {b.total_size_str}</p>
                  <Button size="sm" variant="primary" onClick={() => resumeBatch(b.batch_id)}>Reanudar</Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {series.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">Series</h2>
            <div className="space-y-2">
              {series.map(t => (
                <SeriesPanel key={t.path} t={t} meta={metaFor(t)}
                  onPlay={(e, title) => setPlaying({ path: e.path, title, subtitle: epLabel(e) || undefined })}
                  onDelete={(e, label) => del(e.path, label)} />
              ))}
            </div>
          </section>
        )}

        {movies.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold">Películas</h2>
            <div className="grid gap-x-[var(--row-gap)] gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(var(--card-w),1fr))]">
              {movies.map(t => {
                const m = metaFor(t);
                return (
                  <Card key={t.path} title={m?.title || t.cleanName} poster={m?.poster} rating={m?.rating}
                    meta={`${t.size} · ${t.owner}`} badge="En disco" badgeTone="ok"
                    onOpen={() => setPlaying({ path: t.path, title: m?.title || t.cleanName })}
                    actions={
                      <>
                        <Button variant="light" size="sm" icon={<IconPlay />} onClick={() => setPlaying({ path: t.path, title: m?.title || t.cleanName })}>Ver</Button>
                        {t.canDelete && <Button variant="ghost" size="sm" onClick={() => del(t.path, m?.title || t.cleanName)}>Borrar</Button>}
                      </>
                    } />
                );
              })}
            </div>
          </section>
        )}

        {!loading && titles.length === 0 && active.length === 0 && (
          <div className="py-16">
            <p className="text-lg text-nf-dim">Todavía no has descargado nada.</p>
            <p className="mt-1 text-base text-nf-faint">Entra en una película o serie y pulsa Descargar.</p>
          </div>
        )}
      </div>

      <div className="h-16" />
      {notice && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded bg-nf-raised px-5 py-3 text-base shadow-panel animate-slide-up">{notice}</div>
      )}
      {playing && <Player path={playing.path} title={playing.title} subtitle={playing.subtitle} onClose={() => setPlaying(null)} />}
    </Shell>
  );
}
