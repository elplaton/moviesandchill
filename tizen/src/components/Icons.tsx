/** Iconos de trazo, sin dependencias. Todos toman el color del texto. */
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24' };

export const IconSearch = () => (
  <svg {...base} className="w-full h-full"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const IconHome = () => (
  <svg {...base} className="w-full h-full"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></svg>
);
export const IconFilm = () => (
  <svg {...base} className="w-full h-full"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></svg>
);
export const IconTv = () => (
  <svg {...base} className="w-full h-full"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M8 21h8M12 18v3M8 3l4 3 4-3" /></svg>
);
export const IconDownload = () => (
  <svg {...base} className="w-full h-full"><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
);
export const IconGear = () => (
  <svg {...base} className="w-full h-full"><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
);
export const IconPlay = () => (
  <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor"><path d="M7 4.5v15l12-7.5z" /></svg>
);
export const IconPause = () => (
  <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor"><rect x="6" y="4" width="4.5" height="16" rx="1" /><rect x="13.5" y="4" width="4.5" height="16" rx="1" /></svg>
);
export const IconCheck = () => (
  <svg {...base} strokeWidth={3} className="w-full h-full"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconStar = () => (
  <svg viewBox="0 0 20 20" className="w-full h-full" fill="currentColor"><path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.07 3.29a1 1 0 00.95.69h3.46c.97 0 1.37 1.24.59 1.81l-2.8 2.03a1 1 0 00-.37 1.12l1.07 3.29c.3.92-.75 1.69-1.54 1.12l-2.8-2.03a1 1 0 00-1.18 0l-2.8 2.03c-.78.57-1.83-.2-1.53-1.12l1.07-3.29a1 1 0 00-.37-1.12L2.98 8.72c-.78-.57-.38-1.81.59-1.81h3.46a1 1 0 00.95-.69l1.07-3.29z" /></svg>
);
export const IconBack = () => (
  <svg {...base} className="w-full h-full"><path d="M15 5l-7 7 7 7" /></svg>
);
export const IconInfo = () => (
  <svg {...base} className="w-full h-full"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>
);
export const IconTrash = () => (
  <svg {...base} className="w-full h-full"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const IconLogout = () => (
  <svg {...base} className="w-full h-full"><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" /></svg>
);
