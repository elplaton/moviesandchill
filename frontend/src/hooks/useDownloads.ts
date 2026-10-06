import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';
import { onProgress } from '../services/ws';
import type { Batch, DownloadState } from '../types';

export function useDownloads() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [pausedBatches, setPausedBatches] = useState<any[]>([]);
  const [downloadStates, setDownloadStates] = useState<Map<number, DownloadState>>(new Map());

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/status');
      const data = await res.json();
      setBatches(data.active_batches || []);
      return data.disk_free || '';
    } catch {}
    return '';
  }, []);

  const loadPaused = useCallback(async () => {
    try {
      const res = await apiFetch('/resumable');
      const data = await res.json();
      setPausedBatches(data.batches || []);
    } catch {}
  }, []);

  const download = async (msgId: number, channelId?: number) => {
    try {
      const res = await apiFetch('/download', {
        method: 'POST', body: JSON.stringify({ message_id: msgId, channel_id: channelId }),
      });
      const data = await res.json();
      if (data.error) return data.error;
      loadStatus();
      const parts: any[] = data.parts || [];
      setDownloadStates(prev => {
        const next = new Map(prev);
        for (const p of parts) {
          next.set(p.message_id, { messageId: p.message_id, batchId: data.batch_id, progress: 0, status: 'downloading' });
        }
        return next;
      });
      return null;
    } catch {}
    return 'Error de conexion';
  };

  const cancelBatch = async (batchId: string) => {
    await apiFetch('/cancel', { method: 'POST', body: JSON.stringify({ batch_id: batchId }) });
    loadStatus();
  };

  const pauseBatch = async (batchId: string) => {
    await apiFetch('/pause', { method: 'POST', body: JSON.stringify({ batch_id: batchId }) });
    loadStatus(); loadPaused();
  };

  const resumeBatch = async (batchId: string) => {
    await apiFetch('/resume', { method: 'POST', body: JSON.stringify({ batch_id: batchId }) });
    loadPaused(); loadStatus();
  };

  // Estado inicial y sondeo mientras haya algo en marcha: asi lo que lanza
  // otra cuenta (o el movil) aparece en Actividad sin recargar.
  useEffect(() => { loadStatus(); }, [loadStatus]);
  const hayActivas = batches.some((b) => ['downloading', 'extracting', 'converting'].includes(b.status));
  useEffect(() => {
    const t = setInterval(loadStatus, hayActivas ? 4000 : 15000);
    return () => clearInterval(t);
  }, [hayActivas, loadStatus]);

  useEffect(() => {
    const unsub = onProgress((data: any) => {
      if (data.type === 'batch_progress' && data.batch_id) {
        setBatches(prev => {
          if (!prev.some(b => b.batch_id === data.batch_id)) { loadStatus(); return prev; }
          return prev.map(b => b.batch_id === data.batch_id ? { ...b,
            progress: data.overall_progress ?? b.progress,
            downloaded_size_str: data.downloaded_size_str ?? b.downloaded_size_str,
            total_size_str: data.total_size_str || b.total_size_str,
            speed_str: data.speed_str ?? b.speed_str,
            eta_str: data.eta_str ?? b.eta_str,
          } : b);
        });
      }
      if (data.type === 'batch_status' && data.batch_id) loadStatus();
      if (data.type === 'batch_progress' && data.part_message_id) {
        setDownloadStates(prev => {
          const next = new Map(prev);
          const existing = next.get(data.part_message_id);
          if (existing) {
            if (data.downloaded_size_str) {
              next.set(data.part_message_id, { ...existing,
                progress: data.part_progress ?? data.overall_progress ?? existing.progress,
                downloadedStr: data.downloaded_size_str,
                totalStr: data.total_size_str || existing.totalStr || '',
                speedStr: data.speed_str || '',
                etaStr: data.eta_str || '',
              });
            } else {
              next.set(data.part_message_id, { ...existing, progress: data.part_progress || data.overall_progress || 0 });
            }
          }
          return next;
        });
      }
      if (data.type === 'batch_update' && data.part_message_id) {
        setDownloadStates(prev => {
          const next = new Map(prev);
          const existing = next.get(data.part_message_id);
          if (existing && data.status === 'done') {
            next.set(data.part_message_id, { ...existing, progress: 100, status: 'done' });
          }
          return next;
        });
      }
      if (data.type === 'batch_status' && data.batch_id) {
        const status = data.status;
        if (status === 'cancelled') {
          setDownloadStates(prev => {
            const next = new Map(prev);
            for (const [key, ds] of next) { if (ds.batchId === data.batch_id) next.delete(key); }
            return next;
          });
        } else if (['done', 'error'].includes(status)) {
          const batchId = data.batch_id;
          setDownloadStates(prev => {
            const next = new Map(prev);
            for (const [key, ds] of next) {
              if (ds.batchId === batchId) {
                next.set(key, { ...ds, status: status === 'done' ? 'done' : 'error', progress: status === 'done' ? 100 : ds.progress });
              }
            }
            return next;
          });
          setTimeout(() => {
            setDownloadStates(prev => {
              const next = new Map(prev);
              for (const [key, ds] of next) { if (ds.batchId === batchId) next.delete(key); }
              return next;
            });
          }, 3000);
        } else if (status === 'extracting' || status === 'converting') {
          setDownloadStates(prev => {
            const next = new Map(prev);
            for (const [key, ds] of next) { if (ds.batchId === data.batch_id) next.set(key, { ...ds, status }); }
            return next;
          });
        }
      }
    });
    return () => unsub();
  }, [loadStatus]);

  return { batches, pausedBatches, downloadStates, loadStatus, loadPaused, download, cancelBatch, pauseBatch, resumeBatch };
}
