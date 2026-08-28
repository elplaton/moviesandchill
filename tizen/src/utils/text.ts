export function cleanFileName(name: string): string {
  return name
    .replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|rar|zip|7z|tar\.gz|tar\.bz2|tar|tgz|tbz2)$/i, '')
    .replace(/\.part\d+/i, '')
    .replace(/\.r\d{2,}$/i, '')
    .replace(/\.\d{3,}$/, '')
    .replace(/\s+\d{1,2}x\d{2,}\b.*$/i, '')
    .replace(/\s+(1080p|720p|2160p|4k|zip|rar|7z)\s*$/i, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUALITY = /\b(1080p|720p|2160p|4k|4K|hdr|hdrip|bdrip|bluray|blu-ray|web-dl|webrip|brrip|dvdrip|hdtv|x264|x265|hevc|h265|aac|ddp|dts|truehd|atmos|h264|av1|multi|dual|castellano|spanish|latino|sub|7z|zip|rar|dv|dovi|dolby vision|hdr10|hdr10\+|remux|dubbed|ac3|eac3)\b/gi;

export function cleanTitle(name: string): string {
  let s = name;
  s = s.replace(/\.part\d+/i, '');
  s = s.replace(/\.r\d{2,}$/i, '');
  s = s.replace(/\.\d{3,}$/, '');
  for (const ext of ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.7z', '.zip', '.rar']) {
    if (s.toLowerCase().endsWith(ext)) { s = s.slice(0, -ext.length); break; }
  }
  s = s.replace(/\s+\d{1,2}x\d{2,}.*$/i, '');
  s = s.replace(/\s+[sS]\d{1,2}[eE]?\d{0,2}\b.*$/i, '');
  s = s.replace(/[\[\(].*?[\]\)]/g, '');
  s = s.replace(/\b(19|20)\d{2}\b/g, '');
  s = s.replace(/\s+[sS]\d{1,2}\s*$/i, '');
  s = s.replace(QUALITY, '');
  s = s.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  return s || name;
}

export function parseTitle(name: string): { seriesName: string; season: number; episode: number } | null {
  let m = name.match(/^(.+?)\s+(\d{1,2})x(\d{2})\b/i);
  if (m) {
    const s = cleanTitle(m[1].trim());
    return { seriesName: s, season: parseInt(m[2]), episode: parseInt(m[3]) };
  }
  m = name.match(/^(\d{1,2})x(\d{2})\s*[-–]\s*(.+)/i);
  if (m) {
    const s = cleanTitle(m[3].trim());
    return { seriesName: s, season: parseInt(m[1]), episode: parseInt(m[2]) };
  }
  return null;
}
