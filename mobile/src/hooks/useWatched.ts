import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';

type Kind = 'movie' | 'series';

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

  const alternarEpisodio = useCallback(async (season: number | null | undefined, episode: number) => {
    const k = clave(season, episode);
    const estaba = episodios.has(k) || entero;
    setEpisodios(prev => {
      const n = new Set(prev);
      estaba ? n.delete(k) : n.add(k);
      return n;
    });
    // Quitar el visto de un episodio de una serie marcada entera deja de serlo:
    // "serie vista" con un capítulo sin ver no es un estado que exista.
    if (estaba && entero) {
      setEntero(false);
      await mandar(false);
      return;
    }
    const ok = await mandar(!estaba, season ?? 0, episode);
    if (!ok) {
      setEpisodios(prev => {
        const n = new Set(prev);
        estaba ? n.add(k) : n.delete(k);
        return n;
      });
    }
  }, [episodios, entero, mandar]);

  const esVisto = useCallback(
    (season: number | null | undefined, episode: number) => entero || episodios.has(clave(season, episode)),
    [entero, episodios]);

  return { entero, episodios, esVisto, alternarTitulo, alternarEpisodio };
}
