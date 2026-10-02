import { useEffect, useState, type RefObject } from 'react';

/**
 * El `<video>` de WebKit con lo que hace falta para AirPlay. No está en los
 * tipos estándar porque es una extensión de Apple.
 */
interface VideoWebKit extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
}

interface Airplay {
  /** Hay algún dispositivo al alcance (Apple TV, altavoz, otro Mac). */
  disponible: boolean;
  /** Ahora mismo se está reproduciendo fuera, no en esta pantalla. */
  activo: boolean;
  /** Abre el selector del sistema. */
  elegir: () => void;
}

/**
 * AirPlay para el reproductor propio.
 *
 * Solo existe en Safari (macOS, iOS, iPadOS); en cualquier otro navegador el
 * botón no debe salir, y por eso `disponible` arranca en falso y solo se
 * enciende cuando WebKit avisa de que hay algo al alcance. No vale con
 * mirar el `user agent`: aunque el navegador sea Safari, sin ningún Apple TV
 * en la red el selector saldría vacío.
 *
 * En el móvil el reproductor es el del sistema y ya trae su propio botón; esto
 * es para las pantallas donde los controles son nuestros.
 */
export function useAirplay(ref: RefObject<HTMLVideoElement | null>): Airplay {
  const [disponible, setDisponible] = useState(false);
  const [activo, setActivo] = useState(false);

  useEffect(() => {
    const v = ref.current as VideoWebKit | null;
    if (!v || typeof v.webkitShowPlaybackTargetPicker !== 'function') return;

    // WebKit avisa cuando aparece o desaparece algo en la red, y el evento
    // llega tambien al suscribirse, asi que no hay que sondear nada.
    const onDisponibilidad = (e: Event) => {
      const { availability } = e as Event & { availability?: string };
      setDisponible(availability === 'available');
    };
    const onCambio = () => setActivo(!!v.webkitCurrentPlaybackTargetIsWireless);

    v.addEventListener('webkitplaybacktargetavailabilitychanged', onDisponibilidad);
    v.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onCambio);
    onCambio();

    return () => {
      v.removeEventListener('webkitplaybacktargetavailabilitychanged', onDisponibilidad);
      v.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onCambio);
    };
  }, [ref]);

  const elegir = () => {
    const v = ref.current as VideoWebKit | null;
    try {
      v?.webkitShowPlaybackTargetPicker?.();
    } catch {
      /* el selector lo cancela el sistema, no es cosa nuestra */
    }
  };

  return { disponible, activo, elegir };
}
