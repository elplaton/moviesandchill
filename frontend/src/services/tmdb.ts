import { apiFetch } from './api';
import type { TMDBMetadata } from '../types';

const cache = new Map<string, TMDBMetadata>();

export async function fetchMetadataBatch(names: string[]): Promise<Map<string, TMDBMetadata>> {
  const unique = [...new Set(names.filter(n => n && n.length > 1))];
  const uncached = unique.filter(n => !cache.has(n));

  if (uncached.length > 0) {
    try {
      const res = await apiFetch('/metadata/batch', {
        method: 'POST',
        body: JSON.stringify({ names: uncached }),
      });
      const data = await res.json();
      const meta = data.metadata || {};
      for (const [key, info] of Object.entries(meta)) {
        cache.set(key, info as TMDBMetadata);
      }
    } catch {}
    for (const n of uncached) {
      if (!cache.has(n)) cache.set(n, { title: n });
    }
  }

  return cache;
}
