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
      const activos: Batch[] = data.active_batches || [];
      setBatches(activos);

      // Se siembra el estado por elemento con lo que ya esta en curso. Los
      // mensajes de progreso del WebSocket solo actualizan entradas que ya
      // existen, asi que sin esto una descarga arrancada antes de recargar la
      // app no mostraba su anillo en ninguna parte.
      const enCurso = new Set(['downloading', 'extracting', 'converting']);
      setDownloadStates(prev => {
        const next = new Map(prev);
        const vivos = new Set(activos.filter(b => enCurso.has(b.status)).map(b => b.batch_id));
        // Un lote cancelado o fallido ya no esta "en curso": se limpia su
        // estado para que la fila vuelva a ofrecer Descargar. Antes el lote
        // cancelado seguia 10 s en /status y se resembraba como "22%".
        for (const [key, ds] of next) {
          if (ds.status !== 'done' && !vivos.has(ds.batchId)) next.delete(key);
        }
        for (const b of activos) {
          if (!enCurso.has(b.status)) continue;
          for (const p of b.parts || []) {
            const actual = next.get(p.message_id);
            if (actual && actual.status === 'done') continue;
            next.set(p.message_id, {
              ...actual,
              messageId: p.message_id,
              batchId: b.batch_id,
              progress: p.progress ?? b.progress ?? 0,
              status: b.status as DownloadState['status'],
            });
          }
        }
        return next;
      });
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

  // Sondeo mientras haya algo en marcha: si el WebSocket se cae (o la TV lo
  // corta al dormir), el progreso sigue llegando aunque sea cada pocos segundos.
  const hayActivas = batches.some((b) => ['downloading', 'extracting', 'converting'].includes(b.status));
  useEffect(() => {
    if (!hayActivas) return;
    const t = setInterval(loadStatus, 4000);
    return () => clearInterval(t);
  }, [hayActivas, loadStatus]);

  useEffect(() => {
    const unsub = onProgress((data: any) => {
      // El porcentaje global del lote tambien se refleja en las tarjetas de
      // Descargas, que leen `batches` y no el estado por archivo.
      if (data.type === 'batch_progress' && data.batch_id) {
        setBatches(prev => prev.map(b => b.batch_id === data.batch_id
          ? { ...b, progress: data.overall_progress ?? b.progress, status: 'downloading' }
          : b));
      }
      if (data.type === 'batch_status' && data.batch_id) {
        // Cambio de fase (extrayendo, convirtiendo, hecho, error): se relee el estado completo.
        loadStatus();
      }
      if (data.type === 'batch_update' && data.batch_id && data.downloaded_parts !== undefined) {
        setBatches(prev => prev.map(b => b.batch_id === data.batch_id
          ? { ...b, downloaded_parts: data.downloaded_parts, progress: data.overall_progress ?? b.progress }
          : b));
      }
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
              // ?? y no ||: part_progress puede valer 0, que es falsy, y
              // entonces se colaba el progreso global del lote. Por eso el
              // anillo mostraba un porcentaje que no correspondia al fichero.
              next.set(data.part_message_id, { ...existing, progress: data.part_progress ?? existing.progress, downloadedStr: data.downloaded_size_str, totalStr: data.total_size_str || existing.totalStr || '', speed, _lastBytes: 0, _lastTime: now });
            } else {
              next.set(data.part_message_id, { ...existing, progress: data.part_progress ?? existing.progress ?? 0 });
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
