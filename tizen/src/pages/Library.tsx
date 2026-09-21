import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import MovieCard from '../components/MovieCard';
import MovieRow from '../components/MovieRow';
import PlayDetail from '../components/PlayDetail';
import { FocusScope } from '../focus/react';
import { apiFetch, streamUrl } from '../services/api';
import { cleanTitle } from '../utils/text';
import type { TMDBMetadata } from '../types';

interface Descargado {
  nombre: string;
  ruta: string;
  tamano: string;
  /** Titulo de la fila a la que pertenece. */
  serie?: string;
  /**
   * Clave para pedir la caratula. Es el clean_name del backend, que ya viene
   * normalizado igual que lo que usa TMDB. Antes se usaba el titulo de la fila,
   * que pasa por el cleanTitle del frontend sobre el nombre crudo y da una
   * cadena distinta: se pedia una clave y se buscaba otra.
   */
  clave: string;
}

/**
 * Prefijo de tres palabras. El nombre limpio de un episodio arrastra su titulo
 * ("Sabrina, The Teenage Witch Soul Mates") y con eso TMDB no encuentra nada;
 * con el prefijo si. Es la misma heuristica que usa el backend al enriquecer.
 */
function prefijo(nombre: string): string {
  return nombre.split(/\s+/).slice(0, 3).join(' ');
}

/** Agrupa por serie cuando el nombre trae SxxEyy o NxM, para no listar 200 episodios sueltos. */
function serieDe(nombre: string): string | undefined {
  const limpio = cleanTitle(nombre);
  if (/(\d{1,2})x(\d{2})|[sS]\d{2}[eE]\d{2}/.test(nombre)) return limpio || nombre;
  return undefined;
}

export default function Library() {
  const [items, setItems] = useState<Descargado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [reproduciendo, setReproduciendo] = useState<Descargado | null>(null);
  const [caratulas, setCaratulas] = useState<Map<string, TMDBMetadata>>(new Map());

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/files');
        const data = await res.json();
        const lista: Descargado[] = [];
        const anadir = (e: any, carpeta?: string) => {
          if (!e?.name || !e?.path || e.is_dir) return;
          lista.push({
            nombre: e.clean_name || e.name,
            ruta: e.path,
            tamano: e.size || '',
            serie: serieDe(e.name) || (carpeta ? cleanTitle(carpeta) : undefined),
            clave: e.clean_name || cleanTitle(e.name),
          });
        };
        for (const f of data.files || []) {
          if (f.episodes?.length) {
            for (const ep of f.episodes) anadir(ep, f.clean_name || f.name);
          } else {
            anadir(f);
          }
        }
        setItems(lista);

        // /api/files solo sabe de ficheros en disco, no de TMDB. Las caratulas
        // se piden aparte con los titulos limpios; sin esto las tarjetas
        // salian con el degradado de respaldo en vez de la portada.
        // Se piden dos variantes por titulo: el nombre limpio completo y su
        // prefijo de tres palabras. El completo suele arrastrar el titulo del
        // episodio ("... Soul Mates") y TMDB no encuentra nada; el prefijo si.
        const nombres = [...new Set(lista.flatMap(i => (
          i.clave ? [i.clave, prefijo(i.clave)] : []
        )).filter(Boolean))];
        if (nombres.length) {
          try {
            const r = await apiFetch('/metadata/batch', {
              method: 'POST', body: JSON.stringify({ names: nombres }),
            });
            const meta = (await r.json()).metadata || {};
            setCaratulas(new Map(Object.entries(meta) as [string, TMDBMetadata][]));
          } catch {}
        }
      } catch {} finally { setCargando(false); }
    })();
  }, []);

  const caratulaDe = (it: Descargado): TMDBMetadata | undefined => {
    if (!it.clave) return undefined;
    const exacto = caratulas.get(it.clave);
    if (exacto?.poster) return exacto;
    return caratulas.get(prefijo(it.clave)) || exacto;
  };

  // Una fila por serie y una final con las peliculas sueltas. El titulo sale
  // de TMDB cuando se conoce: el nombre del fichero incluye el titulo del
  // episodio y quedaba un encabezado como "S07E22 - Sabrina... Soul Mates".
  const filas = useMemo(() => {
    const porSerie = new Map<string, Descargado[]>();
    const sueltos: Descargado[] = [];
    for (const it of items) {
      const meta = it.clave
        ? (caratulas.get(it.clave)?.poster ? caratulas.get(it.clave) : caratulas.get(prefijo(it.clave)))
        : undefined;
      const titulo = it.serie ? (meta?.title || prefijo(it.clave) || it.serie) : undefined;
      if (titulo) {
        if (!porSerie.has(titulo)) porSerie.set(titulo, []);
        porSerie.get(titulo)!.push(it);
      } else {
        sueltos.push(it);
      }
    }
    const out = [...porSerie.entries()].map(([titulo, eps]) => ({ titulo, items: eps }));
    if (sueltos.length) out.push({ titulo: 'Peliculas', items: sueltos });
    return out;
  }, [items, caratulas]);

  return (
    <Layout>
      <div className="pt-20 pb-4 px-6 md:px-14">
        <h1 className="text-white text-4xl md:text-5xl font-bold mb-2 tracking-tight">Descargas</h1>
        <p className="text-gray-400 text-base md:text-lg">
          {cargando ? 'Cargando...' : `${items.length} ${items.length === 1 ? 'archivo' : 'archivos'} en disco`}
        </p>
      </div>

      {!cargando && items.length === 0 && (
        <div className="px-6 md:px-14 py-16 text-center">
          <p className="text-gray-500 text-lg mb-2">Todavia no has descargado nada</p>
          <p className="text-gray-600 text-sm">Busca una pelicula o serie y pulsa Descargar</p>
        </div>
      )}

      <FocusScope orientation="vertical" index={1} as="none">
        {filas.map((fila, filaIdx) => (
          <MovieRow key={fila.titulo} index={filaIdx} title={fila.titulo}>
            {fila.items.map((it, i) => (
              <MovieCard
                key={it.ruta}
                index={i}
                forceFocus={filaIdx === 0 && i === 0}
                name={it.nombre}
                size={it.tamano}
                posterUrl={caratulaDe(it)?.poster}
                year={caratulaDe(it)?.year}
                rating={caratulaDe(it)?.rating}
                downloaded
                hoverLabel="Reproducir"
                actions="click"
                onClick={() => setReproduciendo(it)}
              />
            ))}
          </MovieRow>
        ))}
      </FocusScope>

      {reproduciendo && (
        <PlayDetail
          name={reproduciendo.nombre}
          size={reproduciendo.tamano}
          path={reproduciendo.ruta}
          metadata={caratulaDe(reproduciendo) || { title: cleanTitle(reproduciendo.nombre) }}
          streamUrl={streamUrl}
          onClose={() => setReproduciendo(null)}
        />
      )}
    </Layout>
  );
}
