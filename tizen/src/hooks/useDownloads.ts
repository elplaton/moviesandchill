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

  useEffect(() => {
    const unsub = onProgress((data: any) => {
      if (data.type === 'batch_progress' && data.part_message_id) {
        setDownloadStates(prev => {
          const next = new Map(prev);
          const existing = next.get(data.part_message_id);
          if (existing) {
            const now = Date.now();
            let speed = existing.speed || '';
            if (data.downloaded_size_str) {
              const prevTime = existing._lastTime || now;
              const elapsed = (now - prevTime) / 1000;
              const sizeMatch = data.downloaded_size_str.match(/([\d.]+)\s*(GB|MB|KB|B)/i);
              const prevMatch = existing.downloadedStr?.match(/([\d.]+)\s*(GB|MB|KB|B)/i);
              if (sizeMatch && prevMatch && elapsed > 0.5) {
                const toBytes = (v: number, u: string) => {
                  const m: Record<string, number> = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824 };
                  return v * (m[u.toUpperCase()] || 1);
                };
                const bytesPerSec = (toBytes(parseFloat(sizeMatch[1]), sizeMatch[2]) - toBytes(parseFloat(prevMatch[1]), prevMatch[2])) / elapsed;
                if (bytesPerSec > 0) {
                  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
                  let v = bytesPerSec, i = 0;
                  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
                  speed = `${v.toFixed(1)} ${units[i]}`;
                }
              }
              next.set(data.part_message_id, { ...existing, progress: data.part_progress || data.overall_progress || existing.progress, downloadedStr: data.downloaded_size_str, totalStr: data.total_size_str || existing.totalStr || '', speed, _lastBytes: 0, _lastTime: now });
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
  }, []);

  return { batches, pausedBatches, downloadStates, loadStatus, loadPaused, download, cancelBatch, pauseBatch, resumeBatch };
}
