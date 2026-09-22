from app.database.connection import get_pool

# Columnas de tmdb_cache que acompañan a cada media_item en las respuestas.
_TMDB_COLS = """
    tc.title as tmdb_title, tc.year as tmdb_year, tc.rating as tmdb_rating,
    tc.poster as tmdb_poster, tc.backdrop as tmdb_backdrop, tc.overview as tmdb_overview,
    tc.genres as tmdb_genres, tc.media_type as tmdb_type
"""


async def insert_media_item(data: dict):
    await insert_media_items([data])


async def insert_media_items(items: list[dict]):
    """Inserta un lote con una sola conexion.

    Antes se llamaba a insert_media_item() por elemento: 500 acquire() por lote
    sobre un pool de 5 conexiones.
    """
    pool = get_pool()
    if not pool or not items:
        return
    rows = [(
        i.get("channel_id"), i.get("channel_name"), i.get("message_id"),
        i.get("file_name"), i.get("file_size"), i.get("size_str"),
        i.get("clean_title"), i.get("media_type"), i.get("season"), i.get("episode"),
    ) for i in items]
    async with pool.acquire() as conn:
        await conn.executemany("""
            INSERT INTO media_items (channel_id, channel_name, message_id, file_name,
                file_size, size_str, clean_title, media_type, season, episode)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (channel_id, message_id) DO NOTHING
        """, rows)


async def update_media_tmdb(channel_id: int, message_id: int, tmdb_id: int, tmdb_valid: bool, tmdb_type: str):
    await update_media_tmdb_many([(tmdb_id, tmdb_type, tmdb_valid, channel_id, message_id)])


async def update_media_tmdb_many(rows: list[tuple]):
    """rows: (tmdb_id, tmdb_type, tmdb_valid, channel_id, message_id)."""
    pool = get_pool()
    if not pool or not rows:
        return
    async with pool.acquire() as conn:
        await conn.executemany("""
            UPDATE media_items SET tmdb_id=$1, tmdb_type=$2, tmdb_valid=$3, tmdb_searched=TRUE
            WHERE channel_id=$4 AND message_id=$5
        """, rows)


async def mark_batch_tmdb_searched(items: list[dict]):
    pool = get_pool()
    if not pool or not items:
        return
    rows = [(i["channel_id"], i["message_id"]) for i in items]
    async with pool.acquire() as conn:
        await conn.executemany("""
            UPDATE media_items SET tmdb_searched = TRUE
            WHERE channel_id = $1 AND message_id = $2
        """, rows)


async def search_media(query: str, limit: int = 50, offset: int = 0):
    """Busca por nombre de archivo limpio y tambien por el titulo TMDB (en
    español u original): "Como conoci a vuestra madre" encuentra los archivos
    de "How I Met Your Mother"."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(f"""
            SELECT mi.*, {_TMDB_COLS}
            FROM media_items mi
            LEFT JOIN tmdb_cache tc ON tc.tmdb_id = mi.tmdb_id AND tc.media_type = mi.tmdb_type
            WHERE mi.clean_title ILIKE $1 OR tc.title ILIKE $1 OR tc.original_title ILIKE $1
            ORDER BY mi.tmdb_id NULLS LAST, mi.season NULLS LAST, mi.episode NULLS LAST, mi.message_id DESC
            LIMIT $2 OFFSET $3
        """, f"%{query}%", limit, offset)
        return [dict(r) for r in rows]


async def get_media_by_tmdb(tmdb_id: int, media_type: str | None = None):
    """Todos los archivos de un titulo, para el detalle de pelicula/serie.
    Antes el detalle buscaba por ILIKE del titulo TMDB y en 2 de cada 3 series
    no encontraba nada porque el archivo esta en otro idioma."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(f"""
            SELECT mi.*, {_TMDB_COLS}
            FROM media_items mi
            LEFT JOIN tmdb_cache tc ON tc.tmdb_id = mi.tmdb_id AND tc.media_type = mi.tmdb_type
            WHERE mi.tmdb_id = $1 AND ($2::text IS NULL OR mi.tmdb_type = $2)
            ORDER BY mi.season NULLS LAST, mi.episode NULLS LAST, mi.file_name
        """, tmdb_id, media_type)
        return [dict(r) for r in rows]


async def get_media_without_tmdb(limit: int = 50):
    # Solo los no buscados: antes se cogian todos los que tenian tmdb_id NULL y
    # cada pasada volvia a preguntar a TMDB por los mismos 11.000 sin resultado.
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM media_items
            WHERE tmdb_id IS NULL AND tmdb_searched = FALSE
            ORDER BY id LIMIT $1
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
            LEFT JOIN tmdb_cache tc ON tc.tmdb_id = mi.tmdb_id AND tc.media_type = mi.tmdb_type
            WHERE mi.channel_id = $1
            ORDER BY mi.indexed_at DESC LIMIT $2
        """, channel_id, limit)
        return [dict(r) for r in rows]


async def fetch_all_media_for_reclassify():
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT mi.id, mi.channel_id, mi.message_id, mi.file_name, mi.clean_title,
                   mi.media_type, mi.season, mi.episode, mi.tmdb_id, mi.tmdb_valid,
                   mi.tmdb_type, tc.year AS tmdb_year,
                   tc.title AS tmdb_title, tc.original_title AS tmdb_original, tc.vote_count AS tmdb_votes
            FROM media_items mi
            LEFT JOIN tmdb_cache tc ON tc.tmdb_id = mi.tmdb_id AND tc.media_type = mi.tmdb_type
        """)
        return [dict(r) for r in rows]


async def bulk_update_parsed(rows: list[tuple]):
    """rows: (clean_title, media_type, season, episode, id)."""
    pool = get_pool()
    if not pool or not rows:
        return
    async with pool.acquire() as conn:
        await conn.executemany("""
            UPDATE media_items SET clean_title=$1, media_type=$2, season=$3, episode=$4
            WHERE id=$5
        """, rows)


async def reset_tmdb_for_ids(ids: list[int]):
    pool = get_pool()
    if not pool or not ids:
        return
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE media_items SET tmdb_id=NULL, tmdb_type=NULL, tmdb_valid=NULL, tmdb_searched=FALSE
            WHERE id = ANY($1::int[])
        """, ids)


async def get_missing_cache_pairs():
    """(tmdb_id, tmdb_type) referenciados por media_items sin fila en tmdb_cache
    (p. ej. los que se pisaron entre pelicula y serie con la clave antigua)."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT DISTINCT mi.tmdb_id, mi.tmdb_type
            FROM media_items mi
            LEFT JOIN tmdb_cache tc ON tc.tmdb_id = mi.tmdb_id AND tc.media_type = mi.tmdb_type
            WHERE mi.tmdb_id IS NOT NULL AND mi.tmdb_type IS NOT NULL AND tc.tmdb_id IS NULL
        """)
        return [(r["tmdb_id"], r["tmdb_type"]) for r in rows]
