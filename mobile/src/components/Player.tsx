import { useEffect, useRef, useState } from 'react';
import { fetchSubtitles, streamTicket, subtitleUrl, type ExternalSubtitle } from '../services/tracks';
import { useAirplay } from '../hooks/useAirplay';
import { IAirplay } from './Icons';
import { clearWatched, resumePoint, setWatched } from '../utils/progress';

interface Props { path: string; title: string; subtitle?: string; poster?: string; backdrop?: string; onClose: () => void }

/**
 * Reproductor: solo el <video> del sistema, sin barra ni botones propios.
 *
 * En cuanto arranca entra en pantalla completa nativa, que en el telefono ya
 * trae todo (girar, barra de tiempo, volumen, AirPlay, subtitulos, PiP y el
 * boton de salir). Se cierra al salir de esa pantalla completa, al terminar
 * el video o con el gesto de atras del telefono: al abrirse se apila una
 * entrada en el historial para que "atras" signifique "cerrar el video" y no
 * "volver a la pantalla anterior".
 *
 * Mientras carga se tapa con una pantalla de espera. Si no, se veia el
 * reproductor en linea con sus propios controles durante un segundo y luego
 * saltaba encima el del sistema: parecian dos reproductores peleandose.
 */
export default function Player({ path, title, subtitle, poster, backdrop, onClose }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [subs, setSubs] = useState<ExternalSubtitle[]>([]);
  const [preparando, setPreparando] = useState(true);
  const [fallo, setFallo] = useState('');
  const airplay = useAirplay(ref);
  // El `src` espera a la entrada de reproducción: el token de acceso caduca a
  // la hora y cortaba las películas largas por la mitad. Con AirPlay es
  // imprescindible, porque quien pide los trozos es el Apple TV.
  const [ticket, setTicket] = useState<string | null>(null);
  const src = ticket === null
    ? undefined
    : `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(ticket)}`;

  // El selector de subtítulos lo pone el reproductor del sistema; aquí solo
  // hay que colgarle las pistas que haya.
  useEffect(() => {
    let vivo = true;
    streamTicket(path).then(t => { if (vivo) setTicket(t); });
    fetchSubtitles(path).then(s => { if (vivo) setSubs(s); });
    return () => { vivo = false; };
  }, [path]);

  useEffect(() => {
    const v = ref.current; if (!v) return;
    const start = resumePoint(path);
    let last = 0;
    let closed = false;
    const close = () => { if (closed) return; closed = true; onClose(); };

    const onMeta = () => { if (start > 0) v.currentTime = start; };
    const onTime = () => {
      const now = Date.now(); if (now - last < 5000 || !v.duration) return; last = now;
      if (v.currentTime / v.duration >= 0.97) clearWatched(path);
      else setWatched({ path, title, subtitle, poster, backdrop, position: v.currentTime, duration: v.duration });
    };
    const onEnded = () => { clearWatched(path); history.state?.player ? history.back() : close(); };

    let entered = false;
    const goFull = () => {
      if (entered) return; entered = true;
      // Si ya va por AirPlay no se entra en pantalla completa: la imagen esta
      // en la tele y lo unico que se veria aqui es el cartel de AirPlay.
      const anyAir = v as unknown as { webkitCurrentPlaybackTargetIsWireless?: boolean };
      if (anyAir.webkitCurrentPlaybackTargetIsWireless) { setPreparando(false); return; }
      // Ya hay imagen y el reproductor del sistema esta a punto de abrirse:
      // se retira la espera un instante despues para no dejar un parpadeo
      // del reproductor en linea entre medias.
      setTimeout(() => setPreparando(false), 120);
      const anyV = v as any;
      // iPhone: el reproductor del sistema. El resto: pantalla completa del
      // documento, con giro a apaisado donde se pueda bloquear.
      if (typeof anyV.webkitEnterFullscreen === 'function') { try { anyV.webkitEnterFullscreen(); } catch { /* hace falta un gesto */ } return; }
      const req = v.requestFullscreen?.bind(v) || anyV.webkitRequestFullscreen?.bind(v);
      if (req) req().then(() => (screen.orientation as any)?.lock?.('landscape').catch(() => {})).catch(() => {});
    };

    const onError = () => {
      setPreparando(false);
      setFallo('No se ha podido abrir el vídeo. Puede que el archivo no esté listo todavía.');
    };
    // Red de seguridad: si el vídeo no arranca (archivo a medio convertir, un
    // codec que el telefono no abre) mas vale ver el reproductor y sus
    // controles que quedarse en una espera eterna.
    const rendicion = setTimeout(() => setPreparando(false), 20000);

    // Salir de la pantalla completa (boton Hecho, atras) cierra el reproductor.
    const onExitIos = () => { history.state?.player ? history.back() : close(); };
    const onFsChange = () => { if (entered && !document.fullscreenElement) onExitIos(); };
    const onPop = () => close();

    history.pushState({ player: true }, '');
    window.addEventListener('popstate', onPop);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    v.addEventListener('playing', goFull, { once: true });
    v.addEventListener('error', onError);
    v.addEventListener('webkitendfullscreen', onExitIos);
    document.addEventListener('fullscreenchange', onFsChange);

    return () => {
      window.removeEventListener('popstate', onPop);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('playing', goFull);
      v.removeEventListener('error', onError);
      clearTimeout(rendicion);
      v.removeEventListener('webkitendfullscreen', onExitIos);
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      (screen.orientation as any)?.unlock?.();
      // Si se cerro sin pasar por el historial (fin del video), se retira la entrada.
      if (history.state?.player) history.back();
      if (v.duration && v.currentTime > 0) setWatched({ path, title, subtitle, poster, backdrop, position: v.currentTime, duration: v.duration });
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[70] bg-black">
      <video ref={ref} src={src} controls autoPlay playsInline poster={backdrop}
        crossOrigin="use-credentials" x-webkit-airplay="allow"
        className="w-full h-full bg-black object-contain">
        {subs.map(sub => (
          <track key={sub.path} kind="subtitles" src={subtitleUrl(sub.path, ticket || undefined)}
            srcLang={sub.language} label={sub.label} />
        ))}
      </video>

      {airplay.activo && !preparando && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <span className="w-14 h-14 text-nf-red"><IAirplay /></span>
          <p className="mt-4 text-[17px] font-semibold leading-tight">{title}</p>
          <p className="mt-2 text-[14px] text-nf-text2">Reproduciendo en otra pantalla</p>
          <button onClick={airplay.elegir}
            className="mt-6 h-11 px-5 rounded-xl bg-white/15 text-[15px] font-semibold active:bg-white/25">
            Cambiar de dispositivo
          </button>
        </div>
      )}

      {(preparando || fallo) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          {backdrop && (
            <img src={backdrop} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/60" />
          <div className="relative">
            {fallo ? (
              <>
                <p className="text-[16px] font-semibold">{fallo}</p>
                <button onClick={onClose} className="mt-5 h-11 px-6 rounded-xl bg-white/15 text-[15px] font-semibold">
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <span className="block w-10 h-10 mx-auto rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
                <p className="mt-5 text-[17px] font-semibold leading-tight">{title}</p>
                {subtitle && <p className="mt-1 text-[14px] text-nf-text2">{subtitle}</p>}
                <p className="mt-3 text-[13px] text-nf-text3">Preparando el vídeo…</p>
                {airplay.disponible && (
                  <button onClick={airplay.elegir}
                    className="mt-6 inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white/15 text-[15px] font-semibold active:bg-white/25">
                    <span className="w-5 h-5"><IAirplay /></span>
                    Ver en otra pantalla
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
