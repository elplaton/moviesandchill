"""Suscripciones de aviso (Web Push).

Una suscripcion es un aparato, no una cuenta: el telefono, la PWA instalada y
el navegador del escritorio son tres. El `endpoint` que da el navegador es su
identidad, asi que volver a suscribirse en el mismo sitio actualiza la fila en
vez de duplicarla.

Las suscripciones caducan solas (al desinstalar la app, al borrar los datos del
navegador) y entonces el servicio de push contesta 404 o 410: eso no es un
error nuestro, es la señal de que hay que borrar la fila.
"""
import logging

from app.database.connection import get_pool

logger = logging.getLogger("tmd")


async def add_subscription(user_id: int, endpoint: str, p256dh: str, auth: str,
                           app: str = "web") -> bool:
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, app)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (endpoint) DO UPDATE SET
                user_id = $1, p256dh = $3, auth = $4, app = $5, failures = 0
        """, user_id, endpoint[:500], p256dh[:200], auth[:100], app[:10])
    return True


async def remove_subscription(user_id: int, endpoint: str) -> bool:
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
            user_id, endpoint[:500])
    return True


async def subscriptions_for(user_id: int) -> list[dict]:
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, endpoint, p256dh, auth, app FROM push_subscriptions WHERE user_id = $1",
            user_id)
        return [dict(r) for r in rows]


async def count_subscriptions(user_id: int) -> int:
    pool = get_pool()
    if not pool:
        return 0
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT COUNT(*) FROM push_subscriptions WHERE user_id = $1", user_id) or 0


async def drop_subscription_by_id(sub_id: int) -> None:
    """La suscripcion ya no existe en el servicio de push: fuera."""
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM push_subscriptions WHERE id = $1", sub_id)


async def mark_subscription_ok(sub_id: int) -> None:
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE push_subscriptions SET last_ok = NOW(), failures = 0 WHERE id = $1", sub_id)


async def mark_subscription_fail(sub_id: int) -> None:
    """Un fallo que no es "ya no existe" (una caida del servicio de push, por
    ejemplo) solo cuenta: a las cinco veces se deja de intentar."""
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1", sub_id)
        await conn.execute("DELETE FROM push_subscriptions WHERE id = $1 AND failures >= 5", sub_id)


async def ya_avisado(user_id: int, tmdb_id: int, season: int | None, episode: int) -> bool:
    pool = get_pool()
    if not pool:
        return True
    async with pool.acquire() as conn:
        return bool(await conn.fetchval("""
            SELECT 1 FROM series_avisos
            WHERE user_id = $1 AND tmdb_id = $2 AND season = $3 AND episode = $4
        """, user_id, tmdb_id, season or 0, episode))


async def marcar_avisado(user_id: int, tmdb_id: int, season: int | None, episode: int) -> None:
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO series_avisos (user_id, tmdb_id, season, episode)
            VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
        """, user_id, tmdb_id, season or 0, episode)


async def episodios_sin_avisar(user_id: int, tmdb_id: int,
                               episodios: list[tuple[int | None, int]]) -> list[tuple[int | None, int]]:
    """De los episodios que han llegado, los que esta cuenta todavia no sabe."""
    if not episodios:
        return []
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT season, episode FROM series_avisos
            WHERE user_id = $1 AND tmdb_id = $2
        """, user_id, tmdb_id)
    sabidos = {(r["season"], r["episode"]) for r in rows}
    return [(s, e) for s, e in episodios if (s or 0, e) not in sabidos]
