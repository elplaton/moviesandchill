from app.database.connection import get_pool

# Un titulo por tmdb_id con los datos del primer archivo y el recuento de
# episodios distintos (no de archivos: un pack de 8 partes de una temporada
# contaba como 8 episodios). Solo entran los archivos cuyo tipo detectado
# coincide con el de TMDB (tmdb_valid): asi una pelicula mal emparejada con
# una serie no aparece en la fila de series con "1 episodios".
_TITLES_CTE = """
    WITH titles AS (
        SELECT mi.tmdb_id, mi.tmdb_type,
               MIN(mi.id) AS id,
               MIN(mi.channel_id) AS channel_id,
               MIN(mi.channel_name) AS channel_name,
               MIN(mi.message_id) AS message_id,
               MIN(mi.clean_title) AS clean_title,
               MAX(mi.indexed_at) AS last_indexed,
               COUNT(DISTINCT CASE WHEN mi.episode IS NOT NULL
                                   THEN COALESCE(mi.season, 0) * 1000 + mi.episode
                                   ELSE -COALESCE(mi.season, 0) END) AS episode_count,
               COUNT(*) AS file_count
        FROM media_items mi
        WHERE mi.tmdb_id IS NOT NULL AND mi.tmdb_valid IS TRUE
        GROUP BY mi.tmdb_id, mi.tmdb_type
    )
    SELECT t.*, tc.title AS tmdb_title, tc.year, tc.rating, tc.poster, tc.backdrop,
           tc.overview, tc.genres, tc.media_type AS tmdb_type, tc.vote_count
    FROM titles t
    JOIN tmdb_cache tc ON tc.tmdb_id = t.tmdb_id AND tc.media_type = t.tmdb_type
    WHERE tc.poster IS NOT NULL
"""


async def get_browse_pool(tmdb_type: str, limit: int = 300):
    """Muestra aleatoria ponderada hacia lo reciente (Efraimidis-Spirakis:
    clave = RANDOM()^(1/peso)). Un titulo de 2026 pesa ~8 veces mas que uno
    de 2008 o anterior; antes era RANDOM() puro sobre 7.500 titulos y la
    Home salia llena de clasicos."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(_TITLES_CTE + """
              AND tc.media_type = $1
            ORDER BY RANDOM() ^ (1.0 / (1 + GREATEST(COALESCE(tc.year, 2000) - 2008, 0) * 0.4)) DESC
            LIMIT $2
        """, tmdb_type, limit)
        return [dict(r) for r in rows]


async def get_recent_releases(limit: int = 20, min_year: int = 0, max_year: int = 9999):
    # Se acota por arriba: un "estreno de 2028" es un emparejamiento erroneo.
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(_TITLES_CTE + """
              AND tc.year BETWEEN $1 AND $2
            ORDER BY tc.year DESC, COALESCE(tc.vote_count, 50) DESC, tc.rating DESC NULLS LAST
            LIMIT $3
        """, min_year, max_year, limit)
        return [dict(r) for r in rows]


async def get_recently_added(limit: int = 20):
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(_TITLES_CTE + """
            ORDER BY t.last_indexed DESC, t.id DESC
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]


# Compatibilidad con el codigo que aun llama a las funciones antiguas.
async def get_browse_movies(limit: int = 300):
    return await get_browse_pool("movie", limit)


async def get_browse_series(limit: int = 300):
    return await get_browse_pool("tv", limit)
