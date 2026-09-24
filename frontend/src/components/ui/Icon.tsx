/** Iconos de trazo, sin dependencias. Heredan el color y el tamaño del padre. */
const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24', className: 'w-full h-full' };

export const IconPlay = () => <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor"><path d="M7 4.5v15l12-7.5z" /></svg>;
export const IconPause = () => <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor"><rect x="6" y="4" width="4.5" height="16" rx="1" /><rect x="13.5" y="4" width="4.5" height="16" rx="1" /></svg>;
export const IconDownload = () => <svg {...s}><path d="M12 4v11M7 10l5 5 5-5M4 19h16" /></svg>;
export const IconSearch = () => <svg {...s}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
export const IconClose = () => <svg {...s}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IconChevronL = () => <svg {...s} strokeWidth={2.5}><path d="M15 5l-7 7 7 7" /></svg>;
export const IconChevronR = () => <svg {...s} strokeWidth={2.5}><path d="M9 5l7 7-7 7" /></svg>;
export const IconChevronD = () => <svg {...s}><path d="M6 9l6 6 6-6" /></svg>;
export const IconStar = () => <svg viewBox="0 0 20 20" className="w-full h-full" fill="currentColor"><path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.07 3.29a1 1 0 00.95.69h3.46c.97 0 1.37 1.24.59 1.81l-2.8 2.03a1 1 0 00-.37 1.12l1.07 3.29c.3.92-.75 1.69-1.54 1.12l-2.8-2.03a1 1 0 00-1.18 0l-2.8 2.03c-.78.57-1.83-.2-1.53-1.12l1.07-3.29a1 1 0 00-.37-1.12L2.98 8.72c-.78-.57-.38-1.81.59-1.81h3.46a1 1 0 00.95-.69l1.07-3.29z" /></svg>;
export const IconInfo = () => <svg {...s}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.4" /></svg>;
export const IconTrash = () => <svg {...s}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
export const IconCheck = () => <svg {...s} strokeWidth={2.6}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const IconVolume = () => <svg {...s}><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7" /></svg>;
export const IconMute = () => <svg {...s}><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M16 9l5 6M21 9l-5 6" /></svg>;
export const IconExpand = () => <svg {...s}><path d="M8 3H3v5M16 3h5v5M16 21h5v-5M8 21H3v-5" /></svg>;
export const IconUser = () => <svg {...s}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>;
export const IconShield = () => <svg {...s}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>;
export const IconLogout = () => <svg {...s}><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" /></svg>;
