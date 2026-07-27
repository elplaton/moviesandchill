from app.database.connection import get_pool


async def get_tmdb_cached(tmdb_id: int):
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM tmdb_cache WHERE tmdb_id = $1", tmdb_id)
        return dict(row) if row else None


async def upsert_tmdb_cache(data: dict):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO tmdb_cache (tmdb_id, media_type, title, original_title, year,
                rating, poster, backdrop, overview, genres, runtime, seasons_count)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (tmdb_id) DO UPDATE SET
                title=EXCLUDED.title, year=EXCLUDED.year, rating=EXCLUDED.rating,
                poster=EXCLUDED.poster, backdrop=EXCLUDED.backdrop,
                overview=EXCLUDED.overview, genres=EXCLUDED.genres,
                runtime=EXCLUDED.runtime, seasons_count=EXCLUDED.seasons_count,
                cached_at=NOW()
        """, data.get("tmdb_id"), data.get("media_type"), data.get("title"),
            data.get("original_title"), data.get("year"), data.get("rating"),
            data.get("poster"), data.get("backdrop"), data.get("overview"),
            data.get("genres"), data.get("runtime"), data.get("seasons_count"))
