import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import FocusableButton from '../components/FocusableButton';
import { FocusScope } from '../focus/react';
import { apiFetch } from '../services/api';

/** Un campo numerico no se puede teclear con el mando: se cicla entre valores. */
const LINE_OPTIONS = [100, 250, 500, 1000];

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

        <FocusScope orientation="horizontal" index={1} className="flex gap-3 items-center mb-5 flex-wrap">
          <FocusableButton
            index={0}
            onClick={() => setLines(LINE_OPTIONS[(LINE_OPTIONS.indexOf(lines) + 1) % LINE_OPTIONS.length] ?? 100)}
            className="bg-white/5 border border-white/10 text-gray-300 px-4 py-2.5 rounded-xl text-sm"
          >
            {lines} lineas
          </FocusableButton>
          <FocusableButton index={1} onClick={() => setPaused(!paused)}
            className="bg-white/5 border border-white/10 text-gray-300 px-4 py-2.5 rounded-xl text-sm">
            {paused ? 'Reanudar' : 'Pausar'}
          </FocusableButton>
          <FocusableButton index={2} onClick={() => setAutoScroll(!autoScroll)}
            className="bg-white/5 border border-white/10 text-gray-300 px-4 py-2.5 rounded-xl text-sm">
            Auto: {autoScroll ? 'ON' : 'OFF'}
          </FocusableButton>
          <FocusableButton index={3} onClick={fetchLogs} autoFocus
            className="bg-netflix-red/20 border border-netflix-red/30 text-netflix-red px-4 py-2.5 rounded-xl text-sm font-medium">
            Actualizar
          </FocusableButton>
        </FocusScope>

        <div className="bg-black/85 border border-white/10 rounded-2xl p-5 h-[calc(100vh-260px)] overflow-auto font-mono text-xs leading-relaxed shadow-inner">
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
