"""Rellenar la fecha de estreno de lo que ya estaba en la cache.

`tmdb_cache` guardaba solo el año porque es lo unico que se mostraba. Para que
"Novedades" distinga lo de este mes de lo de enero hace falta el dia, y eso
obliga a volver a preguntar a TMDB por los titulos antiguos.

Se rellena **solo lo reciente** (los ultimos años): es lo unico que puede
entrar en la fila de novedades, y asi son unos cientos de consultas en vez de
veinte mil. Lo demas se queda sin fecha y vale el 1 de enero de su año, que es
exactamente la precision que habia antes.
"""
import asyncio
import logging
from datetime import date

logger = logging.getLogger("tmd")

# Cuantos años atras tiene sentido rellenar: la ventana de novedades son 24
# meses, y se coge un año de margen por los estrenos que se fechan tarde.
AÑOS_ATRAS = 3
# Por pasada. Con 10 en paralelo son unos pocos minutos; el resto va en la
# siguiente vuelta.
POR_PASADA = 1500
CONCURRENCIA = 10


async def pendientes(limite: int = POR_PASADA) -> list[tuple[int, str]]:
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return []
    desde = date.today().year - AÑOS_ATRAS
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT tmdb_id, media_type FROM tmdb_cache
            WHERE release_date IS NULL AND year IS NOT NULL AND year >= $1
            ORDER BY year DESC
            LIMIT $2
        """, desde, limite)
    return [(r["tmdb_id"], r["media_type"]) for r in rows]


async def rellenar(api_key: str, limite: int = POR_PASADA) -> int:
    """Pide a TMDB la ficha de los titulos recientes sin fecha y la guarda."""
    from app.database.connection import upsert_tmdb_cache
    from app.services.tmdb import get_details

    if not api_key:
        return 0
    faltan = await pendientes(limite)
    if not faltan:
        return 0

    logger.info("Fechas de estreno: %d titulos recientes sin fecha", len(faltan))
    sem = asyncio.Semaphore(CONCURRENCIA)
    hechos = 0

    async def _uno(tmdb_id: int, media_type: str):
        nonlocal hechos
        async with sem:
            try:
                detalles = await get_details(api_key, tmdb_id, media_type)
            except Exception as e:
                logger.warning("Fecha de %s/%d fallo: %s", media_type, tmdb_id, str(e)[:80])
                return
            if detalles and detalles.get("release_date"):
                await upsert_tmdb_cache(detalles)
                hechos += 1

    await asyncio.gather(*[_uno(i, t) for i, t in faltan], return_exceptions=True)
    logger.info("Fechas de estreno: %d/%d rellenadas", hechos, len(faltan))
    return hechos


async def relleno_periodico(api_key: str, horas: float = 12) -> None:
    """Al arrancar y cada medio dia. Lo nuevo ya llega con fecha desde el
    enriquecimiento, asi que esto solo existe para lo que entro antes."""
    await asyncio.sleep(120)
    while True:
        try:
            await rellenar(api_key)
        except Exception as e:
            logger.error("Relleno de fechas fallo: %s", e)
        await asyncio.sleep(max(horas, 1) * 3600)
