"""Series que sigue cada cuenta.

Solo series: una pelicula no estrena episodios. Por eso aqui no hay
`media_type` (siempre es `tv` de TMDB) y la clave es `(user_id, tmdb_id)`.

La fila sobrevive a dejar de seguir, con `active = false`. Es deliberado: el
seguimiento tambien se enciende solo al ver un episodio, asi que sin esa marca
una serie que alguien quito volveria a aparecer en cuanto reprodujera un
capitulo. "No tengo fila" y "me dijo que no" son cosas distintas.
"""
from app.database.connection import get_pool

# La ficha de cada serie seguida, con lo que hay en disco. El LEFT JOIN con los
# archivos es a proposito, igual que en favoritos: si se da de baja el canal
# que la traia, la serie sigue en la lista (con 0 episodios) en vez de
# desaparecer sin que nadie la haya quitado.
_LISTA = """
    WITH seguidas AS (
        SELECT tmdb_id, created_at, auto
        FROM series_follows WHERE user_id = $1 AND active
    ), archivos AS (
        SELECT mi.tmdb_id,
               MIN(mi.id) AS id,
               MIN(mi.channel_id) AS channel_id,
               MIN(mi.channel_name) AS channel_name,
               MIN(mi.message_id) AS message_id,
               MIN(mi.clean_title) AS clean_title,
               MAX(mi.indexed_at) AS last_indexed,
               COUNT(DISTINCT COALESCE(mi.season, 0) * 1000 + COALESCE(mi.episode, 0)) AS episode_count,
               COUNT(*) AS file_count
        FROM media_items mi
        JOIN seguidas s ON s.tmdb_id = mi.tmdb_id
        WHERE mi.tmdb_valid IS TRUE AND mi.tmdb_type = 'tv'
        GROUP BY mi.tmdb_id
    )
    SELECT s.tmdb_id, 'tv' AS tmdb_type, s.created_at, s.auto,
           a.id, a.channel_id, a.channel_name, a.message_id, a.clean_title,
           a.last_indexed,
           COALESCE(a.episode_count, 0) AS episode_count,
           COALESCE(a.file_count, 0) AS file_count,
           tc.title AS tmdb_title, tc.year, tc.rating, tc.poster, tc.backdrop,
           tc.overview, tc.genres, tc.vote_count
    FROM seguidas s
    JOIN tmdb_cache tc ON tc.tmdb_id = s.tmdb_id AND tc.media_type = 'tv'
    LEFT JOIN archivos a ON a.tmdb_id = s.tmdb_id
    ORDER BY a.last_indexed DESC NULLS LAST, s.created_at DESC
    LIMIT $2
"""


async def list_follows(user_id: int, limit: int = 200) -> list[dict]:
    """Las series seguidas con su ficha, lo que ha recibido algo primero."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        return [dict(r) for r in await conn.fetch(_LISTA, user_id, limit)]


async def follow_keys(user_id: int) -> list[int]:
    """Solo los ids. Es lo que piden los clientes para pintar la campana."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT tmdb_id FROM series_follows WHERE user_id = $1 AND active", user_id)
        return [r["tmdb_id"] for r in rows]


async def set_follow(user_id: int, tmdb_id: int, active: bool) -> bool:
    """Seguir o dejar de seguir a mano. Al dejar de seguir la fila se queda
    (con active = false) para que el seguimiento automatico no la resucite."""
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO series_follows (user_id, tmdb_id, active, auto)
            VALUES ($1, $2, $3, FALSE)
            ON CONFLICT (user_id, tmdb_id)
            DO UPDATE SET active = $3, auto = FALSE
        """, user_id, tmdb_id, active)
    return True


async def auto_follow(user_id: int, tmdb_id: int) -> bool:
    """Seguir por haber visto un episodio. No pisa nada: si ya hay fila (la
    siga o la haya quitado) se respeta lo que dijera la cuenta."""
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO series_follows (user_id, tmdb_id, active, auto)
            VALUES ($1, $2, TRUE, TRUE)
            ON CONFLICT (user_id, tmdb_id) DO NOTHING
        """, user_id, tmdb_id)
    return True


async def followers_of(tmdb_id: int) -> list[int]:
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT user_id FROM series_follows WHERE tmdb_id = $1 AND active", tmdb_id)
        return [r["user_id"] for r in rows]


async def followed_series_ids() -> list[int]:
    """Las series que sigue alguien, sea quien sea. El vigilante solo mira
    esas: preguntar por el catalogo entero seria barrer 160.000 archivos."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT tmdb_id FROM series_follows WHERE active")
        return [r["tmdb_id"] for r in rows]
