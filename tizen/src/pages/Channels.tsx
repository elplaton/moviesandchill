import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { Channel } from '../types';

interface IndexStats {
  total: number;
  movies: number;
  series: number;
  with_tmdb: number;
  tmdb_searched: number;
  by_channel: { channel_id: number; channel_name: string; count: number }[];
}

interface ChannelProgress {
  channel_id: number;
  channel_name: string;
  last_message_id: number;
  total_indexed: number;
  total_scanned?: number;
  total_estimate?: number;
  status: string;
  phase?: string;
}

export default function Channels() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [url, setUrl] = useState('');
  const [urlFeedback, setUrlFeedback] = useState('');
  const [toast, setToast] = useState('');

  const [stats, setStats] = useState<IndexStats | null>(null);
  const [progress, setProgress] = useState<ChannelProgress[]>([]);
  const [polling, setPolling] = useState(true);
  const [tmdbEnabled, setTmdbEnabled] = useState(false);
  const [tmdbRunning, setTmdbRunning] = useState(false);

  const loadChannels = async () => {
    try {
      const res = await apiFetch('/channels');
      const data = await res.json();
      const list: Channel[] = data.channels || [];
      setChannels(list);
      setActiveIds(new Set(list.map(c => c.id)));
    } catch {}
  };

  const loadIndexInfo = async () => {
    try {
      const [statsRes, progRes, statusRes] = await Promise.all([
        apiFetch('/index/stats'),
        apiFetch('/index/progress'),
        apiFetch('/index/status'),
      ]);
      const s = await statsRes.json();
      const p = await progRes.json();
      const st = await statusRes.json();
      setStats(s);
      setProgress(p.channels || []);
      const running = (p.channels || []).some((c: ChannelProgress) =>
        c.status === 'running' || c.status === 'scanning' || c.phase === 'enriching'
      );
      setPolling(running);
      setTmdbRunning(st.phase === 'enriching' && st.running);
    } catch {}
  };

  useEffect(() => { loadChannels(); loadIndexInfo(); fetchConfig(); }, []);

  const fetchConfig = async () => {
    try {
      const res = await apiFetch('/config');
      const data = await res.json();
      setTmdbEnabled(data.config?.tmdb_enabled || false);
    } catch {}
  };

  const toggleTmdb = async () => {
    const newVal = !tmdbEnabled;
    setTmdbEnabled(newVal);
    await apiFetch('/config', {
      method: 'POST',
      body: JSON.stringify({ tmdb_enabled: newVal }),
    });
    setToast(newVal ? 'TMDB activado' : 'TMDB desactivado');
    if (newVal && stats && stats.total > 0 && stats.with_tmdb < stats.total) {
      await apiFetch('/index/enrich', { method: 'POST' });
    }
    setTimeout(() => setToast(''), 2000);
  };

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(loadIndexInfo, 5000);
    return () => clearInterval(interval);
  }, [polling]);

  const toggle = (id: number) => {
    setActiveIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const saveChannels = async () => {
    const selected = channels.filter(c => activeIds.has(c.id)).map(c => ({ id: c.id, name: c.name }));
    await apiFetch('/config', { method: 'POST', body: JSON.stringify({ channels: selected }) });
    setToast('Guardado');
    setTimeout(() => setToast(''), 2000);
  };

  const addByUrl = async () => {
    if (!url.trim()) return;
    setUrlFeedback('Resolviendo...');
    try {
      const res = await apiFetch('/channels/add', { method: 'POST', body: JSON.stringify({ url: url.trim() }) });
      const data = await res.json();
      if (data.error) {
        setUrlFeedback(data.error);
      } else {
        setUrlFeedback(`${data.status === 'added' ? 'Anadido' : 'Actualizado'}: ${data.channel.name}`);
        setUrl('');
        setActiveIds(prev => new Set([...prev, data.channel.id]));
        await loadChannels();
        setTimeout(loadIndexInfo, 2000);
      }
    } catch {
      setUrlFeedback('Error de conexion');
    }
  };

  const scanAll = async () => {
    await apiFetch('/index/rescan', { method: 'POST' });
    setToast('Escaneo completo reiniciado');
    setPolling(true);
    setTimeout(() => { setToast(''); loadIndexInfo(); }, 2000);
  };

  const scanChannel = async (channelId: number) => {
    await apiFetch(`/index/channel/${channelId}`, { method: 'POST' });
    setToast('Reescanear canal...');
    setPolling(true);
    setTimeout(() => { setToast(''); loadIndexInfo(); }, 2000);
  };

  const progressFor = (channelId: number) => progress.find(p => p.channel_id === channelId);
  const runningCount = progress.filter(p => p.status === 'running' || p.status === 'scanning').length;

  const active = channels.filter(c => activeIds.has(c.id));
  const inactive = channels.filter(c => !activeIds.has(c.id));

  useEffect(() => { if (!isAdmin) navigate('/'); }, [isAdmin, navigate]);
  if (!isAdmin) return null;

  return (
    <Layout>
      <div className="px-6 md:px-14 pt-24 pb-20 max-w-4xl mx-auto">
        {toast && (
          <div className="fixed top-24 right-6 z-50 bg-green-600/90 backdrop-blur-xl border border-green-400/20 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium animate-slide-up">
            {toast}
          </div>
        )}

        <h1 className="text-white text-4xl font-bold mb-2 tracking-tight animate-fade-in">Canales</h1>
        <p className="text-gray-400 text-sm mb-10 animate-fade-in">Canales de Telegram donde se busca contenido</p>

        {/* Index Stats */}
        {stats && (
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white text-lg font-medium">
                Contenido indexado
                {runningCount > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-yellow-400 text-xs font-normal">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-yellow-400" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
                    </span>
                    Indexando...
                  </span>
                )}
              </h2>
              <div className="flex gap-2">
                <button onClick={scanAll} className="text-xs bg-netflix-red hover:bg-netflix-red-hover text-white px-4 py-2 rounded-lg transition-all font-medium">
                  Reescanear todo
                </button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="bg-black/20 rounded-xl p-3 text-center">
                <p className="text-white text-xl font-bold">{stats.total.toLocaleString()}</p>
                <p className="text-gray-400 text-[11px]">Total</p>
              </div>
              <div className="bg-black/20 rounded-xl p-3 text-center">
                <p className="text-white text-xl font-bold">{stats.movies.toLocaleString()}</p>
                <p className="text-gray-400 text-[11px]">Películas</p>
              </div>
              <div className="bg-black/20 rounded-xl p-3 text-center">
                <p className="text-white text-xl font-bold">{stats.series.toLocaleString()}</p>
                <p className="text-gray-400 text-[11px]">Series</p>
              </div>
              <div className="bg-black/20 rounded-xl p-3 text-center">
                <p className="text-white text-xl font-bold">{stats.with_tmdb.toLocaleString()}</p>
                <p className="text-gray-400 text-[11px]">Con TMDB</p>
              </div>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-gray-400 text-xs flex items-center gap-2">
                  Progreso TMDB
                  {tmdbRunning && (
                    <span className="inline-flex items-center gap-1 text-yellow-400">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-yellow-400" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-yellow-500" />
                      </span>
                      <span className="text-[10px]">Enriqueciendo...</span>
                    </span>
                  )}
                </span>
                <span className="text-gray-400 text-xs">
                  {stats.with_tmdb.toLocaleString()} encontrados · {(stats.tmdb_searched || 0).toLocaleString()} / {stats.total.toLocaleString()} procesados ({Math.round(((stats.tmdb_searched || 0) / Math.max(stats.total, 1)) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-netflix-red rounded-full transition-all duration-1000" style={{
                  width: `${((stats.tmdb_searched || 0) / Math.max(stats.total, 1)) * 100}%`,
                  background: (stats.tmdb_searched || 0) === stats.total ? '#2ECC40' : tmdbRunning ? '#F5A623' : '#E50914',
                }} />
              </div>
            </div>

            {progress.length > 0 && (
              <div className="space-y-2">
                {progress.map(prog => {
                  const chCount = (stats?.by_channel || []).find(c => c.channel_id === prog.channel_id)?.count || 0;
                  const isScanning = prog.status === 'running' || prog.status === 'scanning';
                  const pct = (prog.total_estimate || 0) > 0
                    ? Math.round(((prog.total_scanned || 0) / (prog.total_estimate || 1)) * 100)
                    : 0;
                  return (
                    <div key={prog.channel_id} className="bg-black/20 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-white text-sm truncate">{prog.channel_name}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ml-2 ${
                          isScanning ? 'bg-yellow-500/20 text-yellow-400'
                          : prog.status === 'done' ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-500/20 text-gray-400'
                        }`}>
                          {isScanning ? 'Escaneando...' : prog.status === 'done' ? 'Completado' : prog.status === 'pending' ? 'Pendiente' : prog.status}
                        </span>
                      </div>

                      {(prog.total_estimate || 0) > 0 && (
                        <div className="mb-1.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-gray-500 text-[10px]">
                              {(prog.total_scanned || 0).toLocaleString()} / {(prog.total_estimate || 0).toLocaleString()} msgs
                            </span>
                            <span className="text-gray-400 text-[10px]">{pct}%</span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-700 ${isScanning ? 'bg-yellow-500' : prog.status === 'done' ? 'bg-green-500' : 'bg-gray-600'}`} style={{
                              width: `${Math.min(pct, 100)}%`,
                            }} />
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-[11px]">
                        <span className="text-green-400">{chCount.toLocaleString()} con media</span>
                        {prog.total_indexed != null && prog.total_indexed > 0 && (
                          <span className="text-gray-500">{((prog.total_indexed || 0) - chCount).toLocaleString()} sin media</span>
                        )}
                        {prog.total_scanned != null && prog.total_scanned > 0 && (
                          <span className="text-gray-600">{prog.total_scanned?.toLocaleString()} total escaneados</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between py-3 border-t border-white/5 mt-4">
              <div className="flex items-center gap-3">
                <span className="text-gray-300 text-sm">TMDB</span>
                <button onClick={toggleTmdb}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 flex items-center px-0.5 ${tmdbEnabled ? 'bg-green-500 justify-end' : 'bg-white/20 justify-start'}`}>
                  <span className="w-5 h-5 rounded-full bg-white shadow transition-all duration-200" />
                </button>
                <span className={`text-xs ${tmdbEnabled ? 'text-green-400' : 'text-gray-500'}`}>
                  {tmdbEnabled ? 'Activado' : 'Desactivado'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
          <h2 className="text-white text-lg font-medium mb-4">Anadir canal por URL</h2>
          <div className="flex gap-3">
            <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addByUrl()}
              placeholder="https://t.me/c/123456789 o https://t.me/NombreCanal"
              className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-white/25 transition-all placeholder-gray-500" />
            <button onClick={addByUrl}
              className="bg-netflix-red hover:bg-netflix-red-hover text-white px-6 py-3 rounded-xl font-medium text-sm transition-all hover:scale-105 shadow-lg shadow-netflix-red/20">
              Anadir
            </button>
          </div>
          {urlFeedback && (
            <p className={`mt-3 text-xs ${urlFeedback.includes('Error') || urlFeedback.includes('URL') ? 'text-red-400' : 'text-green-400'}`}>
              {urlFeedback}
            </p>
          )}
        </div>

        {active.length > 0 && (
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
            <h2 className="text-white text-lg font-medium mb-4">Activos ({active.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {active.map(c => (
                <button key={c.id} onClick={() => toggle(c.id)}
                  className="flex items-center gap-3 bg-netflix-red/10 border border-netflix-red/20 rounded-xl px-4 py-3 hover:bg-netflix-red/15 transition-all text-left">
                  <span className="text-white text-sm truncate font-medium">{c.name}</span>
                  <span className="text-gray-400 text-[10px] shrink-0 ml-auto">{c.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {inactive.length > 0 && (
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
            <h2 className="text-white text-lg font-medium mb-4">Inactivos ({inactive.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {inactive.map(c => (
                <button key={c.id} onClick={() => toggle(c.id)}
                  className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all text-left">
                  <span className="text-gray-400 text-sm truncate">{c.name}</span>
                  <span className="text-gray-500 text-[10px] shrink-0 ml-auto">{c.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={saveChannels}
          className="bg-netflix-red hover:bg-netflix-red-hover text-white px-8 py-3.5 rounded-xl font-semibold transition-all hover:scale-105 shadow-lg shadow-netflix-red/20">
          Guardar
        </button>
      </div>
    </Layout>
  );
}
