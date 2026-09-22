import { Link } from 'react-router-dom';

interface Props { to: string; title: string; poster?: string; subtitle?: string; progress?: number; badge?: string; wide?: boolean }

/** Carátula 2:3 con el título debajo. En móvil el texto no va encima de la imagen: tapa y no se lee. */
export default function Poster({ to, title, poster, subtitle, progress, badge, wide }: Props) {
  return (
    <Link to={to} className={`block shrink-0 ${wide ? 'w-[160px]' : 'w-[112px]'} active:opacity-70`}>
      <div className="relative rounded-lg overflow-hidden bg-nf-card aspect-[2/3]">
        {poster ? <img src={poster} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          : <div className="absolute inset-0 p-2 flex items-end text-[12px] font-semibold leading-tight text-nf-text2">{title}</div>}
        {badge && <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-bold text-nf-warn">{badge}</span>}
        {progress !== undefined && progress > 0 && (
          <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/25"><div className="h-full bg-nf-red" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        )}
      </div>
      <p className="mt-1.5 text-[12px] font-medium leading-tight line-clamp-2">{title}</p>
      {subtitle && <p className="text-[11px] text-nf-text3 truncate">{subtitle}</p>}
    </Link>
  );
}
