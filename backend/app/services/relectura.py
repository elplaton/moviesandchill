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
# Espera al arrancar antes de la primera relectura, y cada cuanto se repite.
ESPERA_ARRANQUE_S = 300
CADA_S = 6 * 3600

# Lo que enseña Admin -> Canales mientras tanto: si esta en marcha, cuando
# empieza la siguiente y por donde va cada canal. Los numeros de archivos
# leidos y pendientes no viven aqui sino en la base de datos (`estado()`), que
# es lo unico que sobrevive a un reinicio.
_estado: dict = {"corriendo": False, "siguiente": None, "canales": {}}
_cerrojo = asyncio.Lock()


def _ahora() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _en(segundos: float) -> str:
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) + timedelta(seconds=segundos)).isoformat()


def _canal(channel_id: int, nombre: str, **cambios) -> None:
    c = _estado["canales"].setdefault(channel_id, {"nombre": nombre})
    c.update(cambios)


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
    from app.database.media import borrar_de_temas, guardar_contexto, marcar_leidos, temas_ignorados
    from app.services.indexer import _contexto_a_item, ensure_enrich_worker, seguidor_para, ver
    from app.services.title_parser import parse_filename

    pendientes = await _pendientes(channel_id)
    if not pendientes:
        _canal(channel_id, nombre, estado="al_dia", mensaje=None, hasta=None)
        return 0
    entidad = downloader.channels.get(channel_id, {}).get("entity")
    if not entidad:
        logger.info("Relectura: canal %s sin resolver, se deja para otra vez", nombre)
        _canal(channel_id, nombre, estado="sin_resolver")
        return 0

    guardado = (await get_app_settings()).get(_clave(channel_id)) or ""
    desde = max(int(guardado) if guardado.isdigit() else 0, min(pendientes) - MARGEN, 0)
    hasta = max(pendientes)
    ignorados = (await temas_ignorados()).get(channel_id, set())
    seguidor = seguidor_para(downloader)
    logger.info("Relectura de %s: %d archivos pendientes (mensajes %d a %d)",
                nombre, len(pendientes), desde, hasta)

    _canal(channel_id, nombre, estado="releyendo", empezo=_ahora(), desde=desde, hasta=hasta, mensaje=desde,
           error=None)
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

    vistos_ids: set[int] = set()
    async for msg in downloader.client.iter_messages(entidad, reverse=True, offset_id=desde):
        ultimo = msg.id
        vistos_ids.add(msg.id)
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
            _canal(channel_id, nombre, mensaje=ultimo)
            await asyncio.sleep(PAUSA_S)
        if msg.id >= hasta:
            break
    await volcar()

    # Lo pendiente que ya no esta en Telegram (mensajes borrados) no se puede
    # releer nunca: se da por leido, o cada vuelta recorreria el canal entero
    # desde el mas viejo de ellos para no encontrar nada.
    perdidos = [m for m in pendientes if m <= ultimo and m not in vistos_ids]
    if perdidos:
        await marcar_leidos(channel_id, perdidos)

    if a_borrar:
        quitados = await borrar_de_temas(channel_id, sorted(a_borrar))
        logger.info("Relectura de %s: %d archivos de temas ignorados quitados del catalogo", nombre, quitados)
    logger.info("Relectura de %s terminada: %d archivos con contexto", nombre, hechos)
    _canal(channel_id, nombre, estado="terminado", mensaje=ultimo, termino=_ahora())
    return hechos


async def releer_todo(downloader, api_key: str = "") -> int:
    """Relee todos los canales activos, uno detras de otro. Si ya hay una
    relectura en marcha (la de fondo o la del boton), no se lanza otra."""
    from app.database.connection import get_active_channels

    if _cerrojo.locked():
        return 0
    async with _cerrojo:
        _estado["corriendo"] = True
        _estado["siguiente"] = None
        try:
            await _al_dia_con_las_reglas()
            canales = await get_active_channels()
            for canal in canales:
                _canal(canal["id"], canal["name"], estado="en_cola")
            total = 0
            for canal in canales:
                try:
                    total += await releer_canal(downloader, canal["id"], canal["name"], api_key)
                except Exception as e:
                    # Un canal que falla no para los demas; el siguiente
                    # arranque sigue por donde iba.
                    logger.warning("Relectura de %s fallo: %s", canal["name"], e)
                    _canal(canal["id"], canal["name"], estado="fallo", error=str(e)[:200])
            return total
        finally:
            _estado["corriendo"] = False


def en_marcha() -> bool:
    return _cerrojo.locked()


async def estado() -> dict:
    """Como va la relectura, para el panel: lo de memoria (si esta en marcha,
    por que mensaje va) y, de la base de datos, cuantos archivos de cada canal
    tienen ya su contexto."""
    from app.database.connection import get_active_channels, get_pool

    contados = {}
    pool = get_pool()
    if pool:
        async with pool.acquire() as conn:
            filas = await conn.fetch("""
                SELECT channel_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE contexto_leido) AS leidos,
                       COUNT(*) FILTER (WHERE contexto_leido AND ficha IS NOT NULL) AS con_ficha
                  FROM media_items GROUP BY channel_id
            """)
        contados = {f["channel_id"]: dict(f) for f in filas}
    canales = []
    for c in await get_active_channels():
        mem = _estado["canales"].get(c["id"], {})
        n = contados.get(c["id"], {})
        canales.append({
            "channel_id": c["id"], "nombre": c["name"],
            "estado": mem.get("estado") or ("al_dia" if n.get("total") == n.get("leidos") else "pendiente"),
            "total": n.get("total", 0), "leidos": n.get("leidos", 0), "con_ficha": n.get("con_ficha", 0),
            "mensaje": mem.get("mensaje"), "desde": mem.get("desde"), "hasta": mem.get("hasta"),
            "empezo": mem.get("empezo"), "termino": mem.get("termino"), "error": mem.get("error"),
        })
    return {"corriendo": en_marcha(), "siguiente": _estado["siguiente"], "canales": canales}


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
    _estado["siguiente"] = _en(ESPERA_ARRANQUE_S)
    await asyncio.sleep(ESPERA_ARRANQUE_S)
    while True:
        if downloader.client and downloader.client.is_connected():
            try:
                await releer_todo(downloader, api_key)
            except Exception as e:
                logger.error("Relectura fallo: %s", e)
        _estado["siguiente"] = _en(CADA_S)
        await asyncio.sleep(CADA_S)
