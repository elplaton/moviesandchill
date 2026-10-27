import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Row from './Row';
import { IClose } from './Icons';
import type { Carril } from '../hooks/useCarriles';
import type { BrowseItem } from '../types';
import { estaPedida, pedir, textoAlPedir, TIPO_PETICION } from '../services/peticiones';
import { fondoDeTitulo } from '../utils/text';
import { toast } from '../utils/toast';

interface Props {
  carril: Carril;
  scrollX?: number;
  onScrollX?: (x: number) => void;
  /** Tras pedir uno: el motor de carriles lo apunta para que diga «Pedida»
   *  sin volver a pedir la portada. */
  onPedida: (tmdbId: number, mediaType: string) => void;
}

/** De donde sale el top, dicho debajo del titulo: no es lo mismo lo que dice
 *  Netflix de si mismo que lo que se mueve en TMDB. */
const FUENTE = {
  netflix: 'Datos oficiales de Netflix para España (semanales)',
  tmdb: 'Según las tendencias de la semana en TMDB',
} as const;

/** «Temporada 4» manda sobre el año: en un top de series lo que se esta
 *  viendo es esa temporada, y el año seria el del estreno de la serie. */
const meta = (i: BrowseItem) => i.subtitulo || (i.year ? String(i.year) : undefined);

/** Que dice el boton de pedir. Una pedida que fallo se puede volver a pedir, y
 *  una que pidio otro tambien: es el mismo POST, el servidor la suma. En la
 *  cola o ya mandada da igual: las dos estan pedidas. */
function estadoPedir(i: BrowseItem) {
  const p = i.peticion;
  const mia = estaPedida(p?.estado) && !!p?.mia;
  const deOtro = estaPedida(p?.estado) && !p?.mia;
  return { mia, texto: mia ? 'Pedida' : deOtro ? 'Avisarme' : 'Pedir' };
}

/**
 * El puesto, grande y hueco, a la izquierda de la caratula, que lo tapa en
 * parte. Las de dos cifras se estrechan en vez de achicarse: asi el 10 mide lo
 * mismo de alto que el 9 y la fila no da un salto.
 */
function Puesto({ n }: { n: number }) {
  const dos = n >= 10;
  return (
    <div className="relative shrink-0 h-[168px]" style={{ width: dos ? 112 : 64 }} aria-hidden>
      <span className="puesto-top absolute bottom-0 select-none"
        style={{ right: -22, transform: dos ? 'scaleX(0.82)' : undefined, transformOrigin: 'right bottom' }}>{n}</span>
    </div>
  );
}

function Caratula({ i, apagada, etiqueta }: { i: BrowseItem; apagada?: boolean; etiqueta?: string }) {
  return (
    <div className="relative rounded-lg overflow-hidden bg-nf-card aspect-[2/3]">
      {i.poster ? <img src={i.poster} alt="" loading="lazy"
                    className={`absolute inset-0 w-full h-full object-cover ${apagada ? 'opacity-40 grayscale-[60%]' : ''}`} />
        : <div className={`absolute inset-0 p-2 flex items-end text-[12px] font-semibold leading-tight text-white/90 ${apagada ? 'opacity-50' : ''}`}
               style={{ background: fondoDeTitulo(i.title) }}>{i.title}</div>}
      {etiqueta && <span className="absolute left-1.5 right-1.5 bottom-1.5 py-1 rounded bg-black/80 text-center text-[10px] font-bold">{etiqueta}</span>}
    </div>
  );
}

/**
 * Hoja inferior para lo que no tenemos: que es y el boton de pedirlo.
 *
 * Por portal en el <body>, como el reproductor: dentro de `.app-main` un
 * `position: fixed` no queda por encima de la barra de pestañas en iOS (ver
 * `.player-shell` en index.css).
 */
function HojaPedir({ i, onCerrar, onPedida }: { i: BrowseItem; onCerrar: () => void; onPedida: Props['onPedida'] }) {
  const [enviando, setEnviando] = useState(false);
  const { mia, texto } = estadoPedir(i);

  const accion = async () => {
    setEnviando(true);
    try {
      const d = await pedir(i.tmdb_id, i.media_type);
      onPedida(i.tmdb_id, i.media_type);
      toast(await textoAlPedir(d), 'ok', 5000);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se ha podido pedir', 'error', 6000);
    } finally { setEnviando(false); }
  };

  const linea = [TIPO_PETICION[i.media_type], i.subtitulo, i.year].filter(Boolean).join(' · ');
  return createPortal(
    <div className="hoja-shell">
      <button aria-label="Cerrar" onClick={onCerrar} className="absolute inset-0 bg-black/60" />
      <div role="dialog" aria-label={i.title}
        className="subir relative rounded-t-2xl bg-nf-raised px-4 pt-4"
        style={{ paddingBottom: 'calc(var(--safe-b) + 16px)' }}>
        <button onClick={onCerrar} aria-label="Cerrar"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
          <span className="w-4 h-4"><IClose /></span>
        </button>
        <div className="flex gap-3 pr-10">
          <div className="w-[88px] shrink-0"><Caratula i={i} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold leading-tight line-clamp-2">{i.title}</p>
            <p className="mt-1 text-[12px] text-nf-text3">{linea}</p>
            <p className="mt-2 text-[12px] text-nf-text2">Todavía no la tenemos. Si la pides, te avisamos cuando llegue.</p>
          </div>
        </div>
        {i.overview && <p className="mt-3 text-[13px] leading-snug text-nf-text2 line-clamp-5">{i.overview}</p>}
        <button onClick={accion} disabled={enviando || mia}
          className={`mt-4 w-full h-12 rounded-xl text-[15px] font-semibold disabled:opacity-60 ${mia ? 'bg-white/10 text-nf-text2' : 'bg-white text-black'}`}>
          {enviando ? 'Pidiendo…' : texto}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Una fila de top: el puesto grande junto a cada caratula, como el Top 10 de
 * Netflix en el movil. Trae tambien lo que no tenemos (es lo que se esta
 * viendo en España, no lo que hay aqui): eso no lleva a una ficha que no
 * existe, sale atenuado y al tocarlo se ofrece pedirlo.
 */
export default function TopRow({ carril, scrollX, onScrollX, onPedida }: Props) {
  // Se guarda el id y no la tarjeta: al pedir, la tarjeta del carril cambia
  // (pasa a «Pedida») y la hoja tiene que enseñar la nueva, no una copia.
  const [abierta, setAbierta] = useState<string | null>(null);
  const elegida = abierta ? carril.items.find(i => i.id === abierta) : undefined;
  const titulo = carril.titulo ?? carril.genre;

  return (
    <>
      <Row title={titulo} subtitle={carril.top ? FUENTE[carril.top.fuente] : undefined}
        scrollX={scrollX} onScrollX={onScrollX}>
        {carril.items.map((i, n) => {
          const puesto = i.puesto ?? n + 1;
          const tarjeta = (cuerpo: ReactNode) => (
            <div key={`${carril.genre}-${i.id}`} className="shrink-0 flex items-start">
              <Puesto n={puesto} />
              <div className="relative z-10 w-[112px]">{cuerpo}</div>
            </div>
          );
          const pie = (
            <>
              <p className="mt-1.5 text-[12px] font-medium leading-tight line-clamp-2">{i.title}</p>
              {meta(i) && <p className="text-[11px] text-nf-text3 truncate">{meta(i)}</p>}
            </>
          );
          // Sin `en_catalogo` (una fila antigua) se da por tenido, que es lo
          // que han sido siempre las tarjetas de la portada.
          if (i.en_catalogo !== false) {
            return tarjeta(
              <Link to={`/t/${i.media_type}/${i.tmdb_id}`} className="block active:opacity-70">
                <Caratula i={i} />{pie}
              </Link>,
            );
          }
          // Un puesto que TMDB no conoce: solo el nombre, sin ficha ni pedir.
          if (i.sin_ficha) {
            return tarjeta(<div><Caratula i={i} apagada etiqueta="Sin ficha" />{pie}</div>);
          }
          return tarjeta(
            <button onClick={() => setAbierta(i.id)} className="block w-full text-left active:opacity-70"
              aria-label={`${i.title}: no la tenemos, pedirla`}>
              <Caratula i={i} apagada etiqueta={estadoPedir(i).mia ? 'Pedida' : 'No la tenemos'} />{pie}
            </button>,
          );
        })}
      </Row>
      {elegida && <HojaPedir i={elegida} onCerrar={() => setAbierta(null)} onPedida={onPedida} />}
    </>
  );
}
