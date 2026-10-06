from app.database.connection import get_pool

# Un favorito es un titulo de TMDB, no un archivo: lo que se guarda en disco
# cambia (se borra un episodio, llega otra version) y la lista no deberia
# enterarse. Por eso la clave es (tmdb_id, media_type) y los recuentos se
# calculan al leer.
#
# El LEFT JOIN con los archivos es a proposito: si el canal que traia la
# pelicula se da de baja, el favorito sigue en la lista (con 0 archivos) en
# vez de desaparecer sin que nadie lo haya quitado.
_LISTA = """
    WITH fav AS (
        SELECT tmdb_id, media_type, created_at
        FROM user_favorites
        WHERE user_id = $1
          -- El tipo se filtra aqui y no en Python: las pantallas de Peliculas
          -- y Series paginan esta fila, y contar mal el total deja al carril
          -- pidiendo paginas que no existen.
          AND ($4::text IS NULL OR media_type = $4)
    ), archivos AS (
        SELECT mi.tmdb_id, mi.tmdb_type,
               MIN(mi.id) AS id,
               MIN(mi.channel_id) AS channel_id,
               MIN(mi.channel_name) AS channel_name,
               MIN(mi.message_id) AS message_id,
               MIN(mi.clean_title) AS clean_title,
               COUNT(DISTINCT CASE WHEN mi.episode IS NOT NULL
                                   THEN COALESCE(mi.season, 0) * 1000 + mi.episode
                                   ELSE -COALESCE(mi.season, 0) END) AS episode_count,
               COUNT(*) AS file_count
        FROM media_items mi
        JOIN fav ON fav.tmdb_id = mi.tmdb_id AND fav.media_type = mi.tmdb_type
        WHERE mi.tmdb_valid IS TRUE
        GROUP BY mi.tmdb_id, mi.tmdb_type
    )
    SELECT fav.tmdb_id, fav.media_type AS tmdb_type, fav.created_at,
           a.id, a.channel_id, a.channel_name, a.message_id, a.clean_title,
           COALESCE(a.episode_count, 0) AS episode_count,
           COALESCE(a.file_count, 0) AS file_count,
           tc.title AS tmdb_title, tc.year, tc.rating, tc.poster, tc.backdrop,
           tc.overview, tc.genres, tc.vote_count
    FROM fav
    JOIN tmdb_cache tc ON tc.tmdb_id = fav.tmdb_id AND tc.media_type = fav.media_type
    LEFT JOIN archivos a ON a.tmdb_id = fav.tmdb_id AND a.tmdb_type = fav.media_type
    ORDER BY fav.created_at DESC
    LIMIT $2 OFFSET $3
"""


async def list_favorites(user_id: int, limit: int = 200, offset: int = 0,
                         media_type: str | None = None) -> list[dict]:
    """Los favoritos con su ficha de TMDB, lo ultimo marcado primero."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        return [dict(r) for r in await conn.fetch(_LISTA, user_id, limit, offset, media_type)]


async def count_favorites(user_id: int, media_type: str | None = None) -> int:
    """Cuantos hay en total: es lo que necesita el carril para saber si queda
    algo por traer."""
    pool = get_pool()
    if not pool:
        return 0
    async with pool.acquire() as conn:
        return await conn.fetchval("""
            SELECT COUNT(*) FROM user_favorites
            WHERE user_id = $1 AND ($2::text IS NULL OR media_type = $2)
        """, user_id, media_type) or 0


async def favorite_keys(user_id: int) -> list[tuple[int, str]]:
    """Solo los pares (tmdb_id, tipo). Es lo que piden los clientes para
    pintar el corazon: no hace falta traerse toda la ficha para eso."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT tmdb_id, media_type FROM user_favorites WHERE user_id = $1", user_id)
        return [(r["tmdb_id"], r["media_type"]) for r in rows]


async def add_favorite(user_id: int, tmdb_id: int, media_type: str) -> bool:
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO user_favorites (user_id, tmdb_id, media_type)
            VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
        """, user_id, tmdb_id, media_type)
    return True


async def remove_favorite(user_id: int, tmdb_id: int, media_type: str) -> bool:
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
        await conn.execute("""
            DELETE FROM user_favorites
            WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3
        """, user_id, tmdb_id, media_type)
    return True
