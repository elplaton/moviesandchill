import { IconInfo, IconPlay, IconStar } from './ui/Icon';
import Button from './ui/Button';
import type { BrowseItem } from '../types';

interface Props {
  item: BrowseItem;
  onOpen: () => void;
  /** Si hay algo de este título en disco, se ofrece verlo directamente. */
  onPlay?: () => void;
}

/**
 * Destacado de la portada.
 *
 * Ocupa la franja alta con el fondo del título, y es lo primero que se ve al
 * entrar. Antes esa franja la ocupaban un «Bienvenido, admin» y un buscador,
 * que no dicen nada del catálogo; el buscador ha pasado a la barra superior.
 */
export default function Hero({ item, onOpen, onPlay }: Props) {
  const bg = (item.backdrop || item.poster || '').replace('/w780/', '/w1280/');
  const meta = [
    item.year ? String(item.year) : '',
    item.genres?.slice(0, 3).join(' · ') || '',
    item.media_type === 'series' && item.episode_count ? `${item.episode_count} episodios` : '',
  ].filter(Boolean);

  return (
    <section className="relative mb-4 h-[min(64vh,620px)] min-h-[420px]">
      {bg && <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />}
      {/* Dos degradados: uno lateral para que el texto se lea y otro al pie
          para fundir con el primer carril sin un corte duro. */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #141414 0%, rgba(20,20,20,0.92) 30%, rgba(20,20,20,0.15) 70%, rgba(20,20,20,0.35) 100%)' }} />
      <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: 'linear-gradient(180deg, rgba(20,20,20,0), #141414)' }} />

      <div className="relative flex h-full max-w-[720px] flex-col justify-end px-gutter pb-14">
        <p className="mb-2 text-micro font-bold uppercase tracking-[0.18em] text-nf-red">
          {item.media_type === 'series' ? 'Serie' : 'Película'}
        </p>
        <h1 className="text-hero font-bold line-clamp-2">{item.title}</h1>

        <div className="mt-3 flex items-center gap-3 text-md text-nf-dim">
          {item.rating ? (
            <span className="inline-flex items-center gap-1.5 text-white">
              <span className="w-4 h-4 text-nf-warn"><IconStar /></span>{item.rating.toFixed(1)}
            </span>
          ) : null}
          {meta.map((m, i) => (
            <span key={i} className="inline-flex items-center gap-3">
              {(i > 0 || item.rating) && <span className="h-1 w-1 rounded-full bg-nf-faint" />}
              {m}
            </span>
          ))}
        </div>

        {item.overview && <p className="mt-4 max-w-[560px] text-md leading-relaxed text-nf-dim line-clamp-3">{item.overview}</p>}

        <div className="mt-7 flex items-center gap-3">
          {onPlay && <Button variant="light" size="lg" icon={<IconPlay />} onClick={onPlay}>Reproducir</Button>}
          <Button variant="ghost" size="lg" icon={<IconInfo />} onClick={onOpen}>Más información</Button>
        </div>
      </div>
    </section>
  );
}
