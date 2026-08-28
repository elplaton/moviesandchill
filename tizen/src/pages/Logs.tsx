import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { apiFetch } from '../services/api';

export default function Logs() {
  const [logs, setLogs] = useState<string[]>([]);
  const [lines, setLines] = useState(100);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const fetchLogs = async () => {
    try {
      const res = await apiFetch(`/logs?lines=${lines}`);
      const data = await res.json();
      if (data.logs) setLogs(data.logs);
    } catch {}
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(() => { if (!paused) fetchLogs(); }, 3000);
    return () => clearInterval(interval);
  }, [lines, paused]);

  return (
    <Layout>
      <div className="px-6 md:px-14 pt-24 pb-8">
        <h1 className="text-white text-4xl font-bold mb-2 tracking-tight">Logs</h1>
        <p className="text-gray-400 text-sm mb-8">Salida de journalctl -u telegram-movie</p>

        <div className="flex gap-3 items-center mb-5 flex-wrap">
          <input type="number" value={lines} onChange={e => setLines(parseInt(e.target.value) || 100)}
            className="w-20 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 transition-all" />
          <span className="text-gray-400 text-sm">lineas</span>
          <button onClick={() => setPaused(!paused)}
            className="bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:border-white/20 px-4 py-2.5 rounded-xl text-sm transition-all backdrop-blur-sm">
            {paused ? 'Reanudar' : 'Pausar'}
          </button>
          <button onClick={() => setAutoScroll(!autoScroll)}
            className="bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:border-white/20 px-4 py-2.5 rounded-xl text-sm transition-all backdrop-blur-sm">
            Auto: {autoScroll ? 'ON' : 'OFF'}
          </button>
          <button onClick={fetchLogs}
            className="bg-netflix-red/20 border border-netflix-red/30 text-netflix-red hover:bg-netflix-red/30 px-4 py-2.5 rounded-xl text-sm transition-all backdrop-blur-sm font-medium">
            Actualizar
          </button>
        </div>

        <div className="bg-black/60 backdrop-blur-sm border border-white/10 rounded-2xl p-5 h-[calc(100vh-260px)] overflow-auto font-mono text-xs leading-relaxed shadow-inner">
          {logs.length === 0 ? (
            <span className="text-gray-600">No hay logs disponibles</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="text-green-400/90 hover:bg-white/[0.03] px-1 rounded transition-colors py-px">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
