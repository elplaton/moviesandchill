// Marca dist/sw.js con la fecha del build: un service worker distinto por
// version es lo que hace que la PWA se actualice sola.
import { readFileSync, writeFileSync } from 'node:fs';
const p = new URL('../dist/sw.js', import.meta.url);
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
writeFileSync(p, readFileSync(p, 'utf8').replace('__BUILD__', stamp));
console.log('sw.js version', stamp);
