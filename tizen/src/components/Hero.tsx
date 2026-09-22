import { useEffect, useState } from 'react';
import { useFeatured } from '../tv/featured';
import { IconStar } from './Icons';
import type { Featured } from '../types';

/** Fondo mas grande para el panel: TMDB sirve el mismo archivo a w1280. */
export function bigBackdrop(url?: string): string | undefined {
  return url ? url.replace('/w780/', '/w1280/') : undefined;
}

interface Props {
  /** Se enseña cuando ninguna tarjeta ha tomado el foco todavia. */
  fallback?: Featured | null;
  heading?: string;
}

/**
 * Panel de informacion de la portada. Ocupa la franja superior y describe la
 * tarjeta enfocada: fondo, titulo, año, nota, generos y sinopsis. Las
 * tarjetas no llevan texto, asi que este es el unico sitio donde se lee.
 */
export default function Hero({ fallback, heading }: Props) {
  const featured = useFeatured() || fallback || null;
  // Dos capas de fondo para poder cruzarlas con opacidad (unica propiedad
  // animable barata). Solo se cambia la capa oculta.
  const [layers, setLayers] = useState<[string | undefined, string | undefined]>([undefined, undefined]);
  const [front, setFront] = useState(0);

  const url = bigBackdrop(featured?.backdrop) || featured?.poster;
  useEffect(() => {
    if (!url) return;
    if (layers[front] === url) return;
    const back = front === 0 ? 1 : 0;
    const img = new Image();
    img.onload = () => {
      setLayers((prev) => { const n: [string | undefined, string | undefined] = [prev[0], prev[1]]; n[back] = url; return n; });
      setFront(back);
    };
    img.src = url;
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta: string[] = [];
  if (featured?.year) meta.push(String(featured.year));
  if (featured?.genres?.length) meta.push(featured.genres.slice(0, 3).join(' · '));
  if (featured?.subtitle) meta.push(featured.subtitle);

  return (
    // Va por encima de los carriles y es opaco: las filas que suben se ocultan
    // tras el, como en cualquier portada de television.
    <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none overflow-hidden bg-tv-bg" style={{ height: 'var(--hero-h)' }}>
      {/* fondo a la derecha, fundido hacia el contenido */}
      <div className="absolute top-0 right-0 w-[1180px] overflow-hidden" style={{ height: 'var(--hero-h)' }}>
        {[0, 1].map((i) => (
          <div key={i} className="tv-backdrop absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: layers[i] ? `url(${layers[i]})` : undefined, opacity: front === i && layers[i] ? 1 : 0 }} />
        ))}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #141414 0%, rgba(20,20,20,0.85) 22%, rgba(20,20,20,0) 60%)' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,20,20,0) 40%, #141414 96%)' }} />
      </div>

      <div className="absolute left-0 top-[92px] w-[960px]" style={{ paddingLeft: 'var(--content-x)' }}>
        {heading && !featured && (
          <h1 className="text-hero font-bold tracking-tight">{heading}</h1>
        )}
        {featured && (
          <>
            <h1 className="text-hero font-bold tracking-tight line-clamp-2 drop-shadow-lg">{featured.title}</h1>
            <div className="mt-4 flex items-center gap-4 text-lead text-tv-text2">
              {featured.rating ? (
                <span className="inline-flex items-center gap-2 text-white">
                  <span className="w-6 h-6 text-tv-warn"><IconStar /></span>{featured.rating.toFixed(1)}
                </span>
              ) : null}
              {meta.map((m, i) => (
                <span key={i} className="inline-flex items-center gap-4">
                  {(i > 0 || featured.rating) ? <span className="w-[6px] h-[6px] rounded-full bg-tv-text3" /> : null}
                  {m}
                </span>
              ))}
            </div>
            {featured.overview && (
              <p className="mt-5 text-body text-tv-text2 leading-relaxed line-clamp-3 max-w-[820px]">{featured.overview}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
