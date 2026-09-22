import { useCallback, useEffect, useRef, useState } from 'react';
import Overlay from './Overlay';
import { useBackHandler } from '../focus/react';
import { pushMediaHandler, pushRawHandler } from '../focus/keys';
import { clearWatched, resumePoint, setWatched } from '../tv/progress';
import { toast } from '../tv/toast';
import { IconPause, IconPlay } from './Icons';

interface Props {
  src: string;
  path: string;
  title: string;
  subtitle?: string;
  poster?: string;
  backdrop?: string;
  onClose: () => void;
}

const OSD_MS = 3200;
const SAVE_EVERY_MS = 5000;
/** Salto por pulsacion; al repetir seguido crece. */
const STEPS = [10, 30, 60, 120];
const REPEAT_WINDOW_MS = 500;

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/**
 * Reproductor a pantalla completa sin controles nativos.
 *
 *   OK / ⏯   pausa y reanuda (y enseña la barra)
 *   ◀ ▶      saltan 10 s; seguidos, 30, 60 y 120 s
 *   ▲ ▼      enseñan la barra
 *   Atras    sale guardando la posicion
 *
 * La barra se oculta sola. La posicion se guarda cada 5 s y al salir, y al
 * abrir el mismo archivo se reanuda donde se dejo.
 */
export default function Player({ src, path, title, subtitle, poster, backdrop, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [osd, setOsd] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [seekHint, setSeekHint] = useState<string | null>(null);
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeek = useRef<{ at: number; n: number }>({ at: 0, n: 0 });
  const lastSave = useRef(0);

  const showOsd = useCallback(() => {
    setOsd(true);
    if (osdTimer.current) clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => setOsd(false), OSD_MS);
  }, []);

  const save = useCallback((force = false) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const now = Date.now();
    if (!force && now - lastSave.current < SAVE_EVERY_MS) return;
    lastSave.current = now;
    if (v.currentTime / v.duration >= 0.97) clearWatched(path);
    else setWatched({ path, title, subtitle, poster, backdrop, position: v.currentTime, duration: v.duration });
  }, [path, title, subtitle, poster, backdrop]);

  const close = useCallback(() => {
    save(true);
    onClose();
  }, [save, onClose]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
    showOsd();
  }, [showOsd]);

  const seek = useCallback((dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const now = Date.now();
    const n = now - lastSeek.current.at < REPEAT_WINDOW_MS ? Math.min(lastSeek.current.n + 1, STEPS.length - 1) : 0;
    lastSeek.current = { at: now, n };
    const step = STEPS[n] * dir;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + step));
    setTime(v.currentTime);
    setSeekHint(`${dir > 0 ? '+' : '−'}${STEPS[n]} s`);
    showOsd();
  }, [showOsd]);

  useBackHandler(() => { close(); return true; }, true);

  useEffect(() => pushRawHandler((key) => {
    if (key === 'enter') { togglePlay(); return true; }
    if (key === 'left') { seek(-1); return true; }
    if (key === 'right') { seek(1); return true; }
    showOsd();
    return true;
  }), [togglePlay, seek, showOsd]);

  useEffect(() => pushMediaHandler((key) => {
    const v = videoRef.current;
    if (!v) return;
    if (key === 'playpause') togglePlay();
    else if (key === 'play') { v.play().catch(() => {}); setPlaying(true); showOsd(); }
    else if (key === 'pause') { v.pause(); setPlaying(false); showOsd(); }
    else if (key === 'stop') close();
    else if (key === 'rewind') seek(-1);
    else if (key === 'forward') seek(1);
  }), [togglePlay, seek, close, showOsd]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const start = resumePoint(path);
    const onMeta = () => {
      setDuration(v.duration || 0);
      if (start > 0) {
        v.currentTime = start;
        toast(`Continuando desde ${fmt(start)}`);
      }
    };
    const onTime = () => { setTime(v.currentTime); save(); };
    const onEnded = () => { clearWatched(path); onClose(); };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => { setBuffering(false); setPlaying(true); };
    const onError = () => { toast('No se ha podido reproducir el archivo', 'error', 5000); };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('canplay', onPlaying);
    v.addEventListener('error', onError);
    showOsd();
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('canplay', onPlaying);
      v.removeEventListener('error', onError);
      if (osdTimer.current) clearTimeout(osdTimer.current);
    };
  }, [path, save, onClose, showOsd]);

  useEffect(() => {
    if (!seekHint) return;
    const t = setTimeout(() => setSeekHint(null), 700);
    return () => clearTimeout(t);
  }, [seekHint]);

  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <Overlay>
    <div className="fixed inset-0 z-[70]" style={{ background: '#000' }}>
      <video ref={videoRef} src={src} autoPlay preload="auto" className="absolute inset-0 w-full h-full"
        style={{ backgroundColor: '#000', objectFit: 'contain' }} />

      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[72px] h-[72px] rounded-full border-[6px] border-white/20 border-t-white animate-spin" />
        </div>
      )}

      {!playing && !buffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[120px] h-[120px] rounded-full bg-black/55 flex items-center justify-center text-white">
            <span className="w-[64px] h-[64px]"><IconPause /></span>
          </div>
        </div>
      )}

      {seekHint && (
        <div className="absolute top-[300px] left-0 right-0 flex justify-center pointer-events-none">
          <span className="px-6 py-3 rounded-lg bg-black/70 text-h1 font-bold">{seekHint}</span>
        </div>
      )}

      <div className={`tv-osd ${osd ? '' : 'is-hidden'} absolute left-0 right-0 bottom-0 pt-[160px] pb-[64px] px-[96px]`}
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 100%)' }}>
        <div className="flex items-end justify-between mb-6">
          <div className="min-w-0">
            <p className="text-h1 font-bold truncate">{title}</p>
            {subtitle && <p className="text-lead text-tv-text2 truncate mt-1">{subtitle}</p>}
          </div>
          <div className="flex items-center space-x-4 text-lead text-tv-text2 shrink-0 ml-10">
            <span className="w-8 h-8 text-white">{playing ? <IconPlay /> : <IconPause />}</span>
            <span className="text-white font-semibold tabular-nums">{fmt(time)}</span>
            <span>/</span>
            <span className="tabular-nums">{fmt(duration)}</span>
          </div>
        </div>
        <div className="relative h-[10px] rounded-full bg-white/25 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-tv-red rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-5 text-caption text-tv-text3">OK pausa · ◀ ▶ saltan 10 s (mantén para más) · Atrás sale</p>
      </div>
    </div>
    </Overlay>
  );
}
