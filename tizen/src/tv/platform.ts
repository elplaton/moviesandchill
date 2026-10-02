/**
 * En que aparato se esta ejecutando la app.
 *
 * Habia tres deteccciones sueltas por el codigo (`/Tizen/` en main.tsx,
 * `window.tizen` y `window.AndroidTV` en keys.ts) y cada vez que se añadia un
 * aparato habia que acordarse de todas. Aqui estan juntas.
 *
 * La PlayStation es el unico de la lista que **no tiene teclas**: el mando
 * mueve un cursor y X hace clic, y el navegador de la consola no expone la
 * Gamepad API, asi que ni las flechas ni Atras llegan como `keydown`. Todo lo
 * que en una tele se hace con el mando tiene que poder hacerse ahi con el
 * puntero, y eso es lo que pregunta `soloPuntero()`.
 */
export type Plataforma = 'tizen' | 'webos' | 'firetv' | 'playstation' | 'web';

interface VentanaTV {
  tizen?: unknown;
  AndroidTV?: { exit?: () => void };
}

/**
 * Funcion pura para poder probarla: el user agent y los puentes nativos
 * entran por parametro. `test/platform.test.mjs` la ejecuta con los agentes
 * de verdad de cada aparato.
 */
export function detectarPlataforma(ua: string, ventana: VentanaTV = {}): Plataforma {
  if (ventana.tizen || /Tizen/i.test(ua)) return 'tizen';
  if (/Web0S|webOS/i.test(ua)) return 'webos';
  // Los Fire TV Stick se identifican con el modelo (AFTT, AFTMM, AFTKA...).
  if (ventana.AndroidTV || /\bAFT[A-Z]{1,3}\b/.test(ua)) return 'firetv';
  // El navegador de la PS4 dice "PlayStation 4"; el escondido de la PS5,
  // "PlayStation 5". Para la app son lo mismo: puntero y nada mas.
  if (/PlayStation [45]/i.test(ua)) return 'playstation';
  return 'web';
}

let cache: Plataforma | null = null;

export function plataforma(): Plataforma {
  if (cache === null) {
    cache = detectarPlataforma(
      typeof navigator === 'undefined' ? '' : navigator.userAgent,
      (typeof window === 'undefined' ? {} : window) as unknown as VentanaTV,
    );
  }
  return cache;
}

/** Hay cursor en pantalla: todo menos Tizen, cuyo mando no lo tiene. */
export function tienePuntero(): boolean {
  return plataforma() !== 'tizen';
}

/**
 * No hay teclas utiles: el puntero es la unica forma de manejar la app, asi
 * que hay que dibujar en pantalla lo que en una tele se pulsa en el mando
 * (volver, pausa, saltos).
 */
export function soloPuntero(): boolean {
  return plataforma() === 'playstation';
}

/**
 * La app puede cerrarse sola.
 *
 * En una tele o en el Fire TV hay un anfitrion al que pedirselo; en el
 * navegador de la consola no hay nada que cerrar (`window.close()` no hace
 * nada) y el boton "Salir de la app" solo serviria para no hacer nada.
 */
export function puedeCerrarse(): boolean {
  const p = plataforma();
  return p === 'tizen' || p === 'webos' || p === 'firetv';
}
