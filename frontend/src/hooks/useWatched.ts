import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';

type Kind = 'movie' | 'series';
/** Un capítulo: [temporada, episodio]. Temporada null/0 si no se sabe. */
export type Capitulo = [number | null | undefined, number];

const clave = (season: number | null | undefined, episode: number) => `${season ?? 0}:${episode}`;

/**
 * Lo que la cuenta ya ha visto de un título.
 *
 * Es por título y no por archivo: "ya me he visto esta película" vale aunque
 * no esté descargada, y marcar un episodio no depende de tenerlo en disco.
 *
 * Lo que se marca aquí hace tres cosas: pinta el visto en la ficha, saca el
 * título de "Continuar viendo" y mueve las recomendaciones (el servidor suma
 * los géneros de lo visto a los del onboarding).
 *
 * Es el mismo archivo en `frontend/` y en `mobile/`.
 */
export function useWatched(tmdbId: number | undefined, kind: Kind) {
  const [entero, setEntero] = useState(false);
  const [episodios, setEpisodios] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tmdbId) { setEntero(false); setEpisodios(new Set()); return; }
    let vivo = true;
    apiFetch(`/watched?tmdb_id=${tmdbId}&media_type=${kind}`)
      .then(r => r.json())
      .then(d => {
        if (!vivo) return;
        setEntero(!!d.whole);
        setEpisodios(new Set<string>((d.episodes || []).map((p: number[]) => clave(p[0], p[1]))));
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [tmdbId, kind]);

  const mandar = useCallback(async (marcar: boolean, season?: number | null, episode?: number) => {
    if (!tmdbId) return false;
    try {
      const res = await apiFetch('/watched', {
        method: marcar ? 'POST' : 'DELETE',
        body: JSON.stringify({ tmdb_id: tmdbId, media_type: kind,
                               season: season ?? null, episode: episode ?? null }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [tmdbId, kind]);

  /** Varios capítulos de golpe (una temporada, o todos menos uno). */
  const lote = useCallback(async (caps: Capitulo[], marcar: boolean, quitarEntero = false) => {
    if (!tmdbId) return false;
    try {
      const res = await apiFetch('/watched/episodios', {
        method: 'POST',
        body: JSON.stringify({ tmdb_id: tmdbId, media_type: kind, marcar, quitar_entero: quitarEntero,
                               episodios: caps.map(([s, e]) => [s ?? 0, e]) }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [tmdbId, kind]);

  /**
   * Una serie marcada entera deja de estarlo, pero lo que no se toca sigue
   * visto: se marcan uno a uno todos los capítulos conocidos menos `fuera`.
   * Antes quitar el visto de un capítulo quitaba el de la serie entera, y con
   * él todos los capítulos marcados.
   */
  const desarmarEntero = useCallback(async (todos: Capitulo[], fuera: Set<string>) => {
    const quedan = todos.filter(([s, e]) => !fuera.has(clave(s, e)));
    const antes = episodios;
    setEntero(false);
    setEpisodios(new Set(quedan.map(([s, e]) => clave(s, e))));
    const ok = await lote(quedan, true, true);
    if (!ok) { setEntero(true); setEpisodios(antes); }
  }, [episodios, lote]);

  /** El título entero: la película, o la serie completa. */
  const alternarTitulo = useCallback(async () => {
    const estaba = entero;
    // Se pinta al tocarlo y se deshace si el servidor dice que no, igual que
    // el corazón de favoritos: un botón que tarda en reaccionar parece roto.
    setEntero(!estaba);
    if (estaba) setEpisodios(new Set());
    const ok = await mandar(!estaba);
    if (!ok) setEntero(estaba);
  }, [entero, mandar]);

  /** `todos` son los capítulos que conoce la ficha: hacen falta para quitar
   *  uno de una serie marcada entera sin perder los demás. */
  const alternarEpisodio = useCallback(async (season: number | null | undefined, episode: number,
                                              todos: Capitulo[] = []) => {
    const k = clave(season, episode);
    const estaba = episodios.has(k) || entero;
    // Quitar el visto de un capítulo de una serie marcada entera: deja de
    // estar entera ("serie vista" con un capítulo sin ver no existe), pero el
    // resto sigue visto.
    if (estaba && entero) {
      await desarmarEntero(todos, new Set([k]));
      return;
    }
    setEpisodios(prev => {
      const n = new Set(prev);
      estaba ? n.delete(k) : n.add(k);
      return n;
    });
    const ok = await mandar(!estaba, season ?? 0, episode);
    if (!ok) {
      setEpisodios(prev => {
        const n = new Set(prev);
        estaba ? n.add(k) : n.delete(k);
        return n;
      });
    }
  }, [episodios, entero, mandar, desarmarEntero]);

  const esVisto = useCallback(
    (season: number | null | undefined, episode: number) => entero || episodios.has(clave(season, episode)),
    [entero, episodios]);

  /** Si todos los capítulos de una temporada están vistos. */
  const temporadaVista = useCallback(
    (caps: Capitulo[]) => caps.length > 0 && caps.every(([s, e]) => esVisto(s, e)),
    [esVisto]);

  /** Marca o desmarca una temporada entera de golpe. */
  const alternarTemporada = useCallback(async (caps: Capitulo[], todos: Capitulo[] = []) => {
    if (!caps.length) return;
    const claves = new Set(caps.map(([s, e]) => clave(s, e)));
    if (temporadaVista(caps)) {
      if (entero) { await desarmarEntero(todos, claves); return; }
      const antes = episodios;
      setEpisodios(prev => new Set([...prev].filter(k => !claves.has(k))));
      if (!(await lote(caps, false))) setEpisodios(antes);
      return;
    }
    const antes = episodios;
    setEpisodios(prev => new Set([...prev, ...claves]));
    if (!(await lote(caps, true))) setEpisodios(antes);
  }, [temporadaVista, entero, episodios, desarmarEntero, lote]);

  return { entero, episodios, esVisto, alternarTitulo, alternarEpisodio, temporadaVista, alternarTemporada };
}
