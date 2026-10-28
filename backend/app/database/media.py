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
    import json

    rows = [(
        i.get("channel_id"), i.get("channel_name"), i.get("message_id"),
        i.get("file_name"), i.get("file_size"), i.get("size_str"),
        i.get("clean_title"), i.get("media_type"), i.get("season"), i.get("episode"),
        i.get("pie"), i.get("ficha"), i.get("tema_id"),
        json.dumps(i["pistas"], ensure_ascii=False) if i.get("pistas") else None,
    ) for i in items]
    async with pool.acquire() as conn:
        # Lo que entra ya con su contexto (pie, ficha, tema) no hay que
        # releerlo de Telegram: `contexto_leido` va a TRUE.
        await conn.executemany("""
            INSERT INTO media_items (channel_id, channel_name, message_id, file_name,
                file_size, size_str, clean_title, media_type, season, episode,
                pie, ficha, tema_id, pistas, contexto_leido)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,TRUE)
            ON CONFLICT (channel_id, message_id) DO NOTHING
        """, rows)


async def temas_ignorados() -> dict[int, set[int]]:
    """Los temas que no se indexan, por canal."""
    pool = get_pool()
    if not pool:
        return {}
    async with pool.acquire() as conn:
        filas = await conn.fetch("SELECT channel_id, temas_ignorados FROM channels")
    return {f["channel_id"]: set(f["temas_ignorados"] or []) for f in filas}


async def guardar_contexto(filas: list[tuple]) -> None:
    """Pone el contexto releido de Telegram a lo ya indexado, y de paso lo que
    saca del nombre el limpiador actual. filas: (pie, ficha, tema_id,
    pistas_json, channel_id, message_id, clean_title, media_type, season,
    episode).

    Todo vuelve a buscarse en TMDB con las pistas nuevas. Lo que ya tenia una
    ficha buena la conserva mientras tanto, y solo pierde la ficha (se queda
    sin ella hasta que se encuentre otra) lo que el limpiador de ahora cambia
    de tipo ("Clarksons Farm 4x1" emparejado con una pelicula). Lo decidido a
    mano en Revision no se toca."""
    pool = get_pool()
    if not pool or not filas:
        return
    async with pool.acquire() as conn:
        await conn.executemany("""
            UPDATE media_items
               SET pie = $1, ficha = $2, tema_id = $3, pistas = $4::jsonb, contexto_leido = TRUE,
                   clean_title = $7,
                   media_type = CASE WHEN tmdb_manual THEN media_type ELSE $8::text END,
                   season = CASE WHEN tmdb_manual THEN season ELSE $9 END,
                   episode = CASE WHEN tmdb_manual THEN episode ELSE $10 END,
                   -- Todo vuelve a buscarse con sus pistas nuevas, tambien lo que ya
                   -- tenia ficha: hay errores con caratula (la otra "Animales").
                   -- La ficha que tenia se queda mientras tanto (no se vacia la
                   -- portada) y solo se cambia si se encuentra otra (ver
                   -- indexer._enrich_group).
                   tmdb_searched = CASE WHEN tmdb_manual THEN tmdb_searched ELSE FALSE END,
                   tmdb_id = CASE WHEN tmdb_manual OR (tmdb_valid IS TRUE AND media_type = $8::text)
                                  THEN tmdb_id ELSE NULL END,
                   tmdb_type = CASE WHEN tmdb_manual OR (tmdb_valid IS TRUE AND media_type = $8::text)
                                    THEN tmdb_type ELSE NULL END,
                   tmdb_valid = CASE WHEN tmdb_manual OR (tmdb_valid IS TRUE AND media_type = $8::text)
                                     THEN tmdb_valid ELSE NULL END
             WHERE channel_id = $5 AND message_id = $6
        """, filas)


async def marcar_leidos(channel_id: int, message_ids: list[int]) -> None:
    """Da por releidos unos archivos sin tocar nada mas (sus mensajes ya no
    estan en Telegram)."""
    pool = get_pool()
    if not pool or not message_ids:
        return
    async with pool.acquire() as conn:
        await conn.execute("""UPDATE media_items SET contexto_leido = TRUE
                               WHERE channel_id = $1 AND message_id = ANY($2::int[])""",
                           channel_id, message_ids)


async def olvidar_sin_leer() -> int:
    """Vuelve a dejar pendiente lo que se dio por releido sin tema: releer de
    verdad siempre lo pone, asi que sin el no se llego a leer."""
    pool = get_pool()
    if not pool:
        return 0
    async with pool.acquire() as conn:
        res = await conn.execute("UPDATE media_items SET contexto_leido = FALSE WHERE contexto_leido AND tema_id IS NULL")
    return int(res.split()[-1]) if res else 0


async def olvidar_contexto() -> int:
    """Marca todo como sin releer, para que la relectura lo vuelva a pasar
    con las reglas de ahora (cuando cambia `contexto.VERSION`)."""
    pool = get_pool()
    if not pool:
        return 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            res = await conn.execute("UPDATE media_items SET contexto_leido = FALSE WHERE contexto_leido")
            await conn.execute("DELETE FROM app_settings WHERE key LIKE 'relectura\\_%'")
    return int(res.split()[-1]) if res else 0


async def borrar_de_temas(channel_id: int, temas: list[int]) -> int:
    """Quita del catalogo lo indexado de unos temas (los que se ignoran)."""
    pool = get_pool()
    if not pool or not temas:
        return 0
    async with pool.acquire() as conn:
        res = await conn.execute(
            "DELETE FROM media_items WHERE channel_id = $1 AND tema_id = ANY($2::int[])", channel_id, temas)
    return int(res.split()[-1]) if res else 0


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
        # Tambien lo que tiene ficha y se ha mandado a comprobar de nuevo (la
        # relectura lo hace con todo). Primero lo que no tiene ficha: lo que
        # llega nuevo no espera a que acabe una comprobacion de una hora.
        rows = await conn.fetch("""
            SELECT * FROM media_items
            WHERE tmdb_searched = FALSE
            ORDER BY (tmdb_id IS NOT NULL), id LIMIT $1
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
                   mi.pie, mi.ficha, mi.tema_id, mi.tmdb_manual,
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


async def get_media_item(channel_id: int | None, message_id: int):
    """Fila del catalogo de un mensaje, con el titulo de TMDB si lo tiene."""
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"""
            SELECT mi.*, {_TMDB_COLS}
            FROM media_items mi
            LEFT JOIN tmdb_cache tc ON tc.tmdb_id = mi.tmdb_id AND tc.media_type = mi.tmdb_type
            WHERE mi.message_id = $1 AND ($2::bigint IS NULL OR mi.channel_id = $2)
            LIMIT 1
        """, message_id, channel_id)
        return dict(row) if row else None
