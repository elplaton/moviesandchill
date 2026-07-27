from app.database.connection import get_pool


async def insert_media_item(data: dict):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO media_items (channel_id, channel_name, message_id, file_name,
                file_size, size_str, clean_title, media_type, season, episode)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (channel_id, message_id) DO NOTHING
        """, data.get("channel_id"), data.get("channel_name"), data.get("message_id"),
            data.get("file_name"), data.get("file_size"), data.get("size_str"),
            data.get("clean_title"), data.get("media_type"), data.get("season"), data.get("episode"))


async def update_media_tmdb(channel_id: int, message_id: int, tmdb_id: int, tmdb_valid: bool):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE media_items SET tmdb_id=$1, tmdb_valid=$2, tmdb_searched=TRUE
            WHERE channel_id=$3 AND message_id=$4
        """, tmdb_id, tmdb_valid, channel_id, message_id)


async def mark_batch_tmdb_searched(items: list[dict]):
    pool = get_pool()
    if not pool or not items:
        return
    async with pool.acquire() as conn:
        for item in items:
            await conn.execute("""
                UPDATE media_items SET tmdb_searched = TRUE
                WHERE channel_id = $1 AND message_id = $2
            """, item["channel_id"], item["message_id"])


async def search_media(query: str, limit: int = 50, offset: int = 0):
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT mi.*, tc.title as tmdb_title, tc.year as tmdb_year,
                tc.rating as tmdb_rating, tc.poster as tmdb_poster, tc.backdrop as tmdb_backdrop,
                tc.overview as tmdb_overview, tc.genres as tmdb_genres, tc.media_type as tmdb_type
            FROM media_items mi
            LEFT JOIN tmdb_cache tc ON mi.tmdb_id = tc.tmdb_id
            WHERE mi.clean_title ILIKE $1
            ORDER BY mi.message_id DESC
            LIMIT $2 OFFSET $3
        """, f"%{query}%", limit, offset)
        return [dict(r) for r in rows]


async def get_media_without_tmdb(limit: int = 50):
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM media_items WHERE tmdb_id IS NULL ORDER BY RANDOM() LIMIT $1
        """, limit)
        return [dict(r) for r in rows]


async def get_media_by_channel(channel_id: int, limit: int = 100):
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT mi.*, tc.title as tmdb_title, tc.rating as tmdb_rating, tc.poster as tmdb_poster
            FROM media_items mi
            LEFT JOIN tmdb_cache tc ON mi.tmdb_id = tc.tmdb_id
            WHERE mi.channel_id = $1
            ORDER BY mi.indexed_at DESC LIMIT $2
        """, channel_id, limit)
        return [dict(r) for r in rows]
