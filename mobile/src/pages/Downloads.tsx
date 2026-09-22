import { useMemo, useState } from 'react';
import { useLibrary, type LocalFile } from '../contexts/LibraryContext';
import { useAuth } from '../contexts/AuthContext';
import { cleanTitle } from '../utils/text';
import { toast } from '../utils/toast';
import Player from '../components/Player';
import { IPlay, ITrash } from '../components/Icons';

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;
const epOf = (n: string) => { const m = n.match(/(\d{1,2})x(\d{2,3})|[sS](\d{1,2})[eE](\d{1,3})/); return m ? `${parseInt(m[1] || m[3])}x${String(parseInt(m[2] || m[4])).padStart(2, '0')}` : ''; };
const seriesOf = (f: LocalFile) => { const parts = f.path.split('/'); const folder = parts[parts.length - 2] || ''; return cleanTitle(folder).replace(/^S\d{1,2}\s*[-–]\s*|\s*S\d{1,2}$/gi, '').trim() || cleanTitle(f.name); };

/** Descargas: en curso, pausadas y lo que hay en el servidor agrupado por título. */
export default function Downloads() {
  const { files, batches, paused, states, cancel, pause, resume, remove } = useLibrary();
  const { me, refresh } = useAuth();
  const [playing, setPlaying] = useState<LocalFile | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');

  const active = batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status));
  const groups = useMemo(() => {
    const m = new Map<string, LocalFile[]>();
    for (const f of files) { if (filter === 'mine' && f.owner !== me?.username) continue; const k = epOf(f.name) ? seriesOf(f) : cleanTitle(f.name); if (!m.has(k)) m.set(k, []); m.get(k)!.push(f); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [files, filter, me]);

  const del = async (f: LocalFile) => {
    if (!confirm(`¿Borrar "${f.name}" del servidor?`)) return;
    const err = await remove(f.path); if (err) toast(err, 'error', 5000); else { toast('Borrado', 'ok'); refresh(); }
  };
  const pct = me?.quota_bytes ? Math.min(100, Math.round((me.used_bytes / me.quota_bytes) * 100)) : 0;

  return (
    <div className="pb-4">
      <div className="px-4 pb-3" style={{ paddingTop: 'calc(var(--safe-t) + 20px)' }}>
        <h1 className="text-[28px] font-bold">Descargas</h1>
        <div className="mt-2">
          <p className="text-[12px] text-nf-text2 mb-1">{me?.quota_bytes ? `${gb(me.used_bytes)} de ${gb(me.quota_bytes)} (${pct} %)` : `${gb(me?.used_bytes || 0)} en disco · sin límite`}</p>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`h-full ${pct >= 90 ? 'bg-nf-red' : 'bg-nf-ok'}`} style={{ width: `${me?.quota_bytes ? pct : 5}%` }} /></div>
        </div>
      </div>

      {active.length > 0 && (
        <section className="mb-4">
          <h2 className="px-4 mb-1 text-[13px] font-semibold text-nf-text2">Descargando</h2>
          {active.map(b => {
            const l = b.status === 'extracting' ? 'Extrayendo' : b.status === 'converting' ? 'Convirtiendo' : `${b.progress} % · ${b.downloaded_parts}/${b.total_parts} partes`;
            const ds = [...states.values()].find(s => s.batchId === b.batch_id);
            const mine = !b.owner || b.owner === me?.username || me?.role === 'admin';
            return (
              <div key={b.batch_id} className="px-4 py-2.5 border-b border-white/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="text-[15px] font-medium truncate">{cleanTitle(b.folder_name)}</p><p className="text-[12px] text-nf-text3">{l}{ds?.speed ? ` · ${ds.speed}` : ''}{b.owner && b.owner !== me?.username ? ` · ${b.owner}` : ''}</p></div>
                  {mine && b.status === 'downloading' && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => { pause(b.batch_id); toast('Pausada'); }} className="tap h-9 px-3 rounded-full bg-white/10 text-[13px]">Pausar</button>
                      <button onClick={() => { cancel(b.batch_id); toast('Cancelada'); }} className="tap h-9 px-3 rounded-full bg-nf-red/20 text-red-300 text-[13px]">Cancelar</button>
                    </div>
                  )}
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-nf-red" style={{ width: `${b.progress}%` }} /></div>
              </div>
            );
          })}
        </section>
      )}
      {paused.length > 0 && (
        <section className="mb-4">
          <h2 className="px-4 mb-1 text-[13px] font-semibold text-nf-text2">Pausadas</h2>
          {paused.map((b: any) => (
            <div key={b.batch_id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/5">
              <div className="min-w-0"><p className="text-[15px] font-medium truncate">{cleanTitle(b.folder_name)}</p><p className="text-[12px] text-nf-text3">{b.total_parts} partes · {b.total_size_str}</p></div>
              <button onClick={() => { resume(b.batch_id); toast('Reanudando'); }} className="tap h-9 px-3 rounded-full bg-white text-black text-[13px] font-semibold">Reanudar</button>
            </div>
          ))}
        </section>
      )}

      <div className="flex items-center justify-between px-4 mb-1">
        <h2 className="text-[13px] font-semibold text-nf-text2">En el servidor</h2>
        <div className="flex rounded-full bg-white/10 p-0.5 text-[12px]">
          <button onClick={() => setFilter('all')} className={`px-3 h-7 rounded-full ${filter === 'all' ? 'bg-white text-black' : 'text-nf-text2'}`}>Todo</button>
          <button onClick={() => setFilter('mine')} className={`px-3 h-7 rounded-full ${filter === 'mine' ? 'bg-white text-black' : 'text-nf-text2'}`}>Mío</button>
        </div>
      </div>
      {groups.map(([title, list]) => (
        <section key={title} className="mb-3">
          <p className="px-4 pt-2 pb-1 text-[15px] font-semibold">{title} <span className="text-nf-text3 font-normal text-[12px]">· {list[0].owner}</span></p>
          {list.map(f => (
            <div key={f.path} className="flex items-center gap-3 px-4 py-2 border-b border-white/5">
              <div className="flex-1 min-w-0"><p className="text-[14px] truncate">{epOf(f.name) ? `${epOf(f.name)} · ` : ''}{cleanTitle(f.name)}</p><p className="text-[12px] text-nf-text3">{f.size}</p></div>
              <button onClick={() => setPlaying(f)} className="tap w-9 h-9 rounded-full bg-white text-black flex items-center justify-center"><span className="w-4 h-4 ml-0.5"><IPlay /></span></button>
              {f.canDelete && <button onClick={() => del(f)} className="tap w-9 h-9 rounded-full bg-white/10 text-nf-text2 flex items-center justify-center active:bg-nf-red/40"><span className="w-4 h-4"><ITrash /></span></button>}
            </div>
          ))}
        </section>
      ))}
      {groups.length === 0 && active.length === 0 && <p className="px-4 pt-4 text-[14px] text-nf-text3">Todavía no hay nada descargado.</p>}
      {playing && <Player path={playing.path} title={cleanTitle(playing.name)} onClose={() => setPlaying(null)} />}
    </div>
  );
}
