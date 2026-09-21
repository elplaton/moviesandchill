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
  serie?: string;
  meta?: TMDBMetadata;
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
      } catch {} finally { setCargando(false); }
    })();
  }, []);

  // Una fila por serie y una final con las peliculas sueltas.
  const filas = useMemo(() => {
    const porSerie = new Map<string, Descargado[]>();
    const sueltos: Descargado[] = [];
    for (const it of items) {
      if (it.serie) {
        if (!porSerie.has(it.serie)) porSerie.set(it.serie, []);
        porSerie.get(it.serie)!.push(it);
      } else {
        sueltos.push(it);
      }
    }
    const out = [...porSerie.entries()].map(([titulo, eps]) => ({ titulo, items: eps }));
    if (sueltos.length) out.push({ titulo: 'Peliculas', items: sueltos });
    return out;
  }, [items]);

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
                subtitle={fila.titulo === 'Peliculas' ? '' : undefined}
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
          metadata={{ title: cleanTitle(reproduciendo.nombre) }}
          streamUrl={streamUrl}
          onClose={() => setReproduciendo(null)}
        />
      )}
    </Layout>
  );
}
