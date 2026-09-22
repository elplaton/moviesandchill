import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';
import { fmtGB } from './AdminUsers';

interface Row { id: number; folder_name: string; folder_path: string; size_bytes: number; status: string; owner: string | null; created_at: string }

/** Todo lo que hay en disco, de quién es y cuánto ocupa; el admin puede borrar cualquier cosa. */
export default function AdminDownloads({ onToast }: { onToast: (m: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [conv, setConv] = useState<{ running: boolean; total: number; done: number; current: string } | null>(null);

  const load = async () => {
    try { const r = await apiFetch('/admin/downloads'); const d = await r.json(); setRows(d.downloads || []); } catch {}
    try { const r = await apiFetch('/admin/convert-library'); setConv(await r.json()); } catch {}
  };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const remove = async (r: Row) => {
    if (!confirm(`¿Borrar "${r.folder_name}" del servidor?`)) return;
    const res = await apiFetch('/files', { method: 'DELETE', body: JSON.stringify({ path: r.folder_path }) });
    const d = await res.json();
    onToast(d.error || `Borrado ${r.folder_name}`); load();
  };

  const convert = async () => {
    const r = await apiFetch('/admin/convert-library', { method: 'POST' });
    const d = await r.json();
    onToast(d.status === 'already_running' ? 'Ya hay una conversión en marcha' : 'Convirtiendo la biblioteca a MP4…'); load();
  };

  const total = rows.reduce((s, r) => s + (r.size_bytes || 0), 0);
  const label = (s: string) => s === 'done' ? 'En disco' : s === 'paused' ? 'Pausada' : s === 'downloading' ? 'Descargando' : s;

  return (
    <div>
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl flex flex-wrap items-center gap-4 justify-between">
        <div>
          <h2 className="text-white text-lg font-medium">Biblioteca en MP4</h2>
          <p className="text-gray-500 text-xs mt-1 max-w-xl">
            Las descargas nuevas se convierten a MP4 (H.264/AAC), que reproducen iPhone, Android, Samsung y LG. Esto reempaqueta lo que ya estaba en MKV u otros contenedores.
            {conv?.running && ` En marcha: ${conv.done}/${conv.total} · ${conv.current}`}
          </p>
        </div>
        <button onClick={convert} disabled={!!conv?.running}
          className="bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all">
          {conv?.running ? 'Convirtiendo…' : 'Convertir biblioteca'}
        </button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-medium">Descargas ({rows.length})</h2>
          <span className="text-gray-400 text-sm">{fmtGB(total)} en disco</span>
        </div>
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="flex flex-wrap items-center gap-4 bg-black/20 border border-white/5 rounded-xl px-4 py-3">
              <div className="flex-1 min-w-[240px]">
                <p className="text-white text-sm font-medium truncate">{r.folder_name}</p>
                <p className="text-gray-500 text-[11px]">{r.owner || 'admin'} · {label(r.status)} · {new Date(r.created_at).toLocaleDateString('es-ES')}</p>
              </div>
              <span className="text-gray-300 text-sm w-24 text-right">{fmtGB(r.size_bytes)}</span>
              <button onClick={() => remove(r)} disabled={r.status !== 'done'} className="text-xs bg-netflix-red/20 hover:bg-netflix-red/40 disabled:opacity-40 text-red-300 px-3 py-1.5 rounded-lg transition-all">Borrar</button>
            </div>
          ))}
          {rows.length === 0 && <p className="text-gray-500 text-sm">No hay descargas.</p>}
        </div>
      </div>
    </div>
  );
}
