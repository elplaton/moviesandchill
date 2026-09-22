import { useEffect, useState } from 'react';
export interface ToastMsg { id: number; text: string; kind: 'info' | 'ok' | 'error' }
let seq = 0; let items: ToastMsg[] = []; const subs = new Set<(t: ToastMsg[]) => void>();
const emit = () => subs.forEach(f => f(items));
export function toast(text: string, kind: ToastMsg['kind'] = 'info', ms = 3000) {
  const id = ++seq; items = [...items, { id, text, kind }].slice(-3); emit();
  setTimeout(() => { items = items.filter(t => t.id !== id); emit(); }, ms);
}
export function useToasts() { const [l, setL] = useState(items); useEffect(() => { subs.add(setL); return () => { subs.delete(setL); }; }, []); return l; }
