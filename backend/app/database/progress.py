"""Por donde va cada cuenta en cada video.

Antes esto vivia en el localStorage de cada aparato, asi que el punto de
reanudacion no salia de ahi: lo empezado en la tele no existia en el movil, y
en la web ni siquiera habia donde verlo. La tabla `playback_progress` lo pone
en la cuenta, igual que se hizo con los favoritos.
"""
from app.database.connection import get_pool

# Cuantas filas se guardan por cuenta. Es historial: no se borra al terminar
# un episodio porque es justo lo que permite ofrecer el siguiente.
MAX_FILAS = 400

_GUARDAR = """
    INSERT INTO playback_progress
        (user_id, path, grupo, title, subtitle, poster, backdrop,
         tmdb_id, tmdb_type, season, episode, position, duration, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    ON CONFLICT (user_id, path) DO UPDATE SET
        grupo      = EXCLUDED.grupo,
        -- Los datos de ficha solo se pisan si vienen: un cliente que no sepa
        -- la caratula (el reproductor de la web no la recibe) no debe borrar
        -- la que guardo otro.
        title      = COALESCE(EXCLUDED.title,     playback_progress.title),
        subtitle   = COALESCE(EXCLUDED.subtitle,  playback_progress.subtitle),
        poster     = COALESCE(EXCLUDED.poster,    playback_progress.poster),
        backdrop   = COALESCE(EXCLUDED.backdrop,  playback_progress.backdrop),
        tmdb_id    = COALESCE(EXCLUDED.tmdb_id,   playback_progress.tmdb_id),
        tmdb_type  = COALESCE(EXCLUDED.tmdb_type, playback_progress.tmdb_type),
        season     = COALESCE(EXCLUDED.season,    playback_progress.season),
        episode    = COALESCE(EXCLUDED.episode,   playback_progress.episode),
        position   = EXCLUDED.position,
        duration   = CASE WHEN EXCLUDED.duration > 0 THEN EXCLUDED.duration
                          ELSE playback_progress.duration END,
        updated_at = NOW()
"""


async def save_progress(user_id: int, path: str, grupo: str, position: float, duration: float,
                        title: str | None = None, subtitle: str | None = None,
                        poster: str | None = None, backdrop: str | None = None,
                        tmdb_id: int | None = None, tmdb_type: str | None = None,
                        season: int | None = None, episode: int | None = None) -> None:
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute(_GUARDAR, user_id, path, grupo, title, subtitle, poster, backdrop,
                           tmdb_id, tmdb_type, season, episode, float(position), float(duration))
        # Se poda aqui y no con un barrido aparte: son unas pocas filas y asi
        # la tabla no crece sin limite aunque nadie pase a limpiar.
        await conn.execute("""
            DELETE FROM playback_progress
            WHERE user_id = $1 AND path IN (
                SELECT path FROM playback_progress WHERE user_id = $1
                ORDER BY updated_at DESC OFFSET $2
            )
        """, user_id, MAX_FILAS)


async def get_progress(user_id: int, path: str) -> dict | None:
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM playback_progress WHERE user_id = $1 AND path = $2", user_id, path)
        return dict(row) if row else None


# La caratula y el titulo se completan con la ficha de TMDB.
#
# Lo que se guarda aqui es lo que manda el cliente, y no todos saben la
# caratula: reproducir desde Descargas, desde una busqueda o desde un archivo
# suelto guardaba la posicion sin imagen, y la tarjeta de "Continuar viendo"
# salia con el titulo en texto y un hueco gris. Teniendo `tmdb_id` la imagen
# esta a un JOIN de distancia, asi que se pone aqui y no en cada cliente.
#
# COALESCE y no EXCLUDED: lo que el cliente guardo manda (puede ser el
# fotograma de un episodio concreto), y TMDB solo rellena lo que falte.
_HISTORIAL = r"""
    SELECT p.user_id, p.path, p.grupo,
           COALESCE(p.title, tc.title, por_carpeta.title) AS title,
           p.subtitle,
           COALESCE(p.poster, tc.poster, por_carpeta.poster) AS poster,
           COALESCE(p.backdrop, tc.backdrop, por_carpeta.backdrop,
                    p.poster, tc.poster, por_carpeta.poster) AS backdrop,
           p.tmdb_id, p.tmdb_type, p.season, p.episode,
           p.position, p.duration, p.updated_at
    FROM playback_progress p
    LEFT JOIN tmdb_cache tc
           ON tc.tmdb_id = p.tmdb_id AND tc.media_type = p.tmdb_type
    -- Sin `tmdb_id` no hay por donde juntar, pero si hay un nombre: la carpeta
    -- del titulo la puso layout.py con el titulo de TMDB, asi que "Dune (2021)"
    -- encuentra su ficha quitandole el año. Va en LATERAL con LIMIT 1 porque
    -- el titulo no es unico (una pelicula y una serie pueden llamarse igual) y
    -- un LEFT JOIN normal duplicaria la fila: dos tarjetas del mismo video.
    LEFT JOIN LATERAL (
        SELECT c.title, c.poster, c.backdrop
        FROM tmdb_cache c
        WHERE p.tmdb_id IS NULL
          AND c.poster IS NOT NULL
          AND c.title = regexp_replace(p.grupo, '\s*\((19|20)[0-9]{2}\)\s*$', '')
        ORDER BY COALESCE(c.vote_count, 0) DESC
        LIMIT 1
    ) AS por_carpeta ON TRUE
    WHERE p.user_id = $1
    ORDER BY p.updated_at DESC
    LIMIT $2
"""


async def list_progress(user_id: int, limit: int = MAX_FILAS) -> list[dict]:
    """Todo el historial de la cuenta, lo ultimo visto primero."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        return [dict(r) for r in await conn.fetch(_HISTORIAL, user_id, limit)]


async def delete_progress(user_id: int, path: str | None = None, grupo: str | None = None,
                          todo: bool = False) -> int:
    """Olvida un archivo, un titulo entero (lo que hace "quitar de la fila": si
    solo se borrara el episodio en curso, la tarjeta volveria con el anterior)
    o **todo el historial de la cuenta**.

    Lo de borrarlo todo existe por un accidente: hubo una version que subia a
    la cuenta el historial que el navegador tenia guardado de cuando el
    progreso vivia en localStorage, y ese historial es del **aparato**, asi que
    en una tele o un movil compartidos le entraba a uno lo que habia visto
    otro. Quitar aquello impide que entren mas, pero no borra las que entraron,
    y hacerlo tarjeta a tarjeta es un castigo. No se pierde nada que no se
    pueda reconstruir viendo: no toca el disco ni las descargas.
    """
    pool = get_pool()
    if not pool or (path is None and grupo is None and not todo):
        return 0
    async with pool.acquire() as conn:
        if todo:
            res = await conn.execute(
                "DELETE FROM playback_progress WHERE user_id = $1", user_id)
        elif grupo is not None:
            res = await conn.execute(
                "DELETE FROM playback_progress WHERE user_id = $1 AND grupo = $2", user_id, grupo)
        else:
            res = await conn.execute(
                "DELETE FROM playback_progress WHERE user_id = $1 AND path = $2", user_id, path)
    return int(res.split()[-1]) if res else 0
