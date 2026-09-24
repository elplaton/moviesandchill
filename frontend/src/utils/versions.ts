import { MULTIPART, RES_TAGS } from './regex';
import { cleanFileName } from './text';
import type { SearchResult } from '../types';

/** Un archivo descargable (o un comprimido en varias partes) de un titulo. */
export interface Version {
  key: string;
  fileName: string;       // nombre del primer archivo
  baseName: string;       // sin sufijo de parte ni extension
  quality: string;        // "1080p · HEVC" o "HD"
  sizeBytes: number;
  sizeStr: string;
  parts: number;
  messageId: number;
  channelId?: number;
  channelName: string;
  /** El backend ya sabe si la carpeta existe en disco. */
  downloaded: boolean;
  season?: number;
  episode?: number;
  /** Ruta en disco cuando viene de la biblioteca. */
  path?: string;
  /** Lo que dice el servidor: ruta final si esta descargado, y su dueño. */
  localPath?: string | null;
  owner?: string | null;
  canDelete?: boolean;
}

export interface Episode {
  season: number | null;
  episode: number;
  variants: Version[];
}

export function extractQuality(name: string): string {
  const found: string[] = [];
  const re = new RegExp(RES_TAGS.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(name)) !== null) {
    const t = m[1].toUpperCase();
    if (!found.includes(t)) found.push(t);
  }
  return found.slice(0, 2).join(' · ') || 'HD';
}

function fmtBytes(n: number): string {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

/** Agrupa las partes de un mismo comprimido en una version. */
export function groupVersions(files: SearchResult[]): Version[] {
  const map = new Map<string, SearchResult[]>();
  const order: string[] = [];
  for (const r of files) {
    const m = r.file_name.match(MULTIPART);
    const key = m ? `${r.channel_id}:${m[1].replace(/\.$/, '').trim().toLowerCase()}` : `${r.channel_id}:${r.id}`;
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key)!.push(r);
  }
  return order.map((key) => {
    const parts = map.get(key)!;
    parts.sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true }));
    const first = parts[0];
    const total = parts.reduce((s, p) => s + (p.size || 0), 0);
    return {
      key,
      fileName: first.file_name,
      baseName: cleanFileName(first.file_name),
      quality: extractQuality(first.file_name),
      sizeBytes: total,
      sizeStr: fmtBytes(total) || first.size_str,
      parts: parts.length,
      messageId: first.id,
      channelId: first.channel_id,
      channelName: first.channel_name,
      downloaded: !!first.downloaded,
      season: first.season ?? undefined,
      episode: first.episode ?? undefined,
      localPath: first.local_path, owner: first.owner, canDelete: first.can_delete,
    };
  });
}

/** Una entrada por episodio con sus variantes; las sin numero van al final. */
export function groupEpisodes(versions: Version[]): Episode[] {
  const map = new Map<string, Episode>();
  for (const v of versions) {
    if (v.episode === undefined) continue;
    const s = v.season ?? null;
    const k = `${s}:${v.episode}`;
    if (!map.has(k)) map.set(k, { season: s, episode: v.episode, variants: [] });
    map.get(k)!.variants.push(v);
  }
  const eps = [...map.values()];
  eps.sort((a, b) => (a.season ?? 999) - (b.season ?? 999) || a.episode - b.episode);
  for (const e of eps) e.variants.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return eps;
}

export function seasonLabel(s: number | null): string {
  if (s === null) return 'Episodios';
  if (s === 0) return 'Especiales';
  return `Temporada ${s}`;
}

export function episodeLabel(e: Episode): string {
  return e.season === null ? `${e.episode}` : `${e.season}x${String(e.episode).padStart(2, '0')}`;
}
