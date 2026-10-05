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


async def list_progress(user_id: int, limit: int = MAX_FILAS) -> list[dict]:
    """Todo el historial de la cuenta, lo ultimo visto primero."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        return [dict(r) for r in await conn.fetch("""
            SELECT * FROM playback_progress WHERE user_id = $1
            ORDER BY updated_at DESC LIMIT $2
        """, user_id, limit)]


async def delete_progress(user_id: int, path: str | None = None, grupo: str | None = None) -> int:
    """Olvida un archivo, o un titulo entero (lo que hace "quitar de la fila":
    si solo se borrara el episodio en curso, la tarjeta volveria con el
    anterior)."""
    pool = get_pool()
    if not pool or (path is None and grupo is None):
        return 0
    async with pool.acquire() as conn:
        if grupo is not None:
            res = await conn.execute(
                "DELETE FROM playback_progress WHERE user_id = $1 AND grupo = $2", user_id, grupo)
        else:
            res = await conn.execute(
                "DELETE FROM playback_progress WHERE user_id = $1 AND path = $2", user_id, path)
    return int(res.split()[-1]) if res else 0
