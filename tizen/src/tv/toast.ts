/** Avisos breves arriba a la derecha. No son enfocables: solo informan. */
import { useEffect, useState } from 'react';

export interface ToastMsg { id: number; text: string; kind: 'info' | 'ok' | 'error' }

let seq = 0;
let items: ToastMsg[] = [];
const listeners = new Set<(t: ToastMsg[]) => void>();

function emit() { listeners.forEach((fn) => fn(items)); }

export function toast(text: string, kind: ToastMsg['kind'] = 'info', ms = 3200) {
  const id = ++seq;
  items = [...items, { id, text, kind }].slice(-3);
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, ms);
}

export function useToasts(): ToastMsg[] {
  const [list, setList] = useState(items);
  useEffect(() => {
    listeners.add(setList);
    return () => { listeners.delete(setList); };
  }, []);
  return list;
}
