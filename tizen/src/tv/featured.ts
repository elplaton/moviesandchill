/**
 * Titulo "destacado": el que tiene el foco ahora mismo en un carril.
 *
 * El panel de arriba de la portada muestra los datos de la tarjeta enfocada.
 * Las tarjetas avisan al enfocarse y el panel se suscribe; va con un pequeño
 * retardo para no cargar un fondo por cada paso cuando se recorre un carril
 * con la flecha pulsada.
 */
import { useEffect, useState } from 'react';
import type { Featured } from '../types';

let current: Featured | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(f: Featured | null) => void>();

const DELAY_MS = 140;

export function setFeatured(item: Featured | null) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (current === item) return;
    current = item;
    listeners.forEach((fn) => fn(item));
  }, DELAY_MS);
}

export function useFeatured(): Featured | null {
  const [f, setF] = useState<Featured | null>(current);
  useEffect(() => {
    listeners.add(setF);
    return () => { listeners.delete(setF); };
  }, []);
  return f;
}
