import { useEffect, useRef } from 'react';
import { getAccessToken } from '../services/api';
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
 */
export default function Player({ path, title, subtitle, poster, backdrop, onClose }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const src = `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAccessToken() || '')}`;

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
      const anyV = v as any;
      // iPhone: el reproductor del sistema. El resto: pantalla completa del
      // documento, con giro a apaisado donde se pueda bloquear.
      if (typeof anyV.webkitEnterFullscreen === 'function') { try { anyV.webkitEnterFullscreen(); } catch { /* hace falta un gesto */ } return; }
      const req = v.requestFullscreen?.bind(v) || anyV.webkitRequestFullscreen?.bind(v);
      if (req) req().then(() => (screen.orientation as any)?.lock?.('landscape').catch(() => {})).catch(() => {});
    };

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
    v.addEventListener('webkitendfullscreen', onExitIos);
    document.addEventListener('fullscreenchange', onFsChange);

    return () => {
      window.removeEventListener('popstate', onPop);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('playing', goFull);
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
        className="w-full h-full bg-black object-contain" />
    </div>
  );
}
