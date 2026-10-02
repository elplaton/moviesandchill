import { useCallback, useEffect, useRef, useState } from 'react';
import { audioLabel, fetchTracks, puedeCambiarAudio, streamTicket, subtitleUrl,
         type MediaTracks } from '../services/tracks';
import { useAirplay } from '../hooks/useAirplay';
import { IconAirplay, IconClose, IconExpand, IconMute, IconPause, IconPlay, IconSubtitles, IconVolume } from './ui/Icon';

interface Props {
  path: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

const KEY_HELP = 'Espacio: pausa · ← →: 10 s · ↑ ↓: volumen · F: pantalla completa · M: silencio · Esc: salir';
const RESUME_KEY = 'mc.progress';

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Posición guardada por archivo, compartida con el resto de clientes. */
function readProgress(path: string): number {
  try {
    const list = JSON.parse(localStorage.getItem(RESUME_KEY) || '[]');
    const hit = list.find((w: any) => w.path === path);
    if (!hit?.duration) return 0;
    return hit.position > 60 && hit.position / hit.duration < 0.95 ? hit.position : 0;
  } catch { return 0; }
}
function writeProgress(path: string, title: string, subtitle: string | undefined, position: number, duration: number) {
  try {
    const list = JSON.parse(localStorage.getItem(RESUME_KEY) || '[]').filter((w: any) => w.path !== path);
    if (duration && position / duration < 0.97) list.unshift({ path, title, subtitle, position, duration, updated: Date.now() });
    localStorage.setItem(RESUME_KEY, JSON.stringify(list.slice(0, 40)));
  } catch { /* almacenamiento lleno */ }
}

/**
 * Reproductor a pantalla completa con controles propios y atajos de teclado.
 *
 * En un escritorio se ve con el teclado a mano: espacio, flechas y F son lo
 * que espera cualquiera, y los controles nativos del navegador no dan ni el
 * título ni un salto de 10 s. La barra se esconde sola mientras se reproduce.
 */
export default function Player({ path, title, subtitle, onClose }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [ui, setUi] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [tracks, setTracks] = useState<MediaTracks | null>(null);
  const [menu, setMenu] = useState(false);
  const [subActiva, setSubActiva] = useState(-1);   // -1 = sin subtítulos
  const [audioActivo, setAudioActivo] = useState(0);
  const airplay = useAirplay(ref);

  // El `src` espera a la entrada de reproducción: el token de acceso caduca a
  // la hora y cortaba las películas largas por la mitad.
  const [ticket, setTicket] = useState<string | null>(null);
  const src = ticket === null
    ? undefined
    : `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(ticket)}`;

  useEffect(() => {
    let vivo = true;
    streamTicket(path).then(t => { if (vivo) setTicket(t); });
    fetchTracks(path).then(t => { if (vivo) { setTracks(t); setAudioActivo(t.default_audio ?? 0); } });
    return () => { vivo = false; };
  }, [path]);

  // Los <track> los pinta React, pero encenderlos y apagarlos es cosa del DOM:
  // el atributo `default` solo vale para el primer renderizado.
  const elegirSubtitulo = useCallback((i: number) => {
    const v = ref.current;
    if (v) for (let n = 0; n < v.textTracks.length; n++) v.textTracks[n].mode = n === i ? 'showing' : 'disabled';
    setSubActiva(i);
    setMenu(false);
  }, []);

  const elegirAudio = useCallback((i: number) => {
    const lista = (ref.current as unknown as {
      audioTracks?: { length: number; [n: number]: { enabled: boolean } };
    })?.audioTracks;
    if (lista) for (let n = 0; n < lista.length; n++) lista[n].enabled = n === i;
    setAudioActivo(i);
    setMenu(false);
  }, []);

  const wake = useCallback(() => {
    setUi(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!ref.current?.paused) setUi(false); }, 2800);
  }, []);

  const toggle = useCallback(() => {
    const v = ref.current; if (!v) return;
    if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
    wake();
  }, [wake]);

  const seek = useCallback((delta: number) => {
    const v = ref.current; if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + delta));
    setHint(`${delta > 0 ? '+' : '−'}${Math.abs(delta)} s`);
    wake();
  }, [wake]);

  const fullscreen = useCallback(() => {
    const box = boxRef.current; if (!box) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else box.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 700);
    return () => clearTimeout(t);
  }, [hint]);

  useEffect(() => {
    const v = ref.current; if (!v) return;
    const start = readProgress(path);
    let lastSave = 0;

    const onMeta = () => { setDuration(v.duration || 0); if (start > 0) { v.currentTime = start; setHint(`Desde ${fmt(start)}`); } };
    const onTime = () => {
      setTime(v.currentTime);
      const now = Date.now();
      if (now - lastSave > 5000 && v.duration) { lastSave = now; writeProgress(path, title, subtitle, v.currentTime, v.duration); }
    };
    const onPlay = () => { setPlaying(true); setBuffering(false); wake(); };
    const onPause = () => { setPlaying(false); setUi(true); };
    const onWaiting = () => setBuffering(true);
    const onEnded = () => { writeProgress(path, title, subtitle, 0, 0); onClose(); };

    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('playing', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('ended', onEnded);

    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); toggle(); break;
        case 'ArrowRight': e.preventDefault(); seek(10); break;
        case 'ArrowLeft': e.preventDefault(); seek(-10); break;
        case 'ArrowUp': e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); setVolume(v.volume); wake(); break;
        case 'ArrowDown': e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); setVolume(v.volume); wake(); break;
        case 'f': fullscreen(); break;
        case 'm': v.muted = !v.muted; setMuted(v.muted); wake(); break;
        case 'Escape': if (!document.fullscreenElement) onClose(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    wake();

    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('playing', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('ended', onEnded);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (v.duration && v.currentTime > 0) writeProgress(path, title, subtitle, v.currentTime, v.duration);
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = duration ? (time / duration) * 100 : 0;
  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = ref.current; if (!v || !v.duration) return;
    v.currentTime = (Number(e.target.value) / 100) * v.duration;
    setTime(v.currentTime);
  };

  const audio = tracks?.audio || [];
  const subs = tracks?.external_subtitles || [];
  const cambioAudio = puedeCambiarAudio(ref.current);
  const hayPistas = audio.length > 1 || subs.length > 0;

  return (
    <div ref={boxRef} className="fixed inset-0 z-[80] bg-black" onMouseMove={wake} onDoubleClick={fullscreen}>
      <video ref={ref} src={src} autoPlay onClick={toggle} crossOrigin="use-credentials"
        x-webkit-airplay="allow"
        className="h-full w-full bg-black object-contain">
        {(tracks?.external_subtitles || []).map(sub => (
          <track key={sub.path} kind="subtitles" src={subtitleUrl(sub.path, ticket || undefined)}
            srcLang={sub.language} label={sub.label} />
        ))}
      </video>

      {airplay.activo && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
          <span className="w-12 h-12 text-nf-red"><IconAirplay /></span>
          <p className="text-lg font-semibold">Reproduciendo por AirPlay</p>
          <p className="text-base text-nf-dim">La imagen va al otro dispositivo.</p>
        </div>
      )}

      {buffering && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}
      {hint && (
        <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center">
          <span className="rounded bg-black/75 px-4 py-2 text-lg font-semibold">{hint}</span>
        </div>
      )}

      <div className={`absolute inset-x-0 top-0 flex items-start gap-4 p-5 transition-opacity duration-300 ${ui ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.75), transparent)' }}>
        <button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/60 hover:bg-white/20" aria-label="Cerrar">
          <span className="w-5 h-5"><IconClose /></span>
        </button>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{title}</p>
          {subtitle && <p className="truncate text-base text-nf-dim">{subtitle}</p>}
        </div>
      </div>

      <div className={`absolute inset-x-0 bottom-0 px-6 pb-5 pt-16 transition-opacity duration-300 ${ui ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        style={{ background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.85))' }}>
        <input type="range" min={0} max={100} step={0.1} value={pct} onChange={onScrub} aria-label="Posición"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none"
          style={{ background: `linear-gradient(90deg, #E50914 ${pct}%, rgba(255,255,255,0.25) ${pct}%)` }} />

        <div className="mt-3 flex items-center gap-4">
          <button onClick={toggle} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/15" aria-label={playing ? 'Pausa' : 'Reproducir'}>
            <span className="w-6 h-6">{playing ? <IconPause /> : <IconPlay />}</span>
          </button>
          <div className="group flex items-center gap-2">
            <button onClick={() => { const v = ref.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); }}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15" aria-label="Silencio">
              <span className="w-5 h-5">{muted || volume === 0 ? <IconMute /> : <IconVolume />}</span>
            </button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volumen"
              onChange={e => { const v = ref.current; if (!v) return; v.volume = Number(e.target.value); v.muted = false; setVolume(v.volume); setMuted(false); }}
              className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 opacity-0 transition-all duration-200 group-hover:w-24 group-hover:opacity-100" />
          </div>
          <span className="text-base tabular-nums text-nf-dim">{fmt(time)} / {fmt(duration)}</span>
          <span className="flex-1" />
          <span className="hidden xl:block text-xs text-nf-faint">{KEY_HELP}</span>
          {airplay.disponible && (
            <button onClick={airplay.elegir} aria-label="AirPlay"
              className={`grid h-9 w-9 place-items-center rounded-full hover:bg-white/15 ${
                airplay.activo ? 'text-nf-red' : ''}`}>
              <span className="w-5 h-5"><IconAirplay /></span>
            </button>
          )}
          {hayPistas && (
            <div className="relative">
              <button onClick={() => setMenu(m => !m)} aria-label="Idioma y subtítulos"
                className={`grid h-9 w-9 place-items-center rounded-full hover:bg-white/15 ${menu ? 'bg-white/15' : ''}`}>
                <span className="w-5 h-5"><IconSubtitles /></span>
              </button>
              {menu && (
                <div className="absolute bottom-12 right-0 w-64 overflow-hidden rounded border border-nf-line bg-black/95 shadow-panel">
                  {audio.length > 1 && (
                    <>
                      <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-nf-faint">Audio</p>
                      {audio.map(a => (
                        <button key={a.order} onClick={() => elegirAudio(a.order)} disabled={!cambioAudio}
                          className={`block w-full px-4 py-2 text-left text-base hover:bg-white/10 disabled:cursor-default disabled:hover:bg-transparent ${
                            a.order === audioActivo ? 'text-white' : 'text-nf-dim'}`}>
                          {a.order === audioActivo ? '✓ ' : '\u00a0\u00a0 '}{audioLabel(a)}
                        </button>
                      ))}
                      {!cambioAudio && (
                        <p className="px-4 pb-2 text-xs leading-snug text-nf-faint">
                          Este navegador no deja cambiar de pista; suena la primera del archivo.
                          En Safari y en la tele sí se puede.
                        </p>
                      )}
                    </>
                  )}
                  {subs.length > 0 && (
                    <>
                      <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-nf-faint">Subtítulos</p>
                      <button onClick={() => elegirSubtitulo(-1)}
                        className={`block w-full px-4 py-2 text-left text-base hover:bg-white/10 ${subActiva === -1 ? 'text-white' : 'text-nf-dim'}`}>
                        {subActiva === -1 ? '✓ ' : '\u00a0\u00a0 '}Desactivados
                      </button>
                      {subs.map((sub, i) => (
                        <button key={sub.path} onClick={() => elegirSubtitulo(i)}
                          className={`block w-full px-4 py-2 text-left text-base hover:bg-white/10 ${subActiva === i ? 'text-white' : 'text-nf-dim'}`}>
                          {subActiva === i ? '✓ ' : '\u00a0\u00a0 '}{sub.label}
                        </button>
                      ))}
                    </>
                  )}
                  <div className="h-2" />
                </div>
              )}
            </div>
          )}
          <button onClick={fullscreen} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15" aria-label="Pantalla completa">
            <span className="w-5 h-5"><IconExpand /></span>
          </button>
        </div>
      </div>
    </div>
  );
}
