import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Overlay from './Overlay';
import { useBackHandler } from '../focus/react';
import { pushMediaHandler, pushRawHandler } from '../focus/keys';
import { audioLabel, fetchTracks, subtitleUrl, type MediaTracks } from '../services/tracks';
import { streamTicket, streamUrl } from '../services/api';
import { soloPuntero } from '../tv/platform';
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
/**
 * En la consola el mando es un cursor y no llega ninguna tecla, asi que todo
 * lo que aqui se hace con el mando tiene que estar dibujado en pantalla.
 */
const PUNTERO = soloPuntero();
/** Salto de los botones de pantalla: fijo, porque un clic no se "mantiene". */
const SALTO = 30;

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
 *
 * Con puntero (PlayStation) cambia la forma, no el fondo: un clic en el video
 * pausa, la barra de progreso se puede pulsar, y los saltos, el idioma y el
 * volver son botones en pantalla.
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
  const barraRef = useRef<HTMLDivElement>(null);
  /** Motivo por el que este aparato no puede decodificar el video, si lo hay. */
  const [aviso, setAviso] = useState<string | null>(null);

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

  /** Salto de los botones de pantalla: siempre el mismo, sin escalado. */
  const saltar = useCallback((segundos: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + segundos));
    setTime(v.currentTime);
    setSeekHint(`${segundos > 0 ? '+' : '−'}${Math.abs(segundos)} s`);
    showOsd();
  }, [showOsd]);

  /**
   * Pulsar la barra lleva a ese punto. El lienzo esta escalado con transform
   * (main.tsx lo ajusta a la ventana), pero getBoundingClientRect() ya
   * devuelve medidas de pantalla y clientX esta en las mismas, asi que la
   * proporcion sale bien sin deshacer la escala.
   */
  const pulsarBarra = useCallback((e: { clientX: number }) => {
    const v = videoRef.current;
    const el = barraRef.current;
    if (!v || !el || !v.duration) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    v.currentTime = frac * v.duration;
    setTime(v.currentTime);
    showOsd();
  }, [showOsd]);

  // Panel de idioma y subtitulos: se abre con la flecha arriba. No usa el
  // motor de foco porque el reproductor ya se queda con todas las teclas.
  const [tracks, setTracks] = useState<MediaTracks>({ audio: [], subtitles: [], defaultAudio: 0, video: null });
  const [panel, setPanel] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [audioActivo, setAudioActivo] = useState(0);
  const [subActiva, setSubActiva] = useState(-1);

  // La URL del video espera a la entrada de reproduccion: el token de acceso
  // caduca a la hora y cortaba las peliculas largas por la mitad. Hasta que
  // llega se usa la que venga en `src`, que es lo de antes.
  const [fuente, setFuente] = useState(src);
  useEffect(() => {
    let vivo = true;
    streamTicket(path).then(t => { if (vivo) setFuente(streamUrl(path, t)); });
    return () => { vivo = false; };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let vivo = true;
    fetchTracks(path).then(t => {
      if (!vivo) return;
      setTracks(t);
      setAudioActivo(t.defaultAudio);
      // El navegador de la consola solo lee H.264 de 8 bits: con cualquier
      // otra cosa se oye el audio y la imagen se queda en negro, sin ningun
      // error. Se avisa antes de que pase, y se para el audio mientras.
      if (PUNTERO && t.video && t.video.ps4 === false) {
        setAviso(t.video.ps4_motivo || 'la consola no puede decodificar este vídeo');
        videoRef.current?.pause();
        setPlaying(false);
      }
    });
    return () => { vivo = false; };
  }, [path]);

  // Lista plana de lo que se puede elegir, que es lo que recorre el cursor.
  const opciones = useMemo(() => {
    const items: { tipo: 'audio' | 'sub'; valor: number; texto: string }[] = [];
    if (tracks.audio.length > 1) {
      for (const a of tracks.audio) items.push({ tipo: 'audio', valor: a.order, texto: audioLabel(a) });
    }
    if (tracks.subtitles.length > 0) {
      items.push({ tipo: 'sub', valor: -1, texto: 'Sin subtitulos' });
      tracks.subtitles.forEach((sub, i) => items.push({ tipo: 'sub', valor: i, texto: sub.label }));
    }
    return items;
  }, [tracks]);

  const aplicar = useCallback((op: { tipo: 'audio' | 'sub'; valor: number }) => {
    const v = videoRef.current;
    if (op.tipo === 'audio') {
      const lista = (v as unknown as { audioTracks?: { length: number; [n: number]: { enabled: boolean } } })?.audioTracks;
      if (lista) for (let n = 0; n < lista.length; n++) lista[n].enabled = n === op.valor;
      setAudioActivo(op.valor);
    } else {
      if (v) for (let n = 0; n < v.textTracks.length; n++) v.textTracks[n].mode = n === op.valor ? 'showing' : 'disabled';
      setSubActiva(op.valor);
    }
  }, []);

  useBackHandler(() => {
    if (panel) { setPanel(false); return true; }
    close();
    return true;
  }, true);

  useEffect(() => pushRawHandler((key) => {
    if (panel) {
      if (key === 'up') { setCursor(c => Math.max(0, c - 1)); return true; }
      if (key === 'down') { setCursor(c => Math.min(opciones.length - 1, c + 1)); return true; }
      if (key === 'enter') { aplicar(opciones[cursor]); setPanel(false); return true; }
      setPanel(false);
      return true;
    }
    if (key === 'enter') { togglePlay(); return true; }
    if (key === 'left') { seek(-1); return true; }
    if (key === 'right') { seek(1); return true; }
    if (key === 'up' && opciones.length) { setCursor(0); setPanel(true); showOsd(); return true; }
    showOsd();
    return true;
  }), [togglePlay, seek, showOsd, panel, opciones, cursor, aplicar]);

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
    // El estado se lee del elemento, no se supone: si el navegador bloquea el
    // arranque automatico (pasa en WebKit cuando el src llega despues del
    // clic, porque la fuente espera a la entrada de reproduccion) el video se
    // queda en pausa y la barra decia "reproduciendo". Con esto dice la verdad
    // y el boton de pausa sirve para arrancarlo.
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onPlaying = () => { setBuffering(false); setPlaying(true); };
    const onError = () => { toast('No se ha podido reproducir el archivo', 'error', 5000); };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('canplay', onPlaying);
    v.addEventListener('error', onError);
    showOsd();
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
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
      <video ref={videoRef} src={fuente} autoPlay playsInline preload="auto" className="absolute inset-0 w-full h-full"
        style={{ backgroundColor: '#000', objectFit: 'contain' }}>
        {tracks.subtitles.map(sub => (
          <track key={sub.path} kind="subtitles" src={subtitleUrl(sub.path)}
            srcLang={sub.language} label={sub.label} />
        ))}
      </video>

      {/* Capa de clic: pausa al pulsar el video y despierta la barra al mover
          el cursor. Va antes de la barra y del panel en el DOM, asi que no les
          quita los clics: lo que se pinta despues queda por encima. */}
      {PUNTERO && (
        <div className="absolute inset-0"
          onClick={() => { if (panel) setPanel(false); else togglePlay(); }}
          onMouseMove={showOsd} />
      )}

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

      {panel && (
        <div className="absolute right-[96px] bottom-[320px] w-[520px] rounded-xl bg-black/92 border border-white/15 py-5">
          <p className="px-7 pb-3 text-caption text-tv-text3 uppercase tracking-wide">Idioma y subtítulos</p>
          {opciones.map((op, i) => {
            const activa = op.tipo === 'audio' ? op.valor === audioActivo : op.valor === subActiva;
            return (
              <div key={`${op.tipo}-${op.valor}`}
                onMouseEnter={PUNTERO ? () => setCursor(i) : undefined}
                onClick={PUNTERO ? () => { aplicar(op); setPanel(false); } : undefined}
                className={`px-7 py-3 text-lead ${i === cursor ? 'bg-white text-black font-semibold' : 'text-tv-text2'}${PUNTERO ? ' cursor-pointer' : ''}`}>
                <span className="inline-block w-8">{activa ? '✓' : ''}</span>
                {op.texto}
              </div>
            );
          })}
          <p className="px-7 pt-3 text-caption text-tv-text3">
            {PUNTERO ? 'Pulsa una opción' : 'OK elige · Atrás cierra'}
          </p>
        </div>
      )}

      {PUNTERO && (
        <div className={`tv-osd ${osd ? '' : 'is-hidden'} absolute top-[40px] left-[48px]`}>
          <button className="tv-ctl inline-flex items-center justify-center space-x-3 rounded-lg px-7 h-[60px] text-body font-semibold whitespace-nowrap" onClick={close}>&#10005;&nbsp;&nbsp;Volver</button>
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
        {/* El area de clic es mas alta que la barra: con un cursor que se mueve
            con el stick, 10 px de alto no se aciertan. */}
        <div ref={barraRef} onClick={PUNTERO ? pulsarBarra : undefined}
          className={PUNTERO ? 'py-[16px] -my-[16px] cursor-pointer' : ''}>
          <div className="relative h-[10px] rounded-full bg-white/25 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-tv-red rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {PUNTERO ? (
          <>
            <div className="mt-7 flex items-center space-x-4">
              <button className="tv-ctl inline-flex items-center justify-center space-x-3 rounded-lg px-7 h-[60px] text-body font-semibold whitespace-nowrap" onClick={() => saltar(-SALTO)}>&#8722;{SALTO} s</button>
              <button className="tv-ctl inline-flex items-center justify-center space-x-3 rounded-lg px-7 h-[60px] text-body font-semibold whitespace-nowrap w-[150px]" onClick={togglePlay}>
                <span className="w-7 h-7">{playing ? <IconPause /> : <IconPlay />}</span>
                <span>{playing ? 'Pausa' : 'Seguir'}</span>
              </button>
              <button className="tv-ctl inline-flex items-center justify-center space-x-3 rounded-lg px-7 h-[60px] text-body font-semibold whitespace-nowrap" onClick={() => saltar(SALTO)}>+{SALTO} s</button>
              {opciones.length > 0 && (
                <button className="tv-ctl inline-flex items-center justify-center space-x-3 rounded-lg px-7 h-[60px] text-body font-semibold whitespace-nowrap" onClick={() => { setCursor(0); setPanel(true); showOsd(); }}>
                  Idioma y subtítulos
                </button>
              )}
            </div>
            <p className="mt-5 text-caption text-tv-text3">
              Pulsa el vídeo para pausar · pulsa la barra para ir a un punto
            </p>
          </>
        ) : (
          <p className="mt-5 text-caption text-tv-text3">
            OK pausa · ◀ ▶ saltan 10 s (mantén para más) · Atrás sale
            {opciones.length > 0 && ' · ▲ idioma y subtítulos'}
          </p>
        )}
      </div>

      {aviso && (
        <div className="absolute inset-0 flex items-center justify-center px-[96px]"
          style={{ background: 'rgba(0,0,0,0.86)' }}>
          <div className="w-[1040px] rounded-xl bg-[#1A1A1A] border border-white/15 px-12 py-11 text-center">
            <p className="text-h1 font-bold">La consola no puede con este vídeo</p>
            <p className="mt-5 text-lead text-tv-text2">{aviso}.</p>
            <p className="mt-3 text-body text-tv-text3 leading-relaxed">
              Si sigues, lo normal es que se oiga pero no se vea. Para verlo aquí
              hay que reconvertir el archivo a H.264 de 8 bits.
            </p>
            <div className="mt-9 flex items-center justify-center space-x-4">
              <button className="tv-ctl inline-flex items-center justify-center space-x-3 rounded-lg px-7 h-[60px] text-body font-semibold whitespace-nowrap" onClick={close}>Volver</button>
              <button className="tv-ctl inline-flex items-center justify-center space-x-3 rounded-lg px-7 h-[60px] text-body font-semibold whitespace-nowrap" onClick={() => {
                setAviso(null);
                const v = videoRef.current;
                v?.play().catch(() => {});
                setPlaying(true);
                showOsd();
              }}>Intentar igualmente</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </Overlay>
  );
}
