from app.database.connection import get_pool


async def get_browse_movies(limit: int = 300):
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        # El DISTINCT ON obliga a ordenar por tmdb_id, asi que el RANDOM() tiene
        # que ir fuera: dentro solo desempataba filas del mismo tmdb_id y el LIMIT
        # acababa devolviendo siempre los mismos tmdb_id mas bajos.
        rows = await conn.fetch("""
            SELECT * FROM (
                SELECT DISTINCT ON (mi.tmdb_id)
                       mi.id, mi.clean_title, mi.file_name, mi.channel_id, mi.channel_name,
                       mi.message_id, mi.size_str,
                       tc.title as tmdb_title, tc.year, tc.rating, tc.poster, tc.backdrop,
                       tc.overview, tc.genres, tc.media_type as tmdb_type
                FROM media_items mi
                JOIN tmdb_cache tc ON mi.tmdb_id = tc.tmdb_id
                WHERE mi.media_type = 'movie' AND mi.tmdb_id IS NOT NULL
                ORDER BY mi.tmdb_id, mi.id DESC
            ) uniq
            ORDER BY RANDOM()
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]


async def get_browse_series(limit: int = 300):
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            WITH series_counts AS (
                SELECT tmdb_id, COUNT(*) as episode_count
                FROM media_items WHERE media_type = 'series' AND tmdb_id IS NOT NULL
                GROUP BY tmdb_id
            )
            SELECT * FROM (
                SELECT DISTINCT ON (mi.tmdb_id)
                       mi.tmdb_id, mi.id, mi.clean_title, mi.channel_id,
                       tc.title as tmdb_title, tc.year, tc.rating, tc.poster, tc.backdrop,
                       tc.overview, tc.genres,
                       sc.episode_count
                FROM media_items mi
                JOIN tmdb_cache tc ON mi.tmdb_id = tc.tmdb_id
                JOIN series_counts sc ON sc.tmdb_id = mi.tmdb_id
                WHERE mi.media_type = 'series' AND mi.tmdb_id IS NOT NULL
                ORDER BY mi.tmdb_id, mi.id DESC
            ) uniq
            ORDER BY RANDOM()
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]
