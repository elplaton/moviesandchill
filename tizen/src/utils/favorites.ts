import type { BrowseItem } from '../types';

/** Un genero dentro de una seccion: "Accion" con sus titulos. */
export interface FavGroup {
  genre: string;
  items: BrowseItem[];
}

/** Peliculas o series, con sus generos dentro. */
export interface FavSection {
  kind: 'movie' | 'series';
  title: string;
  total: number;
  groups: FavGroup[];
}

export const SIN_GENERO = 'Sin género';

/**
 * Los favoritos en dos secciones (Películas y Series) y, dentro de cada una,
 * un grupo por género.
 *
 * Un título va a **un solo** grupo, el de su primer género en TMDB (el
 * principal): TMDB da dos o tres por título, y repetirlo en todos haría que
 * «12 títulos guardados» no cuadrara con las carátulas de abajo — en una lista
 * que uno mismo ha marcado, el recuento tiene que ser el de la lista.
 *
 * Los grupos van del más lleno al más vacío (y a igualdad, alfabéticos), con
 * «Sin género» siempre al final: es el cajón de lo que TMDB no clasifica, no
 * un género más. Dentro de cada grupo se conserva el orden que trae el
 * servidor, que es lo último marcado primero.
 */
export function groupFavorites(items: BrowseItem[]): FavSection[] {
  const kinds: { kind: 'movie' | 'series'; title: string }[] = [
    { kind: 'movie', title: 'Películas' },
    { kind: 'series', title: 'Series' },
  ];

  const sections: FavSection[] = [];
  for (const { kind, title } of kinds) {
    const propios = items.filter(i => i.media_type === kind);
    if (propios.length === 0) continue;

    const porGenero = new Map<string, BrowseItem[]>();
    for (const item of propios) {
      const genre = item.genres?.[0] || SIN_GENERO;
      const lista = porGenero.get(genre);
      if (lista) lista.push(item);
      else porGenero.set(genre, [item]);
    }

    const groups = Array.from(porGenero, ([genre, items]) => ({ genre, items }))
      .sort((a, b) => {
        const aSin = a.genre === SIN_GENERO, bSin = b.genre === SIN_GENERO;
        if (aSin !== bSin) return aSin ? 1 : -1;
        return b.items.length - a.items.length || a.genre.localeCompare(b.genre, 'es');
      });

    sections.push({ kind, title, total: propios.length, groups });
  }
  return sections;
}
