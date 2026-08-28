import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';

interface ChannelProgress {
  channel_id: number;
  channel_name: string;
  total_indexed: number;
  total_estimate: number;
  total_scanned: number;
  status: string;
  phase: string;
}

interface IndexStatus {
  phase: string;
  channels: ChannelProgress[];
  overall_progress: number;
  total_scanned: number;
  total_indexed: number;
  total_estimate: number;
  running: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  idle: 'Inactivo',
  estimating: 'Calculando total de mensajes...',
  estimate_done: 'Estimacion completada',
  scanning: 'Indexando canales...',
  done: 'Indexacion completada',
  enriching: 'Enriqueciendo metadatos...',
  stopped: 'Detenido',
};

export default function IndexProgress() {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/index/status');
      const data = await res.json();
      setStatus(data);
    } catch {}
  }, []);

  const connectWs = useCallback(() => {
    const token = localStorage.getItem('access_token') || '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/progress?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type && ['index_phase', 'index_progress', 'index_channel_start', 'index_channel_done'].includes(msg.type)) {
          fetchStatus();
        }
      } catch {}
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    connectWs();

    const interval = setInterval(fetchStatus, 3000);
    reconnectRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connectWs();
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      if (reconnectRef.current) clearInterval(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchStatus, connectWs]);

  const startIndex = async () => {
    await apiFetch('/index/start', { method: 'POST' });
    fetchStatus();
  };

  const stopIndex = async () => {
    await apiFetch('/index/stop', { method: 'POST' });
    fetchStatus();
  };

  const isActive = status?.phase !== 'idle' && status?.phase !== 'done' && status?.phase !== 'stopped';
  const hasChannels = (status?.channels?.length || 0) > 0;

  if (!status || (!isActive && !hasChannels)) return null;

  return (
    <div className="px-6 md:px-14 mb-8">
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-3 min-w-0">
            {isActive && (
              <div className="w-5 h-5 border-2 border-netflix-red border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">
                {PHASE_LABELS[status.phase] || status.phase}
              </p>
              {status.overall_progress > 0 && (
                <div className="mt-2 w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-netflix-red rounded-full transition-all duration-500" style={{ width: `${status.overall_progress}%` }} />
                </div>
              )}
              <p className="text-gray-500 text-xs mt-1">
                {(status.total_scanned || 0).toLocaleString()} / {(status.total_estimate || 0).toLocaleString()} msgs · {(status.total_indexed || 0).toLocaleString()} con media
                {status.running ? ' · Indexando...' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isActive && status.running && (
              <button onClick={(e) => { e.stopPropagation(); stopIndex(); }} className="text-xs px-3 py-1 rounded-lg bg-netflix-red/20 text-netflix-red hover:bg-netflix-red/30 transition-colors">Detener</button>
            )}
            {!isActive && !status.running && (
              <button onClick={(e) => { e.stopPropagation(); startIndex(); }} className="text-xs px-3 py-1 rounded-lg bg-netflix-red hover:bg-netflix-red-hover text-white transition-colors">Iniciar</button>
            )}
            <svg className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {expanded && (status.channels || []).length > 0 && (
          <div className="px-5 pb-4 space-y-3 border-t border-white/5 pt-4">
            {(status.channels || []).map(ch => (
              <div key={ch.channel_id}>
                <div className="flex justify-between items-center mb-1">
                  <p className="text-gray-300 text-xs truncate flex-1 mr-2">{ch.channel_name}</p>
                  <p className="text-gray-500 text-xs flex-shrink-0">
                    {(ch.total_scanned || 0).toLocaleString()} / {(ch.total_estimate || 0).toLocaleString()}
                    {(ch.total_estimate || 0) > 0 ? ` · ${Math.round(((ch.total_scanned || 0) / Math.max(ch.total_estimate, 1)) * 100)}%` : ''}
                  </p>
                </div>
                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${ch.phase === 'done' ? 'bg-green-500' : ch.phase === 'scanning' ? 'bg-netflix-red' : 'bg-yellow-500/60'}`}
                    style={{ width: `${(ch.total_estimate || 0) > 0 ? Math.round(((ch.total_scanned || 0) / Math.max(ch.total_estimate, 1)) * 100) : 0}%` }}
                  />
                </div>
                <p className="text-gray-500 text-[10px] mt-0.5">{(ch.total_indexed || 0).toLocaleString()} con media</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
