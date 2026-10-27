"""Releer lo ya indexado para ponerle su contexto (ver services/contexto.py).

Lo que se indexo antes de leer pies y fichas solo tiene el nombre del archivo,
y por eso tanto se quedo sin ficha de TMDB. Esto vuelve a recorrer cada canal
en orden (del mensaje mas viejo con algo pendiente al mas nuevo), con el mismo
`Seguidor` que el escaneo, y a cada archivo ya indexado le pone su pie, su
ficha, su tema y sus pistas. Lo que no estaba bien emparejado vuelve a
buscarse en TMDB con esas pistas (lo bien emparejado no se toca), y lo de los
temas que se ignoran sale del catalogo.

Va despacio a proposito (una pausa entre tandas): no corre prisa y comparte
cuenta de Telegram con las descargas y lo que se ve sin descargar. Apunta por
donde va en `app_settings`, asi que un reinicio la deja donde estaba. Solo
lee: no escribe nada en Telegram.
"""
import asyncio
import json
import logging

logger = logging.getLogger("tmd")

TANDA = 500
PAUSA_S = 1.0
# Mensajes que se leen antes del primer archivo pendiente, para encontrar la
# ficha que le toca (va encima).
MARGEN = 60


def _clave(channel_id: int) -> str:
    return f"relectura_{channel_id}"


async def _pendientes(channel_id: int) -> set[int]:
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return set()
    async with pool.acquire() as conn:
        filas = await conn.fetch(
            "SELECT message_id FROM media_items WHERE channel_id = $1 AND contexto_leido = FALSE", channel_id)
    return {f["message_id"] for f in filas}


async def releer_canal(downloader, channel_id: int, nombre: str, api_key: str = "") -> int:
    """Relee un canal. Devuelve cuantos archivos han recibido contexto."""
    from app.database.connection import get_app_settings, set_app_settings
    from app.database.media import borrar_de_temas, guardar_contexto, temas_ignorados
    from app.services.indexer import _contexto_a_item, ensure_enrich_worker, seguidor_para, ver
    from app.services.title_parser import parse_filename

    pendientes = await _pendientes(channel_id)
    if not pendientes:
        return 0
    entidad = downloader.channels.get(channel_id, {}).get("entity")
    if not entidad:
        logger.info("Relectura: canal %s sin resolver, se deja para otra vez", nombre)
        return 0

    guardado = (await get_app_settings()).get(_clave(channel_id)) or ""
    desde = max(int(guardado) if guardado.isdigit() else 0, min(pendientes) - MARGEN, 0)
    hasta = max(pendientes)
    ignorados = (await temas_ignorados()).get(channel_id, set())
    seguidor = seguidor_para(downloader)
    logger.info("Relectura de %s: %d archivos pendientes (mensajes %d a %d)",
                nombre, len(pendientes), desde, hasta)

    hechos = 0
    filas: list[tuple] = []
    a_borrar: set[int] = set()
    vistos = 0
    ultimo = desde

    async def volcar():
        nonlocal filas, hechos
        if filas:
            await guardar_contexto(filas)
            hechos += len(filas)
            filas = []
        await set_app_settings({_clave(channel_id): str(ultimo)})
        if api_key:
            ensure_enrich_worker(api_key)

    async for msg in downloader.client.iter_messages(entidad, reverse=True, offset_id=desde):
        ultimo = msg.id
        ctx = ver(seguidor, msg)
        if ctx and msg.id in pendientes:
            if ctx.tema in ignorados:
                a_borrar.add(ctx.tema)
            c = _contexto_a_item(ctx)
            # Con el limpiador de ahora: "La silla ª" pasa a "La silla", y
            # "Clarksons Farm 4x1" deja de ser una pelicula.
            p = parse_filename(downloader._get_file_name(msg) or "")
            filas.append((c.get("pie"), c.get("ficha"), c.get("tema_id"),
                          json.dumps(c["pistas"], ensure_ascii=False) if c.get("pistas") else None,
                          channel_id, msg.id, p.clean_title[:300], p.media_type, p.season, p.episode))
        vistos += 1
        if vistos % TANDA == 0:
            await volcar()
            await asyncio.sleep(PAUSA_S)
        if msg.id >= hasta:
            break
    await volcar()

    if a_borrar:
        quitados = await borrar_de_temas(channel_id, sorted(a_borrar))
        logger.info("Relectura de %s: %d archivos de temas ignorados quitados del catalogo", nombre, quitados)
    logger.info("Relectura de %s terminada: %d archivos con contexto", nombre, hechos)
    return hechos


async def releer_todo(downloader, api_key: str = "") -> int:
    from app.database.connection import get_active_channels

    total = 0
    for canal in await get_active_channels():
        try:
            total += await releer_canal(downloader, canal["id"], canal["name"], api_key)
        except Exception as e:
            # Un canal que falla no para los demas; el siguiente arranque
            # sigue por donde iba.
            logger.warning("Relectura de %s fallo: %s", canal["name"], e)
    return total


async def _al_dia_con_las_reglas() -> None:
    """Si las fichas se leian de otra forma la ultima vez (`contexto.VERSION`),
    lo releido se vuelve a releer: lo guardado se saco con las reglas viejas."""
    from app.database.connection import get_app_settings, set_app_settings
    from app.database.media import olvidar_contexto
    from app.services.contexto import VERSION

    if (await get_app_settings()).get("contexto_version") == str(VERSION):
        return
    n = await olvidar_contexto()
    await set_app_settings({"contexto_version": str(VERSION)})
    logger.info("Relectura: las fichas se leen de otra forma (version %d), se vuelven a leer %d archivos",
                VERSION, n)


async def relectura_de_fondo(downloader, api_key: str = "") -> None:
    """Al arrancar, con margen para que acabe de conectar y de escanear lo
    nuevo. Si queda algo (un reinicio a medias, un canal recien añadido que se
    indexo antes de esto), se reintenta cada pocas horas."""
    await asyncio.sleep(300)
    await _al_dia_con_las_reglas()
    while True:
        if downloader.client and downloader.client.is_connected():
            try:
                await releer_todo(downloader, api_key)
            except Exception as e:
                logger.error("Relectura fallo: %s", e)
        await asyncio.sleep(6 * 3600)
