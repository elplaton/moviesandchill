import { memo, useState } from 'react';
import Rail from './Rail';
import Button from './ui/Button';
import { IconInfo } from './ui/Icon';
import { pedir } from '../services/peticiones';
import { fondoDeTitulo } from '../utils/text';
import type { BrowseItem, BrowseTop } from '../types';

/** De dónde salen los datos: no es lo mismo la lista oficial de Netflix que
 *  lo que se mueve en TMDB, y la fila tiene que decirlo. */
const FUENTE: Record<BrowseTop['fuente'], string> = {
  netflix: 'Datos oficiales de Netflix para España (semanales)',
  tmdb: 'Según las tendencias de la semana en TMDB',
};

interface Props {
  title: string;
  top: BrowseTop;
  items: BrowseItem[];
  onOpen: (item: BrowseItem) => void;
  scrollX?: number;
  onScrollX?: (x: number) => void;
}

/**
 * Fila de top, como la «Top 10» de Netflix: el puesto en grande a la
 * izquierda y la carátula montada encima.
 *
 * Un top trae también lo que no tenemos (es la lista de lo que se ve en
 * España, no de nuestro catálogo), así que esas tarjetas no abren ficha —no
 * hay archivos que enseñar— y en su lugar ofrecen pedirlo. No pagina: el
 * servidor manda la lista entera.
 */
export default function TopRail({ title, top, items, onOpen, scrollX, onScrollX }: Props) {
  return (
    <Rail title={title} subtitle={FUENTE[top.fuente]} scrollX={scrollX} onScrollX={onScrollX}>
      {items.map((item, i) => (
        <TopCard key={`${item.puesto ?? i}-${item.id}`} item={item} puesto={item.puesto ?? i + 1} onOpen={onOpen} />
      ))}
    </Rail>
  );
}

const TopCard = memo(function TopCard({ item, puesto, onOpen }: {
  item: BrowseItem; puesto: number; onOpen: (item: BrowseItem) => void;
}) {
  const tenemos = item.en_catalogo !== false;
  const [broken, setBroken] = useState(false);
  // Sin ratón no hay hover: pulsar la carátula de algo que no tenemos saca
  // el botón de pedir, en vez de abrir una ficha vacía.
  const [abierto, setAbierto] = useState(false);
  // Lo pedido desde aquí se recuerda sin recargar la fila: el servidor no
  // vuelve a mandarla hasta la próxima visita.
  const [pedidaPorMi, setPedidaPorMi] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const p = item.peticion;
  const mia = pedidaPorMi || (p?.estado === 'enviada' && p.mia);
  const deOtro = !mia && p?.estado === 'enviada' && !p.mia;

  const enviar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const { ya_pedida } = await pedir(item);
      setPedidaPorMi(true);
      setAviso(ya_pedida ? 'Ya estaba pedida: te avisaremos también a ti' : 'Te avisaremos cuando esté');
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se ha podido pedir');
    } finally {
      setOcupado(false);
    }
  };

  const meta = [item.subtitulo, item.year].filter(Boolean).join(' · ');
  // Dos cifras ocupan el doble: sin más sitio, el 10 quedaría tapado entero.
  const hueco = puesto >= 10 ? 150 : 72;

  return (
    <div className="relative flex shrink-0" style={{ width: `calc(var(--card-w) + ${hueco}px)` }}>
      {/* El número va detrás de la carátula y del color del fondo con solo el
          contorno: así se lee grande sin competir con el cartel. */}
      <span aria-hidden
        className="pointer-events-none absolute left-0 top-0 flex select-none items-end font-black"
        style={{
          height: 'calc(var(--card-w) * 1.5)',
          fontSize: 'calc(var(--card-w) * 1.05)',
          lineHeight: 0.78,
          letterSpacing: '-0.07em',
          color: '#141414',
          WebkitTextStroke: '3px rgba(255,255,255,0.55)',
        }}>
        {puesto}
      </span>

      <div className="card relative ml-auto" style={{ width: 'var(--card-w)' }}
        onMouseLeave={() => setAbierto(false)}>
        <button
          onClick={() => (tenemos ? onOpen(item) : setAbierto(true))}
          aria-label={tenemos ? `${puesto}. ${item.title}` : `${puesto}. ${item.title}: no la tenemos`}
          className="card-media relative block w-full aspect-[2/3] rounded-card overflow-hidden bg-nf-surface shadow-card text-left"
        >
          {item.poster && !broken ? (
            <img src={item.poster} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}
              className={`absolute inset-0 h-full w-full object-cover ${tenemos ? '' : 'opacity-50 grayscale-[35%]'}`} />
          ) : (
            <span className={`absolute inset-0 flex items-end p-3 text-sm font-semibold text-white/90 line-clamp-4 ${tenemos ? '' : 'opacity-60'}`}
              style={{ background: fondoDeTitulo(item.title) }}>
              {item.title}
            </span>
          )}
          {!tenemos && (
            <span className="absolute top-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-micro font-semibold text-white">
              No la tenemos
            </span>
          )}
        </button>

        <div className={`card-info absolute inset-x-0 top-0 aspect-[2/3] flex flex-col items-center justify-center gap-2 rounded-card bg-black/55 ${abierto ? 'card-info-on' : ''}`}>
          {tenemos ? (
            <Button variant="light" size="sm" icon={<IconInfo />} onClick={() => onOpen(item)}>
              {item.media_type === 'series' ? 'Ver episodios' : 'Ver detalles'}
            </Button>
          ) : (
            <Button variant={mia ? 'ghost' : 'light'} size="sm" disabled={mia || ocupado} onClick={enviar}>
              {mia ? 'Pedida' : ocupado ? 'Pidiendo…' : deOtro ? 'Avisarme' : 'Pedir'}
            </Button>
          )}
        </div>

        <p className="mt-2 text-base font-medium leading-snug line-clamp-2">{item.title}</p>
        {meta && <p className="text-xs text-nf-faint truncate">{meta}</p>}
        {aviso && <p className="mt-0.5 text-xs text-nf-dim">{aviso}</p>}
      </div>
    </div>
  );
});
