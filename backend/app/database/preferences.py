from app.database.connection import get_pool


async def get_preferences(user_id: int):
    pool = get_pool()
    if not pool:
        return None
    import json
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM user_preferences WHERE user_id = $1", user_id)
        if not row:
            return None
        genres_raw = row["genres"]
        if isinstance(genres_raw, str):
            genres_raw = json.loads(genres_raw)
        return {
            "user_id": row["user_id"],
            "liked_movies": row["liked_movies"] or [],
            "liked_series": row["liked_series"] or [],
            "genres": genres_raw if isinstance(genres_raw, dict) else {},
            "liked_years": row["liked_years"] or [],
        }


async def save_preferences(user_id: int, liked_movies: list[int], liked_series: list[int], genres: dict[str, int], liked_years: list[int] = None):
    pool = get_pool()
    if not pool:
        return
    import json
    years = liked_years or []
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO user_preferences (user_id, liked_movies, liked_series, genres, liked_years)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id) DO UPDATE SET
                liked_movies = EXCLUDED.liked_movies,
                liked_series = EXCLUDED.liked_series,
                genres = EXCLUDED.genres,
                liked_years = EXCLUDED.liked_years
        """, user_id, liked_movies, liked_series, json.dumps(genres), years)


async def get_top_rated(limit: int = 30, offset: int = 0):
    pool = get_pool()
    if not pool:
        return {"movies": [], "series": []}
    async with pool.acquire() as conn:
        movies = await conn.fetch("""
            SELECT DISTINCT ON (tc.tmdb_id)
                   tc.tmdb_id, tc.title as tmdb_title, tc.year, tc.rating, tc.poster,
                   tc.backdrop, tc.overview, tc.genres
            FROM media_items mi
            JOIN tmdb_cache tc ON mi.tmdb_id = tc.tmdb_id
            WHERE mi.media_type = 'movie' AND tc.media_type = 'movie'
              AND tc.rating >= 7 AND tc.year >= 2015
            ORDER BY tc.tmdb_id, tc.rating DESC
            OFFSET $1 LIMIT $2
        """, offset, limit)
        series = await conn.fetch("""
            SELECT DISTINCT ON (mi.tmdb_id)
                   mi.tmdb_id, tc.title as tmdb_title, tc.year, tc.rating, tc.poster,
                   tc.backdrop, tc.overview, tc.genres
            FROM media_items mi
            JOIN tmdb_cache tc ON mi.tmdb_id = tc.tmdb_id
            WHERE mi.media_type = 'series' AND tc.media_type = 'tv'
              AND tc.rating >= 7 AND tc.year >= 2015
            ORDER BY mi.tmdb_id, tc.rating DESC
            OFFSET $1 LIMIT $2
        """, offset, limit)
        return {"movies": [dict(r) for r in movies], "series": [dict(r) for r in series]}
