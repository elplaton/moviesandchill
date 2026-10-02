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


async def get_top_rated(limit: int = 30, offset: int = 0, query: str = ""):
    """Titulos para elegir en el onboarding.

    Sin `query` son los mejor valorados y recientes, que es una buena carta de
    presentacion. Con `query` se busca por titulo en todo el catalogo y se
    sueltan los filtros de nota y año: si alguien busca una pelicula concreta
    es que la quiere, aunque sea de 1980 o tenga un 5 en TMDB.
    """
    pool = get_pool()
    if not pool:
        return {"movies": [], "series": []}

    q = (query or "").strip()

    # DISTINCT ON obliga a ordenar por su propia clave, asi que para ordenar
    # por relevancia hay que envolver la consulta y ordenar por fuera, donde
    # la columna ya se llama tmdb_title.
    #   $1 offset  $2 limite  $3 "%texto%" (filtrar)  $4 "texto%" (ordenar)
    if q:
        filtro = "AND tc.title ILIKE $3"
        params = [f"%{q}%", f"{q}%"]
        orden = ("ORDER BY (CASE WHEN tmdb_title ILIKE $4 THEN 0 ELSE 1 END), "
                 "length(tmdb_title), rating DESC NULLS LAST")
    else:
        filtro = "AND tc.rating >= 7 AND tc.year >= 2015"
        params = []
        orden = "ORDER BY rating DESC NULLS LAST"

    def consulta(tipo_local: str, tipo_tmdb: str) -> str:
        return f"""
            SELECT * FROM (
                SELECT DISTINCT ON (mi.tmdb_id)
                       mi.tmdb_id, tc.title AS tmdb_title, tc.year, tc.rating, tc.poster,
                       tc.backdrop, tc.overview, tc.genres
                FROM media_items mi
                JOIN tmdb_cache tc ON mi.tmdb_id = tc.tmdb_id AND tc.media_type = mi.tmdb_type
                WHERE mi.media_type = '{tipo_local}' AND tc.media_type = '{tipo_tmdb}'
                  AND mi.tmdb_valid IS TRUE
                  {filtro}
                ORDER BY mi.tmdb_id, tc.rating DESC
            ) AS t
            {orden}
            OFFSET $1 LIMIT $2
        """

    async with pool.acquire() as conn:
        movies = await conn.fetch(consulta("movie", "movie"), offset, limit, *params)
        series = await conn.fetch(consulta("series", "tv"), offset, limit, *params)
        return {"movies": [dict(r) for r in movies], "series": [dict(r) for r in series]}
